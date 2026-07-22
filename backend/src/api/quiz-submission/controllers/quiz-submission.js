// @ts-nocheck
"use strict";

/**
 * quiz-submission controller
 */

const { createCoreController } = require("@strapi/strapi").factories;

// ----------------------------------------------------------
// ⭐ SCORE CALCULATION LOGIC (standalone – avoids controller
//    type-inference conflict with createCoreController)
// ----------------------------------------------------------
/**
 * @param {any} strapi
 * @param {number} courseId
 * @param {any[]} answers
 * @returns {Promise<number>}
 */
async function calculateScore(strapi, courseId, answers, preloadedCourse = null) {
      const course = preloadedCourse || await strapi.db.query("api::course.course").findOne({
        where: { id: courseId },
        populate: {
          quiz: {
            populate: {
              quiz_questions: {
                populate: {
                  correct_multiSelect_answers: true,
                  options: true,
                }
              }
            }
          }
        }
      });

      // quiz is a repeatable component → array. Pick the block that best matches submitted question_ids.
      const answerQuestionIds = new Set(
        (Array.isArray(answers) ? answers : [])
          .map((a) => a?.question_id)
          .filter((id) => typeof id === 'string' && id.trim().length > 0)
      );

      const pickBestQuiz = (quizList) => {
        if (!Array.isArray(quizList) || quizList.length === 0) return null;
        if (answerQuestionIds.size === 0) return quizList[0];

        let best = quizList[0];
        let bestMatchCount = -1;

        quizList.forEach((qz) => {
          const qList = Array.isArray(qz?.quiz_questions) ? qz.quiz_questions : [];
          const matchCount = qList.reduce((count, q) => {
            return count + (answerQuestionIds.has(q?.question_id) ? 1 : 0);
          }, 0);

          if (matchCount > bestMatchCount) {
            best = qz;
            bestMatchCount = matchCount;
          }
        });

        return best;
      };

      const quiz = pickBestQuiz(course?.quiz);
      if (!quiz?.quiz_questions || quiz.quiz_questions.length === 0) return 0;

      const questions = quiz.quiz_questions;
      let earnedPoints = 0;
      let totalPoints = 0;

      const normalizeToken = (v) => {
        if (v == null) return '';
        return String(v).trim().toLowerCase();
      };

      const areSetsEqual = (a, b) => {
        if (a.size !== b.size) return false;
        for (const v of a) {
          if (!b.has(v)) return false;
        }
        return true;
      };

      // Accept either option key or label in submissions and stored answers.
      const buildEquivalentChoiceTokens = (question, rawValue) => {
        const token = normalizeToken(rawValue);
        const out = new Set();
        if (!token) return out;
        out.add(token);

        const options = Array.isArray(question?.options) ? question.options : [];
        options.forEach((opt) => {
          const key = normalizeToken(opt?.option_key);
          const label = normalizeToken(opt?.option_label);
          if (!key && !label) return;
          if (token === key || token === label) {
            if (key) out.add(key);
            if (label) out.add(label);
          }
        });

        return out;
      };

      const extractSubmittedMultiSelectValues = (submitted) => {
        if (!Array.isArray(submitted)) return [];
        return submitted
          .map((item) => {
            if (item == null) return null;
            if (typeof item === 'string' || typeof item === 'number') return item;
            if (typeof item === 'object') {
              return item.answer ?? item.option_key ?? item.option_label ?? null;
            }
            return null;
          })
          .filter((v) => v != null);
      };

      // Helper: use point from question if present, else 1 point per question (when point field removed)
      const getPoints = (q) => {
        const p = Number(q?.point);
        return p > 0 ? p : 1;
      };

      // Sum all possible points across every question
      questions.forEach(q => { totalPoints += getPoints(q); });
      if (totalPoints === 0) return 0;

      // 2. Compare submitted answers with correct answers
      if (Array.isArray(answers)) {
        answers.forEach(ans => {
          const q = questions.find(q => q.question_id === ans.question_id);
          if (!q) return;

          const pts = getPoints(q);

          // -----------------------------
          // MULTIPLE CHOICE LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_choice") {
            const submittedChoice = buildEquivalentChoiceTokens(q, ans.selected_answer_for_multiChoice);
            const correctChoice = buildEquivalentChoiceTokens(q, q.correct_answer);
            const isCorrect = [...submittedChoice].some((token) => correctChoice.has(token));

            if (isCorrect) {
              earnedPoints += pts;
            }
          }

          // -----------------------------
          // MULTI-SELECT LOGIC
          // -----------------------------
          if (ans.question_type === "Multiple_select") {
            const userSelected = extractSubmittedMultiSelectValues(ans.selected_answer_for_multiSelect);
            const correctOptions = q.correct_multiSelect_answers || [];

            const userTokens = new Set();
            userSelected.forEach((value) => {
              buildEquivalentChoiceTokens(q, value).forEach((t) => userTokens.add(t));
            });

            const correctRaw = correctOptions
              .map((item) => item?.answer)
              .filter((v) => v != null);
            const correctTokens = new Set();
            correctRaw.forEach((value) => {
              buildEquivalentChoiceTokens(q, value).forEach((t) => correctTokens.add(t));
            });

            // Collapse equivalent key/label representations to canonical tokens where possible.
            const canonicalize = (tokenSet) => {
              const canonical = new Set();
              const options = Array.isArray(q?.options) ? q.options : [];

              tokenSet.forEach((token) => {
                let mapped = token;
                options.forEach((opt) => {
                  const key = normalizeToken(opt?.option_key);
                  const label = normalizeToken(opt?.option_label);
                  if (token === label && key) mapped = key;
                });
                canonical.add(mapped);
              });

              return canonical;
            };

            const match = areSetsEqual(canonicalize(userTokens), canonicalize(correctTokens));

            if (match) {
              earnedPoints += pts;
            }
          }
        });
      }

      // Return percentage 0–100 (frontend displays "{score}%")
      return Math.round((earnedPoints / totalPoints) * 100);
}

/**
 * Build per-answer correctness map keyed by question_id so quiz.answer.correct
 * can be saved and shown in Content Manager.
 *
 * @param {any} course
 * @param {any[]} answers
 * @returns {Map<string, boolean>}
 */
function buildAnswerCorrectnessMap(course, answers) {
  const out = new Map();
  const quizList = Array.isArray(course?.quiz) ? course.quiz : [];
  const questions = [];
  quizList.forEach((qz) => {
    if (Array.isArray(qz?.quiz_questions)) questions.push(...qz.quiz_questions);
  });
  if (questions.length === 0 || !Array.isArray(answers)) return out;

  const normalizeToken = (v) => {
    if (v == null) return '';
    return String(v).trim().toLowerCase();
  };

  const areSetsEqual = (a, b) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  const buildEquivalentChoiceTokens = (question, rawValue) => {
    const token = normalizeToken(rawValue);
    const result = new Set();
    if (!token) return result;
    result.add(token);

    const options = Array.isArray(question?.options) ? question.options : [];
    options.forEach((opt) => {
      const key = normalizeToken(opt?.option_key);
      const label = normalizeToken(opt?.option_label);
      if (!key && !label) return;
      if (token === key || token === label) {
        if (key) result.add(key);
        if (label) result.add(label);
      }
    });
    return result;
  };

  const extractSubmittedMultiSelectValues = (submitted) => {
    if (!Array.isArray(submitted)) return [];
    return submitted
      .map((item) => {
        if (item == null) return null;
        if (typeof item === 'string' || typeof item === 'number') return item;
        if (typeof item === 'object') {
          return item.answer ?? item.option_key ?? item.option_label ?? null;
        }
        return null;
      })
      .filter((v) => v != null);
  };

  const canonicalize = (question, tokenSet) => {
    const canonical = new Set();
    const options = Array.isArray(question?.options) ? question.options : [];
    tokenSet.forEach((token) => {
      let mapped = token;
      options.forEach((opt) => {
        const key = normalizeToken(opt?.option_key);
        const label = normalizeToken(opt?.option_label);
        if (token === label && key) mapped = key;
      });
      canonical.add(mapped);
    });
    return canonical;
  };

  answers.forEach((ans) => {
    const qid = typeof ans?.question_id === 'string' ? ans.question_id : '';
    if (!qid) return;
    const q = questions.find((qq) => qq?.question_id === qid);
    if (!q) return;

    let isCorrect = false;

    if (ans?.question_type === 'Multiple_choice') {
      const submittedChoice = buildEquivalentChoiceTokens(q, ans?.selected_answer_for_multiChoice);
      const correctChoice = buildEquivalentChoiceTokens(q, q?.correct_answer);
      isCorrect = [...submittedChoice].some((token) => correctChoice.has(token));
    } else if (ans?.question_type === 'Multiple_select') {
      const userSelected = extractSubmittedMultiSelectValues(ans?.selected_answer_for_multiSelect);
      const correctOptions = Array.isArray(q?.correct_multiSelect_answers) ? q.correct_multiSelect_answers : [];

      const userTokens = new Set();
      userSelected.forEach((value) => {
        buildEquivalentChoiceTokens(q, value).forEach((t) => userTokens.add(t));
      });

      const correctTokens = new Set();
      correctOptions
        .map((item) => item?.answer)
        .filter((v) => v != null)
        .forEach((value) => {
          buildEquivalentChoiceTokens(q, value).forEach((t) => correctTokens.add(t));
        });

      isCorrect = areSetsEqual(canonicalize(q, userTokens), canonicalize(q, correctTokens));
    }

    out.set(qid, Boolean(isCorrect));
  });

  return out;
}

async function resolveCourseNumericId(strapi, rawCourseId) {
  if (rawCourseId == null || rawCourseId === '') return null;

  const asNumber = Number(rawCourseId);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // In Strapi v5, draftAndPublish types have two rows per document.
    // Always resolve to the published row so entityService populate works.
    const publishedById = await strapi.db.query('api::course.course').findOne({
      where: { id: asNumber, publishedAt: { $notNull: true } },
      select: ['id'],
    });
    if (publishedById?.id != null) return Number(publishedById.id);

    // The id might be the draft row — find published sibling via documentId
    const anyRow = await strapi.db.query('api::course.course').findOne({
      where: { id: asNumber },
      select: ['id', 'documentId'],
    });
    if (anyRow?.documentId) {
      const publishedByDocId = await strapi.db.query('api::course.course').findOne({
        where: { documentId: anyRow.documentId, publishedAt: { $notNull: true } },
        select: ['id'],
      });
      if (publishedByDocId?.id != null) return Number(publishedByDocId.id);
      // Course is unpublished — fall back to the draft row id
      return Number(anyRow.id);
    }
  }

  const asDocumentId = String(rawCourseId).trim();
  if (!asDocumentId) return null;

  // Prefer published row when resolving by documentId
  const publishedByDocId = await strapi.db.query('api::course.course').findOne({
    where: { documentId: asDocumentId, publishedAt: { $notNull: true } },
    select: ['id'],
  });
  if (publishedByDocId?.id != null) return Number(publishedByDocId.id);

  const anyByDocId = await strapi.db.query('api::course.course').findOne({
    where: { documentId: asDocumentId },
    select: ['id'],
  });
  return anyByDocId?.id != null ? Number(anyByDocId.id) : null;
}

module.exports = createCoreController(
  "api::quiz-submission.quiz-submission",
  ({ strapi }) => ({

    // ----------------------------------------------------------
    // ⭐ GET LATEST SUBMISSION
    // ----------------------------------------------------------
    async getLatest(ctx) {
      const { userId, courseId } = ctx.query;

      if (!userId || !courseId) {
        return ctx.badRequest('userId and courseId are required');
      }

      const submission = await strapi.db
        .query('api::quiz-submission.quiz-submission')
        .findOne({
          where: { submitted_by: Number(userId), course: Number(courseId) },
          orderBy: { attempt_number: 'desc' },
        });

      // Fetch maxAttempt from course so the frontend can display "Attempt X of Y"
      const course = await strapi.db.query('api::course.course').findOne({
        where: { id: Number(courseId) },
        populate: { quiz: true },
      });
      const maxAttempt = course?.quiz?.[0]?.max_attempt ?? 1;

      // Frontend (AssessmentQuiz.jsx) reads: resultRes?.submission and resultRes?.maxAttempt
      return ctx.send({ submission: submission || null, maxAttempt });
    },

    // ----------------------------------------------------------
    // ⭐ QUIZ SUBMIT
    // ----------------------------------------------------------
    async submit(ctx) {
      try {
        const {
          userId,
          courseId: courseIdParam,
          course: courseParam,
          answers,
          time_taken_minutes: timeTakenRaw,
          submitted_at: submittedAtRaw,
          submission_type: submissionTypeRaw,
        } = ctx.request.body;

          // Accept either numeric id or documentId from frontend
          const courseInput = courseIdParam ?? courseParam;
          const courseId = await resolveCourseNumericId(strapi, courseInput);
          const userIdNum = Number(userId);
  // Enforce minimum 1 minute — never store 0
  const time_taken_minutes = Math.max(1, Math.round(Number(timeTakenRaw ?? 0)));
  const submitted_at = submittedAtRaw ? new Date(submittedAtRaw) : new Date();

        // Validate and normalise submission_type against schema enum values
        const VALID_SUBMISSION_TYPES = ['Auto Submit or Leave', 'Time Limit Exceed', 'Manual Submit'];
        const submission_type = VALID_SUBMISSION_TYPES.includes(submissionTypeRaw)
          ? submissionTypeRaw
          : 'Manual Submit';

        if (!userIdNum || !courseId) {
          return ctx.badRequest("userId and courseId required");
        }

        // ------------------------------------------------------
        // 0. If admin rejected a reattempt within the last 24h → block assessment (after 24h user can request again)
        // ------------------------------------------------------
        const REJECTION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

          const [course, rejectedList, lastSubmission] = await Promise.all([
          strapi.db.query("api::course.course").findOne({
            where: { id: Number(courseId) },
            populate: {
              quiz: {
                populate: {
                  quiz_questions: {
                    populate: {
                      correct_multiSelect_answers: true,
                      options: true,
                    },
                  },
                },
              },
              company: true,
            },
          }),
          strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .findMany({
              where: {
                course: Number(courseId),
                users_permissions_user: userIdNum,
                request_status: "Rejected",
              },
              orderBy: { updatedAt: "desc" },
              limit: 1,
            }),
          strapi.db
            .query("api::quiz-submission.quiz-submission")
            .findOne({
              where: { submitted_by: userIdNum, course: courseId },
              orderBy: { attempt_number: "desc" },
            }),
        ]);

        const latestRejected = Array.isArray(rejectedList) && rejectedList.length > 0 ? rejectedList[0] : null;
        if (latestRejected && latestRejected.updatedAt) {
          const rejectedAt = new Date(latestRejected.updatedAt).getTime();
          if (Date.now() - rejectedAt < REJECTION_COOLDOWN_MS) {
            return ctx.forbidden(
              "Your reattempt request was rejected. You can submit a new request after 24 hours."
            );
          }
        }

        // ------------------------------------------------------
        // 1. Fetch course (for passing score + attempt limit)
        // ------------------------------------------------------
        if (!course) return ctx.badRequest(`Invalid course (id=${courseId})`);

        const minPassingScoreRaw = Number(course.min_passing_score);
        const minPassingScore = Number.isFinite(minPassingScoreRaw) ? minPassingScoreRaw : 0;
        // quiz is a repeatable component → array
        const maxAttempt = course.quiz?.[0]?.max_attempt ?? 1;

        const lastAttempt = lastSubmission?.attempt_number || 0;
        const nextAttempt = lastAttempt + 1;

        // ------------------------------------------------------
        // 3. Calculate score securely (backend only)
        // ------------------------------------------------------
        const scoreRaw = await calculateScore(strapi, courseId, answers, course);
        const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : 0;
        const passed = score >= minPassingScore;

        // Check for approved reattempt (deterministic selection by attempt number)
        strapi.log.info({ courseId, userId: userIdNum, nextAttempt }, '[quiz-submit][reattempt-select] Phase 1 — exact match lookup');

        let approvedRequest = await strapi.db
          .query("api::quiz-reattempt-request.quiz-reattempt-request")
          .findOne({
            where: {
              course: courseId,
              users_permissions_user: userIdNum,
              request_status: "Approved",
              requested_for_attempt: nextAttempt,
            },
          });

        strapi.log.info({
          found: !!approvedRequest,
          requestId: approvedRequest?.id ?? null,
          requested_for_attempt: approvedRequest?.requested_for_attempt ?? null,
          adminCreated: approvedRequest?.adminCreated ?? null,
        }, '[quiz-submit][reattempt-select] Phase 1 result');

        if (!approvedRequest) {
          strapi.log.info({ courseId, userId: userIdNum }, '[quiz-submit][reattempt-select] Phase 2 — fallback to oldest Approved');

          const fallbackList = await strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .findMany({
              where: {
                course: courseId,
                users_permissions_user: userIdNum,
                request_status: "Approved",
              },
              orderBy: { requested_for_attempt: "asc" },
              limit: 1,
            });

          approvedRequest = Array.isArray(fallbackList) && fallbackList.length > 0
            ? fallbackList[0]
            : null;

          strapi.log.info({
            found: !!approvedRequest,
            requestId: approvedRequest?.id ?? null,
            requested_for_attempt: approvedRequest?.requested_for_attempt ?? null,
            adminCreated: approvedRequest?.adminCreated ?? null,
          }, '[quiz-submit][reattempt-select] Phase 2 result');
        }

        if (approvedRequest) {
          strapi.log.info({
            requestId: approvedRequest.id,
            requested_for_attempt: approvedRequest.requested_for_attempt,
            nextAttempt,
          }, '[quiz-submit][reattempt-consume] Marking request as Used');

          // Mark the selected approved request as Used
          await strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .update({
              where: { id: approvedRequest.id },
              data: { request_status: "Used" },
            });

          // Also consume any other Approved rows for the same attempt number.
          // This prevents duplicate admin-created rows for the same slot from
          // remaining in Approved state after the first one is consumed.
          const duplicateApproved = await strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .findMany({
              where: {
                course: courseId,
                users_permissions_user: userIdNum,
                request_status: "Approved",
                requested_for_attempt: approvedRequest.requested_for_attempt,
              },
            });

          if (Array.isArray(duplicateApproved) && duplicateApproved.length > 0) {
            strapi.log.info({
              count: duplicateApproved.length,
              attempt: approvedRequest.requested_for_attempt,
            }, '[quiz-submit][reattempt-consume] consuming duplicate Approved rows for same attempt');

            await Promise.all(
              duplicateApproved.map((dup) =>
                strapi.db
                  .query("api::quiz-reattempt-request.quiz-reattempt-request")
                  .update({ where: { id: dup.id }, data: { request_status: "Used" } })
              )
            );
          }

          strapi.log.info({ requestId: approvedRequest.id }, '[quiz-submit][reattempt-consume] Request(s) marked Used successfully');
        } else if (nextAttempt > maxAttempt) {
          strapi.log.info({ nextAttempt, maxAttempt, userId: userIdNum, courseId }, '[quiz-submit][reattempt-block] No approved request & max attempts exceeded');
          return ctx.send({
            message: `Max attempts reached (${maxAttempt}). Request reattempt.`,
            reattempt_required: true,
          });
        }

        // ------------------------------------------------------
        // 6. Create quiz submission
        // strapi.entityService handles repeatable components (answers)
        // correctly; strapi.db.query().create() cannot build component
        // records from raw data and throws "Invalid id" on [object Object].
        // Sanitize answers: ensure required 'question' field is never null.
        // ------------------------------------------------------
        const correctnessByQuestionId = buildAnswerCorrectnessMap(course, answers);
        const sanitizedAnswers = (Array.isArray(answers) ? answers : []).map((a) => {
          const questionId = a.question_id || a.question || 'unknown';
          const isCorrect = correctnessByQuestionId.get(questionId) ?? false;
          const questionType = a.question_type || 'Multiple_choice';

          const base = {
            ...a,
            question: a.question || a.question_id || 'Unknown',
            question_id: questionId,
            question_type: questionType,
            correct: isCorrect,
          };

          // Keep only the answer field relevant to the selected question type.
          // This avoids validation conflicts when one answer type field is required/hidden by conditions.
          if (questionType === 'Multiple_select') {
            return {
              ...base,
              selected_answer_for_multiSelect: a.selected_answer_for_multiSelect ?? [],
            };
          }

          return {
            ...base,
            selected_answer_for_multiChoice: a.selected_answer_for_multiChoice ?? '',
          };
        });
        const correctTrueCount = sanitizedAnswers.filter((a) => a?.correct === true).length;
        const correctFalseCount = sanitizedAnswers.filter((a) => a?.correct === false).length;
        strapi.log.info(
          '[quiz-submit] answers prepared courseId=%s userId=%s total=%s true=%s false=%s',
          courseId,
          userIdNum,
          sanitizedAnswers.length,
          correctTrueCount,
          correctFalseCount
        );
        const entry = await strapi.entityService.create(
          "api::quiz-submission.quiz-submission",
          {
            data: /** @type {any} */ ({
              answers: sanitizedAnswers,
              score,
              passed,
              course: Number(courseId),
              submitted_by: userIdNum,
              attempt_number: nextAttempt,
              submitted_at,
              time_taken_minutes,
              submission_type,
              publishedAt: new Date(), // publish immediately, not draft
            }),
          }
        );

        // Safety net: enforce component boolean persistence even if create path strips nested keys.
        await strapi.entityService.update("api::quiz-submission.quiz-submission", entry.id, {
          data: /** @type {any} */ ({ answers: sanitizedAnswers }),
        });
        strapi.log.info(
          '[quiz-submit] answers persisted entryId=%s with explicit correct flags',
          entry.id
        );

        let populatedSubmission = /** @type {any} */ (await strapi.db.query("api::quiz-submission.quiz-submission").findOne({
          where: { id: entry.id },
          populate: {
            course: true,
            submitted_by: true,
          },
        }));

        if (!populatedSubmission?.course) {
          await strapi.entityService.update("api::quiz-submission.quiz-submission", entry.id, {
            data: /** @type {any} */ ({ course: Number(courseId) }),
          });

          populatedSubmission = /** @type {any} */ (await strapi.db.query("api::quiz-submission.quiz-submission").findOne({
            where: { id: entry.id },
            populate: {
              course: true,
              submitted_by: true,
            },
          }));
        }
  
        // When user failed and this attempt used all allowed attempts → show re-attempt (e.g. max_attempt=1, failed 1st time)
        const reattemptRequired = !passed && nextAttempt >= maxAttempt;

        let hasPendingReattempt = false;
        if (reattemptRequired) {
          const pendingRequest = await strapi.db
            .query("api::quiz-reattempt-request.quiz-reattempt-request")
            .findOne({
              where: {
                course: Number(courseId),
                users_permissions_user: Number(userId),
                request_status: "Pending",
              },
            });
          hasPendingReattempt = Boolean(pendingRequest);
        }

        // Non-blocking post-submit tasks to keep API latency low under load.
        setImmediate(async () => {
          try {
            /** @type {any} */
            const userProgressController = strapi.controller("api::user-progress.user-progress");
            await userProgressController.updateAfterQuiz(courseId, userId, passed);
          } catch (err) {
            strapi.log.error("updateAfterQuiz error:", err);
          }

          try {
            /** @type {any} */
            const strapiAny = strapi;
            const notifUtil = strapiAny?.utils?.notification;
            if (!notifUtil) return;

            let userName = null;
            try {
              const userRow = await strapi.db
                .query("plugin::users-permissions.user")
                .findOne({ where: { id: Number(userId) }, select: ["username", "email"] });
              userName = userRow?.username || userRow?.email || null;
            } catch {}

            const courseTitle = course?.title || null;
            const courseDocumentId = course?.documentId || null;
            const companyCandidates = Array.isArray(course?.company) ? course.company : course?.company ? [course.company] : [];
            const company = companyCandidates[0]?.name || null;
            const meta = { courseId, userId, score, passed, courseTitle, userName, courseDocumentId, company };
            await notifUtil.sendNotification(
              "quiz_submitted",
              "Quiz Submitted",
              `${userName || `User #${userId}`} has submitted the quiz${courseTitle ? ` for \"${courseTitle}\"` : ""}. Score: ${score}% - ${passed ? "PASSED" : "FAILED"}. Please review the result in the admin panel.`,
              [],
              meta,
              ["admin", "LMadmin"],
              { sendEmail: true, sendSocket: true }
            );
          } catch (err) {
            strapi.log.error("quiz notification error:", err);
          }
        });

      return ctx.send({
        message: "Quiz submitted successfully",
        submission: populatedSubmission || entry,
        maxAttempt,
        has_pending_reattempt: hasPendingReattempt,
        ...(reattemptRequired && { reattempt_required: true }),
      });

    } catch (err) {
      console.error("[quiz submit error]", err);
      try {
        strapi.log.error(`[quiz submit error details] ${JSON.stringify(err?.details || {}, null, 2)}`);
      } catch {
        strapi.log.error('[quiz submit error details] unavailable');
      }
      return ctx.internalServerError(err?.message || "Failed to submit quiz");
    }
    }

  })
);