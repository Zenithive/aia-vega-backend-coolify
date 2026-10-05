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
const {
  REVIEW_STATUS,
  isDescriptive,
  needsManualReview,
  applyQuizReview,
} = require('../../../../utils/quiz-review');

const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const COURSE_UID = 'api::course.course';
const LISTABLE_STATUSES = [REVIEW_STATUS.PENDING, REVIEW_STATUS.REVIEWED];

function normalizeCompany(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'aia') return 'AIA';
  if (text === 'vega') return 'Vega';
  return '';
}

function employeeName(user = {}) {
  return user.username || user.email || '-';
}

function optionLabel(question, value) {
  const token = String(value ?? '').trim();
  if (!token) return '';
  const options = Array.isArray(question?.options) ? question.options : [];
  const hit = options.find(
    (o) => String(o?.option_key ?? '').trim() === token || String(o?.option_label ?? '').trim() === token
  );
  return hit ? String(hit.option_label || hit.option_key) : token;
}

function multiSelectValues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (item && typeof item === 'object' ? item.answer ?? item.option_key ?? item.option_label : item))
    .filter((v) => v != null && String(v).trim() !== '');
}

function learnerAnswer(answer, question) {
  if (isDescriptive(answer)) return String(answer.user_answer_for_descriptive_question ?? '');
  if (answer.question_type === 'Multiple_select') {
    return multiSelectValues(answer.selected_answer_for_multiSelect).map((v) => optionLabel(question, v)).join(', ');
  }
  return optionLabel(question, answer.selected_answer_for_multiChoice);
}

function expectedAnswer(answer, question) {
  if (!question) return '';
  if (answer.question_type === 'Multiple_select') {
    return (Array.isArray(question.correct_multiSelect_answers) ? question.correct_multiSelect_answers : [])
      .map((x) => optionLabel(question, x?.answer))
      .filter(Boolean)
      .join(', ');
  }
  if (isDescriptive(answer)) return String(question.correct_answer ?? '');
  return optionLabel(question, question.correct_answer);
}

function companyMatches(submission, company) {
  if (!company) return true;
  return String(submission?.submitted_by?.company || '').toLowerCase() === company.toLowerCase();
}

function courseMatches(submission, courseId) {
  if (!courseId) return true;
  const course = submission?.course || {};
  return String(course.id || '') === courseId || String(course.documentId || '') === courseId;
}

module.exports = ({ strapi }) => ({
  async listReviews({ company: companyRaw, courseId: courseIdRaw, status: statusRaw }) {
    const status = LISTABLE_STATUSES.includes(statusRaw) ? statusRaw : REVIEW_STATUS.PENDING;
    const company = normalizeCompany(companyRaw);
    const courseId = String(courseIdRaw || '').trim();

    const submissions = await strapi.db.query(QUIZ_UID).findMany({
      where: { review_status: status, publishedAt: { $notNull: true } },
      populate: {
        answers: true,
        submitted_by: { select: ['id', 'username', 'email', 'emp_id', 'emp_code', 'company'] },
        course: { select: ['id', 'documentId', 'title'] },
      },
      orderBy: { submitted_at: status === REVIEW_STATUS.PENDING ? 'asc' : 'desc' },
      limit: 5000,
    });

    return (submissions || [])
      .filter((s) => companyMatches(s, company) && courseMatches(s, courseId))
      .map((s) => {
        const answers = Array.isArray(s.answers) ? s.answers : [];
        const toReview = answers.filter(needsManualReview);
        return {
          id: s.id,
          emp_name: employeeName(s.submitted_by),
          emp_id: s.submitted_by?.emp_id || '-',
          emp_code: s.submitted_by?.emp_code || '-',
          course: s.course?.title || '-',
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
      module: submission.module_title || quizModule?.title || null,
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
