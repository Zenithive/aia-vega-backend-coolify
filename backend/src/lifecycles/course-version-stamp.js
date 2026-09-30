// @ts-nocheck
'use strict';

/**
 * Stamps course_version on progress records (user-progress, module-video-progress).
 *
 * Runs as a DB lifecycle so it covers every write path (controllers, document service,
 * db.query, course-assignment automation). The version is always taken from the linked
 * course; the course_version sent by the frontend is only a fallback.
 */

const COURSE_UID = 'api::course.course';
const STAMPED_MODELS = [
  'api::user-progress.user-progress',
  'api::module-video-progress.module-video-progress',
];
const LOG = '[course-version-stamp]';

function hasValue(v) {
  return v != null && String(v).trim() !== '';
}

/** Extract a course id / documentId from any relation payload shape Strapi may pass to the DB layer. */
function extractCourseRef(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return extractCourseRef(value[0]);
  if (typeof value === 'object') {
    if (value.id != null) return value.id;
    if (value.documentId != null) return value.documentId;
    for (const key of ['set', 'connect']) {
      if (value[key] != null) {
        const ref = extractCourseRef(value[key]);
        if (ref != null) return ref;
      }
    }
  }
  return null;
}

async function findCourseVersion(strapi, courseRef) {
  if (courseRef == null) return null;
  const asNumber = Number(courseRef);
  const where = Number.isFinite(asNumber) && asNumber > 0
    ? { id: asNumber }
    : { documentId: String(courseRef) };
  const course = await strapi.db.query(COURSE_UID).findOne({ where, select: ['id', 'course_version'] });
  return hasValue(course?.course_version) ? String(course.course_version) : null;
}

function versionFromRequest(strapi) {
  const ctx = strapi.requestContext?.get?.();
  const body = ctx?.request?.body;
  if (!body || typeof body !== 'object') return null;
  const v = body.course_version ?? body.data?.course_version;
  return hasValue(v) ? String(v).trim() : null;
}

async function stampOnCreate(strapi, event) {
  const data = event.params?.data;
  if (!data || typeof data !== 'object') return;
  const fromCourse = await findCourseVersion(strapi, extractCourseRef(data.course));
  const version = fromCourse || (hasValue(data.course_version) ? String(data.course_version) : null) || versionFromRequest(strapi);
  if (version) data.course_version = version;
}

/** Legacy rows created before this field existed get the version filled on their next update. */
async function stampOnUpdate(strapi, event) {
  const data = event.params?.data;
  if (!data || typeof data !== 'object' || hasValue(data.course_version)) return;
  const where = event.params?.where;
  if (!where) return;

  const row = await strapi.db.query(event.model.uid).findOne({
    where,
    select: ['id', 'course_version'],
    populate: { course: { select: ['id', 'course_version'] } },
  });
  if (!row || hasValue(row.course_version)) return;

  const version =
    (hasValue(row.course?.course_version) ? String(row.course.course_version) : null) ||
    (await findCourseVersion(strapi, extractCourseRef(data.course))) ||
    versionFromRequest(strapi);
  if (version) data.course_version = version;
}

function registerCourseVersionStamp(strapi) {
  strapi.db.lifecycles.subscribe({
    models: STAMPED_MODELS,
    async beforeCreate(event) {
      try {
        await stampOnCreate(strapi, event);
      } catch (e) {
        strapi.log.warn(`${LOG} beforeCreate failed for ${event.model?.uid}: ${e?.message || e}`);
      }
    },
    async beforeUpdate(event) {
      try {
        await stampOnUpdate(strapi, event);
      } catch (e) {
        strapi.log.warn(`${LOG} beforeUpdate failed for ${event.model?.uid}: ${e?.message || e}`);
      }
    },
  });
}

module.exports = { registerCourseVersionStamp };
