'use strict';

/**
 * Analytics Dashboard Plugin (Server)
 *
 * Registers custom analytics API endpoints for Learning & Overall dashboards.
 * Endpoints return aggregated data in chart-ready format.
 */

const analyticsController = require('./controllers/analytics');
const learningController = require('./controllers/learning');
const overallController = require('./controllers/overall');

module.exports = {
  register({ strapi }) {
    // Register permission for analytics access
    strapi.admin.services.permission.actionProvider.registerMany([
      {
        section: 'plugins',
        displayName: 'Access Analytics Dashboard',
        uid: 'read',
        pluginName: 'analytics-dashboard',
      },
    ]);
  },

  bootstrap({ strapi }) {
    const analytics = analyticsController({ strapi });
    const learning = learningController({ strapi });
    const overall = overallController({ strapi });
    const analyticsService = require('./services/analytics')({ strapi });

    strapi.server.routes([
      // ============ LEARNING ANALYTICS ============
      {
        method: 'GET',
        path: '/api/analytics/learning/global',
        handler: learning.learningGlobal,
        config: {
          auth: false, // Enable auth for production if needed
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/personal',
        handler: learning.learningPersonal,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/employee-table',
        handler: learning.learningEmployeeTable,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/learning/employee-table/export',
        handler: learning.learningEmployeeTableExport,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ OVERALL ANALYTICS ============
      {
        method: 'GET',
        path: '/api/analytics/overall/global',
        handler: overall.overallGlobal,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/overall/personal',
        handler: overall.overallPersonal,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ UTILITY ENDPOINTS ============
      {
        method: 'GET',
        path: '/api/analytics/employees',
        handler: analytics.employeesList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/departments',
        handler: analytics.departmentsList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/unit-locations',
        handler: analytics.unitLocationsList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/courses-by-department',
        handler: learning.coursesByDepartment,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/course-modules',
        handler: learning.courseModules,
        config: {
          auth: false,
          policies: [],
        },
      },
      // ============ ACTIVITY TRACKING ============
      {
        method: 'GET',
        path: '/api/analytics/activity/time-by-type-and-day',
        handler: analytics.activityTimeByTypeAndDay,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/activity/log',
        handler: analytics.activityLog,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/activity/kpis',
        handler: analytics.activityTrackingKpis,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/activity/pages-stats',
        handler: analytics.activityPagesStats,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/activity/news-list',
        handler: analytics.activityNewsList,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/api/analytics/activity/track',
        handler: analytics.activityTrack,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/api/analytics/events/ingest',
        handler: analytics.eventsIngest,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/events/page-stats',
        handler: analytics.eventsPageStats,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/events/page-trend',
        handler: analytics.eventsPageTrend,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/events/learning-stats',
        handler: analytics.eventsLearningStats,
        config: {
          auth: false,
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/api/analytics/events/aggregation-status',
        handler: analytics.eventsAggregationStatus,
        config: {
          auth: false,
          policies: [],
        },
      },
    ]);

    // Keep aggregate cache warm for dashboard reads without scanning raw events each request.
    const refreshMs = Math.max(60 * 1000, parseInt(process.env.ANALYTICS_AGGREGATION_INTERVAL_MS || '300000', 10));
    analyticsService.refreshAggregateCaches().catch((e) => {
      strapi.log.warn('analytics-dashboard initial aggregate refresh failed:', e?.message || e);
    });
    setInterval(() => {
      analyticsService.refreshAggregateCaches().catch((e) => {
        strapi.log.warn('analytics-dashboard scheduled aggregate refresh failed:', e?.message || e);
      });
    }, refreshMs);
  },
};
