'use strict';

/**
 * course-group-label controller
 * Learners only see groups that contain at least one course assigned to them.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { getAssignedCourseIdsForUser } = require('../../course/controllers/course');

const COURSE_UID = 'api::course.course';

function readEq(node) {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && node.$eq != null) return String(node.$eq);
  return null;
}

module.exports = createCoreController('api::course-group-label.course-group-label', ({ strapi }) => ({
  async find(ctx) {
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view course groups.');
    }

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const courseFilters = ctx.query?.filters?.courses && typeof ctx.query.filters.courses === 'object'
      ? ctx.query.filters.courses
      : {};
    const category = readEq(courseFilters.course_category);

    const where = {
      id: { $in: assignedIds.length ? assignedIds : [0] },
      publishedAt: { $notNull: true },
      active: { $ne: 'unpublished' },
    };
    if (category) where.course_category = category;

    const courses = await strapi.db.query(COURSE_UID).findMany({
      where,
      select: ['id'],
      populate: { course_group_label: true },
      limit: 1000,
    });

    const byDocument = new Map();
    for (const course of courses || []) {
      const label = course?.course_group_label;
      if (!label?.documentId || !label?.name) continue;
      if (Object.prototype.hasOwnProperty.call(label, 'publishedAt') && label.publishedAt == null) continue;
      byDocument.set(String(label.documentId), {
        id: label.id,
        documentId: label.documentId,
        name: label.name,
      });
    }

    const data = [...byDocument.values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
      data,
      meta: {
        pagination: {
          page: 1,
          pageSize: Math.max(data.length, 1),
          pageCount: data.length ? 1 : 0,
          total: data.length,
        },
      },
    };
  },
}));
