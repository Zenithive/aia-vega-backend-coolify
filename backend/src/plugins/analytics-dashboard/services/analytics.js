// @ts-nocheck

'use strict';

/**
 * Analytics Service - Aggregates data for analytics dashboards.
 * Composes shared, common, learning (quiz) and overall view modules.
 */
const getShared = (strapi) => require('./analyticsShared')({ strapi });
const { buildEmployeeAccountStatus } = require('./analyticsShared');
const getCommon = (strapi) => require('./analyticsCommon')({ strapi });
const getLearningQuiz = (strapi) => require('./learning/learningQuiz')({ strapi });
const getOverall = (strapi) => require('./overall/overall')({ strapi });
const getTelemetry = (strapi) => require('./analyticsTelemetry')({ strapi });

const normalizeDateBound = (value, endOfDay = false) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.toISOString();
};

const LEARNING_TIME_EVENTS = new Set([
  'learning_module_exit',
  'learning_video_progress',
  'learning_video_completed',
  'learning_quiz_submitted',
  'learning_feedback_submitted',
]);

function sumQuizTimeMinutes(submissions) {
  return (submissions || []).reduce((sum, s) => {
    const minutes = Number(s?.time_taken_minutes);
    return sum + (Number.isFinite(minutes) && minutes >= 0 ? minutes : 0);
  }, 0);
}

function sumProgressMinutes(progressList) {
  return (progressList || []).reduce((sum, p) => {
    const minutes = Number(p?.time_spent_minutes);
    return sum + (Number.isFinite(minutes) && minutes >= 0 ? minutes : 0);
  }, 0);
}

function sumVideoWatchMinutes(videoRows) {
  return (videoRows || []).reduce((sum, row) => {
    const minutes = Number(row?.time_watched_min);
    return sum + (Number.isFinite(minutes) && minutes >= 0 ? minutes : 0);
  }, 0);
}

function telemetryBucketToMinutes(bucket) {
  if (!bucket) {
    return { module: 0, video: 0, quiz: 0, feedback: 0 };
  }
  return {
    module: (Number(bucket.moduleSeconds) || 0) / 60,
    video: (Number(bucket.videoSeconds) || 0) / 60,
    quiz: (Number(bucket.quizSeconds) || 0) / 60,
    feedback: (Number(bucket.feedbackSeconds) || 0) / 60,
  };
}

async function resolveCourseIdKeys(strapi, courseIdStr) {
  const keys = new Set();
  if (!courseIdStr) return keys;
  const trimmed = String(courseIdStr).trim();
  if (!trimmed) return keys;
  keys.add(trimmed);
  if (/^\d+$/.test(trimmed)) keys.add(String(Number(trimmed)));
  try {
    const where = /^\d+$/.test(trimmed) ? { id: Number(trimmed) } : { documentId: trimmed };
    const course = await strapi.db.query('api::course.course').findOne({
      where,
      select: ['id', 'documentId'],
    });
    if (course?.id != null) keys.add(String(course.id));
    if (course?.documentId) keys.add(String(course.documentId));
  } catch (_) {}
  return keys;
}

async function loadVideoProgressByUser(strapi, userIds, courseIdStr) {
  const byUser = new Map();
  if (!Array.isArray(userIds) || userIds.length === 0) return byUser;

  const where = { user: { id: { $in: userIds } } };
  if (courseIdStr) {
    const trimmed = String(courseIdStr).trim();
    if (/^\d+$/.test(trimmed)) {
      where.course = { id: Number(trimmed) };
    } else {
      where.course = { documentId: trimmed };
    }
  }

  let rows = [];
  try {
    rows = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
      where,
      select: ['time_watched_min', 'user_id'],
      populate: { user: { select: ['id'] } },
      limit: 50000,
    });
  } catch (_) {}

  (rows || []).forEach((row) => {
    const uid = row.user?.id ?? row.user_id;
    if (uid == null) return;
    const key = String(uid);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(row);
  });

  return byUser;
}

/**
 * Returns the Set of numeric user IDs that have an ACTIVE (active='published')
 * course-assignment for the given course (by numeric ID or documentId string).
 *
 * This is used by analytics to exclude users whose assignment was replaced
 * by a newer assignment (old assignment marked active='unpublished').
 *
 * Only Individual-type assignments are checked because all assignment types
 * (Dept, Location, Workflow) automatically create per-user Individual entries.
 */
async function getActivelyAssignedUserIdsForCourse(strapi, courseIdStr) {
  const activeUserIds = new Set();
  if (!courseIdStr) return activeUserIds;

  const trimmed = String(courseIdStr).trim();
  const isNumeric = /^\d+$/.test(trimmed);

  const courseWhere = isNumeric
    ? { id: Number(trimmed) }
    : { documentId: trimmed };

  let assignments = [];
  try {
    assignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
      where: {
        active: 'published',
        assignment_target_type: 'Individual',
        courses: courseWhere,
      },
      populate: { individual_user: { select: ['id'] } },
      limit: 50000,
    });
  } catch (_) {}

  (assignments || []).forEach((a) => {
    const users = Array.isArray(a.individual_user) ? a.individual_user : [];
    users.forEach((u) => {
      if (u?.id != null) activeUserIds.add(Number(u.id));
    });
  });

  return activeUserIds;
}

async function loadLearningActivityTimeByUser(strapi, userIds, params = {}) {
  const result = new Map();
  if (!Array.isArray(userIds) || userIds.length === 0) return result;

  const dateFromNorm = normalizeDateBound(params.dateFrom, false);
  const dateToNorm = normalizeDateBound(params.dateTo, true);
  const courseIdStr = params.courseId ? String(params.courseId).trim() : null;
  const courseIdKeys = courseIdStr ? await resolveCourseIdKeys(strapi, courseIdStr) : null;

  const where = {
    user: { id: { $in: userIds } },
    activity_description: { $in: Array.from(LEARNING_TIME_EVENTS) },
  };
  if (dateFromNorm || dateToNorm) {
    where.timestamp = {};
    if (dateFromNorm) where.timestamp.$gte = dateFromNorm;
    if (dateToNorm) where.timestamp.$lte = dateToNorm;
  }

  let events = [];
  try {
    events = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      select: ['activity_description', 'entity_type', 'entity_id', 'activity_duration', 'user_id'],
      populate: { user: { select: ['id'] } },
      limit: 100000,
    });
  } catch (_) {}

  (events || []).forEach((row) => {
    const uid = row.user?.id ?? row.user_id;
    if (uid == null) return;

    const eventName = row.activity_description || '';
    if (!LEARNING_TIME_EVENTS.has(eventName)) return;

    const entityType = String(row.entity_type || '').toLowerCase();
    const entityId = row.entity_id != null ? String(row.entity_id).trim() : '';
    if (courseIdKeys && courseIdKeys.size > 0) {
      if (entityType !== 'course' || !entityId || !courseIdKeys.has(entityId)) return;
    }

    const mapKey = courseIdStr ? `${uid}::${courseIdStr}` : String(uid);
    if (!result.has(mapKey)) {
      result.set(mapKey, {
        moduleSeconds: 0,
        videoSeconds: 0,
        quizSeconds: 0,
        feedbackSeconds: 0,
      });
    }

    const duration = Math.max(0, Number(row.activity_duration) || 0);
    const bucket = result.get(mapKey);
    if (eventName.includes('module')) bucket.moduleSeconds += duration;
    else if (eventName.includes('video')) bucket.videoSeconds += duration;
    else if (eventName.includes('quiz')) bucket.quizSeconds += duration;
    else if (eventName.includes('feedback')) bucket.feedbackSeconds += duration;
  });

  return result;
}

function getEmployeeTimeContextKey(userId, courseIdStr) {
  return courseIdStr ? `${userId}::${courseIdStr}` : String(userId);
}

const DROP_OFF_INACTIVE_DAYS = 14;

function getDropOffCutoffDateStr() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DROP_OFF_INACTIVE_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

function parseDropOffOnlyParam(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function isDropOffProgress(progress, dropOffCutoffStr = getDropOffCutoffDateStr()) {
  const status = progress?.progress_status ?? progress?.progressStatus;
  const percentage = progress?.progress_percentage ?? progress?.progressPercentage ?? 0;
  const lastAccess = progress?.last_accessed_at ?? progress?.lastAccessedAt;
  const startedAt = progress?.started_at ?? progress?.startedAt;
  const isStarted = status === 'In_progress' || (status === 'Not_started' && startedAt);
  const notCompleted = status !== 'Completed' && status !== 'Failed';
  const inactiveLongEnough = lastAccess && String(lastAccess).slice(0, 10) < dropOffCutoffStr;
  return isStarted && notCompleted && percentage < 100 && inactiveLongEnough;
}

function buildDropOffEnrollments(progresses, dropOffCutoffStr = getDropOffCutoffDateStr(), userById = {}) {
  const today = new Date();
  return (Array.isArray(progresses) ? progresses : [])
    .filter((p) => isDropOffProgress(p, dropOffCutoffStr))
    .map((p) => {
      const uid = p.user?.id ?? p.user_id ?? p.userId;
      const user = {
        ...(p.user || {}),
        ...(uid != null && userById[uid] ? userById[uid] : {}),
      };
      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      let inactiveDays = null;
      if (lastAccess) {
        const diffMs = today.getTime() - new Date(lastAccess).getTime();
        inactiveDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }
      return {
        employeeId: user.id ?? p.user_id ?? p.userId,
        employeeName: user.username || user.email || `User ${user.id ?? p.user_id ?? ''}`,
        email: user.email || '—',
        company: user.company || '—',
        emp_code: user.emp_code ?? '—',
        emp_id: user.emp_id ?? '—',
        branch: user.branch ?? '—',
        working_location: user.working_location ?? '—',
        ...buildEmployeeAccountStatus(user),
        courseId: p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.courseId,
        courseTitle: p.course?.title ?? 'Unknown',
        status: p.progress_status ?? '—',
        progressPercent: p.progress_percentage ?? p.progressPercentage ?? 0,
        lastAccessedAt: lastAccess ? String(lastAccess).slice(0, 10) : '—',
        inactiveDays,
      };
    })
    .sort((a, b) => (b.inactiveDays ?? 0) - (a.inactiveDays ?? 0));
}

function intersectUserWhereWithIds(userWhere, filteredIds) {
  const filtered = [...filteredIds].filter((n) => Number.isFinite(n));
  if (filtered.length === 0) return false;

  if (typeof userWhere.id === 'number') {
    if (!filtered.includes(userWhere.id)) return false;
    return true;
  }
  if (userWhere.id && Array.isArray(userWhere.id.$in)) {
    const intersected = userWhere.id.$in.filter((id) => filtered.includes(Number(id)));
    if (intersected.length === 0) return false;
    userWhere.id = { $in: intersected };
    return true;
  }
  userWhere.id = { $in: filtered };
  return true;
}

async function loadDropOffUserIds(strapi, params = {}) {
  const dropOffCutoffStr = getDropOffCutoffDateStr();
  const dropOffUserIds = new Set();
  const progressFilters = {};
  if (params.courseId) {
    const courseIdStr = String(params.courseId).trim();
    progressFilters.$or = [
      { course: { id: courseIdStr } },
      { course: { documentId: courseIdStr } },
    ];
  }

  let allProgress = [];
  try {
    const [published, draft] = await Promise.all([
      strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'published',
        fields: ['progress_status', 'progress_percentage', 'last_accessed_at', 'started_at'],
        populate: { user: { fields: ['id'] } },
        pagination: { limit: 50000 },
      }),
      strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'draft',
        fields: ['progress_status', 'progress_percentage', 'last_accessed_at', 'started_at'],
        populate: { user: { fields: ['id'] } },
        pagination: { limit: 50000 },
      }),
    ]);
    const merged = [
      ...(Array.isArray(published) ? published : []),
      ...(Array.isArray(draft) ? draft : []),
    ];
    const seen = new Set();
    allProgress = merged.filter((p) => {
      const key = p?.documentId ? `doc:${p.documentId}` : `id:${p?.id ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (_) {
    try {
      const progressWhere = {};
      if (params.courseId) progressWhere.course_id = String(params.courseId).trim();
      allProgress = await strapi.db.query('api::user-progress.user-progress').findMany({
        where: progressWhere,
        select: ['user_id', 'progress_status', 'progress_percentage', 'last_accessed_at', 'started_at'],
        limit: 50000,
      }) || [];
    } catch (_) {}
  }

  allProgress.forEach((p) => {
    if (!isDropOffProgress(p, dropOffCutoffStr)) return;
    const uid = p.user?.id ?? p.user_id;
    if (uid != null) dropOffUserIds.add(Number(uid));
  });

  return dropOffUserIds;
}

function getLastQuizAttemptScore(submissions) {
  const subs = Array.isArray(submissions) ? submissions : [];
  if (subs.length === 0) return 0;
  const last = [...subs].sort((a, b) => {
    const attemptDiff = (Number(b?.attempt_number) || 0) - (Number(a?.attempt_number) || 0);
    if (attemptDiff !== 0) return attemptDiff;
    return new Date(b?.submitted_at || 0).getTime() - new Date(a?.submitted_at || 0).getTime();
  })[0];
  const score = Number(last?.score);
  return Number.isFinite(score) ? Math.round(score) : 0;
}

function buildEmployeeTableRowMetrics(progs, subs, timeContext = {}) {
  const { videoRows = [], telemetry = null } = timeContext;
  const progressMinutes = sumProgressMinutes(progs);
  const quizSubmissionMinutes = sumQuizTimeMinutes(subs);
  const videoWatchMinutes = sumVideoWatchMinutes(videoRows);
  const telemetryMinutes = telemetryBucketToMinutes(telemetry);

  // Module + video: stored progress/video records, supplemented by activity telemetry when higher.
  const moduleContentMinutes = Math.max(
    progressMinutes + videoWatchMinutes,
    telemetryMinutes.module + telemetryMinutes.video,
  );

  // Quiz: all submission attempts (reattempt-safe), supplemented by activity telemetry when higher.
  const quizMinutes = Math.max(quizSubmissionMinutes, telemetryMinutes.quiz);

  // Feedback: tracked via learning activity events.
  const feedbackMinutes = telemetryMinutes.feedback;

  const lastQuizScore = getLastQuizAttemptScore(subs);
  const quizAttemptCount = Array.isArray(subs) ? subs.length : 0;

  return {
    courseCompletionTimeMinutes: Math.round(moduleContentMinutes + quizMinutes + feedbackMinutes),
    lastQuizScore,
    avgScore: lastQuizScore,
    quizAttemptCount,
  };
}

module.exports = ({ strapi }) => {
  if (strapi.__analyticsDashboardService) {
    return strapi.__analyticsDashboardService;
  }

  const shared = getShared(strapi);
  const common = getCommon(strapi);
  const learningQuiz = getLearningQuiz(strapi);
  const overall = getOverall(strapi);
  const telemetry = getTelemetry(strapi);
  const service = {
    ...shared,
    ...common,
    ...learningQuiz,
    ...overall,
    ...telemetry,

  async _getRealtimeLearningMinutesByCourse(params = {}, userId = null) {
    const out = {
      byCourseId: new Map(),
      byCourseTitle: new Map(),
      totalMinutes: 0,
    };
    try {
      const telemetryParams = /** @type {any} */ ({
        ...params,
        location: params.location ?? params.unitLocation,
      });
      if (userId != null) telemetryParams.userId = userId;
      const self = /** @type {any} */ (this);
      if (typeof self.getLearningStats !== 'function') return out;
      const raw = await self.getLearningStats(telemetryParams);
      const entities = Array.isArray(raw?.by_entity) ? raw.by_entity : [];
      const entityCourseIds = [];
      entities.forEach((entity) => {
        if (String(entity?.entity_type || '').toLowerCase() !== 'course') return;
        const seconds = Number(entity?.total_time_seconds || 0);
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        const minutes = Math.round((seconds / 60) * 10) / 10;
        const idKey = entity?.entity_id != null ? String(entity.entity_id).trim() : '';
        const titleKey = entity?.entity_label ? String(entity.entity_label).trim().toLowerCase() : '';
        if (idKey) {
          entityCourseIds.push(idKey);
          out.byCourseId.set(idKey, Math.max(out.byCourseId.get(idKey) || 0, minutes));
        }
        if (titleKey) {
          out.byCourseTitle.set(titleKey, Math.max(out.byCourseTitle.get(titleKey) || 0, minutes));
        }
      });

      if (entityCourseIds.length > 0) {
        const uniqueIds = [...new Set(entityCourseIds)];
        const numericIds = uniqueIds.filter((id) => /^\d+$/.test(id)).map(Number);
        const documentIds = uniqueIds.filter((id) => !/^\d+$/.test(id));
        const [coursesByNumeric, coursesByDocument] = await Promise.all([
          numericIds.length > 0
            ? strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericIds } }, select: ['id', 'documentId'] })
            : [],
          documentIds.length > 0
            ? strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: documentIds } }, select: ['id', 'documentId'] })
            : [],
        ]);
        [...(coursesByNumeric || []), ...(coursesByDocument || [])].forEach((course) => {
          const idKey = course?.id != null ? String(course.id) : '';
          const docKey = course?.documentId ? String(course.documentId) : '';
          const linkedMinutes = Math.max(
            idKey ? (out.byCourseId.get(idKey) || 0) : 0,
            docKey ? (out.byCourseId.get(docKey) || 0) : 0,
          );
          if (linkedMinutes > 0) {
            if (idKey) out.byCourseId.set(idKey, linkedMinutes);
            if (docKey) out.byCourseId.set(docKey, linkedMinutes);
          }
        });
      }

      const totals = raw?.totals || {};
      const totalSeconds = Number(totals.module_time_seconds || 0)
        + Number(totals.video_time_seconds || 0)
        + Number(totals.quiz_time_seconds || 0)
        + Number(totals.feedback_time_seconds || 0);
      out.totalMinutes = Math.round(((Number(totalSeconds) || 0) / 60) * 10) / 10;
    } catch (e) {
      strapi.log.warn('Learning realtime by course resolve failed:', e?.message);
    }
    return out;
  },

  _mergeRealtimeMinutesIntoCourseRows(rows = [], realtime = null) {
    if (!Array.isArray(rows) || !realtime) return rows;
    return rows.map((row) => {
      const idKey = row?.courseId != null ? String(row.courseId).trim() : '';
      const titleKey = row?.courseTitle ? String(row.courseTitle).trim().toLowerCase() : '';
      let realtimeMinutes = 0;
      if (idKey && realtime.byCourseId?.has(idKey)) {
        realtimeMinutes = realtime.byCourseId.get(idKey) || 0;
      } else if (titleKey && realtime.byCourseTitle?.has(titleKey)) {
        realtimeMinutes = realtime.byCourseTitle.get(titleKey) || 0;
      }
      if (!Number.isFinite(realtimeMinutes) || realtimeMinutes <= 0) return row;
      const existing = Number(row.timeSpentMinutes || 0);
      return {
        ...row,
        // Divide realtime total by enrollmentCount so we compare per-enrollment averages.
        // realtimeMinutes is the SUM across all users for that course, not per-enrollment.
        timeSpentMinutes: Math.max(existing, Math.round((realtimeMinutes / (row.enrollmentCount || 1)) * 10) / 10),
      };
    });
  },

  _applyRealtimeToSelectedCourseRows(rows = [], selectedCourseId = null, realtime = null) {
    if (!Array.isArray(rows) || !selectedCourseId || !realtime || (Number(realtime.totalMinutes) || 0) <= 0) return rows;
    const selected = String(selectedCourseId).trim();
    if (!selected) return rows;

    // When filtered by course, backend usually returns one course row.
    // Divide realtime.totalMinutes by enrollmentCount so it's a per-enrollment figure.
    if (rows.length === 1) {
      const only = rows[0] || {};
      const n = only.enrollmentCount || 1;
      const realtimePerEnrollment = Math.round((Number(realtime.totalMinutes) / n) * 10) / 10;
      return [{ ...only, timeSpentMinutes: Math.max(Number(only.timeSpentMinutes) || 0, realtimePerEnrollment) }];
    }

    const selectedNum = /^\d+$/.test(selected) ? Number(selected) : NaN;
    return rows.map((row) => {
      const rowId = row?.courseId != null ? String(row.courseId).trim() : '';
      const rowNum = /^\d+$/.test(rowId) ? Number(rowId) : NaN;
      const matches = rowId === selected || (!Number.isNaN(selectedNum) && !Number.isNaN(rowNum) && selectedNum === rowNum);
      if (!matches) return row;
      const n = row.enrollmentCount || 1;
      const realtimePerEnrollment = Math.round((Number(realtime.totalMinutes) / n) * 10) / 10;
      return {
        ...row,
        timeSpentMinutes: Math.max(Number(row.timeSpentMinutes) || 0, realtimePerEnrollment),
      };
    });
  },

  _dedupeCourseOptions(list = []) {
    const deduped = new Map();
    (list || []).forEach((course) => {
      const id = course?.id ?? course?.documentId ?? null;
      const documentId = course?.documentId ? String(course.documentId).trim() : '';
      const title = String(course?.title ?? '').trim();
      const key = documentId || (title ? `title:${title.toLowerCase()}` : (id != null ? `id:${String(id)}` : ''));
      if (!key) return;
      if (!deduped.has(key)) {
        deduped.set(key, {
          id,
          documentId: documentId || null,
          title: title || `Course ${id}`,
        });
        return;
      }
      const existing = deduped.get(key);
      if ((existing?.documentId == null || existing.documentId === '') && documentId) {
        deduped.set(key, {
          id,
          documentId,
          title: title || existing?.title || `Course ${id}`,
        });
      }
    });
    return [...deduped.values()].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  },

  _courseOptionKey(course = {}) {
    const documentId = course?.documentId ? String(course.documentId).trim() : '';
    const title = String(course?.title ?? '').trim();
    const id = course?.id != null ? String(course.id).trim() : '';
    return documentId || (title ? `title:${title.toLowerCase()}` : (id ? `id:${id}` : ''));
  },

  _intersectCourseOptions(primary = [], secondary = []) {
    if (!Array.isArray(primary) || primary.length === 0) return [];
    if (!Array.isArray(secondary) || secondary.length === 0) return [];
    const secondaryKeys = new Set(secondary.map((course) => this._courseOptionKey(course)).filter(Boolean));
    return this._dedupeCourseOptions(primary.filter((course) => secondaryKeys.has(this._courseOptionKey(course))));
  },

  async _extractCoursesFromAssignments(assignments = []) {
    const inlineCourses = [];
    const numericCourseIds = new Set();
    const documentCourseIds = new Set();

    (assignments || []).forEach((assignment) => {
      const linkedCourses = Array.isArray(assignment?.courses)
        ? assignment.courses
        : (assignment?.course ? [assignment.course] : []);

      if (linkedCourses.length > 0) {
        linkedCourses.forEach((course) => {
          if (!course) return;
          const courseId = course.id ?? course.documentId ?? course.document_id ?? null;
          const courseDocId = course.documentId ?? course.document_id ?? null;
          const title = course.title ?? course.attributes?.title ?? null;
          if (title || courseDocId || courseId != null) {
            inlineCourses.push({
              id: courseId,
              documentId: courseDocId ?? null,
              title: title ?? `Course ${courseId ?? courseDocId}`,
            });
          }
          if (courseId != null && /^\d+$/.test(String(courseId))) numericCourseIds.add(Number(courseId));
          if (courseDocId != null && String(courseDocId).trim()) documentCourseIds.add(String(courseDocId).trim());
        });
        return;
      }

      const rawIds = [assignment?.course_id, assignment?.courseId, assignment?.course].filter((value) => value != null && typeof value !== 'object');
      rawIds.forEach((value) => {
        const asStr = String(value).trim();
        if (!asStr) return;
        if (/^\d+$/.test(asStr)) numericCourseIds.add(Number(asStr));
        else documentCourseIds.add(asStr);
      });
    });

    const [coursesById, coursesByDoc] = await Promise.all([
      numericCourseIds.size > 0
        ? strapi.db.query('api::course.course').findMany({
            where: { id: { $in: [...numericCourseIds] } },
            select: ['id', 'documentId', 'title'],
            limit: 1000,
          })
        : [],
      documentCourseIds.size > 0
        ? strapi.db.query('api::course.course').findMany({
            where: { documentId: { $in: [...documentCourseIds] } },
            select: ['id', 'documentId', 'title'],
            limit: 1000,
          })
        : [],
    ]);

    return this._dedupeCourseOptions([
      ...inlineCourses,
      ...(coursesById || []).map((course) => ({ id: course.id, documentId: course.documentId ?? null, title: course.title ?? `Course ${course.id}` })),
      ...(coursesByDoc || []).map((course) => ({ id: course.id ?? course.documentId, documentId: course.documentId ?? null, title: course.title ?? `Course ${course.id ?? course.documentId}` })),
    ]);
  },

  async _getDepartmentAssignedCourses(departmentId) {
    if (departmentId == null || departmentId === '') return [];
    let assignments = [];
    let numericDept = typeof departmentId === 'number' ? departmentId : parseInt(String(departmentId), 10);
    const isDocId = typeof departmentId === 'string' && departmentId.length > 10;
    if (Number.isNaN(numericDept) && isDocId) {
      const deptRow = await strapi.db.query('api::department.department').findOne({
        where: { documentId: departmentId },
        select: ['id'],
      });
      if (deptRow?.id != null) numericDept = Number(deptRow.id);
    }
    if (!Number.isNaN(numericDept)) {
      assignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
        where: { assignment_target_type: 'Department', departments: { id: numericDept } },
        populate: ['courses'],
        limit: 500,
      }) || [];
    }
    if (assignments.length === 0 && isDocId) {
      assignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
        where: { assignment_target_type: 'Department', departments: { documentId: departmentId } },
        populate: ['courses'],
        limit: 500,
      }) || [];
    }
    if (assignments.length === 0) return [];
    return this._extractCoursesFromAssignments(assignments);
  },

  async _getLocationAssignedCourses(locationId) {
    if (locationId == null || locationId === '') return [];
    let assignments = [];
    let numericLocation = typeof locationId === 'number' ? locationId : parseInt(String(locationId), 10);
    const isDocId = typeof locationId === 'string' && locationId.length > 10;
    if (Number.isNaN(numericLocation) && isDocId) {
      const locationRow = await strapi.db.query('api::work-location.work-location').findOne({
        where: { documentId: String(locationId) },
        select: ['id'],
      });
      if (locationRow?.id != null) numericLocation = Number(locationRow.id);
    }
    if (!Number.isNaN(numericLocation)) {
      assignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
        where: { assignment_target_type: 'Location', work_locations: { id: numericLocation } },
        populate: ['courses'],
        limit: 500,
      }) || [];
    }
    if (assignments.length === 0 && isDocId) {
      assignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
        where: { assignment_target_type: 'Location', work_locations: { documentId: String(locationId) } },
        populate: ['courses'],
        limit: 500,
      }) || [];
    }
    if (assignments.length === 0) return [];
    return this._extractCoursesFromAssignments(assignments);
  },

  /**
   * LEARNING ANALYTICS - Global (all employees)
   */
  async getLearningGlobal(params = {}) {
    const emptyResponse = () => ({
      kpis: {
        totalCourses: 0,
        totalEnrollments: 0,
        completionRate: 0,
        avgTimeSpentMinutes: 0,
        avgQuizScore: 0,
        completedCourse: 0,
        dropOffRate: 0,
        dropOffCount: 0,
        totalAssignments: 0,
        certificatesIssued: 0,
      },
      statusDistribution: [],
      categoryDistribution: [],
      departmentDistribution: [],
      monthlyCompletions: [],
      learningActivityByWeek: [],
      completionFunnel: [],
      dropOffEnrollments: [],
    });
    try {
    let progresses = [];
    const wantCompanyEarly = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const wantCompanyNormEarly = wantCompanyEarly ? (String(params.company).trim().toLowerCase() === 'vega' ? 'Vega' : String(params.company).trim().toLowerCase() === 'aia' ? 'AIA' : String(params.company).trim()) : null;
    let companyUserIds = null;
    if (wantCompanyNormEarly) {
      try {
        const companyUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: wantCompanyNormEarly },
          select: ['id'],
        });
        companyUserIds = (companyUsers || []).map((u) => u.id).filter((id) => id != null);
      } catch (e) {
        strapi.log.warn('Learning global: company user lookup failed:', e?.message);
      }
    }
    // user-progress has no company field; filter via user relation (user has company)
    // Note: Strapi 5 may not use user_id column - use user relation only
    try {
      let raw = [];
      if (companyUserIds && companyUserIds.length > 0) {
        try {
          raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: { user: { id: { $in: companyUserIds } } },
            limit: 5000,
            populate: { course: true, user: true },
          });
        } catch (_) {}
        if (!Array.isArray(raw) || raw.length === 0) {
          raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            limit: 5000,
            populate: { course: true, user: true },
          });
        }
      } else {
        raw = await strapi.db.query('api::user-progress.user-progress').findMany({
          limit: 5000,
          populate: { course: true, user: true },
        });
      }
      if (Array.isArray(raw) && raw.length > 0) {
        const courseIds = [...new Set(raw.map((r) => {
          const c = r.course;
          if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
          return r.course_id ?? r.courseId;
        }).filter(Boolean))];
        const userIdsRaw = [...new Set(raw.map((r) => {
          const u = r.user;
          if (u && typeof u === 'object' && u.id != null) return u.id;
          return r.user_id ?? r.userId;
        }).filter(Boolean))];
        const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
        const numericUserIds = userIdsRaw.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
        const [courses, users] = await Promise.all([
          numericCourseIds.length > 0 ? strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } }) : [],
          numericUserIds.length > 0 ? strapi.db.query('plugin::users-permissions.user').findMany({ where: { id: { $in: numericUserIds.map(Number) } }, populate: ['department'] }) : [],
        ]);
        const courseById = {};
        (courses || []).forEach((c) => { courseById[c.id] = c; });
        const userById = {};
        (users || []).forEach((u) => { userById[u.id] = u; });
        const mapped = raw.map((r) => {
          const uid = r.user_id ?? r.userId ?? r.user?.id;
          const cid = r.course_id ?? r.courseId ?? r.course?.id ?? r.course?.documentId;
          const course = (cid != null && courseById[cid]) ? courseById[cid] : (r.course && typeof r.course === 'object' && (r.course.title != null || r.course.id != null) ? r.course : null);
          const cat = course?.course_category ?? course?.courseCategory;
          const user = (uid != null && userById[uid]) ? userById[uid] : (r.user || null);
          return {
            ...r,
            user,
            user_id: uid,
            course: course ? { ...course, course_category: cat } : null,
          };
        });

        // Deduplicate by (userId, courseId): strapi.db.query returns both draft and
        // published versions of a Strapi v5 document, which would double-count enrollments.
        // Keep published record (published_at != null) over draft; if tied keep higher id.
        const dedupMap = new Map();
        mapped.forEach((r) => {
          const uid = r.user_id ?? r.user?.id;
          const cid = r.course?.id ?? r.course_id;
          const key = `${uid}::${cid}`;
          const existing = dedupMap.get(key);
          if (!existing) { dedupMap.set(key, r); return; }
          const rPublished = r.published_at ?? r.publishedAt;
          const exPublished = existing.published_at ?? existing.publishedAt;
          if (rPublished && !exPublished) { dedupMap.set(key, r); return; }
          if (!rPublished && exPublished) return;
          if ((r.id ?? 0) > (existing.id ?? 0)) dedupMap.set(key, r);
        });
        progresses = Array.from(dedupMap.values());
      }
    } catch (e) {
      strapi.log.warn('Learning global: db.query failed:', e?.message);
    }

    // ── Active-assignment filter ─────────────────────────────────────────────
    // Only include progress records for (user, course) pairs that have an
    // active (published) Individual course-assignment.
    // This applies whether or not a specific course filter is selected.
    try {
      if (params.courseId && String(params.courseId).trim()) {
        // Course-specific filter: only users actively assigned to this course
        const activeIds = await getActivelyAssignedUserIdsForCourse(strapi, String(params.courseId).trim());
        if (activeIds.size > 0) {
          progresses = progresses.filter((p) => {
            const uid = p.user?.id ?? p.user_id ?? p.userId;
            return uid != null && activeIds.has(Number(uid));
          });
        }
      } else {
        // Global filter (All Courses): build the full set of active (userId, courseId) pairs
        const activeAssignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
          where: { active: 'published', assignment_target_type: 'Individual' },
          populate: {
            courses: { select: ['id'] },
            individual_user: { select: ['id'] },
          },
          limit: 50000,
        });
        // Build a Set of "userId::courseId" keys that are actively assigned
        const activePairs = new Set();
        for (const a of (activeAssignments || [])) {
          const users = Array.isArray(a.individual_user) ? a.individual_user : [];
          const courses = Array.isArray(a.courses) ? a.courses : [];
          for (const u of users) {
            for (const c of courses) {
              if (u?.id != null && c?.id != null) {
                activePairs.add(`${Number(u.id)}::${Number(c.id)}`);
              }
            }
          }
        }
        if (activePairs.size > 0) {
          progresses = progresses.filter((p) => {
            const uid = Number(p.user?.id ?? p.user_id ?? p.userId);
            const cid = Number(p.course?.id ?? p.course_id ?? p.courseId);
            if (!uid || !cid) return false;
            return activePairs.has(`${uid}::${cid}`);
          });
        }
      }
    } catch (_) {}
    // ─────────────────────────────────────────────────────────────────────────

    // Apply filters in memory (date, company, department, course, course category, location, quiz status, feedback given)
    const wantCompany = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const wantDept = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    const wantDateFrom = params.dateFrom;
    const wantDateTo = params.dateTo;
    const wantCourseId = params.courseId && String(params.courseId).trim();
    const wantCategory = params.courseCategory && String(params.courseCategory).trim();
    const wantUnitLocation = params.unitLocation && String(params.unitLocation).trim();
    const wantQuizStatus = params.quizStatus && String(params.quizStatus).trim().toLowerCase();
    const wantFeedbackGiven = params.feedbackGiven && String(params.feedbackGiven).trim().toLowerCase();

    // Resolve selected location id/documentId to a location name.
    // Learning filters now use work-location records, but keep a fallback for legacy unit-location ids.
    let unitLocationName = wantUnitLocation ? String(params.unitLocation) : null;
    if (wantUnitLocation) {
      try {
        const isNumeric = typeof params.unitLocation === 'number' || /^\d+$/.test(String(params.unitLocation));
        let loc = null;
        try {
          loc = isNumeric
            ? await strapi.db.query('api::work-location.work-location').findOne({ where: { id: Number(params.unitLocation) }, select: ['name'] })
            : await strapi.db.query('api::work-location.work-location').findOne({ where: { documentId: String(params.unitLocation) }, select: ['name'] });
        } catch (_) {}
        if (!loc) {
          loc = isNumeric
            ? await strapi.db.query('api::unit-location.unit-location').findOne({ where: { id: Number(params.unitLocation) }, select: ['name'] })
            : await strapi.db.query('api::unit-location.unit-location').findOne({ where: { documentId: String(params.unitLocation) }, select: ['name'] });
        }
        if (loc?.name) unitLocationName = loc.name;
      } catch (e) {
        strapi.log.warn('Learning global: unit location resolve failed:', e?.message);
      }
    }

    // Resolve department id/documentId to name for filtering (user.department is string, not relation)
    let departmentNameForFilter = null;
    if (wantDept) {
      try {
        const deptId = params.department;
        const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
        const deptRow = isNumeric
          ? await strapi.db.query('api::department.department').findOne({ where: { id: Number(deptId) }, select: ['name'] })
          : await strapi.db.query('api::department.department').findOne({ where: { documentId: String(deptId) }, select: ['name'] });
        if (deptRow?.name) departmentNameForFilter = deptRow.name;
      } catch (e) {
        strapi.log.warn('Learning global: department resolve failed:', e?.message);
      }
    }

    // Normalize date bounds using server local day boundaries.
    const wantDateFromNorm = normalizeDateBound(wantDateFrom, false);
    const wantDateToNorm = normalizeDateBound(wantDateTo, true);

    // Optional: load quiz and feedback submission sets for (userId, courseId) when filters requested (only when a course is selected)
    let quizPassedByUserCourse = null;
    let quizFailedByUserCourse = null;
    let feedbackByUserCourse = null;
    if (wantCourseId && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail' || wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
      const pairs = progresses.map((p) => ({
        userId: p.user?.id ?? p.user_id ?? p.userId,
        courseId: p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId,
      })).filter((x) => x.userId != null && x.courseId != null);
      const uniqueUserIds = [...new Set(pairs.map((x) => x.userId))];
      const uniqueCourseIds = [...new Set(pairs.map((x) => x.courseId).filter(Boolean))];
      const numericUserIds = uniqueUserIds.filter((id) => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
      let numericCourseIds = uniqueCourseIds.filter((id) => typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)));
      // When a course is selected it may be sent as documentId; resolve so quiz/feedback queries find submissions
      if (numericCourseIds.length === 0 && wantCourseId && uniqueCourseIds.length > 0) {
        const courseIdParam = String(params.courseId || '').trim();
        if (courseIdParam.length > 10) {
          try {
            const row = await strapi.db.query('api::course.course').findOne({ where: { documentId: courseIdParam }, select: ['id'] });
            if (row?.id != null) numericCourseIds = [Number(row.id)];
          } catch (_) {}
        } else if (/^\d+$/.test(courseIdParam)) numericCourseIds = [Number(courseIdParam)];
      }
      if (numericUserIds.length > 0 && numericCourseIds.length > 0 && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail')) {
        try {
          // Use raw FK columns for where (Strapi 5 db returns submitted_by_id, course_id when relations not populated)
          const quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
            where: {
              submitted_by_id: { $in: numericUserIds },
              course_id: { $in: numericCourseIds },
            },
            limit: 10000,
          });
          quizPassedByUserCourse = new Set();
          quizFailedByUserCourse = new Set();
          (quizSubs || []).forEach((q) => {
            const uid = q.submitted_by?.id ?? q.submitted_by ?? q.submitted_by_id;
            const cid = q.course?.id ?? q.course ?? q.course_id;
            const cidDoc = q.course?.documentId ?? q.course?.document_id;
            if (uid != null && cid != null) {
              const keyNum = `${Number(uid)}-${Number(cid)}`;
              if (q.passed === true) {
                quizPassedByUserCourse.add(keyNum);
              } else {
                quizFailedByUserCourse.add(keyNum);
              }
            }
            if (uid != null && cidDoc != null && String(cidDoc) !== String(cid)) {
              const keyDoc = `${Number(uid)}-${String(cidDoc)}`;
              if (q.passed === true) {
                quizPassedByUserCourse.add(keyDoc);
              } else {
                quizFailedByUserCourse.add(keyDoc);
              }
            }
          });
        } catch (e) {
          strapi.log.warn('Learning global: quiz submission lookup failed:', e?.message);
        }
      }
      if (numericUserIds.length > 0 && numericCourseIds.length > 0 && (wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
        try {
          const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
            where: {
              users_permissions_user: { id: { $in: numericUserIds } },
              course: { id: { $in: numericCourseIds } },
            },
            select: ['users_permissions_user', 'course'],
          });
          feedbackByUserCourse = new Set();
          (feedbackSubs || []).forEach((f) => {
            const uid = f.users_permissions_user?.id ?? f.users_permissions_user;
            const cid = f.course?.id ?? f.course;
            const cidDoc = f.course?.documentId ?? f.course?.document_id;
            if (uid != null && (cid != null || cidDoc != null)) {
              if (cid != null) feedbackByUserCourse.add(`${uid}-${cid}`);
              if (cidDoc != null) feedbackByUserCourse.add(`${uid}-${cidDoc}`);
            }
          });
        } catch (e) {
          strapi.log.warn('Learning global: feedback submission lookup failed:', e?.message);
        }
      }
    }

    // For company filter: use companyUserIds when available so we don't rely on populated user.company
    const companyUserIdsSet = companyUserIds && companyUserIds.length > 0
      ? new Set(companyUserIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n)))
      : null;
    if (wantCompany || wantDept || wantDateFrom || wantDateTo || wantCourseId || wantCategory || wantUnitLocation || wantQuizStatus || wantFeedbackGiven) {
      const wantCompanyNorm = wantCompany ? (String(wantCompany).trim().toLowerCase() === 'vega' ? 'Vega' : String(wantCompany).trim().toLowerCase() === 'aia' ? 'AIA' : String(wantCompany).trim()) : null;
      progresses = progresses.filter((p) => {
        if (wantDateFromNorm && p.last_accessed_at && String(p.last_accessed_at) < wantDateFromNorm) return false;
        if (wantDateToNorm && p.last_accessed_at && String(p.last_accessed_at) > wantDateToNorm) return false;
        if (wantCompanyNorm) {
          if (companyUserIdsSet && companyUserIdsSet.size > 0) {
            const uid = p.user?.id ?? p.user_id ?? p.userId;
            if (uid == null || !companyUserIdsSet.has(Number(uid))) return false;
          } else {
            const rawCompany = p.user?.company;
            const userCompanyStr = (typeof rawCompany === 'object' && rawCompany != null) ? (rawCompany.name ?? rawCompany) : (rawCompany ?? '');
            const userCompanyNorm = userCompanyStr ? (String(userCompanyStr).toLowerCase() === 'vega' ? 'Vega' : String(userCompanyStr).toLowerCase() === 'aia' ? 'AIA' : String(userCompanyStr).trim()) : null;
            if (!userCompanyNorm || userCompanyNorm !== wantCompanyNorm) return false;
          }
        }
        if (wantDept && departmentNameForFilter) {
          const userDeptName = (typeof p.user?.department === 'object' && p.user?.department?.name) ? p.user.department.name : (p.user?.department ?? '');
          if (String(userDeptName).trim().toLowerCase() !== String(departmentNameForFilter).trim().toLowerCase()) return false;
        }
        if (wantCourseId) {
          const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
          if (String(cid) !== String(params.courseId)) return false;
        }
        if (wantCategory) {
          const cat = p.course?.course_category ?? p.course?.courseCategory ?? '';
          if (String(cat) !== String(params.courseCategory)) return false;
        }
        if (wantUnitLocation && unitLocationName) {
          const locationCandidates = [
            p.user?.working_location,
            p.user?.branch,
            p.user?.unit_location,
          ];
          const matchesLocation = locationCandidates
            .filter((value) => value != null && String(value).trim() !== '')
            .some((value) => String(value).toLowerCase().includes(String(unitLocationName || '').toLowerCase()));
          if (!matchesLocation) return false;
        }
        if (wantCourseId && (wantQuizStatus === 'pass' || wantQuizStatus === 'fail')) {
          const uid = p.user?.id ?? p.user_id ?? p.userId;
          const uidNum = uid != null ? Number(uid) : NaN;
          if (Number.isNaN(uidNum)) return false;
          // Prefer numeric course id to match quiz_submission.course_id; fallback to documentId
          const cidRaw = p.course_id ?? p.courseId ?? p.course?.id ?? p.course?.documentId;
          const cidDoc = p.course?.documentId ?? p.course?.document_id;
          const cidNum = cidRaw != null && (typeof cidRaw === 'number' || /^\d+$/.test(String(cidRaw))) ? Number(cidRaw) : null;
          const keyNum = cidNum != null ? `${uidNum}-${cidNum}` : null;
          const keyDoc = cidDoc != null ? `${uidNum}-${String(cidDoc)}` : null;
          const hasPassed = quizPassedByUserCourse && (keyNum && quizPassedByUserCourse.has(keyNum) || keyDoc && quizPassedByUserCourse.has(keyDoc));
          const hasFailed = quizFailedByUserCourse && (keyNum && quizFailedByUserCourse.has(keyNum) || keyDoc && quizFailedByUserCourse.has(keyDoc));
          if (wantQuizStatus === 'pass') {
            if (!hasPassed) return false;
          } else {
            // fail = has at least one fail AND never passed (so Pass and Fail show different sets)
            if (!hasFailed || hasPassed) return false;
          }
        }
        if (wantCourseId && (wantFeedbackGiven === 'yes' || wantFeedbackGiven === 'no')) {
          const uid = p.user?.id ?? p.user_id ?? p.userId;
          const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
          const cidDoc = p.course?.documentId ?? p.course?.document_id;
          const key1 = uid != null && cid != null ? `${uid}-${cid}` : null;
          const key2 = uid != null && cidDoc != null && String(cidDoc) !== String(cid) ? `${uid}-${cidDoc}` : null;
          const hasFeedback = feedbackByUserCourse && (key1 && feedbackByUserCourse.has(key1) || key2 && feedbackByUserCourse.has(key2));
          if (wantFeedbackGiven === 'yes' && !hasFeedback) return false;
          if (wantFeedbackGiven === 'no' && hasFeedback) return false;
        }
        return true;
      });
    }

    // Build userId -> department name map (use numeric id only to avoid 500 if documentId column missing)
    const numericUserIds = [...new Set(progresses.map((p) => p.user?.id ?? p.user_id ?? p.userId).filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x)))))].map(Number);
    const departmentByUserId = {};
    const userById = {};
    if (numericUserIds.length > 0) {
      try {
        const users = (await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: numericUserIds } },
          select: ['id', 'blocked', 'active', 'exit_date', 'company'],
          populate: ['department'],
        })) || [];
        users.forEach((u) => {
          const deptName = u.department?.name;
          if (deptName && u.id != null) departmentByUserId[u.id] = deptName;
          userById[u.id] = u;
        });
      } catch (e) {
        strapi.log.warn('Learning global: user/department lookup failed:', e?.message);
      }
    }

    // Aggregate by status
    const statusCounts = { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 };
    let totalTimeSpent = 0;
    let certificatesIssued = 0;
    const categoryCounts = {};
    const departmentCounts = {};
    const monthlyCompletions = {};
    // Week key = Monday of week (YYYY-MM-DD) for learning activity by week
    const getWeekKey = (dateStr) => {
      const d = new Date(String(dateStr).slice(0, 10));
      if (Number.isNaN(d.getTime())) return null;
      const day = d.getDay();
      const diff = d.getDate() - (day === 0 ? 6 : day - 1);
      const monday = new Date(d.getFullYear(), d.getMonth(), diff);
      return monday.toISOString().slice(0, 10);
    };
    const learningActivityByWeek = {};
    let startedCount = 0;
    const courseIdsSet = new Set();
    const dropOffCutoff = new Date();
    dropOffCutoff.setDate(dropOffCutoff.getDate() - 14);
    const dropOffCutoffStr = dropOffCutoff.toISOString().slice(0, 10);

    progresses.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;
      totalTimeSpent += p.time_spent_minutes || 0;
      if (p.certificate_issued) certificatesIssued++;

      const started = p.progress_status !== 'Not_started' || (p.started_at ?? p.startedAt);
      if (started) startedCount++;

      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      if (lastAccess) {
        const weekKey = getWeekKey(lastAccess);
        if (weekKey) learningActivityByWeek[weekKey] = (learningActivityByWeek[weekKey] || 0) + 1;
      }

      const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId;
      if (cid != null) courseIdsSet.add(String(cid));

      const catName = p.course?.course_category?.name ?? p.course?.course_category ?? p.course?.courseCategory ?? 'Other';
      categoryCounts[catName] = (categoryCounts[catName] || 0) + 1;

      const userId = p.user?.id ?? p.user_id ?? p.userId;
      const deptName = (p.user?.department?.name ?? (userId != null ? departmentByUserId[userId] : null)) || 'Unassigned';
      departmentCounts[deptName] = (departmentCounts[deptName] || 0) + 1;

      if (p.completed_at && p.progress_status === 'Completed') {
        const month = p.completed_at.slice(0, 7);
        monthlyCompletions[month] = (monthlyCompletions[month] || 0) + 1;
      }
    });

    const total = progresses.length;
    const completed = statusCounts.Completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgTimeSpent = total > 0 ? Math.round(totalTimeSpent / total) : 0;

    // Drop-off: started but not completed, and no activity in last 14 days
    let dropOffCount = 0;
    progresses.forEach((p) => {
      if (isDropOffProgress(p, dropOffCutoffStr)) dropOffCount++;
    });
    const dropOffRate = total > 0 ? Math.round((dropOffCount / total) * 100) : 0;

    // Avg quiz score from filtered set: only quiz submissions for (user, course) in filtered progresses
    let avgQuizScore = 0;
    if (progresses.length > 0) {
      try {
        strapi.log.info(`[LearningGlobal][AvgQuizScore] Start calculation. progresses=${progresses.length}`);
        const numericUserIdsQuiz = [...new Set(
          progresses
            .map((p) => p.user?.id ?? p.user_id ?? p.userId)
            .filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x))))
            .map((x) => Number(x))
        )];

        const numericCourseIdsQuiz = [
          ...new Set(
            progresses
              .map((p) => p.course?.id ?? p.course_id ?? p.courseId)
              .filter((x) => x != null && (typeof x === 'number' || /^\d+$/.test(String(x))))
              .map((x) => Number(x))
          ),
        ];
        const documentCourseIdsQuiz = [...new Set(
          progresses
            .map((p) => p.course?.documentId ?? p.course?.document_id ?? p.courseId ?? p.course_id)
            .filter((x) => x != null && typeof x === 'string' && !/^\d+$/.test(String(x)) && String(x).trim() !== '')
            .map((x) => String(x).trim())
        )];

        // Resolve documentIds to numeric ids so quiz_submission.course (numeric FK)
        // can be matched even when filters operate on course documentId.
        if (documentCourseIdsQuiz.length > 0) {
          try {
            const courseRows = await strapi.db.query('api::course.course').findMany({
              where: { documentId: { $in: documentCourseIdsQuiz } },
              select: ['id', 'documentId'],
            });
            (courseRows || []).forEach((c) => {
              if (c?.id != null) numericCourseIdsQuiz.push(Number(c.id));
            });
          } catch (_) {}
        }
        const uniqueNumericCourseIdsQuiz = [...new Set(numericCourseIdsQuiz.filter((n) => !Number.isNaN(n) && n > 0))];
        strapi.log.info(
          `[LearningGlobal][AvgQuizScore] Resolved IDs. users=${numericUserIdsQuiz.length}, courses=${uniqueNumericCourseIdsQuiz.length}, docCourses=${documentCourseIdsQuiz.length}`
        );

        if (numericUserIdsQuiz.length > 0 && uniqueNumericCourseIdsQuiz.length > 0) {
          // Build exact (userId, courseId) pairs from the filtered enrollment set.
          const validPairs = new Set();
          progresses.forEach((p) => {
            const uidRaw = p.user?.id ?? p.user_id ?? p.userId;
            const cidRaw = p.course?.id ?? p.course_id ?? p.courseId;
            const uid = uidRaw != null && /^\d+$/.test(String(uidRaw)) ? Number(uidRaw) : (typeof uidRaw === 'number' ? uidRaw : null);
            const cid = cidRaw != null && /^\d+$/.test(String(cidRaw)) ? Number(cidRaw) : (typeof cidRaw === 'number' ? cidRaw : null);
            if (uid != null && cid != null) validPairs.add(`${uid}-${cid}`);
          });
          strapi.log.info(`[LearningGlobal][AvgQuizScore] Built enrollment pairs. validPairs=${validPairs.size}`);

          let quizSubs = [];
          // Primary path: document-service relation filters (Strapi v5-safe).
          try {
            quizSubs = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
              status: 'published',
              filters: {
                submitted_by: { id: { $in: numericUserIdsQuiz } },
                course: { id: { $in: uniqueNumericCourseIdsQuiz } },
              },
              fields: ['score'],
              populate: ['submitted_by', 'course'],
              limit: 10000,
              start: 0,
            });
          } catch (eDoc) {
            strapi.log.warn(`[LearningGlobal][AvgQuizScore] documents() query failed: ${eDoc?.message}`);
          }

          // Secondary path: db.query relation filters.
          if (!Array.isArray(quizSubs) || quizSubs.length === 0) {
            try {
              quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
                where: {
                  submitted_by: { id: { $in: numericUserIdsQuiz } },
                  course: { id: { $in: uniqueNumericCourseIdsQuiz } },
                },
                populate: { submitted_by: true, course: true },
                select: ['score'],
                limit: 10000,
              });
            } catch (eDbRel) {
              strapi.log.warn(`[LearningGlobal][AvgQuizScore] db relation query failed: ${eDbRel?.message}`);
            }
          }

          // Last fallback for projects that still have physical FK columns.
          if (!Array.isArray(quizSubs) || quizSubs.length === 0) {
            try {
              quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
                where: {
                  submitted_by_id: { $in: numericUserIdsQuiz },
                  course_id: { $in: uniqueNumericCourseIdsQuiz },
                },
                select: ['score', 'submitted_by_id', 'course_id'],
                limit: 10000,
              });
            } catch (eRaw) {
              strapi.log.warn(`[LearningGlobal][AvgQuizScore] db raw-id query failed: ${eRaw?.message}`);
            }
          }

          strapi.log.info(`[LearningGlobal][AvgQuizScore] Quiz submissions fetched. count=${Array.isArray(quizSubs) ? quizSubs.length : 0}`);
          const scores = (quizSubs || [])
            .filter((s) => {
              const uid = Number(s.submitted_by?.id ?? s.submitted_by ?? s.submitted_by_id);
              const cid = Number(s.course?.id ?? s.course ?? s.course_id);
              if (Number.isNaN(uid) || Number.isNaN(cid)) return false;
              return validPairs.has(`${uid}-${cid}`);
            })
            .map((s) => Number(s.score))
            .filter((n) => !Number.isNaN(n));
          strapi.log.info(
            `[LearningGlobal][AvgQuizScore] Matched scores. matchedScores=${scores.length}, avg=${scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0}`
          );
          avgQuizScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        } else {
          strapi.log.info('[LearningGlobal][AvgQuizScore] Skipped quiz fetch due to empty user/course ID set.');
        }
      } catch (e) {
        strapi.log.warn(`[LearningGlobal][AvgQuizScore] Failed: ${e?.message}`);
      }
    } else {
      strapi.log.info('[LearningGlobal][AvgQuizScore] Skipped because filtered progresses is empty.');
    }

    // Learning activity by week: enrollments with activity in that week (by last_accessed_at, week = Monday)
    const learningActivityByWeekArr = Object.entries(learningActivityByWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, enrollments]) => ({ week, enrollments }));

    // Completion funnel: Enrolled -> Started -> Completed -> Certified
    const certified = progresses.filter((p) => p.certificate_issued).length;
    const completionFunnel = [
      { stage: 'Enrolled', value: total },
      { stage: 'Started', value: startedCount },
      { stage: 'Completed', value: completed },
      { stage: 'Certified', value: certified },
    ];

    // Status distribution: Not_started, In_progress, Completed, Failed (for donut)
    const statusDistributionOrder = ['Not_started', 'In_progress', 'Completed', 'Failed'];
    const statusDistribution = statusDistributionOrder.map((name) => ({
      name: name.replace('_', ' '),
      value: statusCounts[name] || 0,
    }));

    // Course view table: one row per course (aggregated across users). Group by title+category so one row per course regardless of id/documentId variance.
    const byCourse = new Map();
    progresses.forEach((p) => {
      const title = String(p.course?.title ?? 'Unknown').trim();
      const category = String(p.course?.course_category ?? p.course?.courseCategory ?? 'Other').trim();
      const key = `${title}::${category}`;
      const cid = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.courseId;
      if (!byCourse.has(key)) {
        byCourse.set(key, {
          courseId: cid != null ? String(cid) : key,
          courseTitle: title,
          courseCategory: category,
          statusCounts: { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 },
          percentages: [],
          timeSpentMinutes: [],
          certificateCount: 0,
          total: 0,
        });
      }
      const agg = byCourse.get(key);
      agg.total += 1;
      const st = p.progress_status ?? 'Not_started';
      agg.statusCounts[st] = (agg.statusCounts[st] || 0) + 1;
      agg.percentages.push(p.progress_percentage ?? p.progressPercentage ?? 0);
      agg.timeSpentMinutes.push(p.time_spent_minutes ?? p.timeSpentMinutes ?? 0);
      if (p.certificate_issued ?? p.certificateIssued) agg.certificateCount += 1;
    });

    let courseProgressTable = Array.from(byCourse.values()).map((agg) => {
      const statusParts = [];
      if (agg.statusCounts.Completed > 0) statusParts.push(`Completed: ${agg.statusCounts.Completed}`);
      if (agg.statusCounts.In_progress > 0) statusParts.push(`In progress: ${agg.statusCounts.In_progress}`);
      if (agg.statusCounts.Not_started > 0) statusParts.push(`Not started: ${agg.statusCounts.Not_started}`);
      if (agg.statusCounts.Failed > 0) statusParts.push(`Failed: ${agg.statusCounts.Failed}`);
      const status = statusParts.length > 0 ? statusParts.join(', ') : '—';
      const avgPct = agg.percentages.length > 0 ? Math.round(agg.percentages.reduce((a, b) => a + b, 0) / agg.percentages.length) : 0;
      const avgTime = agg.timeSpentMinutes.length > 0 ? Math.round((agg.timeSpentMinutes.reduce((a, b) => a + b, 0) / agg.timeSpentMinutes.length) * 10) / 10 : 0;
      const certStr = `${agg.certificateCount}/${agg.total}`;

      // Calculate drop off rate for this course
      // Drop-off: started but not completed, and no activity in last 14 days
      let dropOffCount = 0;
      if (Array.isArray(progresses)) {
        const dropOffCutoff = new Date();
        dropOffCutoff.setDate(dropOffCutoff.getDate() - 14);
        const dropOffCutoffStr = dropOffCutoff.toISOString().slice(0, 10);
        progresses.forEach((p) => {
          const pCid = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.courseId;
          if (String(pCid) !== String(agg.courseId)) return;
          const status = p.progress_status;
          const percentage = p.progress_percentage ?? p.progressPercentage ?? 0;
          const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
          const startedAt = p.started_at ?? p.startedAt;
          const isStarted = status === 'In_progress' || (status === 'Not_started' && startedAt);
          const notCompleted = status !== 'Completed' && status !== 'Failed';
          const inactiveLongEnough = lastAccess && String(lastAccess).slice(0, 10) < dropOffCutoffStr;
          if (isStarted && notCompleted && percentage < 100 && inactiveLongEnough) dropOffCount++;
        });
      }
      const dropOffRate = agg.total > 0 ? Math.round((dropOffCount / agg.total) * 100) : 0;

      return {
        courseId: agg.courseId,
        courseTitle: agg.courseTitle,
        courseCategory: agg.courseCategory,
        status,
        percentage: avgPct,
        timeSpentMinutes: avgTime,
        enrollmentCount: agg.total,
        certificateIssued: certStr,
        dropOffRate,
        dropOffCount,
      };
    });

    const result = {
      kpis: {
        totalCourses: courseIdsSet.size,
        totalEnrollments: total,
        totalAssignments: total,
        completionRate,
        // avgTimeSpent = average of time_spent_minutes across all user-progress records.
        // Realtime telemetry totals are cumulative across all sessions and not a per-enrollment
        // average, so we use the DB value only.
        avgTimeSpentMinutes: avgTimeSpent,
        avgQuizScore,
        completedCourse: completed,
        dropOffCount,
        dropOffRate,
        certificatesIssued,
      },
      statusDistribution,
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
      learningActivityByWeek: learningActivityByWeekArr,
      completionFunnel,
      courseProgress: courseProgressTable,
      dropOffEnrollments: buildDropOffEnrollments(progresses, dropOffCutoffStr, userById),
    };

    if (wantCourseId) {
      try {
        const moduleVideoRaw = await this.getModuleVideoProgressForCourseGlobal(params.courseId, params.moduleIndex, params.moduleTitle);
        result.moduleVideoProgress = moduleVideoRaw;
        const courseModules = await this.getCourseModules(params.courseId);
        const modIndexes = (params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '')
          ? [Number(params.moduleIndex)]
          : (courseModules || []).map((m) => m.index ?? m.moduleIndex ?? 0);
        // Build title→correct index map from courseModules to fix records saved with
        // the old language-filtered index (e.g. module_index=1 for "test module 2 in english"
        // when the correct global index is 3).
        const titleToCorrectIndex = new Map();
        (courseModules || []).forEach((m) => {
          const t = (m.title ?? '').trim().toLowerCase();
          const idx = m.index ?? m.moduleIndex ?? 0;
          if (t) titleToCorrectIndex.set(t, idx);
        });

        const byCourseMod = new Map();
        moduleVideoRaw.forEach((mv) => {
          const cid = mv.courseId ?? '';
          let midx = mv.moduleIndex ?? mv.module_index;
          // Self-heal: if record has a title that maps to a different (correct) index,
          // use the correct index so data lands in the right column.
          const recTitle = (mv.moduleTitle ?? '').trim().toLowerCase();
          if (recTitle && titleToCorrectIndex.has(recTitle)) {
            midx = titleToCorrectIndex.get(recTitle);
          }
          if (midx === undefined || midx === null) return;
          const key = `${cid}::${midx}`;
          if (!byCourseMod.has(key)) byCourseMod.set(key, { watched: [], duration: [] });
          const agg = byCourseMod.get(key);
          agg.watched.push(mv.timeWatchedMinutes ?? 0);
          agg.duration.push(mv.videoDurationMinutes ?? 0);
        });
        courseProgressTable = courseProgressTable.map((row) => {
          const cid = row.courseId ?? '';
          const out = { ...row };
          modIndexes.forEach((midx) => {
            const key = `${cid}::${midx}`;
            const agg = byCourseMod.get(key);
            if (!agg || agg.watched.length === 0) {
              out[`mod_${midx}`] = '—';
              return;
            }
            const avgWatched = Math.round((agg.watched.reduce((a, b) => a + b, 0) / agg.watched.length) * 10) / 10;
            const avgDur = agg.duration.filter((d) => d != null && !Number.isNaN(d)).length > 0
              ? Math.round((agg.duration.filter((d) => d != null).reduce((a, b) => a + b, 0) / agg.duration.filter((d) => d != null).length) * 10) / 10
              : null;
            out[`mod_${midx}`] = avgDur != null ? `${avgWatched}/${avgDur}` : String(avgWatched);
          });
          return out;
        });
      } catch (e) {
        strapi.log.warn('Learning global moduleVideoProgress failed:', e?.message);
        result.moduleVideoProgress = [];
      }
    } else {
      result.moduleVideoProgress = [];
    }

    result.courseProgress = courseProgressTable;
    return result;
    } catch (err) {
      strapi.log.error('Learning global error:', err?.message || err);
      return emptyResponse();
    }
  },

  /**
   * Module video progress for global (all users) for a course — same shape as personal moduleVideoProgress for unified table.
   * Returns array of { userId, userName, courseId, moduleIndex, timeWatchedMinutes, videoDurationMinutes }.
   */
  async getModuleVideoProgressForCourseGlobal(courseId, moduleIndex, moduleTitle) {
    const out = [];
    if (!courseId || String(courseId).trim() === '') return out;
    try {
      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId).trim();
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseIdStr);
      if (numericCourseId == null && courseIdStr.length > 10) {
        // Use findMany to get ALL rows (draft + published) for this documentId
        const cRows = await strapi.db.query('api::course.course').findMany({ where: { documentId: courseIdStr }, select: ['id'] });
        if (Array.isArray(cRows) && cRows.length > 0) {
          numericCourseId = cRows.map(r => r.id).filter(Boolean);
        } else {
          const cRows2 = await strapi.db.query('api::course.course').findMany({ where: { document_id: courseIdStr }, select: ['id'] });
          if (Array.isArray(cRows2) && cRows2.length > 0) numericCourseId = cRows2.map(r => r.id).filter(Boolean);
        }
      }
      if (numericCourseId == null) return out;

      const numericCourseIds = Array.isArray(numericCourseId) ? numericCourseId : [numericCourseId];
      const whereVariants = [
        ...numericCourseIds.flatMap(nid => [
          { course: { id: { $eq: nid } } },
          { course: { id: nid } },
          { course_id: nid },
        ]),
      ];
      if (courseIdStr.length > 10) whereVariants.push({ course: { documentId: courseIdStr } });
      let raw = [];
      for (const where of whereVariants) {
        raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
          where,
          limit: 5000,
          populate: { user: true, course: true },
        });
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      if (!Array.isArray(raw) || raw.length === 0) return out;

      const moduleIndexNum = moduleIndex !== undefined && moduleIndex !== null && moduleIndex !== '' ? Number(moduleIndex) : null;
      const moduleTitleTrim = moduleTitle && String(moduleTitle).trim() ? String(moduleTitle).trim() : null;
      if (moduleIndexNum !== null && !Number.isNaN(moduleIndexNum)) {
        raw = raw.filter((r) => (r.module_index ?? r.moduleIndex) === moduleIndexNum);
      } else if (moduleTitleTrim) {
        raw = raw.filter((r) => {
          const t = (r.module_title ?? r.moduleTitle ?? '').trim().toLowerCase();
          if (t === moduleTitleTrim.toLowerCase()) return true;
          const m = moduleTitleTrim.match(/^Module\s*(\d+)$/i);
          const idx = m ? parseInt(m[1], 10) - 1 : null;
          return idx !== null && (r.module_index ?? r.moduleIndex) === idx;
        });
      }

      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      const userById = {};
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course?.id ?? r.course_id ?? r.course?.documentId;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.username || user?.email || `User ${uid}`;
        const timeWat = r.time_watched_min ?? 0;
        const duration = r.video_duration_min;
        const mIdx = r.module_index ?? r.moduleIndex;
        const mTitle = r.module_title ?? r.moduleTitle ?? null;
        out.push({
          userId: uid,
          userName,
          courseId: cid != null ? String(cid) : null,
          moduleIndex: mIdx != null ? Number(mIdx) : null,
          moduleTitle: mTitle,
          timeWatchedMinutes: timeWat,
          videoDurationMinutes: duration != null ? duration : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleVideoProgressForCourseGlobal failed:', e?.message);
    }
    return out;
  },

  /**
   * Module video progress for Course view module detail table.
   * When courseId is null: all modules of all courses. When courseId provided: all modules of that course only.
   */
  async getModuleDetailTable(courseId) {
    const rows = [];
    try {
      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        };
      };

      let raw = [];
      if (!courseId || String(courseId).trim() === '') {
        raw = await runQuery({});
      } else {
        let numericCourseId = typeof courseId === 'number' ? courseId : null;
        const courseIdStr = String(courseId || '').trim();
        if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
        if (numericCourseId == null && courseIdStr.length > 10) {
          const c = await strapi.db.query('api::course.course').findOne({
            where: { documentId: courseIdStr },
            select: ['id'],
          });
          if (!c?.id) {
            const c2 = await strapi.db.query('api::course.course').findOne({
              where: { document_id: courseIdStr },
              select: ['id'],
            });
            if (c2?.id) numericCourseId = c2.id;
          } else {
            numericCourseId = c.id;
          }
        }
        if (numericCourseId == null) return [];

        const whereVariants = [
          { course: { id: { $eq: numericCourseId } } },
          { course: { id: numericCourseId } },
          { course_id: numericCourseId },
        ];
        if (courseIdStr.length > 10) {
          // @ts-expect-error - documentId valid for Strapi 5 course relation
          whereVariants.push({ course: { documentId: courseIdStr } });
        }
        for (const where of whereVariants) {
          raw = await runQuery(where);
          if (Array.isArray(raw) && raw.length > 0) break;
        }
        if ((!Array.isArray(raw) || raw.length === 0) && typeof strapi.entityService !== 'undefined') {
          try {
            const list = await strapi.entityService.findMany('api::module-video-progress.module-video-progress', {
              filters: { course: { id: numericCourseId } },
              populate: { user: true, course: true },
              limit: 2000,
            });
            raw = Array.isArray(list) ? list : [];
          } catch (_) {
            raw = [];
          }
        }
        if ((!Array.isArray(raw) || raw.length === 0)) {
          try {
            const all = await runQuery({});
            if (Array.isArray(all) && all.length > 0) {
              raw = all.filter((r) => {
                const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
                return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
              });
            }
          } catch (_) {
            raw = [];
          }
        }
      }

      if (!Array.isArray(raw)) raw = [];
      const courseById = {};
      const userById = {};
      const courseIds = [...new Set(raw.map((r) => r.course_id ?? r.course?.id ?? r.course?.documentId).filter(Boolean))];
      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      if (courseIds.length > 0) {
        const numericIds = courseIds.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number);
        if (numericIds.length > 0) {
          const courses = await strapi.db.query('api::course.course').findMany({
            where: { id: { $in: numericIds } },
          });
          (courses || []).forEach((c) => { courseById[c.id] = c; if (c.documentId) courseById[c.documentId] = c; });
        }
      }
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
        const course = (cid != null && courseById[cid]) ? courseById[cid] : r.course;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.username ?? user?.name ?? (user?.email || '—');
        const courseTitle = course?.title ?? '—';
        const modTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${r.module_index + 1}` : '—');
        const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
        const timeWat = r.time_watched_min ?? 0;
        const duration = r.video_duration_min;
        rows.push({
          userName,
          courseTitle,
          moduleTitle: modTitle,
          videoCompletionType: type,
          timeWatchedMinutes: timeWat,
          videoDurationMinutes: duration != null ? duration : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleDetailTable failed:', e?.message);
    }
    return rows;
  },

  /**
   * Pivoted module detail table when a course is selected.
   * Rows = users, Columns = modules. Each cell shows "Time watched (min) / Duration (min)".
   */
  async getModuleDetailPivotTable(courseId) {
    const result = { moduleColumns: [], rows: [] };
    if (!courseId || String(courseId).trim() === '') return result;
    try {
      const courseModules = await this.getCourseModules(courseId);
      const numModules = courseModules.length;
      if (numModules === 0) return result;

      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        }
      };

      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId || '').trim();
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
      if (numericCourseId == null && courseIdStr.length > 10) {
        const c = await strapi.db.query('api::course.course').findOne({
          where: { documentId: courseIdStr },
          select: ['id'],
        });
        if (c?.id) numericCourseId = c.id;
        else {
          const c2 = await strapi.db.query('api::course.course').findOne({
            where: { document_id: courseIdStr },
            select: ['id'],
          });
          if (c2?.id) numericCourseId = c2.id;
        }
      }
      if (numericCourseId == null) return result;

      const whereVariants = [
        { course: { id: { $eq: numericCourseId } } },
        { course: { id: numericCourseId } },
        { course_id: numericCourseId },
      ];
      if (courseIdStr.length > 10) {
        // @ts-expect-error - documentId valid for Strapi 5 course relation
        whereVariants.push({ course: { documentId: courseIdStr } });
      }
      let raw = [];
      for (const where of whereVariants) {
        raw = await runQuery(where);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      if ((!Array.isArray(raw) || raw.length === 0)) {
        const all = await runQuery({});
        if (Array.isArray(all) && all.length > 0) {
          raw = all.filter((r) => {
            const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
            return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
          });
        }
      }
      if (!Array.isArray(raw)) raw = [];

      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { id: { $in: [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))].map(Number) } },
      });
      const userById = {};
      (users || []).forEach((u) => { userById[u.id] = u; });

      const userModuleMap = {};
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        if (uid == null) return;
        const mIdx = r.module_index ?? r.moduleIndex ?? 0;
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        const timeMin = Math.round(timeWat / 60);
        const durMin = duration != null ? Math.round(duration / 60) : null;
        const cellVal = durMin != null ? `${timeMin} / ${durMin}` : String(timeMin);
        if (!userModuleMap[uid]) userModuleMap[uid] = {};
        userModuleMap[uid][mIdx] = cellVal;
      });

      result.moduleColumns = courseModules.map((m, idx) => ({
        key: `module_${m.index ?? idx}`,
        label: m.title ?? `Module ${(m.index ?? idx) + 1}`,
      }));

      const userIds = Object.keys(userModuleMap);
      result.rows = userIds.map((uid) => {
        const user = userById[Number(uid)] || raw.find((r) => (r.user_id ?? r.user?.id) === Number(uid))?.user;
        const userName = user?.username ?? user?.name ?? (user?.email || '—');
        const row = { userName };
        courseModules.forEach((m, idx) => {
          const key = `module_${m.index ?? idx}`;
          row[key] = userModuleMap[uid][m.index ?? idx] ?? '—';
        });
        return row;
      });
      result.rows.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
    } catch (e) {
      strapi.log.warn('getModuleDetailPivotTable failed:', e?.message);
    }
    return result;
  },

  /**
   * Module video progress for a given course + module (all users). For Course view module detail table.
   */
  async getModuleDetailTableForCourseAndModule(courseId, moduleTitle, moduleIndex) {
    const rows = [];
    try {
      let numericCourseId = typeof courseId === 'number' ? courseId : null;
      const courseIdStr = String(courseId || '');
      if (numericCourseId == null && /^\d+$/.test(courseIdStr)) numericCourseId = Number(courseId);
      if (numericCourseId == null) {
        const c = await strapi.db.query('api::course.course').findOne({
          where: { documentId: courseIdStr },
          select: ['id'],
        });
        if (!c?.id) {
          const c2 = await strapi.db.query('api::course.course').findOne({
            where: { document_id: courseIdStr },
            select: ['id'],
          });
          if (c2?.id) numericCourseId = c2.id;
        } else {
          numericCourseId = c.id;
        }
      }
      if (numericCourseId == null) return [];

      const moduleTitleTrim = moduleTitle ? String(moduleTitle).trim() : '';
      const moduleIndexNum = moduleIndex != null && moduleIndex !== '' && !Number.isNaN(Number(moduleIndex)) ? Number(moduleIndex) : null;
      if (!moduleTitleTrim && moduleIndexNum === null) return [];

      const runQuery = async (whereClause) => {
        try {
          return await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where: whereClause,
            limit: 2000,
            populate: { user: true, course: true },
          });
        } catch (e) {
          return [];
        }
      };

      // Fetch by course only (no module filter) — try multiple where variants for different Strapi/DB setups
      let raw = [];
      const whereVariants = [
        { course: { id: { $eq: numericCourseId } } },
        { course: { id: numericCourseId } },
        { course_id: numericCourseId },
      ];
      if (typeof courseId === 'string' && courseId.length > 10) {
        // @ts-expect-error - documentId valid for Strapi 5 course relation, not in inferred type
        whereVariants.push({ course: { documentId: courseId } });
      }
      for (const where of whereVariants) {
        raw = await runQuery(where);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
      // Fallback: entityService (different API in some Strapi versions)
      if ((!Array.isArray(raw) || raw.length === 0) && typeof strapi.entityService !== 'undefined') {
        try {
          const list = await strapi.entityService.findMany('api::module-video-progress.module-video-progress', {
            filters: { course: { id: numericCourseId } },
            populate: { user: true, course: true },
            limit: 2000,
          });
          raw = Array.isArray(list) ? list : [];
        } catch (_) {
          raw = [];
        }
      }
      // Last resort: fetch all and filter in memory by course id (handles any DB/Strapi schema difference)
      if ((!Array.isArray(raw) || raw.length === 0)) {
        try {
          const all = await runQuery({});
          if (Array.isArray(all) && all.length > 0) {
            raw = all.filter((r) => {
              const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
              return Number(cid) === Number(numericCourseId) || String(cid) === String(numericCourseId) || String(cid) === courseIdStr;
            });
          }
        } catch (_) {
          raw = [];
        }
      }

      // Filter in memory by module (flexible: title or index)
      if (Array.isArray(raw) && raw.length > 0) {
        const matchModule = (r) => {
          const rTitle = (r.module_title || r.moduleTitle || '').trim().toLowerCase();
          const rIdx = r.module_index ?? r.moduleIndex;
          if (moduleTitleTrim) {
            if (rTitle === moduleTitleTrim.toLowerCase()) return true;
            const match = moduleTitleTrim.match(/^Module\s*(\d+)$/i);
            const idx = match ? parseInt(match[1], 10) - 1 : null;
            if (idx !== null && idx >= 0 && rIdx === idx) return true;
            return false;
          }
          if (moduleIndexNum !== null) return rIdx === moduleIndexNum;
          return true;
        };
        raw = raw.filter(matchModule);
      }
      if (!Array.isArray(raw)) raw = [];
      const courseById = {};
      const userById = {};
      const courseIds = [...new Set(raw.map((r) => r.course_id ?? r.course?.id ?? r.course?.documentId).filter(Boolean))];
      const userIds = [...new Set(raw.map((r) => r.user_id ?? r.user?.id).filter(Boolean))];
      if (courseIds.length > 0) {
        const courses = await strapi.db.query('api::course.course').findMany({
          where: { id: { $in: courseIds.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number) } },
        });
        (courses || []).forEach((c) => { courseById[c.id] = c; if (c.documentId) courseById[c.documentId] = c; });
      }
      if (userIds.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { id: { $in: userIds.map(Number) } },
        });
        (users || []).forEach((u) => { userById[u.id] = u; });
      }
      raw.forEach((r) => {
        const uid = r.user_id ?? r.user?.id;
        const cid = r.course_id ?? r.course?.id ?? r.course?.documentId;
        const course = (cid != null && courseById[cid]) ? courseById[cid] : r.course;
        const user = (uid != null && userById[uid]) ? userById[uid] : r.user;
        const userName = user?.username ?? user?.name ?? (user?.email || '—');
        const courseTitle = course?.title ?? '—';
        const modTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${r.module_index + 1}` : '—');
        const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
        const timeWat = r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0;
        const duration = r.video_duration_seconds ?? r.videoDurationSeconds;
        rows.push({
          userName,
          courseTitle,
          moduleTitle: modTitle,
          videoCompletionType: type,
          timeWatchedMinutes: Math.round(timeWat / 60),
          videoDurationMinutes: duration != null ? Math.round(duration / 60) : null,
        });
      });
    } catch (e) {
      strapi.log.warn('getModuleDetailTableForCourseAndModule failed:', e?.message);
    }
    return rows;
  },

  /**
   * LEARNING ANALYTICS - Personal (single employee)
   */
  async getLearningPersonal(userId, params = {}) {
    if (!userId) return null;

    const emptyResponse = () => ({
      kpis: { totalCourses: 0, completionRate: 0, avgTimeSpentMinutes: 0, certificatesEarned: 0 },
      statusDistribution: [],
      categoryDistribution: [],
      departmentDistribution: [],
      courseProgress: [],
      monthlyCompletions: [],
    });
    try {
    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    let numericUserId = typeof userId === 'number' ? userId : (typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : null);
    if (isDocumentId && !numericUserId) {
      try {
        let u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { documentId: userId },
          select: ['id'],
        });
        if (!u?.id) {
          u = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { document_id: userId },
            select: ['id'],
          });
        }
        if (u?.id != null) numericUserId = u.id;
      } catch (e) {
        strapi.log.warn('Learning personal: resolve documentId failed:', e?.message);
      }
    }

    let progresses = [];
    // 1) Prefer Document Service with user filter (read both published + draft to avoid stale published rows)
    if (numericUserId != null) {
      const merged = [];
      for (const status of ['published', 'draft']) {
        try {
          const filtered = await strapi.documents('api::user-progress.user-progress').findMany({
            status,
            filters: { user: { id: numericUserId } },
            populate: ['user', 'course', 'course.course_category'],
            limit: 500,
            start: 0,
          });
          if (Array.isArray(filtered) && filtered.length > 0) merged.push(...filtered);
        } catch (e2) {
          strapi.log.warn('Learning personal: document findMany (with user filter, status=' + status + ') failed:', e2?.message || String(e2));
        }
      }
      if (merged.length > 0) progresses = merged;
    }
    // 1b) Fallback: fetch all published+draft and filter in memory (if filtered call failed or returned 0)
    if (progresses.length === 0) {
      try {
        let allProgress = [];
        for (const status of ['published', 'draft']) {
          const rows = await strapi.documents('api::user-progress.user-progress').findMany({
            status,
            populate: ['user', 'course', 'course.course_category'],
            limit: 5000,
            start: 0,
          });
          if (Array.isArray(rows) && rows.length > 0) allProgress.push(...rows);
        }
        if (!Array.isArray(allProgress)) allProgress = [];
        progresses = allProgress.filter((p) => {
          const u = p.user;
          if (!u) return false;
          if (numericUserId != null && (u.id === numericUserId || u.id === Number(numericUserId))) return true;
          if (typeof userId === 'string' && (u.documentId === userId || u.document_id === userId)) return true;
          return false;
        });
      } catch (e2) {
        strapi.log.warn('Learning personal: document findMany (all) failed:', e2?.message || String(e2));
      }
    }
    // 2) Fallback to db.query (try user_id then user) with course populated
    if (progresses.length === 0 && numericUserId != null) {
      for (const userKey of ['user_id', 'user']) {
        try {
          const where = { [userKey]: userKey === 'user' ? { id: numericUserId } : numericUserId };
          if (params.dateFrom || params.dateTo) {
            const dateFilter = {};
            const dateFrom = normalizeDateBound(params.dateFrom, false);
            const dateTo = normalizeDateBound(params.dateTo, true);
            if (dateFrom) dateFilter.$gte = dateFrom;
            if (dateTo) dateFilter.$lte = dateTo;
            // @ts-ignore - Dynamic query builder
            where['last_accessed_at'] = dateFilter;
          }
          const raw = await strapi.db.query('api::user-progress.user-progress').findMany({
            where,
            limit: 500,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseIds = [...new Set(raw.map((r) => {
              const c = r.course;
              if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
              return r.course_id ?? r.courseId ?? r.course;
            }).filter(Boolean))];
            const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
            const docCourseIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            const courses = [];
            if (numericCourseIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } });
              courses.push(...(byId || []));
            }
            if (docCourseIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              }
            }
            const courseById = {};
            const courseByDocId = {};
            courses.forEach((c) => {
              courseById[c.id] = c;
              if (c.documentId) courseByDocId[c.documentId] = c;
              if (c.document_id) courseByDocId[c.document_id] = c;
            });
            progresses = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId ?? c.document_id) : (r.course_id ?? r.courseId ?? r.course);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid])
                ? (courseById[cid] || courseByDocId[cid])
                : (c && typeof c === 'object' && (c.title != null || c.id != null) ? c : null);
              const cat = course?.course_category ?? course?.courseCategory;
              return {
                ...r,
                course: course ? { ...course, course_category: cat } : null,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Learning personal: db.query failed (userKey=' + userKey + '):', e?.message || String(e));
        }
      }
    }
    // Apply date filter in memory
    if (params.dateFrom || params.dateTo) {
      progresses = progresses.filter((p) => {
        const at = p.last_accessed_at;
        if (!at) return true;
        const dateFrom = normalizeDateBound(params.dateFrom, false);
        const dateTo = normalizeDateBound(params.dateTo, true);
        if (dateFrom && at < dateFrom) return false;
        if (dateTo && at > dateTo) return false;
        return true;
      });
    }

    // Ensure course title and category are loaded (document service may return relation as stub)
    const { courseById, courseByDocId } = await this.loadCoursesForProgress(progresses);
    progresses = progresses.map((p) => {
      const cid = p.course?.id ?? p.course_id ?? p.courseId ?? (typeof p.course === 'number' || (typeof p.course === 'string' && /^\d+$/.test(p.course)) ? p.course : null);
      const cdocId = p.course?.documentId ?? p.course?.document_id ?? (typeof p.course === 'string' && p.course.length > 10 ? p.course : null);
      const fullCourse = (cid != null && courseById[cid]) || (cdocId != null && courseByDocId[cdocId]) || (p.course && typeof p.course === 'object' && (p.course.title != null || p.course.id != null) ? p.course : null);
      return { ...p, course: fullCourse || p.course };
    });

    // Deduplicate by course (full list) for KPIs that must reflect all courses (e.g. last course viewed)
    const courseKey = (p) => (p.course?.documentId ?? p.course?.document_id ?? p.course?.id ?? p.course_id ?? p.courseId ?? p.course ?? '').toString();
    const statusOrder = { Completed: 0, In_progress: 1, Failed: 2, Not_started: 3 };
    const byCourseAll = new Map();
    progresses.forEach((p) => {
      const key = courseKey(p);
      if (!key) return;
      const existing = byCourseAll.get(key);
      const pStatus = statusOrder[p.progress_status] ?? 4;
      const existingStatus = existing ? (statusOrder[existing.progress_status] ?? 4) : 4;
      const pPct = Number(p.progress_percentage ?? p.progressPercentage ?? 0);
      const existingPct = Number(existing?.progress_percentage ?? existing?.progressPercentage ?? 0);
      const pAt = p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : 0;
      const existingAt = existing && existing.last_accessed_at ? new Date(existing.last_accessed_at).getTime() : 0;
      if (
        !existing ||
        pStatus < existingStatus ||
        (pStatus === existingStatus && (pPct > existingPct || (pPct === existingPct && pAt >= existingAt)))
      ) {
        byCourseAll.set(key, p);
      }
    });
    const progressesDedupAll = Array.from(byCourseAll.values());

    // Filter by course when params.courseId is set (Personal view course filter)
    const wantCourseId = params.courseId && String(params.courseId).trim();
    if (wantCourseId) {
      const courseIdStr = String(params.courseId).trim();
      let resolvedNumericIds = new Set();
      if (courseIdStr.length > 10 && !/^\d+$/.test(courseIdStr)) {
        try {
          // Use findMany to get ALL rows (draft + published) for this documentId
          const rows = await strapi.db.query('api::course.course').findMany({
            where: { documentId: courseIdStr },
            select: ['id'],
          });
          if (Array.isArray(rows) && rows.length > 0) {
            rows.forEach(r => { if (r?.id) resolvedNumericIds.add(r.id); });
          } else {
            const rows2 = await strapi.db.query('api::course.course').findMany({
              where: { document_id: courseIdStr },
              select: ['id'],
            });
            if (Array.isArray(rows2)) rows2.forEach(r => { if (r?.id) resolvedNumericIds.add(r.id); });
          }
        } catch (_) {}
      } else if (/^\d+$/.test(courseIdStr)) {
        resolvedNumericIds.add(Number(courseIdStr));
      }
      progresses = progresses.filter((p) => {
        const cid = p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId ?? p.course?.document_id ?? p.course;
        if (cid == null) return false;
        if (String(cid) === courseIdStr) return true;
        if (resolvedNumericIds.size > 0 && (resolvedNumericIds.has(Number(cid)) || resolvedNumericIds.has(cid))) return true;
        if (Number(cid) === Number(courseIdStr)) return true;
        return false;
      });
    }

    // Deduplicate filtered progress: one row per course in "My Course" table
    const byCourse = new Map();
    progresses.forEach((p) => {
      const key = courseKey(p);
      if (!key) return;
      const existing = byCourse.get(key);
      const pStatus = statusOrder[p.progress_status] ?? 4;
      const existingStatus = existing ? (statusOrder[existing.progress_status] ?? 4) : 4;
      const pPct = Number(p.progress_percentage ?? p.progressPercentage ?? 0);
      const existingPct = Number(existing?.progress_percentage ?? existing?.progressPercentage ?? 0);
      const pAt = p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : 0;
      const existingAt = existing && existing.last_accessed_at ? new Date(existing.last_accessed_at).getTime() : 0;
      if (
        !existing ||
        pStatus < existingStatus ||
        (pStatus === existingStatus && (pPct > existingPct || (pPct === existingPct && pAt >= existingAt)))
      ) {
        byCourse.set(key, p);
      }
    });
    const progressesDedup = Array.from(byCourse.values());

    const statusCounts = { Not_started: 0, In_progress: 0, Completed: 0, Failed: 0 };
    let totalTimeSpent = 0;
    const courseProgress = [];
    const monthlyCompletions = {};
    const categoryCounts = {};
    const departmentCounts = {};

    // --- Quiz/Feedback lookup for all courses for this user ---
    // Build sets for quick lookup
    let quizPassedByCourse = new Set();
    let feedbackGivenByCourse = new Set();
    let feedbackPendingByCourse = new Set();
    try {
      const userIdNum = progressesDedup[0]?.user?.id ?? progressesDedup[0]?.user_id ?? progressesDedup[0]?.userId ?? null;
      const courseIds = progressesDedup.map(p => p.course?.id ?? p.course_id ?? p.courseId).filter(Boolean);
      if (userIdNum && courseIds.length > 0) {
        // Quiz passed — check quiz_submissions for pass status
        try {
          const quizSubs = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
            where: {
              submitted_by: { id: userIdNum },
              course: { id: { $in: courseIds } },
            },
            select: ['passed'],
            populate: { course: { select: ['id'] } },
          });
          (quizSubs || []).forEach(q => {
            const cid = q.course?.id ?? q.course;
            if (cid != null && q.passed === true) quizPassedByCourse.add(String(cid));
          });
        } catch (passErr) {
          // Fallback: raw SQL for passed status
          try {
            const knexConn = strapi.db.connection;
            if (knexConn && typeof knexConn.raw === 'function') {
              const result = await knexConn.raw(
                `SELECT DISTINCT clnk.course_id
                 FROM quiz_submissions qs
                 JOIN quiz_submissions_submitted_by_lnk ulnk ON ulnk.quiz_submission_id = qs.id
                 JOIN quiz_submissions_course_lnk clnk ON clnk.quiz_submission_id = qs.id
                 WHERE ulnk.user_id = ?
                   AND clnk.course_id IN (${courseIds.map(() => '?').join(', ')})
                   AND qs.published_at IS NOT NULL
                   AND qs.passed = true`,
                [userIdNum, ...courseIds]
              );
              (result?.rows || []).forEach(r => {
                if (r.course_id != null) quizPassedByCourse.add(String(r.course_id));
              });
            }
          } catch (_) {}
        }
        // Feedback submissions
        const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
          where: {
            users_permissions_user: { id: userIdNum },
            course: { id: { $in: courseIds } },
          },
          select: ['course'],
        });
        (feedbackSubs || []).forEach(f => {
          const cid = f.course?.id ?? f.course;
          if (cid != null) feedbackGivenByCourse.add(String(cid));
        });
        // Mark feedback pending for courses that are completed but have no feedback
        progressesDedup.forEach(p => {
          const cid = p.course?.id ?? p.course_id ?? p.courseId;
          if (cid && p.progress_status === 'Completed' && !feedbackGivenByCourse.has(String(cid))) {
            feedbackPendingByCourse.add(String(cid));
          }
        });
      }
    } catch (e) {
      strapi.log.warn('Learning personal: quiz/feedback lookup failed:', e?.message);
    }

    progressesDedup.forEach((p) => {
      statusCounts[p.progress_status] = (statusCounts[p.progress_status] || 0) + 1;

      // course_category on course is an enum (Mandatory/Orientation/Other), not a relation
      const catNamePersonal = p.course?.course_category ?? p.course?.courseCategory ?? 'Other';
      categoryCounts[catNamePersonal] = (categoryCounts[catNamePersonal] || 0) + 1;

      const courseId = p.course?.documentId ?? p.course?.document_id ?? p.course?.id ?? p.course_id ?? p.courseId;
      const numericCourseId = p.course?.id ?? p.course_id ?? p.courseId;
      const moduleTimeMinutes = p.time_spent_minutes ?? 0;

      totalTimeSpent += moduleTimeMinutes;

      // Calculate inactive days
      let inactiveDays = null;
      if (p.last_accessed_at) {
        const lastAccessDate = new Date(p.last_accessed_at);
        const now = new Date();
        const diffMs = now.getTime() - lastAccessDate.getTime();
        inactiveDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }

      courseProgress.push({
        courseId: courseId != null ? String(courseId) : null,
        numericCourseId: numericCourseId != null ? Number(numericCourseId) : null,
        courseTitle: p.course?.title ?? 'Unknown',
        courseCategory: catNamePersonal,
        status: p.progress_status,
        percentage: p.progress_percentage ?? 0,
        completedModules: Array.isArray(p.completed_modules)
          ? p.completed_modules.map((m) => String(m))
          : (Array.isArray(p.completedModules) ? p.completedModules.map((m) => String(m)) : []),
        timeSpentMinutes: moduleTimeMinutes,
        moduleTimeMinutes,
        quizTimeMinutes: 0,
        completedAt: p.completed_at,
        certificateIssued: p.certificate_issued ?? false,
        quizPassed: courseId && quizPassedByCourse.has(String(courseId)),
        feedbackGiven: courseId && feedbackGivenByCourse.has(String(courseId)),
        feedbackPending: courseId && feedbackPendingByCourse.has(String(courseId)),
        inactiveDays,
      });

      if (p.completed_at && p.progress_status === 'Completed') {
        const month = p.completed_at.slice(0, 7);
        monthlyCompletions[month] = (monthlyCompletions[month] || 0) + 1;
      }
    });

    const realtimeByCoursePersonal = await this._getRealtimeLearningMinutesByCourse(params, userId);
    let courseProgressWithRealtime = this._mergeRealtimeMinutesIntoCourseRows(courseProgress, realtimeByCoursePersonal);
    courseProgressWithRealtime = this._applyRealtimeToSelectedCourseRows(courseProgressWithRealtime, params.courseId, realtimeByCoursePersonal);
    const totalTimeFromRows = courseProgressWithRealtime.reduce((sum, row) => sum + (Number(row.timeSpentMinutes) || 0), 0);
    totalTimeSpent = Math.max(totalTimeSpent, Math.round(totalTimeFromRows * 10) / 10);

    if (progressesDedup.length > 0) {
      const userWhere = isDocumentId ? { documentId: userId } : { id: userId };
      let u = null;
      try {
        u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: userWhere,
          populate: ['department'],
        });
      } catch (e) {
        strapi.log.warn('Learning personal: user lookup failed:', e?.message);
      }
      const deptName = u?.department?.name || 'Unassigned';
      departmentCounts[deptName] = progressesDedup.length;
    }

    const total = progressesDedup.length;
    const completed = statusCounts.Completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgTimeSpent = total > 0 ? Math.round(totalTimeSpent / total) : 0;

    const dropOffCutoffPersonal = new Date();
    dropOffCutoffPersonal.setDate(dropOffCutoffPersonal.getDate() - 14);
    const dropOffCutoffStrPersonal = dropOffCutoffPersonal.toISOString().slice(0, 10);
    let dropOffCountPersonal = 0;
    progressesDedup.forEach((p) => {
      const status = p.progress_status;
      const percentage = p.progress_percentage ?? p.progressPercentage ?? 0;
      const lastAccess = p.last_accessed_at ?? p.lastAccessedAt;
      const startedAt = p.started_at ?? p.startedAt;
      const isStarted = status === 'In_progress' || (status === 'Not_started' && startedAt);
      const notCompleted = status !== 'Completed' && status !== 'Failed';
      const inactiveLongEnough = lastAccess && String(lastAccess).slice(0, 10) < dropOffCutoffStrPersonal;
      if (isStarted && notCompleted && percentage < 100 && inactiveLongEnough) dropOffCountPersonal++;
    });
    const dropOffRatePersonal = total > 0 ? Math.round((dropOffCountPersonal / total) * 100) : 0;
    const courseIdsPersonal = new Set(progressesDedup.map((p) => p.course?.id ?? p.course_id ?? p.courseId ?? p.course?.documentId).filter(Boolean));

    // Calculate additional KPIs (last viewed/completed use full list so they are not affected by course filter)
    const inProgressCourses = progressesDedup.filter((p) => p.progress_status === 'In_progress');
    const lastCourseViewed = progressesDedupAll.reduce((latest, p) => {
      if (!p.last_accessed_at) return latest;
      if (!latest || new Date(p.last_accessed_at) > new Date(latest.last_accessed_at)) return p;
      return latest;
    }, null);
    const lastCourseCompleted = progressesDedupAll.filter((p) => p.progress_status === 'Completed').reduce((latest, p) => {
      if (!p.completed_at) return latest;
      if (!latest || new Date(p.completed_at) > new Date(latest.completed_at)) return p;
      return latest;
    }, null);

    return {
      kpis: {
        totalCourses: courseIdsPersonal.size, // 1. total course assigned
        completedCourses: statusCounts.Completed, // 2. completed course
        avgTimeSpentPerCourse: total > 0 ? Math.round(totalTimeSpent / total) : 0, // 3. avg time spent per course
        certificatesEarned: progressesDedup.filter((p) => p.certificate_issued).length, // 4. certificates earned
        quizPassRate: null, // 5. quiz pass rate (to be filled by controller)
        avgQuizScore: null, // 6. avg quiz score (to be filled by controller)
        coursesInProgress: inProgressCourses.length, // 7. courses in progress
        lastCourseViewed: lastCourseViewed ? {
          courseTitle: lastCourseViewed.course?.title ?? 'Unknown',
          lastAccessedAt: lastCourseViewed.last_accessed_at
        } : null, // 8. last course view with time
        lastCourseCompleted: lastCourseCompleted ? {
          courseTitle: lastCourseCompleted.course?.title ?? 'Unknown',
          completedAt: lastCourseCompleted.completed_at
        } : null, // 9. last course completed with time
        // Existing KPIs for compatibility
        totalEnrollments: total,
        completionRate,
        avgTimeSpentMinutes: avgTimeSpent,
        completedCourse: completed,
        dropOffCount: dropOffCountPersonal,
        dropOffRate: dropOffRatePersonal,
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      categoryDistribution: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
      departmentDistribution: Object.entries(departmentCounts).map(([name, value]) => ({ name, value })),
      courseProgress: courseProgressWithRealtime,
      monthlyCompletions: Object.entries(monthlyCompletions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({ month, value })),
    };
    } catch (err) {
      strapi.log.error('Learning personal error:', err?.message || err);
      return emptyResponse();
    }
  },

  /**
   * LEARNING ANALYTICS - Personal module video progress (watched fully vs skipped to end)
   */
  async getLearningPersonalModuleVideoProgress(userId, params = {}) {
    if (!userId) {
      return {
        moduleVideoKpis: { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 },
        moduleVideoProgress: [],
      };
    }

    let numericUserId = typeof userId === 'number' ? userId : (typeof userId === 'string' && /^\d+$/.test(userId) ? parseInt(userId, 10) : null);
    const isDocumentId = typeof userId === 'string' && userId.length > 10 && !/^\d+$/.test(userId);
    if (isDocumentId && !numericUserId) {
      try {
        const u = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { documentId: userId },
          select: ['id'],
        });
        if (u?.id != null) numericUserId = u.id;
      } catch (e) {
        strapi.log.warn('Module video: resolve documentId failed:', e?.message);
      }
    }

    let records = [];
    const wantCourseId = params.courseId && String(params.courseId).trim();
    let resolvedCourseNumericIds = new Set();
    if (wantCourseId) {
      const courseIdStr = String(params.courseId).trim();
      if (courseIdStr.length > 10 && !/^\d+$/.test(courseIdStr)) {
        try {
          // Use findMany to get ALL rows (draft + published) for this documentId
          const rows = await strapi.db.query('api::course.course').findMany({ where: { documentId: courseIdStr }, select: ['id'] });
          if (Array.isArray(rows) && rows.length > 0) {
            rows.forEach(r => { if (r?.id) resolvedCourseNumericIds.add(r.id); });
          } else {
            const rows2 = await strapi.db.query('api::course.course').findMany({ where: { document_id: courseIdStr }, select: ['id'] });
            if (Array.isArray(rows2)) rows2.forEach(r => { if (r?.id) resolvedCourseNumericIds.add(r.id); });
          }
        } catch (_) {}
      } else if (/^\d+$/.test(courseIdStr)) {
        resolvedCourseNumericIds.add(Number(courseIdStr));
      }
    }
    // Back-compat alias: pick first resolved id for whereVariants that need a single value
    const resolvedCourseNumericId = resolvedCourseNumericIds.size > 0 ? [...resolvedCourseNumericIds][0] : null;

    // 0) When course is selected: use same db.query pattern as Course view (user_id + course_id) so we get data
    const courseIdStrForQuery = wantCourseId ? String(params.courseId).trim() : '';
    if (numericUserId != null && (resolvedCourseNumericIds.size > 0 || courseIdStrForQuery.length > 10)) {
      const whereVariants = [
        // Try each resolved numeric ID
        ...[...resolvedCourseNumericIds].flatMap(rid => [
          { user_id: numericUserId, course_id: rid },
          { user: { id: numericUserId }, course: { id: rid } },
          { user: { id: numericUserId }, course_id: rid },
        ]),
        courseIdStrForQuery.length > 10 && { user_id: numericUserId, course: { documentId: courseIdStrForQuery } },
      ].filter(Boolean);
      for (const where of whereVariants) {
        try {
          const raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where,
            limit: 1000,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseById = {};
            const courseByDocId = {};
            const courseIds = [...new Set(raw.map((r) => r.course?.id ?? r.course_id ?? r.courseId ?? r.course?.documentId).filter(Boolean))];
            const numericIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))).map(Number);
            const docIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            if (numericIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericIds } } }) || [];
              byId.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
            }
            if (docIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docIds } } }) || [];
                byDoc.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docIds } } }) || [];
                byDoc.forEach((c) => { courseById[c.id] = c; if (c.documentId) courseByDocId[c.documentId] = c; });
              }
            }
            records = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId) : (r.course_id ?? r.courseId);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid]) ? (courseById[cid] || courseByDocId[cid]) : c;
              return {
                ...r,
                course,
                video_completion_type: r.video_completion_type ?? r.videoCompletionType,
                time_watched_min: r.time_watched_min ?? 0,
                video_duration_min: r.video_duration_min,
                module_title: r.module_title ?? r.moduleTitle,
                module_index: r.module_index ?? r.moduleIndex,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Module video progress (user+course) failed:', e?.message);
        }
      }
    }

    // 1) Document Service with user filter (merge published + draft to avoid stale rows)
    if (records.length === 0 && numericUserId != null) {
      const merged = [];
      for (const status of ['published', 'draft']) {
        try {
          const filters = { user: { id: numericUserId } };
          if (params.dateFrom || params.dateTo) {
            filters.last_updated = {};
            const dateFrom = normalizeDateBound(params.dateFrom, false);
            const dateTo = normalizeDateBound(params.dateTo, true);
            if (dateFrom) filters.last_updated.$gte = dateFrom;
            if (dateTo) filters.last_updated.$lte = dateTo;
          }
          const docRecords = await strapi.documents('api::module-video-progress.module-video-progress').findMany({
            status,
            filters,
            populate: ['course'],
            limit: 1000,
            start: 0,
          });
          if (Array.isArray(docRecords) && docRecords.length > 0) merged.push(...docRecords);
        } catch (e2) {
          strapi.log.warn('Module video progress document findMany failed (status=' + status + '):', e2?.message || String(e2));
        }
      }
      if (merged.length > 0) records = merged;
    }
    // 2) Fallback: db.query (try user_id then user relation with $eq) with course populated
    if (records.length === 0 && numericUserId != null) {
      const userWhereVariants = [
        { user_id: numericUserId },
        { user: { id: numericUserId } },
        { user: { id: { $eq: numericUserId } } },
      ];
      for (const whereVariant of userWhereVariants) {
        try {
          const dateFilter = {};
          const dateFrom = normalizeDateBound(params.dateFrom, false);
          const dateTo = normalizeDateBound(params.dateTo, true);
          if (dateFrom) dateFilter.$gte = dateFrom;
          if (dateTo) dateFilter.$lte = dateTo;
          const where = (params.dateFrom || params.dateTo) ? { ...whereVariant, last_updated: dateFilter } : whereVariant;
          const raw = await strapi.db.query('api::module-video-progress.module-video-progress').findMany({
            where,
            limit: 1000,
            populate: { course: true },
          });
          if (Array.isArray(raw) && raw.length > 0) {
            const courseIds = [...new Set(raw.map((r) => {
              const c = r.course;
              if (c && typeof c === 'object' && (c.id != null || c.documentId)) return c.id ?? c.documentId;
              return r.course_id ?? r.courseId ?? r.course;
            }).filter(Boolean))];
            const numericCourseIds = courseIds.filter((x) => typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x)));
            const docCourseIds = courseIds.filter((x) => typeof x === 'string' && x.length > 10);
            const courses = [];
            if (numericCourseIds.length > 0) {
              const byId = await strapi.db.query('api::course.course').findMany({ where: { id: { $in: numericCourseIds.map(Number) } } });
              courses.push(...(byId || []));
            }
            if (docCourseIds.length > 0) {
              try {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { documentId: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              } catch (_) {
                const byDoc = await strapi.db.query('api::course.course').findMany({ where: { document_id: { $in: docCourseIds } } });
                courses.push(...(byDoc || []));
              }
            }
            const courseById = {};
            const courseByDocId = {};
            courses.forEach((c) => {
              courseById[c.id] = c;
              if (c.documentId) courseByDocId[c.documentId] = c;
              if (c.document_id) courseByDocId[c.document_id] = c;
            });
            records = raw.map((r) => {
              const c = r.course;
              const cid = (c && typeof c === 'object') ? (c.id ?? c.documentId ?? c.document_id) : (r.course_id ?? r.courseId ?? r.course);
              const course = (cid != null && courseById[cid]) || (cid != null && courseByDocId[cid])
                ? (courseById[cid] || courseByDocId[cid])
                : (c && typeof c === 'object' && (c.title != null || c.id != null) ? c : null);
              return {
                ...r,
                course,
                video_completion_type: r.video_completion_type ?? r.videoCompletionType,
                time_watched_seconds: r.time_watched_seconds ?? r.timeWatchedSeconds ?? 0,
                video_duration_seconds: r.video_duration_seconds ?? r.videoDurationSeconds,
                module_title: r.module_title ?? r.moduleTitle,
                module_index: r.module_index ?? r.moduleIndex,
              };
            });
            break;
          }
        } catch (e) {
          strapi.log.warn('Module video progress db.query failed:', e?.message || String(e));
        }
      }
    }

    // Ensure course title is loaded for module video progress (avoid "Unknown" in personal view)
    const { courseById, courseByDocId } = await this.loadCoursesForProgress(records);
    const recordsWithCourse = records.map((r) => {
      const cid = r.course?.id ?? r.course_id ?? r.courseId;
      const cdocId = r.course?.documentId ?? r.course?.document_id;
      const fullCourse = (cid != null && courseById[cid]) || (cdocId != null && courseByDocId[cdocId]) || r.course;
      return { ...r, course: fullCourse || r.course };
    });

    // Filter by course and/or module when params specify (Personal view course/module filter)
    let filteredRecords = recordsWithCourse || [];
    const wantModuleTitle = params.moduleTitle && String(params.moduleTitle).trim();
    const wantModuleIndex = params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '';
    const moduleIndexNum = wantModuleIndex ? Number(params.moduleIndex) : null;
    const hasValidModuleIndex = wantModuleIndex && !Number.isNaN(moduleIndexNum);

    if (wantCourseId || wantModuleTitle || hasValidModuleIndex) {
      filteredRecords = filteredRecords.filter((r) => {
        if (wantCourseId) {
          const cid = r.course?.id ?? r.course_id ?? r.courseId ?? r.course?.documentId ?? r.course?.document_id;
          if (cid == null) return false;
          const courseIdStr = String(params.courseId).trim();
          const courseMatches = String(cid) === courseIdStr ||
            (resolvedCourseNumericIds.size > 0 && (resolvedCourseNumericIds.has(Number(cid)) || resolvedCourseNumericIds.has(cid))) ||
            Number(cid) === Number(courseIdStr);
          if (!courseMatches) return false;
        }
        if (wantModuleTitle || hasValidModuleIndex) {
          const mIdx = r.module_index ?? r.moduleIndex;
          if (hasValidModuleIndex) {
            if (mIdx !== moduleIndexNum) return false;
          } else if (wantModuleTitle) {
            const mTitle = (r.module_title ?? r.moduleTitle ?? '').trim().toLowerCase();
            const paramTitle = wantModuleTitle.toLowerCase();
            if (mTitle === paramTitle) return true;
            const match = paramTitle.match(/module\s*(\d+)/i) || paramTitle.match(/^(\d+)$/);
            const oneBased = match ? parseInt(match[1], 10) : null;
            const idx = oneBased != null ? oneBased - 1 : null;
            if (idx !== null && mIdx === idx) return true;
            return false;
          }
        }
        return true;
      });
    }

    // Deduplicate per course+module after merging draft/published rows.
    // Prefer rows with higher watched minutes; tie-break with stronger completion type.
    const typeRank = { not_started: 0, in_progress: 1, skipped_to_end: 2, full_watch: 3 };
    const dedupByModule = new Map();
    (Array.isArray(filteredRecords) ? filteredRecords : []).forEach((r) => {
      const cid = r.course?.documentId ?? r.course?.document_id ?? r.course?.id ?? r.course_id ?? r.courseId ?? '';
      const mIdx = r.module_index ?? r.moduleIndex;
      const mTitle = (r.module_title ?? r.moduleTitle ?? '').trim().toLowerCase();
      const key = `${String(cid)}::${mIdx != null ? String(mIdx) : mTitle}`;
      const watchedMinutes = Number(
        r.time_watched_min ??
        r.timeWatchedMinutes ??
        ((r.time_watched_seconds ?? r.timeWatchedSeconds) != null
          ? (Number(r.time_watched_seconds ?? r.timeWatchedSeconds) / 60)
          : 0)
      ) || 0;
      const ctype = String(r.video_completion_type ?? r.videoCompletionType ?? 'not_started');
      const existing = dedupByModule.get(key);
      if (!existing) {
        dedupByModule.set(key, r);
        return;
      }
      const existingWatched = Number(
        existing.time_watched_min ??
        existing.timeWatchedMinutes ??
        ((existing.time_watched_seconds ?? existing.timeWatchedSeconds) != null
          ? (Number(existing.time_watched_seconds ?? existing.timeWatchedSeconds) / 60)
          : 0)
      ) || 0;
      const existingType = String(existing.video_completion_type ?? existing.videoCompletionType ?? 'not_started');
      if (watchedMinutes > existingWatched || (watchedMinutes === existingWatched && (typeRank[ctype] ?? 0) >= (typeRank[existingType] ?? 0))) {
        dedupByModule.set(key, r);
      }
    });
    filteredRecords = Array.from(dedupByModule.values());

    const kpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
    const typeToKpi = { full_watch: 'watchedFully', skipped_to_end: 'skippedToEnd', in_progress: 'inProgress', not_started: 'notStarted' };
    // When filtering by course, use params.courseId so frontend row and module video progress match (same id format)
    const canonicalCourseId = wantCourseId ? String(params.courseId).trim() : null;
    const progress = filteredRecords.map((r) => {
      const type = r.video_completion_type ?? r.videoCompletionType ?? 'not_started';
      const kpiKey = typeToKpi[type];
      if (kpiKey) kpis[kpiKey] += 1;
      const courseIdRaw = r.course?.documentId ?? r.course?.document_id ?? r.course?.id ?? r.course_id ?? r.courseId;
      const courseId = canonicalCourseId != null ? canonicalCourseId : (courseIdRaw != null ? String(courseIdRaw) : null);
      const courseTitle = r.course?.title ?? 'Unknown';
      const moduleTitle = r.module_title ?? r.moduleTitle ?? (r.module_index != null ? `Module ${(r.module_index ?? r.moduleIndex) + 1}` : 'Unknown');
      const timeWat = Number(
        r.time_watched_min ??
        r.timeWatchedMinutes ??
        ((r.time_watched_seconds ?? r.timeWatchedSeconds) != null
          ? (Number(r.time_watched_seconds ?? r.timeWatchedSeconds) / 60)
          : 0)
      ) || 0;
      const duration = (r.video_duration_min ?? r.videoDurationMinutes) != null
        ? Number(r.video_duration_min ?? r.videoDurationMinutes)
        : ((r.video_duration_seconds ?? r.videoDurationSeconds) != null
          ? (Number(r.video_duration_seconds ?? r.videoDurationSeconds) / 60)
          : null);
      const moduleIdx = r.module_index ?? r.moduleIndex ?? null;
      return {
        courseId,
        courseTitle,
        moduleTitle,
        moduleIndex: moduleIdx != null ? Number(moduleIdx) : null,
        videoCompletionType: type,
        timeWatchedMinutes: timeWat,
        videoDurationMinutes: duration != null ? duration : null,
      };
    });

    progress.sort((a, b) => {
      const c = (a.courseTitle || '').localeCompare(b.courseTitle || '');
      return c !== 0 ? c : (a.moduleTitle || '').localeCompare(b.moduleTitle || '');
    });

    return {
      moduleVideoKpis: kpis,
      moduleVideoProgress: progress,
    };
  },

  /**
   * LEARNING ANALYTICS - Employee Table (Option B: one row per employee, aggregated)
   */
  async getLearningEmployeeTable(params = {}) {
    const dateFromNorm = normalizeDateBound(params.dateFrom, false);
    const dateToNorm = normalizeDateBound(params.dateTo, true);
    const shared = getShared(strapi);

    // Include blocked/inactive users — account status is surfaced in the table UI.
    const userWhere = {};
    if (params.company) userWhere.company = params.company;
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        userWhere.id = numericId;
      } else {
        userWhere.$or = [
          { username: { $containsi: search } },
          { email: { $containsi: search } },
          { username: { $containsi: search } },
        ];
      }
    }

    // ── Global active-assignment filter ─────────────────────────────────────
    // When no specific course is selected, restrict the user pool to only users
    // who have at least one active (published) Individual course-assignment.
    // This prevents removed users (with unpublished assignments) from appearing.
    if (!params.courseId) {
      try {
        const activeAssignments = await strapi.db.query('api::course-assignment.course-assignment').findMany({
          where: { active: 'published', assignment_target_type: 'Individual' },
          populate: { individual_user: { select: ['id'] } },
          limit: 50000,
        });
        const activeUserIds = new Set();
        for (const a of (activeAssignments || [])) {
          const users = Array.isArray(a.individual_user) ? a.individual_user : [];
          for (const u of users) {
            if (u?.id != null) activeUserIds.add(Number(u.id));
          }
        }
        if (activeUserIds.size > 0) {
          if (typeof userWhere.id === 'number') {
            if (!activeUserIds.has(userWhere.id)) {
              return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
            }
          } else if (userWhere.id && Array.isArray(userWhere.id.$in)) {
            userWhere.id.$in = userWhere.id.$in.filter((id) => activeUserIds.has(Number(id)));
          } else {
            userWhere.id = { $in: [...activeUserIds] };
          }
        }
      } catch (_) {}
    }
    // ─────────────────────────────────────────────────────────────────────────

    // When course filter is selected, constrain the user pool to only users enrolled in that course
    // BEFORE pagination. This ensures course filter works even without search text.
    if (params.courseId) {
      const courseIdStr = String(params.courseId).trim();
      const enrolledUserIds = new Set();
      try {
        const docs = await strapi.documents('api::user-progress.user-progress').findMany({
          filters: {
            $or: [
              { course: { id: courseIdStr } },
              { course: { documentId: courseIdStr } },
            ],
          },
          status: 'published',
          fields: ['id'],
          populate: { user: { fields: ['id'] } },
          pagination: { limit: 50000 },
        });
        (Array.isArray(docs) ? docs : []).forEach((p) => {
          const uid = p?.user?.id;
          if (uid != null) enrolledUserIds.add(Number(uid));
        });
      } catch (_) {}
      if (enrolledUserIds.size === 0) {
        try {
          const rows = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: { course_id: courseIdStr },
            select: ['user_id'],
            limit: 50000,
          });
          (Array.isArray(rows) ? rows : []).forEach((r) => {
            const uid = r?.user_id;
            if (uid != null) enrolledUserIds.add(Number(uid));
          });
        } catch (_) {}
      }

      // ── Active-assignment filter ─────────────────────────────────────────
      // Only show users who have an active (published) assignment for this course.
      // Users whose assignment was replaced (marked unpublished) are excluded.
      const activeAssignedIds = await getActivelyAssignedUserIdsForCourse(strapi, courseIdStr);
      if (activeAssignedIds.size > 0) {
        for (const uid of [...enrolledUserIds]) {
          if (!activeAssignedIds.has(uid)) enrolledUserIds.delete(uid);
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const enrolled = [...enrolledUserIds].filter((n) => Number.isFinite(n));
      if (enrolled.length === 0) {
        return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
      }

      if (typeof userWhere.id === 'number') {
        if (!enrolled.includes(userWhere.id)) {
          return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
        }
      } else {
        userWhere.id = { $in: enrolled };
      }
    }

    // Date/status filters must also constrain the user pool before count/pagination,
    // otherwise table totals/pages remain based on unfiltered users.
    if (dateFromNorm || dateToNorm || params.status) {
      const filteredUserIds = new Set();
      const progressFiltersForUser = {};
      if (dateFromNorm || dateToNorm) {
        progressFiltersForUser.last_accessed_at = {};
        if (dateFromNorm) progressFiltersForUser.last_accessed_at.$gte = dateFromNorm;
        if (dateToNorm) progressFiltersForUser.last_accessed_at.$lte = dateToNorm;
      }
      if (params.status) progressFiltersForUser.progress_status = params.status;
      if (params.courseId) {
        const courseIdStr = String(params.courseId).trim();
        progressFiltersForUser.$or = [
          { course: { id: courseIdStr } },
          { course: { documentId: courseIdStr } },
        ];
      }

      try {
        const [published, draft] = await Promise.all([
          strapi.documents('api::user-progress.user-progress').findMany({
            filters: progressFiltersForUser,
            status: 'published',
            fields: ['id'],
            populate: { user: { fields: ['id'] } },
            pagination: { limit: 50000 },
          }),
          strapi.documents('api::user-progress.user-progress').findMany({
            filters: progressFiltersForUser,
            status: 'draft',
            fields: ['id'],
            populate: { user: { fields: ['id'] } },
            pagination: { limit: 50000 },
          }),
        ]);
        [...(Array.isArray(published) ? published : []), ...(Array.isArray(draft) ? draft : [])].forEach((p) => {
          const uid = p?.user?.id;
          if (uid != null) filteredUserIds.add(Number(uid));
        });
      } catch (_) {
        try {
          const progressWhere = {};
          if (dateFromNorm || dateToNorm) {
            progressWhere.last_accessed_at = {};
            if (dateFromNorm) progressWhere.last_accessed_at.$gte = dateFromNorm;
            if (dateToNorm) progressWhere.last_accessed_at.$lte = dateToNorm;
          }
          if (params.status) progressWhere.progress_status = params.status;
          if (params.courseId) progressWhere.course_id = String(params.courseId).trim();

          const rows = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: progressWhere,
            select: ['user_id'],
            limit: 50000,
          });
          (Array.isArray(rows) ? rows : []).forEach((r) => {
            const uid = r?.user_id;
            if (uid != null) filteredUserIds.add(Number(uid));
          });
        } catch (_) {}
      }

      const filtered = [...filteredUserIds].filter((n) => Number.isFinite(n));
      if (filtered.length === 0) {
        return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
      }

      if (typeof userWhere.id === 'number') {
        if (!filtered.includes(userWhere.id)) {
          return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
        }
      } else if (userWhere.id && Array.isArray(userWhere.id.$in)) {
        const intersected = userWhere.id.$in.filter((id) => filtered.includes(Number(id)));
        if (intersected.length === 0) {
          return { rows: [], total: 0, page: 1, pageSize: Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10)) };
        }
        userWhere.id = { $in: intersected };
      } else {
        userWhere.id = { $in: filtered };
      }
    }

    if (parseDropOffOnlyParam(params.dropOffOnly)) {
      const dropOffUserIds = await loadDropOffUserIds(strapi, params);
      const emptyPageSize = Math.min(100, Math.max(5, parseInt(params.pageSize, 10) || 10));
      if (dropOffUserIds.size === 0) {
        return { rows: [], total: 0, page: 1, pageSize: emptyPageSize };
      }
      if (!intersectUserWhereWithIds(userWhere, dropOffUserIds)) {
        return { rows: [], total: 0, page: 1, pageSize: emptyPageSize };
      }
    }

    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(10000, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    const totalCount = await strapi.db.query('plugin::users-permissions.user').count({
      where: userWhere,
    });

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: userWhere,
      limit: pageSize,
      offset,
    });
    const userList = Array.isArray(users) ? users : [];
    if (userList.length === 0) return { rows: [], total: totalCount, page, pageSize };

    const userIdsNumeric = userList.map((u) => u.id).filter(Boolean);
    const toBool = (value) => {
      if (value === true || value === 1) return true;
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return v === 'true' || v === 'yes' || v === '1';
      }
      return false;
    };
    let isFeedbackMandatoryForCourse = false;
    const feedbackGivenUserIds = new Set();
    const userById = {};
    const userByDocumentId = {};
    userList.forEach((u, i) => {
      if (u.id != null) userById[u.id] = i;
      const docId = u.documentId ?? u.document_id;
      if (docId != null) userByDocumentId[String(docId)] = i;
    });

    const getUserIdx = (uid, docId, rawUserId, rawSubmittedById) => {
      if (uid != null && userById[uid] !== undefined) return userById[uid];
      if (docId != null && userByDocumentId[String(docId)] !== undefined) return userByDocumentId[String(docId)];
      if (rawUserId != null && userById[rawUserId] !== undefined) return userById[rawUserId];
      if (rawSubmittedById != null && userById[rawSubmittedById] !== undefined) return userById[rawSubmittedById];
      return undefined;
    };

    // Use Document Service for progress/submission - handles user relation correctly (id vs documentId)
    const progressFilters = { user: { id: { $in: userIdsNumeric } } };
    if (dateFromNorm || dateToNorm) {
      progressFilters.last_accessed_at = {};
      if (dateFromNorm) progressFilters.last_accessed_at.$gte = dateFromNorm;
      if (dateToNorm) progressFilters.last_accessed_at.$lte = dateToNorm;
    }

    let progressList = [];
    try {
      const publishedProgress = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'published',
        populate: ['user', 'course'],
        pagination: { limit: 10000 },
      });
      const draftProgress = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'draft',
        populate: ['user', 'course'],
        pagination: { limit: 10000 },
      });
      const merged = [
        ...(Array.isArray(publishedProgress) ? publishedProgress : []),
        ...(Array.isArray(draftProgress) ? draftProgress : []),
      ];
      const seen = new Set();
      progressList = merged.filter((p) => {
        const key = p?.documentId ? `doc:${p.documentId}` : `id:${p?.id ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (e) {
      strapi.log.warn('Employee table: progress query failed:', e?.message);
      // Fallback to db.query if Document Service fails
      try {
        const progressWhere = { user_id: { $in: userIdsNumeric } };
        if (dateFromNorm || dateToNorm) {
          progressWhere.last_accessed_at = {};
          if (dateFromNorm) progressWhere.last_accessed_at.$gte = dateFromNorm;
          if (dateToNorm) progressWhere.last_accessed_at.$lte = dateToNorm;
        }
        progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: progressWhere,
          limit: 10000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table: db.query fallback failed:', e2?.message);
      }
    }

    // Filter progressList by courseId (support populated course or raw course id)
    if (params.courseId) {
      const courseIdStr = String(params.courseId);
      progressList = progressList.filter((p) => {
        const courseId = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.course;
        return courseId != null && String(courseId) === courseIdStr;
      });
    }

    // Filter progressList by progress_status if status filter is applied
    if (params.status) {
      progressList = progressList.filter((p) => p.progress_status === params.status);
    }
    if (parseDropOffOnlyParam(params.dropOffOnly)) {
      const dropOffCutoffStr = getDropOffCutoffDateStr();
      progressList = progressList.filter((p) => isDropOffProgress(p, dropOffCutoffStr));
    }

    const submissionFilters = { submitted_by: { id: { $in: userIdsNumeric } } };
    if (params.courseId) {
      const courseIdStr = String(params.courseId).trim();
      submissionFilters.$or = [
        { course: { id: courseIdStr } },
        { course: { documentId: courseIdStr } },
      ];
    }
    let submissionList = [];
    try {
      submissionList = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        filters: submissionFilters,
        status: 'published',
        populate: ['submitted_by', 'course'],
        pagination: { limit: 5000 },
      });
      submissionList = Array.isArray(submissionList) ? submissionList : [];
    } catch (e) {
      strapi.log.warn('Employee table: submission query failed:', e?.message);
      try {
        const submissionWhere = { submitted_by_id: { $in: userIdsNumeric } };
        if (params.courseId) {
          submissionWhere.course_id = String(params.courseId).trim();
        }
        submissionList = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: submissionWhere,
          limit: 5000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table: submission db.query fallback failed:', e2?.message);
      }
    }

    if (params.courseId) {
      const courseIdStr = String(params.courseId).trim();
      submissionList = submissionList.filter((s) => {
        const cid = s.course?.id ?? s.course?.documentId ?? s.course_id ?? s.courseId ?? s.course;
        return cid != null && String(cid) === courseIdStr;
      });

      try {
        const courseList = await strapi.documents('api::course.course').findMany({
          filters: {
            $or: [
              { id: courseIdStr },
              { documentId: courseIdStr },
            ],
          },
          status: 'published',
          populate: ['feedback'],
          pagination: { limit: 1 },
        });
        const course = Array.isArray(courseList) ? courseList[0] : null;
        const feedbackRows = Array.isArray(course?.feedback) ? course.feedback : [];
        isFeedbackMandatoryForCourse = feedbackRows.some((f) => toBool(f?.compulsory));
      } catch (_) {
        try {
          const course = await strapi.db.query('api::course.course').findOne({
            where: /^\d+$/.test(courseIdStr) ? { id: Number(courseIdStr) } : { document_id: courseIdStr },
            populate: ['feedback'],
          });
          const feedbackRows = Array.isArray(course?.feedback) ? course.feedback : [];
          isFeedbackMandatoryForCourse = feedbackRows.some((f) => toBool(f?.compulsory));
        } catch (_) {}
      }

      try {
        const feedbackSubs = await strapi.documents('api::feedback-submission.feedback-submission').findMany({
          filters: {
            users_permissions_user: { id: { $in: userIdsNumeric } },
            $or: [
              { course: { id: courseIdStr } },
              { course: { documentId: courseIdStr } },
            ],
          },
          status: 'published',
          populate: ['users_permissions_user'],
          pagination: { limit: 50000 },
        });
        (Array.isArray(feedbackSubs) ? feedbackSubs : []).forEach((f) => {
          const uid = f?.users_permissions_user?.id;
          if (uid != null) feedbackGivenUserIds.add(Number(uid));
        });
      } catch (_) {
        try {
          const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
            where: {
              users_permissions_user: { id: { $in: userIdsNumeric } },
              $or: [
                { course: { id: courseIdStr } },
                { course: { documentId: courseIdStr } },
              ],
            },
            populate: ['users_permissions_user'],
            limit: 50000,
          });
          (Array.isArray(feedbackSubs) ? feedbackSubs : []).forEach((f) => {
            const uid = f?.users_permissions_user?.id;
            if (uid != null) feedbackGivenUserIds.add(Number(uid));
          });
        } catch (_) {}
      }
    }

    // Group by user (support Document Service user.id/documentId and db.query user_id/submitted_by_id)
    const progressByUserIdx = {};
    const submissionByUserIdx = {};
    userList.forEach((_, i) => {
      progressByUserIdx[i] = [];
      submissionByUserIdx[i] = [];
    });
    progressList.forEach((p) => {
      const idx = getUserIdx(p.user?.id, p.user?.documentId, p.user_id, null);
      if (idx !== undefined) progressByUserIdx[idx].push(p);
    });
    submissionList.forEach((s) => {
      const idx = getUserIdx(s.submitted_by?.id, s.submitted_by?.documentId, null, s.submitted_by_id);
      if (idx !== undefined) submissionByUserIdx[idx].push(s);
    });

    const courseIdStrForTime = params.courseId ? String(params.courseId).trim() : null;
    const [videoProgressByUser, learningActivityByKey] = await Promise.all([
      loadVideoProgressByUser(strapi, userIdsNumeric, courseIdStrForTime),
      loadLearningActivityTimeByUser(strapi, userIdsNumeric, params),
    ]);

    let rows = userList.map((u, i) => {
      const progs = progressByUserIdx[i] || [];
      const subs = submissionByUserIdx[i] || [];
      const timeContext = {
        videoRows: videoProgressByUser.get(String(u.id)) || [],
        telemetry: learningActivityByKey.get(getEmployeeTimeContextKey(u.id, courseIdStrForTime)) || null,
      };
      const hasFeedbackForSelectedCourse = params.courseId ? feedbackGivenUserIds.has(Number(u.id)) : false;
      const feedbackStatus = !params.courseId
        ? '-'
        : hasFeedbackForSelectedCourse
          ? 'Yes'
          : (isFeedbackMandatoryForCourse ? 'No' : '-');
      const statusOrder = ['Not_started', 'In_progress', 'Completed', 'Failed'];
      const statusCounts = {};
      progs.forEach((p) => {
        const status = p?.progress_status;
        if (!status) return;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      const courseStatus = statusOrder
        .filter((s) => statusCounts[s] > 0)
        .map((s) => s)
        .join(', ') || '—';
      const coursesEnrolled = progs.length;
      const totalModulesDone = progs.reduce((sum, p) => {
        const cm = p.completed_modules;
        return sum + (Array.isArray(cm) ? cm.length : 0);
      }, 0);
      const avgProgress = coursesEnrolled > 0
        ? Math.round(progs.reduce((s, p) => s + (p.progress_percentage || 0), 0) / coursesEnrolled)
        : 0;
      const quizPassed = subs.filter((s) => s.passed).length;
      const quizPassRate = subs.length > 0 ? Math.round((quizPassed / subs.length) * 100) : 0;
      const rowMetrics = buildEmployeeTableRowMetrics(progs, subs, timeContext);
      const { accountStatus, accountStatusTags } = shared.buildEmployeeAccountStatus(u);

      return {
        employeeId: u.id,
        employeeName: u.username || u.email || `User ${u.id}`,
        email: u.email || '—',
        company: u.company || '—',
        emp_code: u.emp_code ?? '—',
        emp_id: u.emp_id ?? '—',
        branch: u.branch ?? '—',
        working_location: u.working_location ?? '—',
        accountStatus,
        accountStatusTags,
        coursesEnrolled,
        courseStatus,
        feedbackStatus,
        courseCompletionTimeMinutes: rowMetrics.courseCompletionTimeMinutes,
        totalModulesDone,
        progressPercent: avgProgress,
        quizPassRate,
        avgScore: rowMetrics.avgScore,
        lastQuizScore: rowMetrics.lastQuizScore,
        quizAttemptCount: rowMetrics.quizAttemptCount,
      };
    });

    // If date/course/status/drop-off filters are applied, only include users with matching progress records.
    if (dateFromNorm || dateToNorm || params.courseId || params.status || parseDropOffOnlyParam(params.dropOffOnly)) {
      rows = rows.filter((row, i) => (progressByUserIdx[i] || []).length > 0);
    }

    // Completion Time filter uses exact match against normalized displayed minutes.
    if (params.filterTimeValue !== undefined && params.filterTimeValue !== null && String(params.filterTimeValue).trim() !== '') {
      const value = Number(params.filterTimeValue);
      if (Number.isFinite(value)) {
        const target = Math.round(value);
        rows = rows.filter((row) => Math.round(Number(row.courseCompletionTimeMinutes ?? 0)) === target);
      }
    } else {
      // Backward compatibility for older clients still sending range params.
      if (params.filterTimeMin) {
        const min = Number(params.filterTimeMin);
        if (Number.isFinite(min)) {
          rows = rows.filter((row) => (row.courseCompletionTimeMinutes ?? 0) >= min);
        }
      }
      if (params.filterTimeMax) {
        const max = Number(params.filterTimeMax);
        if (Number.isFinite(max)) {
          rows = rows.filter((row) => (row.courseCompletionTimeMinutes ?? 0) <= max);
        }
      }
    }

    if (params.filterTimeValue || params.filterTimeMin || params.filterTimeMax) {
      const sample = rows.slice(0, 10).map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        completionTimeMin: r.courseCompletionTimeMinutes ?? 0,
      }));
      strapi.log.info(
        `[analytics][employee-table] completion-time filter value=${params.filterTimeValue || ''} min=${params.filterTimeMin || ''} max=${params.filterTimeMax || ''} rowsAfter=${rows.length} sample=${JSON.stringify(sample)}`
      );
    }

    const sortBy = params.sortBy || 'courseCompletionTimeMinutes';
    const sortOrder = (params.sortOrder || 'desc').toLowerCase();
    rows.sort((a, b) => {
      const key = sortBy === 'courseCompletionTime' ? 'courseCompletionTimeMinutes' : sortBy;
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortOrder === 'asc' ? av - bv : bv - av;
    });

    return { rows, total: totalCount, page, pageSize };
  },

  /**
   * Escape CSV value (wrap in quotes if contains comma, quote, or newline)
   */
  escapeCsvValue(val) {
    const s = String(val ?? '');
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  },

  /**
   * LEARNING ANALYTICS - Employee Table Export (CSV)
   * Same filters as getLearningEmployeeTable but returns all rows as CSV.
   */
  async getLearningEmployeeTableExport(params = {}) {
    const XLSX = require('xlsx');
    const result = await this.getLearningEmployeeTableForExport(params);
    
    // Prepare data for Excel
    const exportData = (result.rows || []).map((r) => ({
      'Employee Name': r.employeeName || '—',
      'Account Status': r.accountStatus || 'Active',
      'Email': r.email || '—',
      'Company': r.company || '—',
      'Courses Enrolled': r.coursesEnrolled || 0,
      'Course Status': r.courseStatus || '—',
      'Total Modules Done': r.totalModulesDone || 0,
      'Progress %': r.progressPercent || 0,
      'Quiz Score': r.lastQuizScore ?? r.avgScore ?? 0,
      'Quiz Attempts': r.quizAttemptCount ?? 0,
      'Course Completion Time (min)': r.courseCompletionTimeMinutes || 0,
    }));

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Auto-size columns
    const maxWidth = 50;
    const headers = ['Employee Name', 'Account Status', 'Email', 'Company', 'Courses Enrolled', 'Course Status', 'Total Modules Done', 'Progress %', 'Quiz Score', 'Quiz Attempts', 'Course Completion Time (min)'];
    const wscols = headers.map((header) => {
      const maxLen = Math.max(
        header.length,
        ...exportData.map((row) => String(row[header] || '').length)
      );
      return { wch: Math.min(maxLen + 2, maxWidth) };
    });
    ws['!cols'] = wscols;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Employee Learning Summary');

    // Write to buffer
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  },

  /**
   * Internal: Employee table data for export (all rows, no pagination)
   */
  async getLearningEmployeeTableForExport(params = {}) {
    const dateFromNorm = normalizeDateBound(params.dateFrom, false);
    const dateToNorm = normalizeDateBound(params.dateTo, true);
    const shared = getShared(strapi);

    const userWhere = {};
    if (params.company) userWhere.company = params.company;
    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      if (!Number.isNaN(numericId) && String(numericId) === search) {
        userWhere.id = numericId;
      } else {
        userWhere.$or = [
          { username: { $containsi: search } },
          { email: { $containsi: search } },
          { username: { $containsi: search } },
        ];
      }
    }

    // Export should follow same semantics as table view:
    // when course filter is selected, include all users enrolled in that course even without search text.
    if (params.courseId) {
      const courseIdStr = String(params.courseId).trim();
      const enrolledUserIds = new Set();
      try {
        const docs = await strapi.documents('api::user-progress.user-progress').findMany({
          filters: {
            $or: [
              { course: { id: courseIdStr } },
              { course: { documentId: courseIdStr } },
            ],
          },
          status: 'published',
          fields: ['id'],
          populate: { user: { fields: ['id'] } },
          pagination: { limit: 50000 },
        });
        (Array.isArray(docs) ? docs : []).forEach((p) => {
          const uid = p?.user?.id;
          if (uid != null) enrolledUserIds.add(Number(uid));
        });
      } catch (_) {}
      if (enrolledUserIds.size === 0) {
        try {
          const rows = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: { course_id: courseIdStr },
            select: ['user_id'],
            limit: 50000,
          });
          (Array.isArray(rows) ? rows : []).forEach((r) => {
            const uid = r?.user_id;
            if (uid != null) enrolledUserIds.add(Number(uid));
          });
        } catch (_) {}
      }

      const enrolled = [...enrolledUserIds].filter((n) => Number.isFinite(n));
      if (enrolled.length === 0) return { rows: [] };

      if (typeof userWhere.id === 'number') {
        if (!enrolled.includes(userWhere.id)) return { rows: [] };
      } else {
        userWhere.id = { $in: enrolled };
      }
    }

    if (parseDropOffOnlyParam(params.dropOffOnly)) {
      const dropOffUserIds = await loadDropOffUserIds(strapi, params);
      if (dropOffUserIds.size === 0) return { rows: [] };
      if (!intersectUserWhereWithIds(userWhere, dropOffUserIds)) return { rows: [] };
    }

    const maxExport = 10000;
    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      where: userWhere,
      limit: maxExport,
    });
    const userList = Array.isArray(users) ? users : [];
    if (userList.length === 0) return { rows: [] };

    const userIdsNumeric = userList.map((u) => u.id).filter(Boolean);
    const toBool = (value) => {
      if (value === true || value === 1) return true;
      if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return v === 'true' || v === 'yes' || v === '1';
      }
      return false;
    };
    let isFeedbackMandatoryForCourse = false;
    const feedbackGivenUserIds = new Set();
    const userById = {};
    const userByDocumentId = {};
    userList.forEach((u, i) => {
      if (u.id != null) userById[u.id] = i;
      const docId = u.documentId ?? u.document_id;
      if (docId != null) userByDocumentId[String(docId)] = i;
    });
    const getUserIdxExport = (uid, docId, rawUserId, rawSubmittedById) => {
      if (uid != null && userById[uid] !== undefined) return userById[uid];
      if (docId != null && userByDocumentId[String(docId)] !== undefined) return userByDocumentId[String(docId)];
      if (rawUserId != null && userById[rawUserId] !== undefined) return userById[rawUserId];
      if (rawSubmittedById != null && userById[rawSubmittedById] !== undefined) return userById[rawSubmittedById];
      return undefined;
    };

    const progressFilters = { user: { id: { $in: userIdsNumeric } } };
    if (dateFromNorm || dateToNorm) {
      progressFilters.last_accessed_at = {};
      if (dateFromNorm) progressFilters.last_accessed_at.$gte = dateFromNorm;
      if (dateToNorm) progressFilters.last_accessed_at.$lte = dateToNorm;
    }

    let progressList = [];
    try {
      const publishedProgress = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'published',
        populate: ['user', 'course'],
        pagination: { limit: 50000 },
      }) || [];
      const draftProgress = await strapi.documents('api::user-progress.user-progress').findMany({
        filters: progressFilters,
        status: 'draft',
        populate: ['user', 'course'],
        pagination: { limit: 50000 },
      }) || [];
      const merged = [
        ...(Array.isArray(publishedProgress) ? publishedProgress : []),
        ...(Array.isArray(draftProgress) ? draftProgress : []),
      ];
      const seen = new Set();
      progressList = merged.filter((p) => {
        const key = p?.documentId ? `doc:${p.documentId}` : `id:${p?.id ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (e) {
      strapi.log.warn('Employee table export: progress query failed:', e?.message);
      try {
        const progressWhere = { user_id: { $in: userIdsNumeric } };
        if (dateFromNorm || dateToNorm) {
          progressWhere.last_accessed_at = {};
          if (dateFromNorm) progressWhere.last_accessed_at.$gte = dateFromNorm;
          if (dateToNorm) progressWhere.last_accessed_at.$lte = dateToNorm;
        }
        progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
          where: progressWhere,
          limit: 50000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table export: db.query fallback failed:', e2?.message);
      }
    }
    progressList = Array.isArray(progressList) ? progressList : [];
    if (params.courseId) {
      const courseIdStr = String(params.courseId);
      progressList = progressList.filter((p) => {
        const courseId = p.course?.id ?? p.course?.documentId ?? p.course_id ?? p.course;
        return courseId != null && String(courseId) === courseIdStr;
      });
    }
    if (params.status) {
      progressList = progressList.filter((p) => p.progress_status === params.status);
    }
    if (parseDropOffOnlyParam(params.dropOffOnly)) {
      const dropOffCutoffStr = getDropOffCutoffDateStr();
      progressList = progressList.filter((p) => isDropOffProgress(p, dropOffCutoffStr));
    }
    let submissionList = [];
    try {
      const submissionFilters = { submitted_by: { id: { $in: userIdsNumeric } } };
      if (params.courseId) {
        const courseIdStr = String(params.courseId).trim();
        submissionFilters.$or = [
          { course: { id: courseIdStr } },
          { course: { documentId: courseIdStr } },
        ];
      }
      submissionList = await strapi.documents('api::quiz-submission.quiz-submission').findMany({
        filters: submissionFilters,
        status: 'published',
        populate: ['submitted_by', 'course'],
        pagination: { limit: 20000 },
      }) || [];
    } catch (e) {
      strapi.log.warn('Employee table export: submission query failed:', e?.message);
      try {
        const submissionWhere = { submitted_by_id: { $in: userIdsNumeric } };
        if (params.courseId) {
          submissionWhere.course_id = String(params.courseId).trim();
        }
        submissionList = await strapi.db.query('api::quiz-submission.quiz-submission').findMany({
          where: submissionWhere,
          limit: 20000,
        }) || [];
      } catch (e2) {
        strapi.log.warn('Employee table export: submission fallback failed:', e2?.message);
      }
    }

    if (params.courseId) {
      const courseIdStr = String(params.courseId).trim();
      submissionList = submissionList.filter((s) => {
        const cid = s.course?.id ?? s.course?.documentId ?? s.course_id ?? s.courseId ?? s.course;
        return cid != null && String(cid) === courseIdStr;
      });

      try {
        const courseList = await strapi.documents('api::course.course').findMany({
          filters: {
            $or: [
              { id: courseIdStr },
              { documentId: courseIdStr },
            ],
          },
          status: 'published',
          populate: ['feedback'],
          pagination: { limit: 1 },
        });
        const course = Array.isArray(courseList) ? courseList[0] : null;
        const feedbackRows = Array.isArray(course?.feedback) ? course.feedback : [];
        isFeedbackMandatoryForCourse = feedbackRows.some((f) => toBool(f?.compulsory));
      } catch (_) {
        try {
          const course = await strapi.db.query('api::course.course').findOne({
            where: /^\d+$/.test(courseIdStr) ? { id: Number(courseIdStr) } : { document_id: courseIdStr },
            populate: ['feedback'],
          });
          const feedbackRows = Array.isArray(course?.feedback) ? course.feedback : [];
          isFeedbackMandatoryForCourse = feedbackRows.some((f) => toBool(f?.compulsory));
        } catch (_) {}
      }

      try {
        const feedbackSubs = await strapi.documents('api::feedback-submission.feedback-submission').findMany({
          filters: {
            users_permissions_user: { id: { $in: userIdsNumeric } },
            $or: [
              { course: { id: courseIdStr } },
              { course: { documentId: courseIdStr } },
            ],
          },
          status: 'published',
          populate: ['users_permissions_user'],
          pagination: { limit: 50000 },
        });
        (Array.isArray(feedbackSubs) ? feedbackSubs : []).forEach((f) => {
          const uid = f?.users_permissions_user?.id;
          if (uid != null) feedbackGivenUserIds.add(Number(uid));
        });
      } catch (_) {
        try {
          const feedbackSubs = await strapi.db.query('api::feedback-submission.feedback-submission').findMany({
            where: {
              users_permissions_user: { id: { $in: userIdsNumeric } },
              $or: [
                { course: { id: courseIdStr } },
                { course: { documentId: courseIdStr } },
              ],
            },
            populate: ['users_permissions_user'],
            limit: 50000,
          });
          (Array.isArray(feedbackSubs) ? feedbackSubs : []).forEach((f) => {
            const uid = f?.users_permissions_user?.id;
            if (uid != null) feedbackGivenUserIds.add(Number(uid));
          });
        } catch (_) {}
      }
    }

    const progressByUserIdx = {};
    const submissionByUserIdx = {};
    userList.forEach((_, i) => {
      progressByUserIdx[i] = [];
      submissionByUserIdx[i] = [];
    });
    progressList.forEach((p) => {
      const idx = getUserIdxExport(p.user?.id, p.user?.documentId, p.user_id, null);
      if (idx !== undefined) progressByUserIdx[idx].push(p);
    });
    submissionList.forEach((s) => {
      const idx = getUserIdxExport(s.submitted_by?.id, s.submitted_by?.documentId, null, s.submitted_by_id);
      if (idx !== undefined) submissionByUserIdx[idx].push(s);
    });

    const courseIdStrForTimeExport = params.courseId ? String(params.courseId).trim() : null;
    const [videoProgressByUserExport, learningActivityByKeyExport] = await Promise.all([
      loadVideoProgressByUser(strapi, userIdsNumeric, courseIdStrForTimeExport),
      loadLearningActivityTimeByUser(strapi, userIdsNumeric, params),
    ]);

    let rows = userList.map((u, i) => {
      const progs = progressByUserIdx[i] || [];
      const subs = submissionByUserIdx[i] || [];
      const timeContext = {
        videoRows: videoProgressByUserExport.get(String(u.id)) || [],
        telemetry: learningActivityByKeyExport.get(getEmployeeTimeContextKey(u.id, courseIdStrForTimeExport)) || null,
      };
      const hasFeedbackForSelectedCourse = params.courseId ? feedbackGivenUserIds.has(Number(u.id)) : false;
      const feedbackStatus = !params.courseId
        ? '-'
        : hasFeedbackForSelectedCourse
          ? 'Yes'
          : (isFeedbackMandatoryForCourse ? 'No' : '-');
      const statusOrder = ['Not_started', 'In_progress', 'Completed', 'Failed'];
      const statusCounts = {};
      progs.forEach((p) => {
        const status = p?.progress_status;
        if (!status) return;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      const courseStatus = statusOrder
        .filter((s) => statusCounts[s] > 0)
        .map((s) => s)
        .join(', ') || '—';
      const coursesEnrolled = progs.length;
      const totalModulesDone = progs.reduce((sum, p) => sum + (Array.isArray(p.completed_modules) ? p.completed_modules.length : 0), 0);
      const avgProgress =
        coursesEnrolled > 0
          ? Math.round(progs.reduce((s, p) => s + (p.progress_percentage || 0), 0) / coursesEnrolled)
          : 0;
      const rowMetrics = buildEmployeeTableRowMetrics(progs, subs, timeContext);
      const { accountStatus, accountStatusTags } = shared.buildEmployeeAccountStatus(u);

      return {
        employeeName: u.username || u.email || `User ${u.id}`,
        email: u.email || '—',
        company: u.company || '—',
        emp_code: u.emp_code ?? '—',
        emp_id: u.emp_id ?? '—',
        branch: u.branch ?? '—',
        working_location: u.working_location ?? '—',
        accountStatus,
        accountStatusTags,
        coursesEnrolled,
        courseStatus,
        feedbackStatus,
        totalModulesDone,
        progressPercent: avgProgress,
        avgScore: rowMetrics.avgScore,
        lastQuizScore: rowMetrics.lastQuizScore,
        quizAttemptCount: rowMetrics.quizAttemptCount,
        courseCompletionTimeMinutes: rowMetrics.courseCompletionTimeMinutes,
      };
    });
    if (dateFromNorm || dateToNorm || params.courseId || params.status || parseDropOffOnlyParam(params.dropOffOnly)) {
      rows = rows.filter((_, i) => (progressByUserIdx[i] || []).length > 0);
    }

    // Keep export semantics identical to table view for completion-time filtering.
    if (params.filterTimeValue !== undefined && params.filterTimeValue !== null && String(params.filterTimeValue).trim() !== '') {
      const value = Number(params.filterTimeValue);
      if (Number.isFinite(value)) {
        const target = Math.round(value);
        rows = rows.filter((row) => Math.round(Number(row.courseCompletionTimeMinutes ?? 0)) === target);
      }
    } else {
      if (params.filterTimeMin) {
        const min = Number(params.filterTimeMin);
        if (Number.isFinite(min)) {
          rows = rows.filter((row) => (row.courseCompletionTimeMinutes ?? 0) >= min);
        }
      }
      if (params.filterTimeMax) {
        const max = Number(params.filterTimeMax);
        if (Number.isFinite(max)) {
          rows = rows.filter((row) => (row.courseCompletionTimeMinutes ?? 0) <= max);
        }
      }
    }

    const sortBy = params.sortBy || 'courseCompletionTimeMinutes';
    const sortOrder = (params.sortOrder || 'desc').toLowerCase();
    rows.sort((a, b) => {
      const key = sortBy === 'courseCompletionTime' ? 'courseCompletionTimeMinutes' : sortBy;
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') return sortOrder === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortOrder === 'asc' ? av - bv : bv - av;
    });

    return { rows };
  },

  /**
   * Get courses for filter dropdown. Optional departmentId = courses from assignments to that dept. Optional company = courses that have that company (course.company relation).
   * Course schema has company (manyToMany) – when company selected, filter courses by course.company. When department selected, use course_assignments for that department.
   */
  async getCoursesByDepartment(departmentId, company, extraFilters = {}) {
    try {
      const companyId = company != null && company !== '' ? await this.resolveCompanyId(company) : null;
      const search = extraFilters?.search && String(extraFilters.search).trim()
        ? String(extraFilters.search).trim()
        : '';
      const requestedUserId = extraFilters?.userId != null && extraFilters.userId !== ''
        ? String(extraFilters.userId).trim()
        : '';
      const selectedLocationId = extraFilters?.unitLocation ?? extraFilters?.location ?? '';

      // Employee-view behavior: when a specific user/search is provided, return only courses
      // where matched user(s) are enrolled. Without search/userId, existing global dropdown behavior remains.
      if (search || requestedUserId) {
        const userWhere = {};

        if (companyId != null) {
          const companyRows = await strapi.db.query('api::company.company').findMany({
            where: { id: companyId },
            select: ['name'],
            limit: 1,
          });
          const companyName = companyRows?.[0]?.name;
          if (companyName) userWhere.company = companyName;
        }

        if (requestedUserId) {
          if (/^\d+$/.test(requestedUserId)) {
            userWhere.id = Number(requestedUserId);
          } else {
            userWhere.documentId = requestedUserId;
          }
        }

        if (search) {
          const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
          userWhere.$or = numericSearch != null
            ? [
                { id: numericSearch },
                { emp_code: search },
                { emp_id: search },
              ]
            : [
                { username: { $containsi: search } },
                { email: { $containsi: search } },
                { emp_code: { $containsi: search } },
                { emp_id: { $containsi: search } },
              ];
        }

        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: userWhere,
          select: ['id'],
          limit: 200,
        });
        const userIds = (users || []).map((u) => u.id).filter((id) => id != null);
        if (userIds.length === 0) return [];

        let progressList = [];
        try {
          progressList = await strapi.documents('api::user-progress.user-progress').findMany({
            status: 'published',
            filters: { user: { id: { $in: userIds } } },
            fields: ['id'],
            populate: {
              course: {
                fields: ['id', 'documentId'],
              },
            },
            pagination: { limit: 10000 },
          });
          progressList = Array.isArray(progressList) ? progressList : [];
        } catch (_) {
          progressList = [];
        }

        if (progressList.length === 0) {
          progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
            where: { user_id: { $in: userIds } },
            select: ['course_id'],
            limit: 10000,
          }) || [];
        }

        const numericCourseIds = new Set();
        const documentCourseIds = new Set();
        (progressList || []).forEach((p) => {
          const rawCourse = p.course?.id ?? p.course_id ?? p.courseId ?? p.course;
          const rawDoc = p.course?.documentId ?? p.course?.document_id;
          if (rawCourse != null) {
            const asStr = String(rawCourse).trim();
            if (/^\d+$/.test(asStr)) numericCourseIds.add(Number(asStr));
            else documentCourseIds.add(asStr);
          }
          if (rawDoc != null && String(rawDoc).trim()) documentCourseIds.add(String(rawDoc).trim());
        });

        if (numericCourseIds.size === 0 && documentCourseIds.size === 0) return [];

        const [coursesById, coursesByDoc] = await Promise.all([
          numericCourseIds.size > 0
            ? strapi.db.query('api::course.course').findMany({
                where: { id: { $in: [...numericCourseIds] } },
                select: ['id', 'documentId', 'title'],
                limit: 1000,
              })
            : [],
          documentCourseIds.size > 0
            ? strapi.db.query('api::course.course').findMany({
                where: { documentId: { $in: [...documentCourseIds] } },
                select: ['id', 'documentId', 'title'],
                limit: 1000,
              })
            : [],
        ]);

        return this._dedupeCourseOptions(
          [...(coursesById || []), ...(coursesByDoc || [])].map((c) => ({
            id: c.id ?? c.documentId,
            documentId: c.documentId ?? null,
            title: c.title ?? `Course ${c.id ?? c.documentId}`,
          }))
        );
      }

      const hasDepartmentFilter = departmentId != null && departmentId !== '';
      const hasLocationFilter = selectedLocationId != null && String(selectedLocationId).trim() !== '';

      // When department/location filters are selected, prefer courses from actual
      // enrollments of matching users. Assignment intersection can be empty in
      // valid cases (e.g., mixed assignment sources), causing empty dropdowns.
      if (hasDepartmentFilter || hasLocationFilter) {
        let departmentNameForFilter = null;
        if (hasDepartmentFilter) {
          try {
            const depRaw = String(departmentId).trim();
            if (/^\d+$/.test(depRaw)) {
              const dep = await strapi.db.query('api::department.department').findOne({
                where: { id: Number(depRaw) },
                select: ['name'],
              });
              departmentNameForFilter = dep?.name || null;
            } else {
              const dep = await strapi.db.query('api::department.department').findOne({
                where: { documentId: depRaw },
                select: ['name'],
              });
              departmentNameForFilter = dep?.name || null;
            }
          } catch (_) {}
        }

        let locationNameForFilter = null;
        if (hasLocationFilter) {
          try {
            const locRaw = String(selectedLocationId).trim();
            const isNumericLoc = /^\d+$/.test(locRaw);
            let loc = null;
            try {
              loc = isNumericLoc
                ? await strapi.db.query('api::work-location.work-location').findOne({ where: { id: Number(locRaw) }, select: ['name'] })
                : await strapi.db.query('api::work-location.work-location').findOne({ where: { documentId: locRaw }, select: ['name'] });
            } catch (_) {}
            if (!loc) {
              loc = isNumericLoc
                ? await strapi.db.query('api::unit-location.unit-location').findOne({ where: { id: Number(locRaw) }, select: ['name'] })
                : await strapi.db.query('api::unit-location.unit-location').findOne({ where: { documentId: locRaw }, select: ['name'] });
            }
            locationNameForFilter = loc?.name || null;
          } catch (_) {}
        }

        try {
          const userWhere = {};

          if (companyId != null) {
            const companyRows = await strapi.db.query('api::company.company').findMany({
              where: { id: companyId },
              select: ['name'],
              limit: 1,
            });
            const companyName = companyRows?.[0]?.name;
            if (companyName) userWhere.company = companyName;
          }

          const users = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: userWhere,
            select: ['id', 'department', 'working_location', 'branch', 'unit_location'],
            limit: 5000,
          });

          const filteredUsers = (users || []).filter((u) => {
            if (departmentNameForFilter) {
              const userDept = typeof u?.department === 'object' ? u?.department?.name : u?.department;
              if (String(userDept || '').trim().toLowerCase() !== String(departmentNameForFilter).trim().toLowerCase()) return false;
            }
            if (locationNameForFilter) {
              const candidates = [u?.working_location, u?.branch, u?.unit_location]
                .filter((v) => v != null && String(v).trim() !== '')
                .map((v) => String(v).toLowerCase());
              if (!candidates.some((v) => v.includes(String(locationNameForFilter).trim().toLowerCase()))) return false;
            }
            return true;
          });

          const userIds = filteredUsers.map((u) => u.id).filter((id) => id != null);
          if (userIds.length > 0) {
            let progressList = [];
            try {
              progressList = await strapi.documents('api::user-progress.user-progress').findMany({
                status: 'published',
                filters: { user: { id: { $in: userIds } } },
                fields: ['id'],
                populate: {
                  course: { fields: ['id', 'documentId'] },
                },
                pagination: { limit: 10000 },
              });
              progressList = Array.isArray(progressList) ? progressList : [];
            } catch (_) {
              progressList = [];
            }

            if (progressList.length === 0) {
              progressList = await strapi.db.query('api::user-progress.user-progress').findMany({
                where: { user_id: { $in: userIds } },
                select: ['course_id'],
                limit: 10000,
              }) || [];
            }

            const numericCourseIds = new Set();
            const documentCourseIds = new Set();
            (progressList || []).forEach((p) => {
              const rawCourse = p.course?.id ?? p.course_id ?? p.courseId ?? p.course;
              const rawDoc = p.course?.documentId ?? p.course?.document_id;
              if (rawCourse != null) {
                const asStr = String(rawCourse).trim();
                if (/^\d+$/.test(asStr)) numericCourseIds.add(Number(asStr));
                else if (asStr) documentCourseIds.add(asStr);
              }
              if (rawDoc != null && String(rawDoc).trim()) documentCourseIds.add(String(rawDoc).trim());
            });

            if (numericCourseIds.size > 0 || documentCourseIds.size > 0) {
              const [coursesById, coursesByDoc] = await Promise.all([
                numericCourseIds.size > 0
                  ? strapi.db.query('api::course.course').findMany({
                      where: { id: { $in: [...numericCourseIds] } },
                      select: ['id', 'documentId', 'title'],
                      limit: 1000,
                    })
                  : [],
                documentCourseIds.size > 0
                  ? strapi.db.query('api::course.course').findMany({
                      where: { documentId: { $in: [...documentCourseIds] } },
                      select: ['id', 'documentId', 'title'],
                      limit: 1000,
                    })
                  : [],
              ]);

              const fromProgress = this._dedupeCourseOptions(
                [...(coursesById || []), ...(coursesByDoc || [])].map((c) => ({
                  id: c.id ?? c.documentId,
                  documentId: c.documentId ?? null,
                  title: c.title ?? `Course ${c.id ?? c.documentId}`,
                }))
              );

              if (fromProgress.length > 0) return fromProgress;
            }
          }
        } catch (_) {}
      }

      // No filters at all: return all courses.
      if (!hasDepartmentFilter && !hasLocationFilter && companyId == null) {
        let list = [];
        try {
          const docList = await strapi.documents('api::course.course').findMany({
            status: 'published',
            fields: ['title'],
            pagination: { limit: 1000 },
          });
          list = Array.isArray(docList) ? docList : [];
        } catch (_) {}

        if (list.length === 0) {
          try {
            const rows = await strapi.db.query('api::course.course').findMany({
              select: ['id', 'documentId', 'title'],
              orderBy: { title: 'asc' },
              limit: 1000,
            });
            list = Array.isArray(rows) ? rows : [];
          } catch (_) {}
        }

        return this._dedupeCourseOptions((list || [])
          .map((c) => ({
            id: c.id ?? c.documentId,
            documentId: c.documentId ?? null,
            title: c.title ?? c.attributes?.title ?? `Course ${c.id ?? c.documentId}`,
          })));
      }

      let filteredCourses = null;
      if (hasDepartmentFilter) {
        filteredCourses = await this._getDepartmentAssignedCourses(departmentId);
      }
      if (hasLocationFilter) {
        const locationCourses = await this._getLocationAssignedCourses(selectedLocationId);
        filteredCourses = filteredCourses == null
          ? locationCourses
          : this._intersectCourseOptions(filteredCourses, locationCourses);
      }
      if (companyId != null) {
        const companyCourses = await this._getCoursesByCompanyId(companyId);
        filteredCourses = filteredCourses == null
          ? companyCourses
          : this._intersectCourseOptions(filteredCourses, companyCourses);
      }
      let finalCourses = this._dedupeCourseOptions(filteredCourses || []);

      // Fallback: if department/location filters are active but assignment-based
      // list is empty, derive courses from actual user-progress records so the
      // dropdown matches KPI/chart/table scope.
      if (finalCourses.length === 0 && (hasDepartmentFilter || hasLocationFilter)) {
        try {
          let departmentNameForFilter = null;
          if (hasDepartmentFilter) {
            const depRaw = String(departmentId).trim();
            const depIsNumeric = /^\d+$/.test(depRaw);
            const dep = depIsNumeric
              ? await strapi.db.query('api::department.department').findOne({ where: { id: Number(depRaw) }, select: ['name'] })
              : await strapi.db.query('api::department.department').findOne({ where: { documentId: depRaw }, select: ['name'] });
            departmentNameForFilter = dep?.name || null;
          }

          let locationNameForFilter = null;
          if (hasLocationFilter) {
            const locRaw = String(selectedLocationId).trim();
            const locIsNumeric = /^\d+$/.test(locRaw);
            let loc = null;
            try {
              loc = locIsNumeric
                ? await strapi.db.query('api::work-location.work-location').findOne({ where: { id: Number(locRaw) }, select: ['name'] })
                : await strapi.db.query('api::work-location.work-location').findOne({ where: { documentId: locRaw }, select: ['name'] });
            } catch (_) {}
            if (!loc) {
              loc = locIsNumeric
                ? await strapi.db.query('api::unit-location.unit-location').findOne({ where: { id: Number(locRaw) }, select: ['name'] })
                : await strapi.db.query('api::unit-location.unit-location').findOne({ where: { documentId: locRaw }, select: ['name'] });
            }
            locationNameForFilter = loc?.name || null;
          }

          const rawProgress = await strapi.db.query('api::user-progress.user-progress').findMany({
            limit: 10000,
            populate: { course: true, user: true },
          }) || [];

          const normalizedCompany = company
            ? (String(company).trim().toLowerCase() === 'vega'
                ? 'Vega'
                : (String(company).trim().toLowerCase() === 'aia' ? 'AIA' : String(company).trim()))
            : null;

          const filteredProgress = rawProgress.filter((p) => {
            const user = p.user || {};
            const course = p.course || {};
            if (!course || (course.id == null && !course.documentId)) return false;

            if (normalizedCompany) {
              const rawCompany = user.company;
              const userCompany = typeof rawCompany === 'object' && rawCompany != null
                ? (rawCompany.name ?? rawCompany)
                : rawCompany;
              const normalizedUserCompany = userCompany
                ? (String(userCompany).trim().toLowerCase() === 'vega'
                    ? 'Vega'
                    : (String(userCompany).trim().toLowerCase() === 'aia' ? 'AIA' : String(userCompany).trim()))
                : null;
              if (!normalizedUserCompany || normalizedUserCompany !== normalizedCompany) return false;
            }

            if (departmentNameForFilter) {
              const userDept = typeof user.department === 'object' ? user.department?.name : user.department;
              if (String(userDept || '').trim().toLowerCase() !== String(departmentNameForFilter).trim().toLowerCase()) {
                return false;
              }
            }

            if (locationNameForFilter) {
              const candidates = [user.working_location, user.branch, user.unit_location]
                .filter((v) => v != null && String(v).trim() !== '')
                .map((v) => String(v).toLowerCase());
              if (!candidates.some((v) => v.includes(String(locationNameForFilter).trim().toLowerCase()))) {
                return false;
              }
            }
            return true;
          });

          finalCourses = this._dedupeCourseOptions(
            filteredProgress
              .map((p) => ({
                id: p.course?.id ?? p.course?.documentId,
                documentId: p.course?.documentId ?? null,
                title: p.course?.title ?? p.course?.attributes?.title ?? `Course ${p.course?.id ?? p.course?.documentId}`,
              }))
              .filter((c) => c.id != null || c.documentId)
          );
        } catch (fallbackError) {
          strapi.log.warn('getCoursesByDepartment fallback from progress failed:', fallbackError?.message || fallbackError);
        }
      }

      return finalCourses;
    } catch (e) {
      strapi.log.error('getCoursesByDepartment error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get courses that have the given company (course.company relation). Course schema has company manyToMany.
   */
  async _getCoursesByCompanyId(companyId) {
    const companyIdStr = String(companyId);
    const toResult = (list) => this._dedupeCourseOptions((list || []).map((c) => ({
      id: c.id ?? c.documentId,
      documentId: c.documentId ?? null,
      title: c.title ?? c.attributes?.title ?? `Course ${c.id ?? c.documentId}`,
    })));

    try {
      let list = [];
      try {
        const docList = await strapi.documents('api::course.course').findMany({
          status: 'published',
          filters: { company: { id: companyId } },
          limit: 500,
        });
        list = Array.isArray(docList) ? docList : [];
      } catch (_) {}
      if (list.length === 0) {
        try {
          const rows = await strapi.db.query('api::course.course').findMany({
            where: { company: { id: companyId } },
            orderBy: { title: 'asc' },
            limit: 500,
            select: ['id', 'documentId', 'title'],
          });
          list = rows || [];
        } catch (_) {}
      }
      if (list.length > 0) return toResult(list);

      // Fallback: fetch all courses with company populated and filter in memory (handles relation filter quirks)
      try {
        const all = await strapi.db.query('api::course.course').findMany({
          orderBy: { title: 'asc' },
          limit: 1000,
          populate: ['company'],
        });
        const filtered = (all || []).filter((c) => {
          const comp = c.company;
          if (!comp) return false;
          const arr = Array.isArray(comp) ? comp : [comp];
          return arr.some((x) => x && (x.id === companyId || x.id === Number(companyId) || String(x.id) === companyIdStr || x.documentId === companyIdStr || x.document_id === companyIdStr));
        });
        return toResult(filtered);
      } catch (e) {
        strapi.log.warn('_getCoursesByCompanyId fallback:', e?.message || e);
        return [];
      }
    } catch (e) {
      strapi.log.warn('_getCoursesByCompanyId error:', e?.message || e);
      return [];
    }
  },

  /**
   * Get courses that have the given company (for Course dropdown when Company selected)
   */
  async getCoursesByCompany(company) {
    const companyId = await this.resolveCompanyId(company);
    if (companyId == null) return [];
    return this._getCoursesByCompanyId(companyId);
  },
  };

  strapi.__analyticsDashboardService = service;
  return service;
};
