// @ts-nocheck
'use strict';

/**
 * Course feedback responses. Feedback forms differ per course / version, so each response is
 * returned with its own questions and answers (no fixed columns); the admin UI lists the
 * responses, summarises answers per question, and exports one row per answer.
 */

const { normalizeCompany, courseCatalog, resolveCourseRows } = require('../../../../utils/course-catalog');

const FEEDBACK_UID = 'api::feedback-submission.feedback-submission';
const USER_FIELDS = ['id', 'username', 'email', 'emp_id', 'emp_code', 'company', 'department'];

const employeeName = (user = {}) => user.username || user.email || '-';

module.exports = ({ strapi }) => ({
  getCourses: (company) => courseCatalog(strapi, company),

  async responses({ company: companyRaw, course, version }) {
    const company = normalizeCompany(companyRaw);
    const rowIds = await resolveCourseRows(strapi, { company, course, version });
    if (rowIds && rowIds.size === 0) return [];
    const where = {};
    if (rowIds) where.course = { id: { $in: [...rowIds] } };
    if (company) where.users_permissions_user = { company };

    const rows = await strapi.db.query(FEEDBACK_UID).findMany({
      where,
      populate: {
        answers: true,
        users_permissions_user: { select: USER_FIELDS },
        course: { select: ['id', 'documentId', 'title', 'course_version'] },
      },
      orderBy: { createdAt: 'desc' },
      limit: 20000,
    });

    // Draft and published copies of one response share a documentId: keep one (published first).
    const byDocument = new Map();
    for (const row of rows || []) {
      const key = row.documentId || row.id;
      const prev = byDocument.get(key);
      if (!prev || (!prev.publishedAt && row.publishedAt)) byDocument.set(key, row);
    }

    return [...byDocument.values()].map((r) => {
      const user = r.users_permissions_user || {};
      return {
        id: r.id,
        user_id: user.id,
        emp_name: employeeName(user),
        emp_code: user.emp_code || '',
        emp_id: user.emp_id || '',
        department: user.department || '',
        course_title: r.course?.title || '-',
        course_version: r.course_version || r.course?.course_version || '',
        submitted_at: r.createdAt || null,
        answers: (r.answers || []).map((a, i) => ({
          key: String(a.question_id || '').trim() || `q${i + 1}:${a.question || ''}`,
          question: a.question || `Question ${i + 1}`,
          answer_type: a.answer_type || 'Text',
          answer: a.answer ?? '',
        })),
      };
    });
  },
});
