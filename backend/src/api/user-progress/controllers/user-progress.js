"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
const {
  modulesForLanguage,
  findModule,
  isOffline,
  loadCourse,
  loadProgress,
  updateProgressRows,
  computeModuleStates,
  nextStepFor,
  recomputeProgress,
  ensureOfflineCompletionEntries,
} = require("../../../utils/course-modules");

async function resolveCourseId(strapi, courseId) {
  const num = Number(courseId);
  if (!Number.isNaN(num)) return num;
  const course = await strapi.documents('api::course.course').findFirst({
    filters: { documentId: { $eq: String(courseId) } },
  });
  return course?.id ?? null;
}

/** Point the learner's offline-module-completion entries at the modules of their course language. */
async function syncOfflineEntries(strapi, userId, courseId, language) {
  try {
    await ensureOfflineCompletionEntries(strapi, { userId, courseId, language });
  } catch (e) {
    strapi.log.warn(`startCourse: offline completion entries not synced: ${e?.message || e}`);
  }
}

module.exports = createCoreController("api::user-progress.user-progress", ({ strapi }) => ({

  /**
   * User must choose language before starting the course.
   * Language saved permanently in user-progress.selected_language.
   * User cannot change language after start.
   */
  async startCourse(ctx) {
    const { userId, courseId, language } = ctx.request.body;

    if (!userId || !courseId || !language) {
      return ctx.badRequest("userId, courseId & language are required");
    }

    const uid = "api::user-progress.user-progress";
    const numUserId = Number(userId);
    const numCourseId = Number(courseId);
    const now = new Date();

    // Check if progress exists
    let existing = null;
    try {
      const list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      existing = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!existing) {
        const draftList = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        existing = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      }
    } catch (e) {
      existing = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }

    // Already started → refresh access time without changing the recorded outcome
    if (existing) {
      // Re-opening a course must not downgrade a Completed/Failed record; only fill missing values.
      const startData = { last_accessed_at: now };
      if (!existing.progress_status || existing.progress_status === "Not_started") startData.progress_status = "In_progress";
      if (!existing.selected_language) startData.selected_language = language;

      try {
        if (existing.documentId) {
          await strapi.documents(uid).update({
            documentId: existing.documentId,
            data: startData,
            status: 'published',
          });
        } else {
          await strapi.db.query(uid).update({
            where: { id: existing.id },
            data: startData,
          });
        }
      } catch (e) {
        await strapi.db.query(uid).update({
          where: { id: existing.id },
          data: startData,
        });
      }

      await syncOfflineEntries(strapi, numUserId, numCourseId, existing.selected_language || language);
      return ctx.send({
        message: "Course already started; progress updated.",
      });
    }

    // Create new entry
    let entry;
    try {
      entry = await strapi.documents(uid).create(/** @type {any} */ ({
        data: {
          user: { connect: [{ id: numUserId }] },
          course: { connect: [{ id: numCourseId }] },
          progress_status: "In_progress",
          progress_percentage: 0,
          completed_modules: [],
          selected_language: language,
          started_at: now,
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
        },
        status: 'published',
      }));
    } catch (createErr) {
      strapi.log.warn('startCourse documents create failed, trying db.query:', createErr?.message);
      entry = await strapi.db.query(uid).create({
        data: {
          user: numUserId,
          course: numCourseId,
          progress_status: "In_progress",
          progress_percentage: 0,
          completed_modules: [],
          selected_language: language,
          started_at: now,
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
        },
      });
    }

    await syncOfflineEntries(strapi, numUserId, numCourseId, language);
    return ctx.send({
      message: "Course started successfully",
      progress: entry,
    });
  },

  /**
   * Mark a module's content as completed.
   *
   * Enforces the module sequence: earlier modules (same language) must be completed first.
   * Offline modules cannot be completed here — an assessor uploads completion proof instead.
   * Online modules with a quiz are only completed once their quiz is passed.
   */
  async markModuleRead(ctx) {
    const b = ctx.request.body || {};
    const { userId, courseId, moduleId } = b;
    const lastAccessedAt = b.last_accessed_at ? new Date(b.last_accessed_at) : new Date();
    const deltaMinutes = Math.max(0, Number(b.time_spent_minutes ?? 0));
    const selectedLanguage = b.selected_language ?? null;
    const startedAtFromReq = b.started_at ? new Date(b.started_at) : null;

    if (!userId || !courseId || !moduleId) {
      return ctx.badRequest("userId, courseId, moduleId required");
    }

    const uid = "api::user-progress.user-progress";
    const numUserId = Number(userId);
    const numCourseId = await resolveCourseId(strapi, courseId);
    if (numCourseId == null) {
      return ctx.badRequest("Invalid courseId");
    }

    const course = await loadCourse(strapi, numCourseId);
    if (!course) {
      return ctx.badRequest("Invalid courseId");
    }

    let progress = await loadProgress(strapi, numUserId, numCourseId);

    const effectiveLang = selectedLanguage ?? progress?.selected_language ?? null;
    const langModules = modulesForLanguage(course.modules, effectiveLang);
    const module = findModule(langModules, moduleId) || findModule(course.modules, moduleId);
    if (!module) {
      return ctx.badRequest("Module not found in this course");
    }
    if (isOffline(module)) {
      return ctx.badRequest(
        "This is an offline module. It is completed when your assessor uploads your completion proof."
      );
    }

    // Sequence check against the learner's current state.
    const before = await computeModuleStates(strapi, {
      course,
      userId: numUserId,
      progress: progress ? { ...progress, selected_language: effectiveLang } : { selected_language: effectiveLang },
    });
    const state = before.modules.find((s) => s.module_id === module.module_id);
    if (state && !state.unlocked) {
      return ctx.forbidden("Complete the previous modules first.");
    }

    const moduleKey = String(module.module_id ?? module.id);

    if (!progress) {
      // Auto-create if missing — user may mark a module without going through start-course
      await strapi.documents(uid).create(/** @type {any} */ ({
        data: {
          user: { connect: [{ id: numUserId }] },
          course: { connect: [{ id: numCourseId }] },
          progress_status: "In_progress",
          progress_percentage: 0,
          completed_modules: [moduleKey],
          started_at: startedAtFromReq || lastAccessedAt,
          completed_at: null,
          last_accessed_at: lastAccessedAt,
          time_spent_minutes: deltaMinutes,
          certificate_issued: false,
          selected_language: effectiveLang,
        },
        status: 'published',
      }));
      progress = await loadProgress(strapi, numUserId, numCourseId);
    } else {
      const completedSet = new Set((progress.completed_modules || []).map(String));
      completedSet.add(moduleKey);
      const data = {
        completed_modules: [...completedSet],
        started_at: progress.started_at || startedAtFromReq || lastAccessedAt,
        last_accessed_at: lastAccessedAt,
        time_spent_minutes: Math.max(0, Number(progress.time_spent_minutes || 0)) + deltaMinutes,
        selected_language: effectiveLang,
      };
      await updateProgressRows(strapi, progress, data);
      progress = { ...progress, ...data };
    }

    const summary = await recomputeProgress(strapi, { userId: numUserId, courseId: numCourseId, progress, course });
    const fresh = await strapi.db.query(uid).findOne({ where: { id: progress.id } });

    return ctx.send({
      message: "Module marked completed",
      completed_modules: fresh?.completed_modules ?? progress.completed_modules,
      nextStep: summary?.nextStep ?? "continue",
      module_states: summary?.modules ?? [],
      progress: fresh ?? progress,
    });
  },

  /**
   * Called after a quiz submission. Module completion and course status are re-derived
   * from the learner's submissions (see utils/course-modules).
   */
  async updateAfterQuiz(courseId, userId) {
    const numUserId = Number(userId);
    const numCourseId = await resolveCourseId(strapi, courseId);
    if (numCourseId == null || Number.isNaN(numUserId)) return;
    await recomputeProgress(strapi, { userId: numUserId, courseId: numCourseId });
  },

  /**
   * GET /api/user-progress/all?userId=
   * Returns all progress records for a user (for merging with course list to show completed).
   */
  async getAllProgress(ctx) {
    const { userId } = ctx.query;
    if (!userId) return ctx.badRequest('userId is required');
    const uid = 'api::user-progress.user-progress';
    const records = await strapi.documents(uid).findMany({
      filters: { user: { id: Number(userId) } },
      populate: ['course'],
      status: 'published',
      limit: 500,
    });

    const numUserId = Number(userId);
    const feedbackCourseIds = new Set();
    try {
      const fbRecords = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
        where: { users_permissions_user: numUserId },
        populate: ['course'],
        limit: 1000,
      });
      (Array.isArray(fbRecords) ? fbRecords : []).forEach((fb) => {
        const cId = fb.course?.id;
        if (cId != null) feedbackCourseIds.add(Number(cId));
      });
    } catch (e) {
      strapi.log.warn('getAllProgress: feedback batch query failed:', e?.message);
    }

    const byCourse = {};
    (Array.isArray(records) ? records : []).forEach((r) => {
      const courseId = r.course?.id ?? r.course;
      if (courseId != null) {
        const numCourseId = Number(courseId);
        byCourse[numCourseId] = {
          progress_status: r.progress_status,
          completed: r.progress_status === 'Completed',
          completed_at: r.completed_at,
          certificate_issued: r.certificate_issued,
          feedback_submitted: feedbackCourseIds.has(numCourseId),
          due_date: r.due_date ?? null,
        };
      }
    });
    return ctx.send(byCourse);
  },

  /**
   * GET /api/user-progress/progress?userId=&courseId=
   * Returns the progress record (including completed_modules) for a user+course pair.
   * Uses strapi.documents for Strapi 5 compatibility (db.query has relation column issues).
   * courseId can be numeric id or documentId.
   */
  async getProgress(ctx) {
    const { userId, courseId } = ctx.query;
    if (!userId || !courseId) {
      return ctx.badRequest('userId and courseId are required');
    }
    const numUserId = Number(userId);
    const numCourseId = await resolveCourseId(strapi, courseId);
    if (numCourseId == null) {
      return ctx.send({ completed_modules: [], progress_status: null });
    }
    const uid = 'api::user-progress.user-progress';
    let progress = null;
    try {
      let list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!progress) {
        list = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        progress = Array.isArray(list) && list.length > 0 ? list[0] : null;
      }
    } catch (e) {
      strapi.log.warn('getProgress documents failed, trying db.query fallback:', e?.message);
      progress = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }
    // Per-module state (type, unlocked, completed, quiz attempts, offline proof) for the learner's language.
    const moduleStateFor = async (progressRow) => {
      try {
        const course = await loadCourse(strapi, numCourseId);
        if (!course) return { module_states: [], next_step: 'continue', current_module_id: null };
        const language = progressRow?.selected_language || ctx.query.language || null;
        const summary = await computeModuleStates(strapi, {
          course,
          userId: numUserId,
          progress: { ...(progressRow || {}), selected_language: language },
        });
        return {
          module_states: summary.modules,
          next_step: nextStepFor(summary, course),
          current_module_id: summary.currentModule?.module_id ?? null,
        };
      } catch (e) {
        strapi.log.warn('getProgress: module state computation failed:', e?.message);
        return { module_states: [], next_step: 'continue', current_module_id: null };
      }
    };

    if (!progress) {
      return ctx.send({
        ...(await moduleStateFor(null)),
        progress_status: 'Not_started',
        progress_percentage: 0,
        completed_modules: [],
        started_at: null,
        completed_at: null,
        last_accessed_at: null,
        time_spent_minutes: 0,
        certificate_issued: false,
        certificate_url: null,
        selected_language: null,
        course: null,
        user: null,
        quiz_submission: null,
        feedback_submission: null,
      });
    }
    // Re-fetch with full population via db.query for complete field set
    let full = null;
    try {
      full = await strapi.db.query('api::user-progress.user-progress').findOne({
        where: { id: progress.id },
        populate: {
          course: true,
          user: true,
          quiz_submission: true,
          feedback_submission: true,
        },
      });
    } catch (e) {
      full = progress;
    }
    // Check feedback existence via a direct query (the oneToOne relation may not be linked)
    let hasFeedback = !!full.feedback_submission;
    if (!hasFeedback) {
      try {
        const fbCount = await strapi.db.query('api::feedback-submission.feedback-submission').count({
          where: { course: numCourseId, users_permissions_user: numUserId },
        });
        hasFeedback = fbCount > 0;
      } catch { /* ignore */ }
    }
    // Only downgrade Completed → In_progress when feedback IS compulsory but missing
    let feedbackCompulsory = false;
    try {
      const courseForFb = await strapi.db.query('api::course.course').findOne({
        where: { id: numCourseId },
        populate: { feedback: true },
      });
      feedbackCompulsory = courseForFb?.feedback?.[0]?.compulsory === true;
    } catch { /* ignore */ }
    const effectiveStatus =
      full.progress_status === 'Completed' && feedbackCompulsory && !hasFeedback
        ? 'In_progress'
        : full.progress_status;

    return ctx.send({
      id: full.id,
      documentId: full.documentId ?? null,
      progress_status: effectiveStatus,
      progress_percentage: full.progress_percentage ?? 0,
      completed_modules: Array.isArray(full.completed_modules) ? full.completed_modules : [],
      started_at: full.started_at ?? null,
      completed_at: full.completed_at ?? null,
      last_accessed_at: full.last_accessed_at ?? null,
      time_spent_minutes: full.time_spent_minutes ?? 0,
      certificate_issued: !!full.certificate_issued,
      certificate_url: full.certificate_url ?? null,
      selected_language: full.selected_language ?? null,
      course: full.course ?? null,
      user: full.user ?? null,
      quiz_submission: full.quiz_submission ?? null,
      feedback_submission: full.feedback_submission ?? null,
      ...(await moduleStateFor(full)),
    });
  },

  /**
   * Called after feedback submission.
   * If quiz passed & feedback submitted → course completed.
   * Uses strapi.documents (same as getProgress) so the update is visible when user returns.
   * courseId can be numeric or documentId.
   */
  async finalizeCourse(courseId, userId, feedbackSubmissionId) {
    const uid = "api::user-progress.user-progress";
    const now = new Date();
    const numUserId = Number(userId);
    const numCourseId = await resolveCourseId(strapi, courseId);
    if (numCourseId == null) {
      strapi.log.warn('finalizeCourse: could not resolve courseId', courseId);
      return;
    }

    let existing = null;
    try {
      const list = await strapi.documents(uid).findMany({
        filters: { user: { id: numUserId }, course: { id: numCourseId } },
        status: 'published',
        limit: 1,
      });
      existing = Array.isArray(list) && list.length > 0 ? list[0] : null;
      if (!existing) {
        const draftList = await strapi.documents(uid).findMany({
          filters: { user: { id: numUserId }, course: { id: numCourseId } },
          status: 'draft',
          limit: 1,
        });
        existing = Array.isArray(draftList) && draftList.length > 0 ? draftList[0] : null;
      }
    } catch (e) {
      strapi.log.warn('finalizeCourse findMany failed:', e?.message);
      existing = await strapi.db.query(uid).findOne({
        where: { user: numUserId, course: numCourseId },
      });
    }

    // Resolve feedbackSubmissionId to numeric id for relation linking
    let fbNumericId = null;
    if (feedbackSubmissionId) {
      const fbNum = Number(feedbackSubmissionId);
      if (Number.isFinite(fbNum)) {
        fbNumericId = fbNum;
      } else {
        try {
          const fbRow = await strapi.db.query('api::feedback-submission.feedback-submission').findOne({
            where: { documentId: String(feedbackSubmissionId) },
            select: ['id'],
          });
          fbNumericId = fbRow?.id ?? null;
        } catch { /* ignore */ }
      }
    }

    if (existing) {
      // Feedback has no percentage weight. Course is already Completed after quiz pass.
      // Just ensure the record stays Completed and link the feedback submission.
      /** @type {any} */
      const updateData = {
        progress_status: "Completed",
        completed_at: existing.completed_at ?? now,
        certificate_issued: true,
      };
      try {
        if (existing.documentId) {
          await strapi.documents(uid).update(/** @type {any} */ ({
            documentId: existing.documentId,
            data: updateData,
            status: 'published',
          }));
        } else {
          await strapi.db.query(uid).update({
            where: { id: existing.id },
            data: updateData,
          });
        }
      } catch (err) {
        strapi.log.error('finalizeCourse update failed:', err?.message);
        await strapi.db.query(uid).update({
          where: { id: existing.id },
          data: updateData,
        });
      }
      // Link the feedback_submission relation if available
      if (fbNumericId) {
        try {
          await strapi.db.query('api::feedback-submission.feedback-submission').update({
            where: { id: fbNumericId },
            data: { user_progress: existing.id },
          });
        } catch (linkErr) {
          strapi.log.warn('finalizeCourse: could not link feedback_submission:', linkErr?.message);
        }
      }
    } else {
      try {
        await strapi.documents(uid).create(/** @type {any} */ ({
          data: {
            user: { connect: [{ id: numUserId }] },
            course: { connect: [{ id: numCourseId }] },
            progress_status: "Completed",
            progress_percentage: 100,
            completed_modules: [],
            completed_at: now,
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: true,
          },
          status: 'published',
        }));
      } catch (createErr) {
        strapi.log.warn('finalizeCourse documents create failed:', createErr?.message);
        await strapi.db.query(uid).create({
          data: {
            user: numUserId,
            course: numCourseId,
            progress_status: "Completed",
            progress_percentage: 100,
            completed_modules: [],
            completed_at: now,
            last_accessed_at: now,
            time_spent_minutes: 0,
            certificate_issued: true,
          },
        });
      }
    }
  },

}));