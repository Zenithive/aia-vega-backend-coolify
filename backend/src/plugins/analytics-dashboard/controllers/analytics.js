//@ts-nocheck
'use strict';

/**
 * Analytics Controller – Shared endpoints
 * Used by both Learning and Overall dashboards: employees, departments, unit-locations, activity.
 */
const getQueryParams = require('./utils/getQueryParams');

async function resolvePortalUserFromHeader(strapi, ctx) {
  const fromState = ctx.state?.user;
  if (fromState?.id) return fromState;

  const authHeader =
    ctx.request?.header?.authorization ||
    ctx.request?.headers?.authorization ||
    '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
    if (!jwtService) return null;

    const decoded = await jwtService.verify(token);
    const userId = decoded?.id ?? decoded?._id ?? decoded?.sub;
    if (!userId) return null;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId, blocked: { $ne: true } },
      select: ['id', 'company', 'department', 'email', 'username'],
    });

    return user || null;
  } catch {
    return null;
  }
}

async function getUserCompanyFromAuth(strapi, ctx) {
  const resolvedUser = await resolvePortalUserFromHeader(strapi, ctx);
  const userId = resolvedUser?.id;
  if (!userId) return null;
  const raw = (resolvedUser?.company || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'AIA') return 'AIA';
  if (upper === 'VEGA') return 'Vega';
  return null;
}

module.exports = ({ strapi }) => {
  const getAnalyticsService = () => require('../services/analytics')({ strapi });

  return {
    async employeesList(ctx) {
      try {
        const params = getQueryParams(ctx);
        if (!params.company || !String(params.company).trim()) {
          const userCompany = await getUserCompanyFromAuth(strapi, ctx);
          if (userCompany) params.company = userCompany;
        }
        const service = getAnalyticsService();
        const data = await service.getEmployeesList(params);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics employeesList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async departmentsList(ctx) {
      try {
        const company = ctx.query.company || ctx.query.companyId;
        const service = getAnalyticsService();
        const data = await service.getDepartmentsList(company);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics departmentsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async unitLocationsList(ctx) {
      try {
        const company = ctx.query.company || ctx.query.companyId;
        const service = getAnalyticsService();
        const data = await service.getUnitLocationsList(company);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics unitLocationsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityTimeByTypeAndDay(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityTimeByTypeAndDay(params);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics activityTimeByTypeAndDay error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityLog(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityLog(params);
        ctx.body = data || { rows: [], total: 0 };
      } catch (error) {
        strapi.log.error('Analytics activityLog error:', error?.message || error);
        ctx.body = { rows: [], total: 0 };
        ctx.status = 200;
      }
    },

    async activityTrackingKpis(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityTrackingKpis(params);
        ctx.body = data || { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
      } catch (error) {
        strapi.log.error('Analytics activityTrackingKpis error:', error?.message || error);
        ctx.body = { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
        ctx.status = 200;
      }
    },

    async activityPagesStats(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getActivityPagesStats(params);
        ctx.body = data || { topPagesByVisit: [], leastUsedPages: [] };
      } catch (error) {
        strapi.log.error('Analytics activityPagesStats error:', error?.message || error);
        ctx.body = { topPagesByVisit: [], leastUsedPages: [] };
        ctx.status = 200;
      }
    },

    async activityNewsList(ctx) {
      try {
        const service = getAnalyticsService();
        const data = await service.getNewsForActivityFilter();
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics activityNewsList error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async activityTrack(ctx) {
      try {
        const user = await resolvePortalUserFromHeader(strapi, ctx);
        if (!user?.id) {
          return ctx.unauthorized('Authentication required. Send JWT in Authorization header.');
        }
        const body = ctx.request?.body || {};

        // Backward/forward compatibility: if frontend sends telemetry batch payload
        // to the legacy /activity/track route, process it via events ingest path.
        if (Array.isArray(body?.events) && body.events.length > 0) {
          if (body.events.length > 100) {
            return ctx.badRequest('Maximum 100 events per request');
          }
          const service = getAnalyticsService();
          const result = await service.ingestEvents({ user, body });
          ctx.body = result;
          ctx.status = result?.success ? 201 : 200;
          return;
        }

        const {
          activity_type,
          activity_description,
          duration_seconds,
          event_id,
          eventId,
          session_id,
          sessionId,
          route_path,
          routePath,
          page_type,
          pageType,
          entity_type,
          entityType,
          entity_id,
          entityId,
          click_count,
          clickCount,
          source,
          client_ts,
          clientTs,
          tz_offset,
          tzOffset,
          occurred_at,
          occurredAt,
          event_name,
          eventName,
          metadata_json,
          metadata,
        } = body;
        const validTypes = ['News', 'Event', 'Course', 'Quiz', 'Feedback', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];
        const normalizedType = activity_type || page_type || pageType || null;
        if (normalizedType && !validTypes.includes(normalizedType)) {
          return ctx.badRequest('Invalid activity_type');
        }
        const normalizedDescription = (typeof activity_description === 'string' && activity_description.trim())
          ? activity_description.trim()
          : (typeof (event_name || eventName) === 'string' && String(event_name || eventName).trim() ? String(event_name || eventName).trim() : null);
        if (!normalizedDescription) {
          return ctx.badRequest('activity_description or event_name is required (string)');
        }
        const meta = (metadata_json && typeof metadata_json === 'object') ? metadata_json : ((metadata && typeof metadata === 'object') ? metadata : null);
        const normalizedEntityId = entity_id ?? entityId ?? meta?.courseId ?? meta?.course_id ?? null;
        const normalizedEntityType = entity_type ?? entityType ?? (normalizedEntityId != null ? 'course' : null);
        const secs = Math.max(0, parseInt(duration_seconds ?? body.durationSeconds, 10) || 0);
        const service = getAnalyticsService();
        const entry = await service.createActivityLog({
          user_id: user.id,
          company: user.company || null,
          activity_type: normalizedType,
          activity_description: normalizedDescription,
          duration_seconds: secs,
          timestamp: occurred_at || occurredAt,
          event_id: event_id || eventId,
          session_id: session_id || sessionId,
          route_path: route_path || routePath,
          page_type: page_type || pageType,
          entity_type: normalizedEntityType,
          entity_id: normalizedEntityId,
          click_count: click_count ?? clickCount,
          source,
          client_ts: client_ts || clientTs,
          tz_offset: tz_offset ?? tzOffset,
          metadata_json: meta,
        });
        ctx.body = { success: true, id: entry?.id ?? entry?.documentId };
        ctx.status = 201;
      } catch (error) {
        strapi.log.error('Analytics activityTrack error:', error);
        ctx.body = { success: false, error: error?.message || 'Activity log failed' };
        ctx.status = 200;
      }
    },

    async eventsIngest(ctx) {
      try {
        const user = await resolvePortalUserFromHeader(strapi, ctx);
        if (!user?.id) {
          return ctx.unauthorized('Authentication required. Send JWT in Authorization header.');
        }

        const body = ctx.request?.body || {};
        const events = Array.isArray(body?.events) ? body.events : [];
        if (events.length === 0) {
          return ctx.badRequest('events array is required');
        }
        if (events.length > 100) {
          return ctx.badRequest('Maximum 100 events per request');
        }

        const service = getAnalyticsService();
        const result = await service.ingestEvents({ user, body });
        ctx.body = result;
        ctx.status = result?.success ? 201 : 200;
      } catch (error) {
        strapi.log.error('Analytics eventsIngest error:', error);
        ctx.body = { success: false, ingested: 0, duplicates: 0, rejected: 0, errors: [{ index: -1, message: error?.message || 'Event ingest failed' }] };
        ctx.status = 200;
      }
    },

    async eventsPageStats(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getRoutePageStats(params);
        ctx.body = data || { rows: [], total: 0 };
      } catch (error) {
        strapi.log.error('Analytics eventsPageStats error:', error?.message || error);
        ctx.body = { rows: [], total: 0 };
        ctx.status = 200;
      }
    },

    async eventsPageTrend(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getRouteTrend(params);
        ctx.body = data || [];
      } catch (error) {
        strapi.log.error('Analytics eventsPageTrend error:', error?.message || error);
        ctx.body = [];
        ctx.status = 200;
      }
    },

    async eventsLearningStats(ctx) {
      try {
        const params = getQueryParams(ctx);
        const service = getAnalyticsService();
        const data = await service.getLearningStats(params);
        ctx.body = data || { totals: {}, by_entity: [] };
      } catch (error) {
        strapi.log.error('Analytics eventsLearningStats error:', error?.message || error);
        ctx.body = { totals: {}, by_entity: [] };
        ctx.status = 200;
      }
    },

    async eventsAggregationStatus(ctx) {
      try {
        const service = getAnalyticsService();
        ctx.body = service.getCacheStatus();
      } catch (error) {
        strapi.log.error('Analytics eventsAggregationStatus error:', error?.message || error);
        ctx.body = { lastRefreshedAt: null, hasPageSummary: false, hasLearningSummary: false };
        ctx.status = 200;
      }
    },
  };
};
