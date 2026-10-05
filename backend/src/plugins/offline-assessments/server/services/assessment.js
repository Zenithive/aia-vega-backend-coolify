// @ts-nocheck
'use strict';

/**
 * Offline assessments: per-learner completion proof for offline course modules.
 *
 * Offline modules exist once per course language (like every module). They are identified
 * here by their position in the course, so an assessor picks "Module 3 — Practical
 * Assessment" once and each learner's entry is the one for the module of the language that
 * learner is taking. Entries are created on course assignment (without proof); saving proof
 * fills the learner's api::offline-module-completion entry, and its lifecycle completes the
 * module and unlocks the next one (src/lifecycles/offline-module-completion.js).
 */

const { errors } = require('@strapi/utils');
const {
  COURSE_UID,
  USER_PROGRESS_UID,
  OFFLINE_COMPLETION_UID,
  modulesForLanguage,
  isOffline,
  computeModuleStates,
  ensureOfflineCompletionEntries,
} = require('../../../../utils/course-modules');

const USER_FIELDS = ['id', 'username', 'email', 'emp_code', 'emp_id', 'company', 'department', 'designation'];

/** Modules of the course's first language: the reference order shown to assessors. */
function referenceModules(course) {
  const modules = Array.isArray(course?.modules) ? course.modules : [];
  const firstLanguage = modules.find((m) => m?.language)?.language || null;
  return modulesForLanguage(modules, firstLanguage);
}

function offlineModuleList(course) {
  return referenceModules(course)
    .map((m, index) => ({ index, position: index + 1, title: m.title, module_id: m.module_id, offline: isOffline(m) }))
    .filter((m) => m.offline)
    .map(({ offline, ...rest }) => rest);
}

module.exports = ({ strapi }) => {
  async function courseRows(documentId) {
    return strapi.db.query(COURSE_UID).findMany({
      where: { documentId },
      select: ['id', 'documentId', 'title', 'course_version', 'publishedAt', 'min_passing_score'],
      populate: {
        modules: { populate: { quiz: { populate: { quiz_questions: { select: ['id', 'question_id'] } } } } },
        feedback: true,
      },
    });
  }

  /** Progress rows for every row of the course document, one per learner (published row preferred). */
  async function learnerProgress(rowIds) {
    const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: { course: { id: { $in: rowIds } } },
      populate: { user: { select: USER_FIELDS }, course: { select: ['id'] } },
      orderBy: { updatedAt: 'desc' },
    });
    const byUser = new Map();
    for (const row of rows || []) {
      const uid = row.user?.id;
      if (!uid) continue;
      const prev = byUser.get(uid);
      if (!prev || (!prev.publishedAt && row.publishedAt)) byUser.set(uid, row);
    }
    return [...byUser.values()];
  }

  return {
    /** Published courses that contain at least one offline module. */
    async listCourses() {
      const rows = await strapi.db.query(COURSE_UID).findMany({
        where: { publishedAt: { $notNull: true } },
        select: ['id', 'documentId', 'title', 'course_version'],
        populate: { modules: { select: ['id', 'module_id', 'title', 'language', 'module_type'] } },
        orderBy: { title: 'asc' },
      });
      return (rows || [])
        .map((c) => ({
          documentId: c.documentId,
          title: c.title,
          course_version: c.course_version,
          offlineModules: offlineModuleList(c),
        }))
        .filter((c) => c.offlineModules.length > 0);
    },

    /** Every learner on the course with their state for the offline module at `moduleIndex`. */
    async listLearners(documentId, moduleIndex) {
      const rows = await courseRows(documentId);
      if (!rows.length) throw new errors.NotFoundError('Course not found');
      const published = rows.find((r) => r.publishedAt) || rows[0];
      const index = Number(moduleIndex);
      const reference = referenceModules(published)[index];
      if (!reference || !isOffline(reference)) throw new errors.ValidationError('Choose an offline module of this course');

      const progressRows = await learnerProgress(rows.map((r) => r.id));
      const learners = [];
      for (const progress of progressRows) {
        // Learners assigned before the module became offline get their entry now.
        await ensureOfflineCompletionEntries(strapi, {
          userId: progress.user.id,
          courseId: progress.course?.id ?? published.id,
          language: progress.selected_language,
        }).catch((e) => strapi.log.warn(`[offline-assessments] entry sync failed: ${e?.message || e}`));
        const course = { ...published, id: progress.course?.id ?? published.id };
        const summary = await computeModuleStates(strapi, { course, userId: progress.user.id, progress });
        const state = summary.modules[index] || null;
        const status = !state || state.module_type !== 'Offline'
          ? 'mismatch'
          : state.completed
            ? 'completed'
            : state.unlocked
              ? 'ready'
              : 'locked';
        const pendingBefore = state ? summary.modules.slice(0, index).filter((m) => !m.completed).length : 0;
        learners.push({
          user: progress.user,
          progress_status: progress.progress_status,
          selected_language: progress.selected_language || null,
          module_title: state?.title ?? reference.title,
          status,
          pending_modules_before: pendingBefore,
          completion: state?.offline_completion || null,
        });
      }
      const order = { ready: 0, locked: 1, completed: 2, mismatch: 3 };
      learners.sort((a, b) => order[a.status] - order[b.status] || String(a.user.username).localeCompare(String(b.user.username)));

      return {
        course: { documentId, title: published.title, course_version: published.course_version },
        module: { index, position: index + 1, title: reference.title },
        learners,
      };
    },

    /** Create or replace the learner's proof for the offline module at `moduleIndex`. */
    async saveCompletion({ courseDocumentId, moduleIndex, userId, proof, remarks }, adminUser) {
      const proofIds = (Array.isArray(proof) ? proof : [])
        .map((f) => Number(typeof f === 'object' && f ? f.id : f))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!courseDocumentId || moduleIndex == null || !userId) {
        throw new errors.ValidationError('courseDocumentId, moduleIndex and userId are required');
      }
      if (proofIds.length === 0) throw new errors.ValidationError('Attach at least one proof file');

      const rows = await courseRows(courseDocumentId);
      if (!rows.length) throw new errors.NotFoundError('Course not found');
      const progress = (await learnerProgress(rows.map((r) => r.id))).find((p) => Number(p.user.id) === Number(userId));
      if (!progress) {
        throw new errors.ValidationError('This learner is not assigned to the course (no course progress found).');
      }

      const courseRow = rows.find((r) => r.id === progress.course?.id) || rows.find((r) => r.publishedAt) || rows[0];
      const modules = modulesForLanguage(courseRow.modules, progress.selected_language);
      const index = Number(moduleIndex);
      const module = modules[index];
      if (!module || !isOffline(module)) {
        throw new errors.ValidationError("This module is not an offline module in the learner's course language.");
      }

      const assessedBy = [adminUser?.firstname, adminUser?.lastname].filter(Boolean).join(' ') || adminUser?.email || null;
      const data = {
        proof: proofIds,
        remarks: remarks ? String(remarks) : null,
        assessed_by: assessedBy,
        module_title: module.title || null,
      };

      const existing = await strapi.db.query(OFFLINE_COMPLETION_UID).findOne({
        where: { user: Number(userId), course: courseRow.id, module_id: module.module_id },
        select: ['id', 'documentId'],
      });

      if (existing) {
        await strapi.documents(OFFLINE_COMPLETION_UID).update({ documentId: existing.documentId, data });
      } else {
        await strapi.documents(OFFLINE_COMPLETION_UID).create({
          data: {
            ...data,
            user: { connect: [{ id: Number(userId) }] },
            course: { connect: [{ id: courseRow.id }] },
            module_id: module.module_id,
          },
        });
      }
      return { ok: true };
    },

    /** Clear the assessment (proof, remarks, date, assessor); the learner's entry itself stays. */
    async removeCompletion(id) {
      const row = await strapi.db.query(OFFLINE_COMPLETION_UID).findOne({ where: { id: Number(id) }, select: ['id', 'documentId'] });
      if (!row) throw new errors.NotFoundError('Completion record not found');
      await strapi.documents(OFFLINE_COMPLETION_UID).update({
        documentId: row.documentId,
        data: { proof: [], remarks: null, completed_at: null, assessed_by: null },
      });
      return { ok: true };
    },
  };
};
