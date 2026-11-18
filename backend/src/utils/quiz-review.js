// @ts-nocheck
'use strict';

/**
 * Manual review of descriptive quiz answers.
 *
 * On submit, Multiple_choice / Multiple_select answers are auto-graded. A non-empty Descriptive
 * answer is saved with correct = null and the submission gets review_status = Pending_review:
 * its score only covers the auto-graded part and passed stays false, so the module is neither
 * passed nor failed until an admin marks every descriptive answer. The admin review sets
 * an integer score from 0–10 per descriptive answer, then the final score / passed are derived
 * from the weighted points (1 point per objective question and 10 maximum per descriptive one).
 */

const { errors } = require('@strapi/utils');
const {
  MODULE_QUIZ_POPULATE,
  findModule,
  findModuleByQuestionIds,
  quizPassMark,
  recomputeProgress,
} = require('./course-modules');

const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';
const COURSE_UID = 'api::course.course';

// Max characters of a learner's descriptive answer: quiz.answer.user_answer_for_descriptive_question maxLength
// (the learner quiz textarea uses the same limit).
const DESCRIPTIVE_ANSWER_MAX_LENGTH = 1300;

const REVIEW_STATUS = {
  NOT_REQUIRED: 'Not_required',
  PENDING: 'Pending_review',
  REVIEWED: 'Reviewed',
};

function isDescriptive(answer) {
  return answer?.question_type === 'Descriptive';
}

/** A descriptive answer with text needs an admin; an empty one is simply wrong. */
function needsManualReview(answer) {
  return isDescriptive(answer) && String(answer?.user_answer_for_descriptive_question ?? '').trim().length > 0;
}

function isPendingReview(submission) {
  return submission?.review_status === REVIEW_STATUS.PENDING;
}

function reviewerName(adminUser) {
  if (!adminUser) return null;
  const full = `${adminUser.firstname || ''} ${adminUser.lastname || ''}`.trim();
  return full || adminUser.username || adminUser.email || null;
}

/** Weighted percentage: objective questions are worth 1; descriptive questions are worth 10. */
function scoreFromAnswers(answers, quizQuestions) {
  const questions = Array.isArray(quizQuestions) ? quizQuestions : [];
  const questionById = new Map(questions.map((q) => [String(q?.question_id || ''), q]));
  const validAnswers = (answers || []).filter((a) => {
    return !questionById.size || questionById.has(String(a?.question_id || ''));
  });
  const scoreQuestions = questions.length ? questions : validAnswers;
  const totalPoints = scoreQuestions.reduce((sum, q) => sum + (q?.question_type === 'Descriptive' ? 10 : 1), 0);
  if (!totalPoints) return 0;

  const earnedPoints = validAnswers.reduce((sum, answer) => {
    const question = questionById.get(String(answer?.question_id || '')) || answer;
    if (question?.question_type === 'Descriptive') {
      // Legacy reviews only stored correct; preserve their old all-or-nothing outcome.
      const points = Number.isInteger(answer?.point) ? answer.point : answer?.correct === true ? 10 : 0;
      return sum + Math.max(0, Math.min(10, points));
    }
    return sum + (answer?.correct === true ? 1 : 0);
  }, 0);
  return Math.round((earnedPoints / totalPoints) * 100);
}

/** Copy a stored answer component for re-saving (component rows are recreated on update). */
function toAnswerData(answer) {
  const { id, __component, ...rest } = answer || {};
  // Answers saved before the character limit (DESCRIPTIVE_ANSWER_MAX_LENGTH) would fail schema validation on this update.
  if (typeof rest.user_answer_for_descriptive_question === 'string') {
    rest.user_answer_for_descriptive_question = rest.user_answer_for_descriptive_question.slice(0, DESCRIPTIVE_ANSWER_MAX_LENGTH);
  }
  return rest;
}

/**
 * Apply an admin review to a submission.
 * @param {object} input  { answers: [{ question_id, point: integer (0–10) }] }
 * @returns updated submission summary
 */
async function applyQuizReview(strapi, submissionId, input, adminUser) {
  const submission = await strapi.db.query(QUIZ_SUBMISSION_UID).findOne({
    where: { id: Number(submissionId) },
    populate: {
      answers: true,
      course: { select: ['id', 'documentId', 'title'] },
      submitted_by: { select: ['id', 'email', 'username'] },
    },
  });
  if (!submission) throw new errors.NotFoundError('Quiz submission not found.');
  // A published review is final.
  if (submission.review_status === REVIEW_STATUS.REVIEWED) {
    throw new errors.ValidationError('This attempt has already been reviewed; the decision cannot be changed.');
  }

  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  if (!answers.some(isDescriptive)) {
    throw new errors.ValidationError('This submission has no descriptive answers to review.');
  }

  const reviews = new Map(
    (Array.isArray(input?.answers) ? input.answers : [])
      .filter((r) => r && r.question_id != null)
      .map((r) => [String(r.question_id), r])
  );

  const missing = [];
  const invalid = [];
  const nextAnswers = answers.map((answer) => {
    const data = toAnswerData(answer);
    if (!isDescriptive(answer)) return data;
    if (!needsManualReview(answer)) return { ...data, point: 0, correct: false };

    const review = reviews.get(String(answer.question_id));
    if (!Number.isInteger(review?.point)) {
      missing.push(answer.question || answer.question_id);
      return data;
    }
    if (review.point < 0 || review.point > 10) {
      invalid.push(answer.question || answer.question_id);
      return data;
    }
    return { ...data, point: review.point, correct: null };
  });
  if (invalid.length > 0) {
    throw new errors.ValidationError(`Descriptive points must be an integer from 0 to 10 (${invalid.length} invalid).`);
  }
  if (missing.length > 0) {
    throw new errors.ValidationError(`Enter points from 0 to 10 for every descriptive answer (${missing.length} left).`);
  }

  const courseId = submission.course?.id;
  const course = courseId
    ? await strapi.db.query(COURSE_UID).findOne({
        where: { id: Number(courseId) },
        populate: { modules: { populate: MODULE_QUIZ_POPULATE } },
      })
    : null;
  const quizModule =
    findModule(course?.modules, submission.module_id) ||
    findModuleByQuestionIds(course, answers.map((a) => a?.question_id));
  const score = scoreFromAnswers(nextAnswers, quizModule?.quiz?.quiz_questions);
  const passed = score >= quizPassMark(course);

  const data = {
    answers: nextAnswers,
    score,
    passed,
    review_status: REVIEW_STATUS.REVIEWED,
    reviewed_at: new Date(),
    reviewed_by: reviewerName(adminUser),
  };

  // Keep every row of the document (draft + published) in sync. Updating a published row can
  // recreate it under a new id (Strapi 5), so rows are re-read by documentId before each update.
  const updatedIds = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const rows = submission.documentId
      ? await strapi.db.query(QUIZ_SUBMISSION_UID).findMany({ where: { documentId: submission.documentId }, select: ['id'] })
      : [{ id: submission.id }];
    const next = rows.find((r) => !updatedIds.has(r.id));
    if (!next) break;
    await strapi.entityService.update(QUIZ_SUBMISSION_UID, next.id, { data });
    updatedIds.add(next.id);
  }

  const userId = submission.submitted_by?.id;
  if (userId && courseId) {
    try {
      await recomputeProgress(strapi, { userId: Number(userId), courseId: Number(courseId) });
    } catch (e) {
      strapi.log.error('[quiz-review] progress recompute failed:', e?.message || e);
    }
  }

  await notifyLearner(strapi, { submission, score, passed, quizModule });

  strapi.log.info(
    '[quiz-review] submission=%s reviewed by %s → score=%s passed=%s',
    submission.id,
    data.reviewed_by || 'admin',
    score,
    passed
  );
  return {
    id: await currentSubmissionId(strapi, submission),
    documentId: submission.documentId || null,
    score,
    passed,
    review_status: data.review_status,
    reviewed_at: data.reviewed_at,
  };
}

/** Row id of the submission after an update (published row first; ids can change on update). */
async function currentSubmissionId(strapi, submission) {
  if (!submission?.documentId) return submission?.id ?? null;
  const published = await strapi.db.query(QUIZ_SUBMISSION_UID).findOne({
    where: { documentId: submission.documentId, publishedAt: { $notNull: true } },
    select: ['id'],
  });
  if (published?.id != null) return published.id;
  const any = await strapi.db.query(QUIZ_SUBMISSION_UID).findOne({ where: { documentId: submission.documentId }, select: ['id'] });
  return any?.id ?? submission.id;
}

async function notifyLearner(strapi, { submission, score, passed, quizModule }) {
  const notifUtil = strapi.utils?.notification;
  const user = submission.submitted_by;
  if (!notifUtil || !user?.id) return;
  const courseTitle = submission.course?.title || null;
  const moduleTitle = submission.module_title || quizModule?.title || null;
  try {
    await notifUtil.sendNotification(
      'quiz_reviewed',
      'Quiz Result Available',
      `Your quiz${moduleTitle ? ` for module "${moduleTitle}"` : ''}${courseTitle ? ` in "${courseTitle}"` : ''} has been reviewed. Final score: ${score}% — ${passed ? 'PASSED' : 'NOT PASSED'}.`,
      [{ id: user.id, email: user.email }],
      {
        courseId: submission.course?.id ?? null,
        courseDocumentId: submission.course?.documentId ?? null,
        courseTitle,
        moduleId: submission.module_id ?? null,
        moduleTitle,
        score,
        passed,
      },
      [],
      { sendEmail: typeof notifUtil.isEmailEnabled === 'function' ? notifUtil.isEmailEnabled() : false, sendSocket: true }
    );
  } catch (e) {
    strapi.log.error('[quiz-review] learner notification failed:', e?.message || e);
  }
}

module.exports = {
  REVIEW_STATUS,
  DESCRIPTIVE_ANSWER_MAX_LENGTH,
  isDescriptive,
  needsManualReview,
  isPendingReview,
  scoreFromAnswers,
  applyQuizReview,
};
