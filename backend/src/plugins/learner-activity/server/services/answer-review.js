// @ts-nocheck
'use strict';

/**
 * Manual review of descriptive quiz answers (admin side).
 * Scoring / progress / learner notification live in src/utils/quiz-review.js.
 */

const { errors } = require('@strapi/utils');
const {
  MODULE_QUIZ_POPULATE,
  findModule,
  findModuleByQuestionIds,
  quizPassMark,
} = require('../../../../utils/course-modules');
const { REVIEW_STATUS, needsManualReview, applyQuizReview } = require('../../../../utils/quiz-review');
const { normalizeCompany, employeeName, learnerAnswer, expectedAnswer } = require('../utils/quiz-answers');

const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const COURSE_UID = 'api::course.course';
const LISTABLE_STATUSES = [REVIEW_STATUS.PENDING, REVIEW_STATUS.REVIEWED];

function companyMatches(submission, company) {
  if (!company) return true;
  return String(submission?.submitted_by?.company || '').toLowerCase() === company.toLowerCase();
}

/** courseRowIds: course rows (all versions or one version) chosen in the filter; null = any course. */
function courseMatches(submission, courseRowIds) {
  if (!courseRowIds) return true;
  return courseRowIds.has(Number(submission?.course?.id));
}

module.exports = ({ strapi }) => ({
  /** Attempts still waiting for a reviewer (drives the "Needs your action" overview and menu badge). */
  async countPending() {
    return strapi.db.query(QUIZ_UID).count({
      where: { review_status: REVIEW_STATUS.PENDING, publishedAt: { $notNull: true } },
    });
  },

  async listReviews({ company: companyRaw, courseRowIds = null, status: statusRaw }) {
    // "all" = waiting and reviewed attempts together (attempts without written answers are never listed).
    const all = statusRaw === 'all';
    const status = all ? null : LISTABLE_STATUSES.includes(statusRaw) ? statusRaw : REVIEW_STATUS.PENDING;
    const company = normalizeCompany(companyRaw);

    const submissions = await strapi.db.query(QUIZ_UID).findMany({
      where: {
        review_status: all ? { $in: LISTABLE_STATUSES } : status,
        publishedAt: { $notNull: true },
      },
      populate: {
        answers: true,
        submitted_by: { select: ['id', 'username', 'email', 'emp_id', 'emp_code', 'company'] },
        course: { select: ['id', 'documentId', 'title', 'course_version'] },
      },
      orderBy: { submitted_at: status === REVIEW_STATUS.PENDING ? 'asc' : 'desc' },
      limit: 5000,
    });

    const rows = (submissions || [])
      .filter((s) => companyMatches(s, company) && courseMatches(s, courseRowIds))
      .map((s) => {
        const answers = Array.isArray(s.answers) ? s.answers : [];
        const toReview = answers.filter(needsManualReview);
        return {
          id: s.id,
          emp_name: employeeName(s.submitted_by),
          emp_id: s.submitted_by?.emp_id || '-',
          emp_code: s.submitted_by?.emp_code || '-',
          course: s.course?.title || '-',
          course_version: s.course_version || s.course?.course_version || '',
          module: s.module_title || '-',
          attempt_number: s.attempt_number ?? null,
          submitted_at: s.submitted_at || null,
          review_status: s.review_status,
          descriptive_count: toReview.length,
          pending_count: toReview.filter((a) => typeof a.correct !== 'boolean').length,
          score: s.review_status === REVIEW_STATUS.REVIEWED ? s.score : null,
          passed: s.review_status === REVIEW_STATUS.REVIEWED ? s.passed === true : null,
          reviewed_by: s.reviewed_by || null,
          reviewed_at: s.reviewed_at || null,
        };
      });
    // In "all", attempts still waiting for review come first (oldest first), then reviewed ones.
    if (all) {
      const waiting = rows.filter((r) => r.review_status === REVIEW_STATUS.PENDING).reverse();
      return [...waiting, ...rows.filter((r) => r.review_status !== REVIEW_STATUS.PENDING)];
    }
    return rows;
  },

  async getReview(id) {
    const submission = await strapi.db.query(QUIZ_UID).findOne({
      where: { id: Number(id) },
      populate: {
        answers: true,
        submitted_by: { select: ['id', 'username', 'email', 'emp_id', 'emp_code'] },
        course: { select: ['id', 'documentId', 'title'] },
      },
    });
    if (!submission) throw new errors.NotFoundError('Quiz submission not found.');

    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const course = submission.course?.id
      ? await strapi.db.query(COURSE_UID).findOne({
          where: { id: Number(submission.course.id) },
          select: ['id', 'min_passing_score'],
          populate: { modules: { populate: MODULE_QUIZ_POPULATE } },
        })
      : null;
    const quizModule =
      findModule(course?.modules, submission.module_id) ||
      findModuleByQuestionIds(course, answers.map((a) => a?.question_id));
    const questions = Array.isArray(quizModule?.quiz?.quiz_questions) ? quizModule.quiz.quiz_questions : [];
    const questionById = new Map(questions.map((q) => [String(q.question_id), q]));

    return {
      id: submission.id,
      emp_name: employeeName(submission.submitted_by),
      emp_id: submission.submitted_by?.emp_id || null,
      emp_code: submission.submitted_by?.emp_code || null,
      course: submission.course?.title || null,
      course_version: submission.course_version || null,
      module: submission.module_title || quizModule?.title || null,
      time_taken_minutes: submission.time_taken_minutes ?? null,
      submission_type: submission.submission_type || null,
      attempt_number: submission.attempt_number ?? null,
      submitted_at: submission.submitted_at || null,
      review_status: submission.review_status || REVIEW_STATUS.NOT_REQUIRED,
      reviewed_by: submission.reviewed_by || null,
      reviewed_at: submission.reviewed_at || null,
      score: submission.review_status === REVIEW_STATUS.PENDING ? null : submission.score,
      passed: submission.review_status === REVIEW_STATUS.PENDING ? null : submission.passed === true,
      pass_mark: quizPassMark(course),
      total_questions: questions.length || answers.length,
      answers: answers.map((a) => {
        const question = questionById.get(String(a.question_id));
        return {
          question_id: a.question_id,
          question: question?.question_text || a.question || a.question_id,
          question_type: a.question_type,
          learner_answer: learnerAnswer(a, question),
          expected_answer: expectedAnswer(a, question),
          needs_review: needsManualReview(a),
          correct: typeof a.correct === 'boolean' ? a.correct : null,
        };
      }),
    };
  },

  async saveReview(id, body, adminUser) {
    // The submission row id can change when it is updated, so read it back by its new id.
    const result = await applyQuizReview(strapi, id, body, adminUser);
    return this.getReview(result?.id ?? id);
  },
});
