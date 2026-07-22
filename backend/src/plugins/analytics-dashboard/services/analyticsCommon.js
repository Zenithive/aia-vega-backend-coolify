//@ts-nocheck
'use strict';


const normalizeDateBound = (value, endOfDay = false) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.toISOString();
};

/**
 * Analytics Common – Shared helpers for Learning views (filters, course load, modules).
 */
module.exports = ({ strapi }) => ({
  async loadCoursesForProgress(progressesOrRecords) {
    if (!progressesOrRecords?.length) return {};
    const byId = {};
    const byDocId = {};
    progressesOrRecords.forEach((p) => {
      const c = p.course;
      const numId = c?.id ?? p.course_id ?? p.courseId ?? p.course;
      const docId = c?.documentId ?? c?.document_id ?? p.course_documentId;
      if (numId != null) {
        if (typeof numId === 'number' || (typeof numId === 'string' && /^\d+$/.test(numId))) byId[numId] = true;
        else if (typeof numId === 'string' && numId.length > 10) byDocId[numId] = true;
      }
      if (docId != null && String(docId).length > 5) byDocId[docId] = true;
    });
    const numericIds = [...new Set(Object.keys(byId).map(Number).filter((n) => !Number.isNaN(n)))];
    const docIds = [...new Set(Object.keys(byDocId))];
    const courseById = {};
    const courseByDocId = {};
    try {
      if (numericIds.length > 0) {
        const byNum = await strapi.db.query('api::course.course').findMany({
          where: { id: { $in: numericIds } },
        });
        (byNum || []).forEach((c) => {
          courseById[c.id] = c;
          if (c.documentId) courseByDocId[c.documentId] = c;
          if (c.document_id) courseByDocId[c.document_id] = c;
        });
      }
      if (docIds.length > 0) {
        try {
          const byDoc = await strapi.db.query('api::course.course').findMany({
            where: { documentId: { $in: docIds } },
          });
          (byDoc || []).forEach((c) => {
            courseById[c.id] = c;
            courseByDocId[c.documentId || c.document_id] = c;
          });
        } catch (docE) {
          const byDocIdCol = await strapi.db.query('api::course.course').findMany({
            where: { document_id: { $in: docIds } },
          });
          (byDocIdCol || []).forEach((c) => {
            courseById[c.id] = c;
            courseByDocId[c.documentId || c.document_id] = c;
          });
        }
      }
    } catch (e) {
      strapi.log.warn('loadCoursesForProgress failed:', e?.message);
    }
    return { courseById, courseByDocId };
  },

  buildFilters(params) {
    const filters = {};
    if (params.dateFrom || params.dateTo) {
      filters.last_accessed_at = {};
      const dateFrom = normalizeDateBound(params.dateFrom, false);
      const dateTo = normalizeDateBound(params.dateTo, true);
      if (dateFrom) filters.last_accessed_at.$gte = dateFrom;
      if (dateTo) filters.last_accessed_at.$lte = dateTo;
    }
    const department = params.department && String(params.department).trim() && String(params.department) !== 'all';
    const company = params.company && String(params.company).trim() && String(params.company).toLowerCase() !== 'all companies' && String(params.company).toLowerCase() !== 'all';
    if (department || company) {
      filters.user = {};
      if (department) filters.user.department = { id: params.department };
      if (company) filters.user.company = params.company;
    }
    if (params.courseCategory) {
      filters.course = { course_category: { id: params.courseCategory } };
    }
    return filters;
  },

  async getCourseModules(courseId) {
    if (!courseId) return [];
    try {
      const idStr = String(courseId);
      const isNumeric = /^\d+$/.test(idStr);
      let course = null;
      if (isNumeric) {
        course = await strapi.db.query('api::course.course').findOne({
          where: { id: Number(courseId) },
          populate: { modules: true },
        });
      }
      if (!course) {
        course = await strapi.db.query('api::course.course').findOne({
          where: { documentId: idStr },
          populate: { modules: true },
        });
      }
      if (!course) {
        try {
          course = await strapi.db.query('api::course.course').findOne({
            where: { document_id: idStr },
            populate: { modules: true },
          });
        } catch (_) {}
      }
      const mods = course?.modules ?? course?.attributes?.modules ?? [];
      if (!Array.isArray(mods)) return [];
      return mods.map((m, idx) => ({
        title: m.title ?? m.attributes?.title ?? `Module ${idx + 1}`,
        module_id: m.module_id ?? m.attributes?.module_id ?? m.moduleIndex ?? String(idx),
        index: m.index ?? idx,
      }));
    } catch (e) {
      strapi.log.warn('getCourseModules failed:', e?.message);
      return [];
    }
  },
});
