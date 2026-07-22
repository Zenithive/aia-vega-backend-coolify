// @ts-nocheck
'use strict';

/**
 * Learning Analytics Controller
 * Handles Learning dashboard API: global (course), personal, employee table, courses/modules.
 */
const getQueryParams = require('./utils/getQueryParams');

const EMPTY_LIVE = {
  totals: {
    module_time_seconds: 0,
    video_time_seconds: 0,
    quiz_time_seconds: 0,
    feedback_time_seconds: 0,
    unique_users: 0,
    dropoff_count: 0,
  },
  by_entity: [],
};

async function resolveNumericUserId(strapi, userId) {
  if (userId == null || userId === '') return null;
  if (typeof userId === 'number' && !Number.isNaN(userId)) return userId;
  const asStr = String(userId).trim();
  if (/^\d+$/.test(asStr)) return Number(asStr);
  try {
    const u = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: asStr },
      select: ['id'],
    });
    if (u?.id != null) return u.id;
  } catch (_) {}
  try {
    const u = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { document_id: asStr },
      select: ['id'],
    });
    if (u?.id != null) return u.id;
  } catch (_) {}
  return null;
}

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => require('../services/analytics')({ strapi });

  return {
    async learningGlobal(ctx) {
      const emptyLearning = () => ({
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
        quiz: { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 },
        moduleDetailTable: [],
        dropOffEnrollments: [],
      });
      try {
        const params = getQueryParams(ctx);
        if (params.moduleTitle) params.moduleTitle = String(params.moduleTitle).trim();
        if (params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '') {
          params.moduleIndex = Number(params.moduleIndex);
        }
        const service = getAnalyticsService();
        const data = await service.getLearningGlobal(params) || emptyLearning();
        try {
          data.quiz = await service.getQuizGlobal(params);
          // Keep avgQuizScore from getLearningGlobal(), which already applies all
          // learning-global filters (company/department/location/category/etc.).
          // getQuizGlobal() currently supports a narrower filter set.
          if (data.kpis && (data.kpis.avgQuizScore == null || Number.isNaN(Number(data.kpis.avgQuizScore)))) {
            data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
          }
        } catch (quizError) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis && data.kpis.avgQuizScore == null) data.kpis.avgQuizScore = 0;
        }
        try {
          const liveParams = {
            ...params,
            // telemetry where-builder uses `location`; learning filters currently send `unitLocation`
            location: params.location || params.unitLocation,
          };
          data.live = await service.getLearningStats(liveParams) || EMPTY_LIVE;
        } catch (_) {
          data.live = EMPTY_LIVE;
        }
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Learning learningGlobal error:', error?.message || error);
        ctx.body = { ...emptyLearning(), live: EMPTY_LIVE };
        ctx.status = 200;
      }
    },

    async learningPersonal(ctx) {
      const emptyLearningPersonal = () => ({
        kpis: {
          totalCourses: 0,
          totalEnrollments: 0,
          completionRate: 0,
          avgTimeSpentMinutes: 0,
          avgQuizScore: 0,
          completedCourse: 0,
          dropOffRate: 0,
          dropOffCount: 0,
          certificatesEarned: 0,
        },
        statusDistribution: [],
        categoryDistribution: [],
        departmentDistribution: [],
        courseProgress: [],
        monthlyCompletions: [],
        quiz: { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 },
        moduleVideoKpis: { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 },
        moduleVideoProgress: [],
      });
      try {
        const params = getQueryParams(ctx);
        const userId = params.userId;
        if (!userId) {
          return ctx.badRequest('userId is required for personal analytics');
        }
        if (params.moduleIndex !== undefined && params.moduleIndex !== null && params.moduleIndex !== '') {
          params.moduleIndex = Number(params.moduleIndex);
        }
        const service = getAnalyticsService();
        const data = await service.getLearningPersonal(userId, params) || emptyLearningPersonal();
        try {
          data.quiz = await service.getQuizPersonal(userId, params);
          if (data.kpis) {
            data.kpis.avgQuizScore = data.quiz?.avgScore ?? 0;
            data.kpis.quizPassRate = data.quiz?.passRate ?? 0;
          }
        } catch (_) {
          data.quiz = { passRate: 0, avgScore: 0, totalAttempts: 0, passed: 0, failed: 0 };
          if (data.kpis) {
            data.kpis.avgQuizScore = 0;
            data.kpis.quizPassRate = 0;
          }
        }
        try {
          const moduleVideoData = await service.getLearningPersonalModuleVideoProgress(userId, params);
          data.moduleVideoKpis = moduleVideoData?.moduleVideoKpis || {};
          data.moduleVideoProgress = moduleVideoData?.moduleVideoProgress || [];
          // Attach module columns to courseProgress when a course is selected (same as Course view so table shows watched/duration)
          const courseId = params.courseId && String(params.courseId).trim();
          if (courseId && Array.isArray(data.courseProgress) && data.courseProgress.length > 0 && Array.isArray(data.moduleVideoProgress) && data.moduleVideoProgress.length > 0) {
            const modIndexes = [...new Set(data.moduleVideoProgress.map((m) => m.moduleIndex).filter((x) => x != null && !Number.isNaN(x)))].sort((a, b) => a - b);
            const byCourseMod = new Map();
            data.moduleVideoProgress.forEach((mv) => {
              const cid = mv.courseId ?? '';
              const midx = mv.moduleIndex ?? mv.module_index;
              if (midx === undefined || midx === null) return;
              const key = `${String(cid)}::${midx}`;
              const watched = mv.timeWatchedMinutes ?? 0;
              const dur = mv.videoDurationMinutes ?? null;
              const val = dur != null && Number(dur) > 0 ? `${watched}/${dur}` : (watched ? String(watched) : '—');
              byCourseMod.set(key, val);
            });
            data.courseProgress = data.courseProgress.map((row) => {
              const out = { ...row };
              const rowCid = row.courseId ?? '';
              modIndexes.forEach((midx) => {
                const key1 = `${String(rowCid)}::${midx}`;
                const key2 = `${courseId}::${midx}`;
                out[`mod_${midx}`] = byCourseMod.get(key1) ?? byCourseMod.get(key2) ?? '—';
              });
              return out;
            });
          }
        } catch (_) {
          data.moduleVideoKpis = { watchedFully: 0, skippedToEnd: 0, inProgress: 0, notStarted: 0 };
          data.moduleVideoProgress = [];
        }
        try {
          const numericUserId = await resolveNumericUserId(strapi, userId);
          const liveParams = {
            ...params,
            userId: numericUserId ?? userId,
            location: params.location || params.unitLocation,
          };
          data.live = await service.getLearningStats(liveParams) || EMPTY_LIVE;
        } catch (_) {
          data.live = EMPTY_LIVE;
        }
        // Merge per-course quiz time from live activity-log data into courseProgress
        if (data.live?.quiz_time_by_course && Array.isArray(data.courseProgress)) {
          const qtMap = data.live.quiz_time_by_course;
          let totalQuizTime = 0;
          data.courseProgress = data.courseProgress.map((row) => {
            const numericId = row.numericCourseId ?? row.courseId;
            const qt = Number(qtMap[String(numericId)] || 0);
            totalQuizTime += qt;
            const moduleTime = Number(row.moduleTimeMinutes || 0);
            return {
              ...row,
              quizTimeMinutes: qt,
              timeSpentMinutes: Math.round((moduleTime + qt) * 10) / 10,
            };
          });
          if (data.kpis && totalQuizTime > 0) {
            data.kpis.avgTimeSpentMinutes = Math.round(((data.kpis.avgTimeSpentMinutes || 0) + totalQuizTime) * 10) / 10;
          }
        }
        ctx.body = data;
      } catch (error) {
        strapi.log.error('Learning learningPersonal error:', error?.message || error);
        ctx.body = { ...emptyLearningPersonal(), live: EMPTY_LIVE };
        ctx.status = 200;
      }
    },

    async learningEmployeeTable(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningEmployeeTable(params);
        ctx.body = data || { rows: [], total: 0, page: 1, pageSize: 10 };
      } catch (error) {
        strapi.log.error('Learning learningEmployeeTable error:', error?.message || error);
        ctx.body = { rows: [], total: 0, page: 1, pageSize: 10 };
        ctx.status = 200;
      }
    },

    async learningEmployeeTableExport(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const excelBuffer = await service.getLearningEmployeeTableExport(params);
        ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        ctx.set('Content-Disposition', 'attachment; filename="employee-learning-summary.xlsx"');
        ctx.body = excelBuffer;
      } catch (error) {
        strapi.log.error('Learning learningEmployeeTableExport error:', error);
        ctx.body = { error: 'Export failed' };
        ctx.status = 500;
      }
    },

    async coursesByDepartment(ctx) {
      try {
        const departmentId = ctx.query.departmentId || ctx.query.department_id;
        const company = ctx.query.company || ctx.query.companyId;
        const search = ctx.query.search;
        const userId = ctx.query.userId || ctx.query.user_id;
        const location = ctx.query.location;
        const unitLocation = ctx.query.unitLocation || ctx.query.unit_location;
        const service = getAnalyticsService();
        const data = await service.getCoursesByDepartment(departmentId, company, {
          search,
          userId,
          location,
          unitLocation,
        });
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Learning coursesByDepartment error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async courseModules(ctx) {
      try {
        const courseId = ctx.query.courseId || ctx.query.course_id;
        if (!courseId) {
          ctx.body = [];
          return;
        }
        const service = getAnalyticsService();
        const data = await service.getCourseModules(courseId);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Learning courseModules error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },
  };
};
