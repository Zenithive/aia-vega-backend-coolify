'use strict';
// @ts-nocheck

const { createCoreController } = require('@strapi/strapi').factories;
/** @type {any} */
const ORIENTATION_CONFIRM_UID = 'api::orientation-confirmation.orientation-confirmation';
/** @type {any} */
const COURSE_UID = 'api::course.course';

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveCourseIdentifiers(strapi, courseId, courseDocumentId) {
  let resolvedCourseId = courseId;
  let resolvedCourseDocumentId = courseDocumentId;
  let resolvedCourseName = '';

  if (resolvedCourseId) {
    const byId = await strapi.db.query(COURSE_UID).findOne({
      where: { id: resolvedCourseId },
      select: ['id', 'documentId', 'title'],
    });
    if (byId?.id) resolvedCourseId = byId.id;
    if (byId?.documentId) resolvedCourseDocumentId = byId.documentId;
    if (typeof byId?.title === 'string') resolvedCourseName = byId.title.trim();
  } else if (resolvedCourseDocumentId) {
    const byDocumentId = await strapi.db.query(COURSE_UID).findOne({
      where: { documentId: resolvedCourseDocumentId },
      select: ['id', 'documentId', 'title'],
    });
    if (byDocumentId?.id) resolvedCourseId = byDocumentId.id;
    if (byDocumentId?.documentId) resolvedCourseDocumentId = byDocumentId.documentId;
    if (typeof byDocumentId?.title === 'string') resolvedCourseName = byDocumentId.title.trim();
  }

  return {
    courseId: resolvedCourseId,
    courseDocumentId: resolvedCourseDocumentId,
    courseName: resolvedCourseName,
  };
}

module.exports = createCoreController(
  ORIENTATION_CONFIRM_UID,
  ({ strapi }) => ({
    async confirm(ctx) {
      try {
        const raw = ctx.request.body || {};
        const body = raw.data && typeof raw.data === 'object' ? raw.data : raw;

        const userIdRaw = body.userId ?? body.user_id;
        const courseIdRaw = body.courseId ?? body.course_id;
        const courseDocumentIdRaw = body.courseDocumentId ?? body.course_document_id;
        const languageRaw = body.language;

        const userId = parsePositiveInt(userIdRaw);
        if (!userId) {
          return ctx.badRequest('userId is required');
        }

        const courseId = parsePositiveInt(courseIdRaw);
        const courseDocumentId = normalizeText(courseDocumentIdRaw);
        const language = normalizeText(languageRaw);

        if (!courseId && !courseDocumentId) {
          return ctx.badRequest('Either courseId or courseDocumentId is required');
        }
        if (!language) {
          return ctx.badRequest('language is required');
        }

        const resolved = await resolveCourseIdentifiers(strapi, courseId, courseDocumentId);
        if (!resolved.courseId && !resolved.courseDocumentId) {
          return ctx.badRequest('Invalid courseId or courseDocumentId');
        }

        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: userId },
          select: ['username', 'email'],
        });
        const userName = normalizeText(user?.username) || normalizeText(user?.email);

        const confirmationData = {
          user_id: userId,
          user_name: userName || undefined,
          course_id: resolved.courseId ?? undefined,
          course_document_id: resolved.courseDocumentId || undefined,
          course_name: normalizeText(resolved.courseName) || undefined,
          language,
          confirmed_at: new Date().toISOString(),
        };

        // Idempotent behavior: do not create duplicates for same user+course+language.
        const where = { user_id: userId, $or: [] };
        where.language = language;
        if (resolved.courseId) where.$or.push({ course_id: resolved.courseId });
        if (resolved.courseDocumentId) where.$or.push({ course_document_id: resolved.courseDocumentId });

        const existing = await strapi.db
          .query(ORIENTATION_CONFIRM_UID)
          .findOne({
            where,
            orderBy: { confirmed_at: 'desc' },
          });

        if (existing) {
          return ctx.send({
            message: 'Orientation already confirmed for this language',
            created: false,
            confirmation: existing,
          });
        }

        const created = await strapi.entityService.create(
          ORIENTATION_CONFIRM_UID,
          {
            data: confirmationData,
          }
        );

        return ctx.send({
          message: 'Orientation confirmed successfully',
          created: true,
          confirmation: created,
        });
      } catch (err) {
        strapi.log.error('[orientation-confirmation.confirm] failed:', err?.message || err);
        return ctx.internalServerError(err?.message || 'Failed to confirm orientation');
      }
    },
  })
);
