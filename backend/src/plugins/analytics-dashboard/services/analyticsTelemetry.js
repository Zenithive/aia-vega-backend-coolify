// @ts-nocheck
'use strict';

const VALID_EVENT_NAMES = new Set([
  'page_view_started',
  'page_view_ended',
  'page_click',
  'heartbeat',
  'learning_module_enter',
  'learning_module_exit',
  'learning_video_progress',
  'learning_video_completed',
  'learning_quiz_started',
  'learning_quiz_submitted',
  'learning_feedback_opened',
  'learning_feedback_submitted',
]);

const LEARNING_TIME_EVENTS = new Set([
  'learning_module_exit',
  'learning_video_progress',
  'learning_video_completed',
  'learning_quiz_submitted',
  'learning_feedback_submitted',
]);

function normalizeDateBound(value, endOfDay) {
  if (value == null || value === '') return null;
  const str = typeof value === 'string' ? value.trim() : (value instanceof Date ? value.toISOString() : String(value));
  if (!str) return null;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }
  return str;
}

function safeInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function clampNonNegative(value) {
  return Math.max(0, safeInt(value, 0));
}

function toIso(value, fallbackNow = false) {
  if (value == null || value === '') return fallbackNow ? new Date().toISOString() : null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallbackNow ? new Date().toISOString() : null;
  return d.toISOString();
}

function getUserIdFromRecord(row) {
  return row.user?.id ?? row.user_id ?? (typeof row.user === 'number' ? row.user : null);
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

module.exports = ({ strapi }) => {
  const self = {
    cache: {
      lastRefreshedAt: null,
      pageSummary: null,
      learningSummary: null,
    },
  };

  self.resolveUserCompany = async function resolveUserCompany(user) {
    const rawCompany = (user?.company || '').trim();
    if (!rawCompany) return { companyName: null, companyId: null };
    const normalizedName = rawCompany.toUpperCase() === 'VEGA' ? 'Vega' : (rawCompany.toUpperCase() === 'AIA' ? 'AIA' : rawCompany);
    let companyId = null;
    try {
      const rows = await strapi.db.query('api::company.company').findMany({
        where: { name: { $eqi: normalizedName } },
        select: ['id', 'name', 'publishedAt'],
        limit: 10,
      });
      const published = (rows || []).find((r) => r?.publishedAt != null);
      const fallback = (rows || [])[0] || null;
      if (published?.id != null) companyId = published.id;
      else if (fallback?.id != null) companyId = fallback.id;
    } catch (e) {
      strapi.log.warn('analyticsTelemetry.resolveUserCompany: failed to resolve company id', e?.message || e);
    }
    return { companyName: normalizedName, companyId };
  };

  self._validateIncomingEvent = function _validateIncomingEvent(event, index) {
    const errors = [];
    const eventId = typeof (event?.event_id ?? event?.eventId) === 'string' ? String(event.event_id ?? event.eventId).trim() : '';
    const eventName = typeof (event?.event_name ?? event?.eventName) === 'string' ? String(event.event_name ?? event.eventName).trim() : '';
    const occurredAt = toIso(event?.occurred_at ?? event?.occurredAt, false);

    if (!eventId) errors.push('event_id is required');
    if (!eventName) errors.push('event_name is required');
    if (eventName && !VALID_EVENT_NAMES.has(eventName)) {
      errors.push('event_name is not supported');
    }
    if (!occurredAt) errors.push('occurred_at must be a valid datetime');

    const durationSeconds = clampNonNegative(event?.duration_seconds ?? event?.durationSeconds);
    const clickCount = clampNonNegative(event?.click_count ?? event?.clickCount);

    // For route-level metrics, route_path should be present on portal events.
    const needsRoute = eventName.startsWith('page_') || eventName === 'heartbeat';
    const routePath = typeof (event?.route_path ?? event?.routePath) === 'string' ? String(event.route_path ?? event.routePath).trim() : '';
    if (needsRoute && !routePath) errors.push('route_path is required for page events');

    const metadata = event?.metadata_json ?? event?.metadata ?? null;
    if (metadata != null && typeof metadata !== 'object') {
      errors.push('metadata_json must be an object when provided');
    }

    const entityTypeRaw = event?.entity_type ?? event?.entityType ?? metadata?.entity_type ?? metadata?.entityType;
    const entityIdRaw = event?.entity_id ?? event?.entityId ?? metadata?.courseId ?? metadata?.course_id ?? metadata?.entity_id ?? metadata?.entityId;
    const normalizedEntityType = typeof entityTypeRaw === 'string' && entityTypeRaw.trim()
      ? entityTypeRaw.trim()
      : (entityIdRaw != null ? 'course' : null);
    const normalizedEntityId = entityIdRaw != null ? String(entityIdRaw).trim() : null;

    return {
      index,
      ok: errors.length === 0,
      errors,
      normalized: {
        event_id: eventId,
        event_name: eventName,
        occurred_at: occurredAt,
        session_id: typeof (event?.session_id ?? event?.sessionId) === 'string' ? String(event.session_id ?? event.sessionId).trim() : null,
        route_path: routePath || null,
        page_type: typeof (event?.page_type ?? event?.pageType) === 'string' ? String(event.page_type ?? event.pageType).trim() : null,
        entity_type: normalizedEntityType,
        entity_id: normalizedEntityId,
        duration_seconds: durationSeconds,
        click_count: clickCount,
        metadata: metadata && typeof metadata === 'object' ? metadata : null,
        client_ts: toIso(event?.client_ts ?? event?.clientTs, false),
        tz_offset: (event?.tz_offset ?? event?.tzOffset) != null ? safeInt(event.tz_offset ?? event.tzOffset, 0) : null,
        source: typeof event?.source === 'string' && event.source.trim() ? event.source.trim() : 'web',
      },
    };
  };

  self.ingestEvents = async function ingestEvents({ user, body }) {
    if (!user?.id) throw new Error('Authentication required');

    const payloadEvents = Array.isArray(body?.events)
      ? body.events
      : (body && typeof body === 'object' ? [body] : []);

    if (payloadEvents.length === 0) {
      return {
        success: false,
        ingested: 0,
        duplicates: 0,
        rejected: 0,
        errors: [{ index: -1, message: 'No events provided' }],
      };
    }

    const capped = payloadEvents.slice(0, 100);
    const { companyId } = await self.resolveUserCompany(user);

    let ingested = 0;
    let duplicates = 0;
    let rejected = 0;
    const errors = [];

    for (let i = 0; i < capped.length; i += 1) {
      const result = self._validateIncomingEvent(capped[i], i);
      if (!result.ok) {
        rejected += 1;
        errors.push({ index: i, message: result.errors.join('; ') });
        continue;
      }

      const e = result.normalized;
      try {
        // Deduplicate via event_id stored in activity_logs
        const existing = await strapi.db.query('api::activity-log.activity-log').findOne({
          where: { event_id: e.event_id },
          select: ['id'],
        });
        if (existing?.id != null) {
          duplicates += 1;
          continue;
        }

        // Map telemetry event fields onto activity_log fields:
        //  activity_type        ← page_type (e.g. "News", "Home")
        //  activity_description ← event_name (e.g. "page_view_ended")
        //  activity_duration    ← duration_seconds stored as-is (seconds)
        //  timestamp            ← occurred_at
        //  All remaining telemetry fields stored in new dedicated columns.
        await strapi.documents('api::activity-log.activity-log').create({
          data: {
            activity_type: e.page_type || null,
            activity_description: e.event_name,
            timestamp: e.occurred_at,
            activity_duration: e.duration_seconds,
            event_id: e.event_id,
            session_id: e.session_id,
            route_path: e.route_path,
            page_type: e.page_type,
            entity_type: e.entity_type,
            entity_id: e.entity_id,
            click_count: e.click_count,
            source: e.source,
            ingested_at: new Date().toISOString(),
            client_ts: e.client_ts,
            tz_offset: e.tz_offset,
            user: user.id,
            company: companyId || undefined,
          },
        });

        ingested += 1;
      } catch (err) {
        rejected += 1;
        errors.push({ index: i, message: err?.message || 'Failed to persist event' });
      }
    }

    return {
      success: rejected === 0,
      ingested,
      duplicates,
      rejected,
      errors,
      cappedAt: payloadEvents.length > 100 ? 100 : null,
    };
  };

  self._buildEventsWhere = async function _buildEventsWhere(params = {}) {
    const where = {};

    // Keep strict telemetry scope for generic /events/*, but allow legacy rows for learning fallback.
    if (!params.includeLegacyEvents) {
      where.event_id = { $notNull: true };
    }

    const from = normalizeDateBound(params.dateFrom, false);
    const to = normalizeDateBound(params.dateTo, true);
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.$gte = from;
      if (to) where.timestamp.$lte = to;
    }

    if (params.routePath) where.route_path = { $eq: String(params.routePath).trim() };
    if (params.pageType) where.page_type = { $eq: String(params.pageType).trim() };
    if (params.entityType) where.entity_type = { $eq: String(params.entityType).trim() };
    if (params.entityId != null && params.entityId !== '') where.entity_id = { $eq: String(params.entityId).trim() };
    if (params.eventName) where.activity_description = { $eq: String(params.eventName).trim() };

    if (params.userId != null && params.userId !== '') {
      const n = safeInt(params.userId, NaN);
      if (!Number.isNaN(n)) {
        where.user = { id: n };
      }
    }

    const hasCompanyFilter = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const hasDeptFilter = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    const hasLocationFilter = (params.location && String(params.location).trim()) || (params.unitLocation && String(params.unitLocation).trim());

    if (hasCompanyFilter || hasDeptFilter || hasLocationFilter) {
      const userWhere = {};
      if (hasCompanyFilter) {
        const c = String(params.company).trim().toLowerCase();
        userWhere.company = c === 'vega' ? 'Vega' : (c === 'aia' ? 'AIA' : String(params.company).trim());
      }
      if (hasDeptFilter) {
        userWhere.department = { $containsi: String(params.department).trim() };
      }
      if (hasLocationFilter) {
        userWhere.working_location = { $containsi: String(params.location || params.unitLocation).trim() };
      }

      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const ids = (users || []).map((u) => u.id).filter((id) => id != null);
      if (ids.length === 0) return null;
      where.user = { id: { $in: ids } };
    }

    return where;
  };

  self.getRoutePageStats = async function getRoutePageStats(params = {}) {
    const where = await self._buildEventsWhere(params);
    if (where === null) return { rows: [], total: 0 };

    const events = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 100000,
      select: ['activity_description', 'route_path', 'page_type', 'activity_duration', 'click_count', 'timestamp'],
      populate: { user: { select: ['id'] } },
    });

    const byRoute = new Map();
    for (const row of events || []) {
      const route = row.route_path || '__unknown';
      const pageType = row.page_type || 'Unknown';
      const key = `${route}::${pageType}`;
      if (!byRoute.has(key)) {
        byRoute.set(key, {
          route_path: route,
          page_type: pageType,
          visits: 0,
          unique_users: new Set(),
          total_time_seconds: 0,
          total_clicks: 0,
        });
      }
      const item = byRoute.get(key);
      const uid = getUserIdFromRecord(row);
      if (uid != null) item.unique_users.add(uid);
      if (row.activity_description === 'page_view_started') item.visits += 1;
      if (row.activity_description === 'page_click') item.total_clicks += 1;
      item.total_clicks += clampNonNegative(row.click_count);
      item.total_time_seconds += clampNonNegative(row.activity_duration); // stored as seconds
    }

    const rows = Array.from(byRoute.values())
      .map((v) => ({
        route_path: v.route_path,
        page_type: v.page_type,
        visits: v.visits,
        unique_users: v.unique_users.size,
        total_time_seconds: v.total_time_seconds,
        total_time_minutes: round1(v.total_time_seconds / 60),
        total_clicks: v.total_clicks,
      }))
      .sort((a, b) => b.total_time_seconds - a.total_time_seconds);

    return { rows, total: rows.length };
  };

  self.getRouteTrend = async function getRouteTrend(params = {}) {
    const where = await self._buildEventsWhere(params);
    if (where === null) return [];

    const events = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 100000,
      select: ['activity_description', 'activity_duration', 'click_count', 'timestamp'],
      populate: { user: { select: ['id'] } },
    });

    const buckets = new Map();
    const push = (bucketKey, row) => {
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          bucket_start: bucketKey,
          visits: 0,
          total_time_seconds: 0,
          total_clicks: 0,
          unique_users: new Set(),
        });
      }
      const b = buckets.get(bucketKey);
      const uid = getUserIdFromRecord(row);
      if (uid != null) b.unique_users.add(uid);
      if (row.activity_description === 'page_view_started') b.visits += 1;
      if (row.activity_description === 'page_click') b.total_clicks += 1;
      b.total_clicks += clampNonNegative(row.click_count);
      b.total_time_seconds += clampNonNegative(row.activity_duration); // stored as seconds
    };

    for (const row of events || []) {
      if (!row.timestamp) continue;
      const d = new Date(row.timestamp);
      if (Number.isNaN(d.getTime())) continue;
      d.setUTCSeconds(0, 0);
      const minute = d.getUTCMinutes();
      d.setUTCMinutes(minute - (minute % 5));
      push(d.toISOString(), row);
    }

    return Array.from(buckets.values())
      .map((b) => ({
        bucket_start: b.bucket_start,
        visits: b.visits,
        unique_users: b.unique_users.size,
        total_clicks: b.total_clicks,
        total_time_seconds: b.total_time_seconds,
        total_time_minutes: round1(b.total_time_seconds / 60),
      }))
      .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
  };

  self.getLearningStats = async function getLearningStats(params = {}) {
    const where = await self._buildEventsWhere({ ...params, includeLegacyEvents: true });
    if (where === null) {
      return {
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
    }

    where.activity_description = { $in: Array.from(VALID_EVENT_NAMES).filter((n) => n.startsWith('learning_')) };

    const events = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 100000,
      select: ['activity_description', 'entity_type', 'entity_id', 'activity_duration'],
      populate: { user: { select: ['id'] } },
    });

    const uniqueUsers = new Set();
    const byEntity = new Map();
    const moduleEnters = new Set();
    const moduleExits = new Set();

    let moduleTime = 0;
    let videoTime = 0;
    let quizTime = 0;
    let feedbackTime = 0;
    const quizTimeByEntity = new Map();

    for (const row of events || []) {
      const uid = getUserIdFromRecord(row);
      const et = row.entity_type || 'unknown';
      const eid = row.entity_id || 'unknown';
      const key = `${et}::${eid}`;
      const duration = clampNonNegative(row.activity_duration); // stored as seconds
      const eventName = row.activity_description || '';

      if (!byEntity.has(key)) {
        byEntity.set(key, {
          entity_type: et,
          entity_id: eid,
          total_time_seconds: 0,
          unique_users: new Set(),
          events: 0,
        });
      }

      const bucket = byEntity.get(key);
      bucket.events += 1;
      bucket.total_time_seconds += duration;

      if (uid != null) {
        uniqueUsers.add(uid);
        bucket.unique_users.add(uid);
      }

      if (eventName === 'learning_module_enter' && uid != null) moduleEnters.add(`${uid}::${key}`);
      if ((eventName === 'learning_module_exit' || eventName === 'learning_video_completed') && uid != null) moduleExits.add(`${uid}::${key}`);

      if (!LEARNING_TIME_EVENTS.has(eventName)) continue;
      if (eventName.includes('module')) moduleTime += duration;
      else if (eventName.includes('video')) videoTime += duration;
      else if (eventName.includes('quiz')) {
        quizTime += duration;
        // Track quiz time per course entity
        if (et === 'course' && eid) {
          const qKey = String(eid);
          if (!quizTimeByEntity.has(qKey)) quizTimeByEntity.set(qKey, 0);
          quizTimeByEntity.set(qKey, quizTimeByEntity.get(qKey) + duration);
        }
      }
      else if (eventName.includes('feedback')) feedbackTime += duration;
    }

    let dropoffCount = 0;
    for (const key of moduleEnters) {
      if (!moduleExits.has(key)) dropoffCount += 1;
    }

    return {
      totals: {
        module_time_seconds: moduleTime,
        video_time_seconds: videoTime,
        quiz_time_seconds: quizTime,
        feedback_time_seconds: feedbackTime,
        unique_users: uniqueUsers.size,
        dropoff_count: dropoffCount,
      },
      by_entity: Array.from(byEntity.values())
        .map((v) => ({
          entity_type: v.entity_type,
          entity_id: v.entity_id,
          total_time_seconds: v.total_time_seconds,
          total_time_minutes: round1(v.total_time_seconds / 60),
          unique_users: v.unique_users.size,
          events: v.events,
        }))
        .sort((a, b) => b.total_time_seconds - a.total_time_seconds),
      quiz_time_by_course: Object.fromEntries(
        Array.from(quizTimeByEntity.entries()).map(([k, v]) => [k, round1(v / 60)])
      ),
    };
  };

  self.refreshAggregateCaches = async function refreshAggregateCaches() {
    const now = new Date().toISOString();
    const defaultRange = {
      dateFrom: new Date(Date.now() - (1000 * 60 * 60 * 24 * 30)).toISOString(),
      dateTo: now,
    };

    try {
      const [pageSummary, learningSummary] = await Promise.all([
        self.getRoutePageStats(defaultRange),
        self.getLearningStats(defaultRange),
      ]);
      self.cache.lastRefreshedAt = now;
      self.cache.pageSummary = pageSummary;
      self.cache.learningSummary = learningSummary;
      return { ok: true, lastRefreshedAt: now };
    } catch (e) {
      strapi.log.error('analyticsTelemetry.refreshAggregateCaches error:', e?.message || e);
      return { ok: false, lastRefreshedAt: self.cache.lastRefreshedAt };
    }
  };

  self.getCacheStatus = function getCacheStatus() {
    return {
      lastRefreshedAt: self.cache.lastRefreshedAt,
      hasPageSummary: !!self.cache.pageSummary,
      hasLearningSummary: !!self.cache.learningSummary,
    };
  };

  return self;
};
