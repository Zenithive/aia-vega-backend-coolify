// @ts-nocheck
'use strict';

/**
 * Offline module completion → learner progress.
 *
 * Records are created (without proof) for every assigned learner when a course is assigned.
 * Attaching proof completes the offline module for that learner and unlocks the next module;
 * removing the proof (or the record) reverses it. Runs as a DB lifecycle so it covers the
 * Content Manager, the offline assessment page and the API.
 */

const {
  OFFLINE_COMPLETION_UID,
  COURSE_UID,
  hasProof,
  loadProgress,
  setModuleContentDone,
  recomputeProgress,
} = require('../utils/course-modules');

const { errors } = require('@strapi/utils');

const LOG = '[offline-module-completion]';

function relationId(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'object') {
    if (value.id != null) return Number(value.id);
    for (const key of ['set', 'connect']) {
      const list = Array.isArray(value[key]) ? value[key] : value[key] ? [value[key]] : [];
      if (list[0]?.id != null) return Number(list[0].id);
    }
  }
  return null;
}

async function loadRecord(strapi, where) {
  return strapi.db.query(OFFLINE_COMPLETION_UID).findOne({
    where,
    select: ['id', 'module_id', 'completed_at'],
    populate: { user: { select: ['id'] }, course: { select: ['id'] }, proof: { select: ['id'] } },
  });
}

async function applyToProgress(strapi, record, done) {
  const userId = record?.user?.id;
  const courseId = record?.course?.id;
  if (!userId || !courseId || !record.module_id) return;
  if (!done) {
    // Another record with proof for the same learner + module keeps it completed.
    const others = await strapi.db.query(OFFLINE_COMPLETION_UID).findMany({
      where: { user: userId, course: courseId, module_id: record.module_id, id: { $ne: record.id } },
      select: ['id'],
      populate: { proof: { select: ['id'] } },
    });
    if (others.some(hasProof)) return;
  }
  let progress = await loadProgress(strapi, userId, courseId);
  if (!progress) return;
  progress = await setModuleContentDone(strapi, progress, record.module_id, done);
  await recomputeProgress(strapi, { userId, courseId, progress });
}

/** Default completed_at to now when proof is attached and the admin left it empty. */
async function fillCompletedAt(strapi, record) {
  if (!hasProof(record) || record.completed_at) return;
  await strapi.db.query(OFFLINE_COMPLETION_UID).update({ where: { id: record.id }, data: { completed_at: new Date() } });
}

function registerOfflineModuleCompletionLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [OFFLINE_COMPLETION_UID],

    async beforeCreate(event) {
      const data = event.params?.data;
      if (!data) return;
      const courseId = relationId(data.course);
      const userId = relationId(data.user);
      if (courseId && userId && data.module_id) {
        const existing = await strapi.db.query(OFFLINE_COMPLETION_UID).count({
          where: { user: userId, course: courseId, module_id: data.module_id },
        });
        if (existing > 0) {
          throw new errors.ApplicationError(
            'An entry already exists for this learner and module. Edit the existing entry instead.'
          );
        }
      }
      if (courseId && !data.course_version) {
        const course = await strapi.db.query(COURSE_UID).findOne({ where: { id: courseId }, select: ['course_version'] });
        if (course?.course_version) data.course_version = course.course_version;
      }
    },

    async afterCreate(event) {
      try {
        const record = await loadRecord(strapi, { id: event.result.id });
        if (!hasProof(record)) return;
        await fillCompletedAt(strapi, record);
        await applyToProgress(strapi, record, true);
      } catch (e) {
        strapi.log.error(`${LOG} afterCreate failed: ${e?.message || e}`);
      }
    },

    async beforeUpdate(event) {
      try {
        event.state = event.state || {};
        event.state.before = await loadRecord(strapi, event.params.where);
      } catch (e) {
        strapi.log.warn(`${LOG} beforeUpdate lookup failed: ${e?.message || e}`);
      }
    },

    async afterUpdate(event) {
      try {
        const before = event.state?.before;
        const after = await loadRecord(strapi, { id: event.result.id });
        if (!after) return;
        const moved =
          !!before &&
          (before.module_id !== after.module_id || before.user?.id !== after.user?.id || before.course?.id !== after.course?.id);
        const wasDone = hasProof(before);
        const isDone = hasProof(after);

        if (moved && wasDone) await applyToProgress(strapi, before, false);
        if (isDone) {
          await fillCompletedAt(strapi, after);
          if (moved || !wasDone) await applyToProgress(strapi, after, true);
        } else if (wasDone && !moved) {
          await applyToProgress(strapi, after, false);
        }
      } catch (e) {
        strapi.log.error(`${LOG} afterUpdate failed: ${e?.message || e}`);
      }
    },

    async beforeDelete(event) {
      try {
        event.state = event.state || {};
        event.state.before = await loadRecord(strapi, event.params.where);
      } catch (e) {
        strapi.log.warn(`${LOG} beforeDelete lookup failed: ${e?.message || e}`);
      }
    },

    async afterDelete(event) {
      try {
        const before = event.state?.before;
        if (hasProof(before)) await applyToProgress(strapi, before, false);
      } catch (e) {
        strapi.log.error(`${LOG} afterDelete failed: ${e?.message || e}`);
      }
    },
  });
}

module.exports = { registerOfflineModuleCompletionLifecycles };
