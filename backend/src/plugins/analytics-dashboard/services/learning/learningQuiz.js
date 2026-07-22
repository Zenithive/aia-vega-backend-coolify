//@ts-nocheck
'use strict';

// Use server local time (IST) for date boundaries, return UTC ISO string for DB filtering
const normalizeDateBound = (value, endOfDay = false) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  // Create a Date object in server local time (IST)
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  }
  // Return as ISO string in UTC (so DB filtering works as expected)
  return date.toISOString();
};

/**
 * Learning Analytics – Quiz (global + personal).
 */
module.exports = ({ strapi }) => {
  async function getQuizGlobal(params = {}) {
    let submissions = [];

    const numericUserId = params.userId != null && (typeof params.userId === 'number' || /^\d+$/.test(String(params.userId)))
      ? Number(params.userId)
      : null;

    // Build date filter
    const dateWhere = {};
    const dateFrom = normalizeDateBound(params.dateFrom, false);
    const dateTo = normalizeDateBound(params.dateTo, true);
    if (dateFrom) dateWhere.$gte = dateFrom;
    if (dateTo) dateWhere.$lte = dateTo;

    // Resolve courseId → set of numeric IDs (handles Strapi v5 draft+published dual rows)
    let resolvedCourseIds = new Set();
    const courseIdStr = params.courseId ? String(params.courseId).trim() : '';
    if (courseIdStr) {
      if (/^\d+$/.test(courseIdStr)) {
        resolvedCourseIds.add(Number(courseIdStr));
      } else if (courseIdStr.length > 10) {
        try {
          const cRows = await strapi.db.query('api::course.course').findMany({
            where: { documentId: courseIdStr },
            select: ['id'],
          });
          if (Array.isArray(cRows) && cRows.length > 0) {
            cRows.forEach((r) => { if (r?.id) resolvedCourseIds.add(r.id); });
          } else {
            const cRows2 = await strapi.db.query('api::course.course').findMany({
              where: { document_id: courseIdStr },
              select: ['id'],
            });
            if (Array.isArray(cRows2)) cRows2.forEach((r) => { if (r?.id) resolvedCourseIds.add(r.id); });
          }
        } catch (_) {}
      }
    }

    // 1) Document Service (handles draft/publish, link tables automatically)
    try {
      const docFilters = {};
      if (numericUserId != null) docFilters.submitted_by = { id: numericUserId };
      if (params.dateFrom || params.dateTo) docFilters.submitted_at = dateWhere;
      if (resolvedCourseIds.size > 0) {
        docFilters.course = { id: { $in: [...resolvedCourseIds] } };
      } else if (courseIdStr.length > 10) {
        // fallback: filter by documentId directly if resolve failed
        docFilters.course = { documentId: courseIdStr };
      }

      submissions = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        status: 'published',
        filters: Object.keys(docFilters).length > 0 ? docFilters : undefined,
        populate: ['submitted_by', 'course'],
        limit: 5000,
        start: 0,
      });
      if (!Array.isArray(submissions)) submissions = [];
    } catch (e) {
      strapi.log.warn('Quiz document findMany failed:', e?.message || e);
      submissions = [];
    }

    // 2) Fallback: db.query with proper relation filter via link table
    if (submissions.length === 0) {
      try {
        const where = {};
        if (numericUserId != null) where.submitted_by = { id: numericUserId };
        if (params.dateFrom || params.dateTo) where.submitted_at = dateWhere;
        if (resolvedCourseIds.size > 0) {
          where.course = { id: { $in: [...resolvedCourseIds] } };
        } else if (courseIdStr.length > 10) {
          where.course = { documentId: courseIdStr };
        }

        const raw = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: Object.keys(where).length > 0 ? where : undefined,
          populate: { submitted_by: true, course: true },
          limit: 5000,
        });
        if (Array.isArray(raw) && raw.length > 0) submissions = raw;
      } catch (e) {
        strapi.log.warn('Quiz db.query failed:', e?.message);
      }
    }

    const passed = submissions.filter((s) => s.passed).length;
    const total = submissions.length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(submissions.reduce((sum, s) => sum + (s.score || 0), 0) / total) : 0;
    return { passRate, avgScore, totalAttempts: total, passed, failed: total - passed };
  }

  return {
    getQuizGlobal,
    async getQuizPersonal(userId, params = {}) {
      return getQuizGlobal({ ...params, userId });
    },
  };
};
