// @ts-nocheck
'use strict';

/**
 * Quiz results. Quizzes differ per module (number and kind of questions) and learners may
 * take a quiz several times, so results are not one wide table:
 *  - learnerModules: one row per learner × course version × module (attempts, best / latest score)
 *  - attempts:       every attempt of one learner for one module quiz
 *  - exportAnswers:  one row per answer (learner, module, attempt, question, answer), which
 *                    works in Excel whatever the quizzes look like.
 * A single attempt's answers come from the answer review service (getReview).
 */

const { REVIEW_STATUS } = require('../../../../utils/quiz-review');
const { MODULE_QUIZ_POPULATE, findModule, quizMaxAttempt, quizPassMark } = require('../../../../utils/course-modules');
const { normalizeCompany, employeeName, learnerAnswer } = require('../utils/quiz-answers');
const { courseCatalog, resolveCourseRows } = require('../../../../utils/course-catalog');

const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const COURSE_UID = 'api::course.course';
const USER_FIELDS = ['id', 'username', 'email', 'emp_id', 'emp_code', 'company', 'department'];

function result(submission) {
  if (submission.review_status === REVIEW_STATUS.PENDING) return 'Pending review';
  return submission.passed ? 'Passed' : 'Not passed';
}

function attemptSummary(s) {
  const pending = s.review_status === REVIEW_STATUS.PENDING;
  return {
    id: s.id,
    attempt_number: s.attempt_number ?? null,
    submitted_at: s.submitted_at || s.createdAt || null,
    score: pending ? null : s.score ?? null,
    passed: pending ? null : s.passed === true,
    result: result(s),
    review_status: s.review_status || REVIEW_STATUS.NOT_REQUIRED,
    time_taken_minutes: s.time_taken_minutes ?? null,
    submission_type: s.submission_type || null,
  };
}

const byTime = (a, b) => new Date(a.submitted_at || a.createdAt || 0) - new Date(b.submitted_at || b.createdAt || 0);

module.exports = ({ strapi }) => {
  /** Published submissions of the chosen company / course / version. */
  async function findSubmissions({ company: companyRaw, course, version }, { withAnswers = false } = {}) {
    const company = normalizeCompany(companyRaw);
    const rowIds = await resolveCourseRows(strapi, { company, course, version });
    if (rowIds && rowIds.size === 0) return [];
    const where = { publishedAt: { $notNull: true } };
    if (rowIds) where.course = { id: { $in: [...rowIds] } };
    if (company) where.submitted_by = { company };
    const rows = await strapi.db.query(QUIZ_UID).findMany({
      where,
      populate: {
        submitted_by: { select: USER_FIELDS },
        course: { select: ['id', 'documentId', 'title', 'course_version'] },
        ...(withAnswers ? { answers: true } : {}),
      },
      orderBy: { submitted_at: 'asc' },
      limit: 20000,
    });
    return rows || [];
  }

  /** Course rows with their module quizzes, to know max attempts and answer option labels. */
  async function loadCourses(courseIds) {
    const ids = [...new Set(courseIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const courses = await strapi.db.query(COURSE_UID).findMany({
      where: { id: { $in: ids } },
      select: ['id', 'min_passing_score'],
      populate: { modules: { populate: MODULE_QUIZ_POPULATE } },
    });
    return new Map((courses || []).map((c) => [c.id, c]));
  }

  return {
    getCourses: (company) => courseCatalog(strapi, company),

    async learnerModules(filters) {
      const submissions = await findSubmissions(filters);
      const courses = await loadCourses(submissions.map((s) => s.course?.id));

      const groups = new Map();
      for (const s of submissions) {
        const user = s.submitted_by || {};
        const key = `${user.id}::${s.course?.documentId || s.course?.id}::${s.module_id || s.module_title || ''}`;
        if (!groups.has(key)) groups.set(key, { key, user, course: s.course || {}, list: [] });
        groups.get(key).list.push(s);
      }

      return [...groups.values()].map(({ key, user, course, list }) => {
        list.sort(byTime);
        const latest = list[list.length - 1];
        const scored = list.filter((s) => s.review_status !== REVIEW_STATUS.PENDING && typeof s.score === 'number');
        const quizModule = findModule(courses.get(course.id)?.modules, latest.module_id);
        return {
          key,
          user_id: user.id,
          emp_name: employeeName(user),
          emp_code: user.emp_code || '',
          emp_id: user.emp_id || '',
          department: user.department || '',
          course_documentId: course.documentId,
          course_title: course.title || '-',
          course_version: latest.course_version || course.course_version || '',
          module_id: latest.module_id || '',
          module_title: latest.module_title || quizModule?.title || '-',
          attempts: list.length,
          max_attempts: quizModule?.quiz ? quizMaxAttempt(quizModule.quiz) : null,
          best_score: scored.length ? Math.max(...scored.map((s) => s.score)) : null,
          passed_ever: list.some((s) => s.passed === true && s.review_status !== REVIEW_STATUS.PENDING),
          latest: attemptSummary(latest),
        };
      });
    },

    async attempts({ userId, courseDocumentId, moduleId }) {
      const rows = await strapi.db.query(QUIZ_UID).findMany({
        where: {
          publishedAt: { $notNull: true },
          submitted_by: { id: Number(userId) },
          course: { documentId: String(courseDocumentId || '') },
          ...(moduleId ? { module_id: String(moduleId) } : {}),
        },
        orderBy: { submitted_at: 'asc' },
      });
      return (rows || []).sort(byTime).map(attemptSummary);
    },

    async exportAnswers(filters) {
      const submissions = await findSubmissions(filters, { withAnswers: true });
      const courses = await loadCourses(submissions.map((s) => s.course?.id));
      const out = [];
      for (const s of submissions) {
        const user = s.submitted_by || {};
        const course = courses.get(s.course?.id);
        const quizModule = findModule(course?.modules, s.module_id);
        const questions = new Map((quizModule?.quiz?.quiz_questions || []).map((q) => [String(q.question_id), q]));
        const summary = attemptSummary(s);
        (s.answers || []).forEach((a, i) => {
          const question = questions.get(String(a.question_id));
          out.push({
            'Employee': employeeName(user),
            'Employee code / ID': user.emp_code || user.emp_id || '',
            'Department': user.department || '',
            'Course': s.course?.title || '',
            'Version': s.course_version || s.course?.course_version || '',
            'Module': s.module_title || quizModule?.title || '',
            'Attempt': summary.attempt_number ?? '',
            'Submitted': summary.submitted_at ? new Date(summary.submitted_at).toLocaleString() : '',
            'Attempt score %': summary.score ?? '',
            'Attempt result': summary.result,
            'Pass mark %': course ? quizPassMark(course) : '',
            'Question no.': i + 1,
            'Question': question?.question_text || a.question || a.question_id || '',
            'Question type': String(a.question_type || '').replace('_', ' '),
            'Learner answer': learnerAnswer(a, question),
            'Answer correct': a.correct === true ? 'Yes' : a.correct === false ? 'No' : 'Not marked yet',
          });
        });
      }
      return out;
    },
  };
};
