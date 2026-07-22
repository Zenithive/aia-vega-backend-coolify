'use strict';

const { createCoreController } = require("@strapi/strapi").factories;

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
      return Number(anyRow.id);
    }
  }

  const asDocumentId = String(rawCourseId).trim();
  if (!asDocumentId) return null;

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
  "api::module-video-progress.module-video-progress",
  ({ strapi }) => ({
    async markAsRead(ctx) {
      const {
        userId,
        courseId: courseIdParam,
        course: courseParam,
        moduleIndex,
        moduleTitle,
        videoDurationMin,
        timeWatchedMin,
      } = ctx.request.body || {};

      // Accept either numeric id or documentId from frontend
      const courseInput = courseIdParam ?? courseParam;
      const courseId = await resolveCourseNumericId(strapi, courseInput);

      if (userId == null || !courseId || moduleIndex === undefined) {
        return ctx.badRequest("Missing required fields: userId, courseId, moduleIndex");
      }

      const uid = "api::module-video-progress.module-video-progress";
      const filters = {
        user: { id: Number(userId) },
        course: { id: courseId },
        module_index: Number(moduleIndex),
      };

      // Primary lookup: exact user + course + module_index
      let existing = await strapi.entityService.findMany(uid, {
        filters,
        limit: 1,
      }).then((list) => list[0] || null);

      // Self-heal fallback: if no record found by index (can happen when old records
      // were saved with the language-filtered index instead of the global index),
      // find by module_title so we UPDATE the old wrong record instead of creating
      // a duplicate alongside it.
      if (!existing && moduleTitle && String(moduleTitle).trim()) {
        const byTitle = await strapi.entityService.findMany(uid, {
          filters: {
            user: { id: Number(userId) },
            course: { id: courseId },
            module_title: String(moduleTitle).trim(),
          },
          limit: 1,
        }).then((list) => list[0] || null);
        if (byTitle) existing = byTitle;
      }

      const data = /** @type {any} */ ({
        user: Number(userId),
        course: Number(courseId),
        module_index: Number(moduleIndex),
        module_title: moduleTitle || null,
        video_completion_type: "full_watch",
        video_duration_min: Number(videoDurationMin) || 0,
        time_watched_min: Number(timeWatchedMin) || 0,
        last_updated: new Date(),
        publishedAt: new Date(),
      });

      let entry;
      if (existing) {
        entry = await strapi.entityService.update(uid, existing.id, { data });
      } else {
        entry = await strapi.entityService.create(uid, { data });
      }

      let populatedEntry = /** @type {any} */ (await strapi.db.query(uid).findOne({
        where: { id: entry.id },
        populate: {
          course: true,
          user: true,
        },
      }));

      // Self-heal: if relation is unexpectedly not attached, force-link and refetch.
      if (!populatedEntry?.course) {
        await strapi.entityService.update(uid, entry.id, {
          data: /** @type {any} */ ({ course: Number(courseId) }),
        });

        populatedEntry = /** @type {any} */ (await strapi.db.query(uid).findOne({
          where: { id: entry.id },
          populate: {
            course: true,
            user: true,
          },
        }));
      }

      return ctx.send({
        message: "Module marked as completed",
        progress: populatedEntry || entry,
      });
    },
  })
);