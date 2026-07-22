// @ts-nocheck

'use strict';

/**
 * Analytics Shared Service
 * Used by both Learning and Overall dashboards: employees, departments, unit-locations, activity.
 */
/**
 * Account status for learning analytics rows.
 * Exported for use outside the Strapi service factory.
 */
function buildEmployeeAccountStatus(user) {
  if (!user) return { accountStatus: 'Active', accountStatusTags: ['Active'] };
  if (user.blocked === true) {
    return { accountStatus: 'Blocked', accountStatusTags: ['Blocked'] };
  }
  const tags = [];
  const companyLower = String(user.company || '').trim().toLowerCase();
  if (companyLower === 'vega') {
    if (user.active === false) tags.push('Inactive');
  } else {
    if (user.active === false) tags.push('Inactive');
    if (user.exit_date != null && String(user.exit_date).trim() !== '' && !tags.includes('Inactive')) {
      tags.push('Inactive');
    }
  }
  if (tags.length === 0) {
    return { accountStatus: 'Active', accountStatusTags: ['Active'] };
  }
  return { accountStatus: tags.join(', '), accountStatusTags: tags };
}

module.exports = ({ strapi }) => {
  const self = {};

  self.resolveCompanyId = async function (company) {
    if (company == null || company === '') return null;
    const str = String(company).trim();
    const numeric = typeof company === 'number' ? company : parseInt(str, 10);
    if (!Number.isNaN(numeric)) return numeric;
    try {
      const exactRows = await strapi.db.query('api::company.company').findMany({
        where: { name: { $eqi: str } },
        select: ['id', 'name', 'publishedAt'],
        limit: 10,
      });
      const exactPublished = (exactRows || []).find((c) => c?.publishedAt != null);
      if (exactPublished?.id != null) return exactPublished.id;
      if (exactRows?.[0]?.id != null) return exactRows[0].id;

      const all = await strapi.db.query('api::company.company').findMany({
        select: ['id', 'name', 'publishedAt'],
        limit: 50,
      });
      const lower = str.toLowerCase();
      const matched = (all || []).filter(
        (c) => c.name && (String(c.name).toLowerCase() === lower || String(c.name).toLowerCase().includes(lower))
      );
      const matchPublished = matched.find((c) => c?.publishedAt != null);
      return matchPublished?.id ?? matched[0]?.id ?? null;
    } catch (e) {
      return null;
    }
  };

  self._dedupeById = function (list) {
    const seenId = new Set();
    const seenName = new Set();
    return (list || []).filter((item) => {
      const key = item.id != null ? String(item.id) : (item.documentId != null ? String(item.documentId) : null);
      const nameKey = (item.name != null ? String(item.name).trim().toLowerCase() : '') || `__${key}`;
      if (key == null || seenId.has(key) || seenName.has(nameKey)) return false;
      seenId.add(key);
      seenName.add(nameKey);
      return true;
    });
  };

  self.getEmployeesList = async function (params = {}) {
    const includeInactiveBlocked = params.includeInactiveBlocked === true
      || String(params.includeInactiveBlocked || '').toLowerCase() === 'true';

    const mapPhotograph = (media) => {
      if (!media) return null;
      return {
        id: media.id ?? null,
        documentId: media.documentId ?? media.document_id ?? null,
        name: media.name ?? null,
        alternativeText: media.alternativeText ?? null,
        caption: media.caption ?? null,
        width: media.width ?? null,
        height: media.height ?? null,
        formats: media.formats ?? null,
        hash: media.hash ?? null,
        ext: media.ext ?? null,
        mime: media.mime ?? null,
        size: media.size ?? null,
        url: media.url ?? null,
        previewUrl: media.previewUrl ?? null,
        provider: media.provider ?? null,
      };
    };

    const where = includeInactiveBlocked ? {} : { blocked: { $eq: false } };

    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    if (companyVal) {
      const c = String(params.company).trim();
      const cl = c.toLowerCase();
      where.company = cl === 'vega' ? 'Vega' : cl === 'aia' ? 'AIA' : c;
    }

    // Vega: show employees with active=true (exit_date doesn't matter)
    // AIA + no-filter: show employees with exit_date IS NULL (currently working)
    const resolvedCompany = where.company;
    if (!includeInactiveBlocked) {
      if (resolvedCompany === 'Vega') {
        where.active = true;
      } else {
        where.active = { $ne: false };
        where.exit_date = { $null: true };
      }
    }

    const deptVal = params.department && String(params.department).trim() && String(params.department).toLowerCase() !== 'all';
    if (deptVal) {
      const deptId = params.department;
      const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
      if (isNumeric) {
        try {
          const deptRow = await strapi.db.query('api::department.department').findOne({
            where: { id: Number(deptId) },
            select: ['name'],
          });
          if (deptRow?.name) where.department = deptRow.name;
        } catch (e) {
          strapi.log.warn('getEmployeesList: resolve department failed', e?.message);
        }
      } else {
        where.department = { $containsi: String(deptId) };
      }
    }

    // Add designation filter
    const designationVal = params.designation && String(params.designation).trim() && String(params.designation).toLowerCase() !== 'all';
    if (designationVal) {
      const desigStr = String(params.designation).trim();
      where.designation = { $containsi: desigStr };
    }

    let locCondition = null;
    if (params.location && String(params.location).trim()) {
      const locVal = String(params.location).trim();
      locCondition = {
        $or: [
          { working_location: { $containsi: locVal } },
          { branch: { $containsi: locVal } },
        ],
      };
    }

    if (params.search && String(params.search).trim()) {
      const search = String(params.search).trim();
      const numericId = parseInt(search, 10);
      const isNumericSearch = !Number.isNaN(numericId) && String(numericId) === search;
      let searchCondition;

      if (isNumericSearch) {
        searchCondition = {
          $or: [
            { id: numericId },
            { emp_code: { $containsi: search } },
            { emp_id: { $containsi: search } },
          ],
        };
      } else {
        // Normalize: strip honorifics, collapse spaces, lowercase
        const cleaned = search
          .replace(/^\s*(mr|mrs|ms)\.?\s+/i, '')
          .replace(/\s+/g, ' ')
          .trim();

        const tokens = cleaned.split(' ').filter(Boolean);

        // Each token must match at least one searchable field (username, email, emp_code, emp_id)
        const tokenConditions = tokens.map((word) => ({
          $or: [
            { username: { $containsi: word } },
            { email: { $containsi: word } },
            { emp_code: { $containsi: word } },
            { emp_id: { $containsi: word } },
          ],
        }));

        searchCondition = tokenConditions;
      }

      if (locCondition) {
        where.$and = (where.$and || []).concat([
          locCondition,
          ...(Array.isArray(searchCondition) ? searchCondition : [searchCondition]),
        ]);
      } else {
        where.$and = (where.$and || []).concat(
          Array.isArray(searchCondition) ? searchCondition : [searchCondition]
        );
      }
    } else if (locCondition) {
      Object.assign(where, locCondition);
    }



    const dateFromRaw = params.dateFrom && String(params.dateFrom).trim();
    const dateToRaw = params.dateTo && String(params.dateTo).trim();
    if (dateFromRaw || dateToRaw) {
      const joinDateWhere = {};
      if (dateFromRaw) joinDateWhere.$gte = dateFromRaw;
      if (dateToRaw) joinDateWhere.$lte = dateToRaw;
      if (Object.keys(joinDateWhere).length > 0) {
        where.joining_date = joinDateWhere;
      }
    }

    const sortFieldMap = {
      'name-asc':     { username: 'ASC' },
      'name-desc':    { username: 'DESC' },
      'join-newest':  { joining_date: 'DESC' },
      'join-oldest':  { joining_date: 'ASC' },
    };
    const orderBy = sortFieldMap[params.sortBy] || { username: 'ASC' };

    const page     = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize, 10) || 9));
    const offset   = (page - 1) * pageSize;

    try {
      const total = await strapi.db.query('plugin::users-permissions.user').count({ where });
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        orderBy,
        limit: pageSize,
        offset,
        populate: {
          photograph: {
            select: [
              'id',
              'documentId',
              'name',
              'alternativeText',
              'caption',
              'width',
              'height',
              'formats',
              'hash',
              'ext',
              'mime',
              'size',
              'url',
              'previewUrl',
              'provider',
            ],
          },
        },
      });
      const list = Array.isArray(users) ? users : [];
      const items = list.map((u) => {
        const { accountStatus, accountStatusTags } = self.buildEmployeeAccountStatus(u);
        return {
        id: u.id,
        documentId: u.documentId ?? u.document_id ?? null,
        employee_name: u.username || u.email || '—',
        username: u.username ?? '—',
        email: u.email || '—',
        emp_code: u.emp_code ?? '—',
        emp_id: u.emp_id ?? '—',
        department: typeof u.department === 'object' && u.department?.name != null ? u.department.name : (u.department ?? '—'),
        business_vertical: u.business_vertical ?? '—',
        designation: typeof u.designation === 'string' ? u.designation : (u.designation?.title ?? '—'),
        company: u.company ?? '—',
        working_location: u.working_location ?? '—',
        joining_date: u.joining_date ?? null,
        exit_date: u.exit_date ?? null,
        date_of_birth: u.date_of_birth ?? null,
        description: u.description ?? null,
        welcome_note: u.welcome_note ?? null,
        branch: u.branch ?? '—',
        contact_no: u.contact_no ?? '—',
        active: u.active !== false,
        blocked: u.blocked === true,
        accountStatus,
        accountStatusTags,
        photograph: mapPhotograph(u.photograph),
        emp_photo_file: u.emp_photo_file ?? null,
      };
      });
      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    } catch (e) {
      strapi.log.error('getEmployeesList error:', e?.message || e);
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }
  };

  self.getDepartmentsList = async function (company) {
    try {
      const companyId = await self.resolveCompanyId(company);
      const where = companyId != null ? { company: companyId } : {};
      const departments = await strapi.db.query('api::department.department').findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { name: 'asc' },
        limit: 200,
      });
      const list = Array.isArray(departments) ? departments : [];
      const mapped = list.map((d) => ({ id: d.id ?? d.documentId, documentId: d.documentId, name: d.name }));
      return self._dedupeById(mapped);
    } catch (e) {
      strapi.log.error('getDepartmentsList error:', e?.message || e);
      return [];
    }
  };

  self.getUnitLocationsList = async function (company) {
    // Now fetch from work-location instead of unit-location
    try {
      const companyId = await self.resolveCompanyId(company);
      const where = companyId != null ? { company: { id: companyId } } : {};
      const locations = await strapi.db.query('api::work-location.work-location').findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { name: 'asc' },
        limit: 200,
      });
      const list = Array.isArray(locations) ? locations : [];
      const mapped = list.map((l) => ({ id: l.id ?? l.documentId, documentId: l.documentId, name: l.name }));
      return self._dedupeById(mapped);
    } catch (e) {
      strapi.log.error('getUnitLocationsList error:', e?.message || e);
      return [];
    }
  };

  self.getActivityTimeByTypeAndDay = async function (params = {}) {
    const where = {};
    if (params.dateFrom || params.dateTo) {
      where.timestamp = {};
      if (params.dateFrom) where.timestamp.$gte = params.dateFrom;
      if (params.dateTo) where.timestamp.$lte = params.dateTo;
    }
    if (params.unitLocation) {
      const userWhere = { department: { unit_locations: { id: params.unitLocation } } };
      if (params.company) userWhere.company = params.company;
      if (params.department) userWhere.department = { id: params.department, unit_locations: { id: params.unitLocation } };
      const usersMatch = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const allowedUserIds = (usersMatch || []).map((u) => u.id);
      if (allowedUserIds.length === 0) return [];
      where.user = { id: { $in: allowedUserIds } };
    } else if (params.company || params.department) {
      where.user = where.user || {};
      if (params.company) where.user.company = params.company;
      if (params.department) where.user.department = { id: params.department };
    }
    if (params.activityType) where.activity_type = params.activityType;

    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 10000,
    });
    const list = Array.isArray(logs) ? logs : [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDate = {};
    const pageTypes = ['News', 'Location', 'Routes', 'People', 'Gallery', 'Home'];
    list.forEach((log) => {
      if (!log.timestamp) return;
      const d = new Date(log.timestamp);
      const dateKey = log.timestamp.slice(0, 10);
      const dayKey = dayNames[d.getDay()];
      if (!byDate[dateKey]) {
        const initial = { date: dateKey, day: dayKey };
        pageTypes.forEach((t) => { initial[t] = 0; });
        byDate[dateKey] = initial;
      }
      const type = normalizeActivityType(log.activity_type || 'News', log.route_path);
      const mins = (log.activity_duration || 0) / 60; // activity_duration stored in seconds
      if (byDate[dateKey][type] !== undefined) {
        byDate[dateKey][type] += mins;
      } else {
        byDate[dateKey][type] = mins;
      }
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  };

  /** Normalize date param to ISO string; if date-only or start-of-day, extend to start/end of day for timestamp range. */
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

  /** Allowed page activity types for Overall Activity Tracking filter/dropdown. */
  const ALLOWED_ACTIVITY_TYPES = ['News', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];
  const ACTIVITY_TYPE_ALIASES = {
    News: ['News'],
    Location: ['Location', 'Locations'],
    Routes: ['Routes', 'Route'],
    People: ['People', 'Person'],
    Gallery: ['Gallery'],
    Home: ['Home'],
    'Company policy': ['Company policy', 'Company Policy', 'Resources'],
    'Form & Templates': ['Form & Templates', 'Form and Templates', 'Resources'],
    Calendar: ['Calendar'],
  };

  function normalizeActivityType(type, routePath = '') {
    const route = String(routePath || '').trim().toLowerCase();
    const rawType = String(type || '').trim().toLowerCase();
    if (rawType === 'resources') {
      if (route.includes('policy')) return 'Company policy';
      if (route.includes('form') || route.includes('template')) return 'Form & Templates';
    }
    const raw = String(type || '').trim().toLowerCase();
    if (!raw) return '';
    for (const key of ALLOWED_ACTIVITY_TYPES) {
      const aliases = ACTIVITY_TYPE_ALIASES[key] || [key];
      if (aliases.some((a) => String(a).trim().toLowerCase() === raw)) return key;
    }
    return String(type || '').trim();
  }

  function expandAllowedActivityTypes() {
    const set = new Set();
    ALLOWED_ACTIVITY_TYPES.forEach((k) => {
      const aliases = ACTIVITY_TYPE_ALIASES[k] || [k];
      aliases.forEach((a) => set.add(String(a)));
    });
    return [...set];
  }

  async function resolveAnalyticsUserId(params) {
    if (params.userId == null || params.userId === '') return null;
    if (typeof params.userId === 'number' && !Number.isNaN(params.userId)) {
      return params.userId;
    }
    const str = String(params.userId).trim();
    const parsed = parseInt(str, 10);
    if (!Number.isNaN(parsed) && String(parsed) === str) {
      return parsed;
    }
    const u = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { documentId: str },
      select: ['id'],
    });
    return u?.id ?? null;
  }

  function applyUserCreatedAtFilter(userWhere, params) {
    if (!params.dateFrom && !params.dateTo) return;
    const from = normalizeDateBound(params.dateFrom, false);
    const to = normalizeDateBound(params.dateTo, true);
    if (!from && !to) return;
    userWhere.createdAt = {};
    if (from) userWhere.createdAt.$gte = from;
    if (to) userWhere.createdAt.$lte = to;
  }

  /**
   * User pool for analytics filters: company, department, unit location, employee, optional account created date.
   */
  self._buildUserScopeWhere = async function (params = {}, options = {}) {
    const { applyCreatedAtFilter = false } = options;
    const numericId = await resolveAnalyticsUserId(params);
    if (params.userId != null && params.userId !== '') {
      if (numericId == null) return null;
      const userWhere = { id: numericId, blocked: { $ne: true } };
      if (applyCreatedAtFilter) applyUserCreatedAtFilter(userWhere, params);
      return userWhere;
    }

    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    const userWhere = { blocked: { $ne: true } };
    if (companyVal) {
      const c = String(params.company).trim().toLowerCase();
      userWhere.company = c === 'vega' ? 'Vega' : c === 'aia' ? 'AIA' : String(params.company).trim();
    }

    if (params.department) {
      try {
        const deptId = params.department;
        const isNumeric = typeof deptId === 'number' || /^\d+$/.test(String(deptId));
        const deptRow = isNumeric
          ? await strapi.db.query('api::department.department').findOne({
              where: { id: Number(deptId) },
              select: ['name'],
            })
          : await strapi.db.query('api::department.department').findOne({
              where: { documentId: String(deptId) },
              select: ['name'],
            });
        if (deptRow?.name) userWhere.department = { $eqi: deptRow.name };
      } catch (e) {
        strapi.log.warn('_buildUserScopeWhere: resolve department failed', e?.message);
      }
    }

    if (params.unitLocation) {
      try {
        const locId = params.unitLocation;
        const isNumeric = typeof locId === 'number' || /^\d+$/.test(String(locId));
        const locRow = isNumeric
          ? await strapi.db.query('api::work-location.work-location').findOne({
              where: { id: Number(locId) },
              select: ['name'],
            })
          : await strapi.db.query('api::work-location.work-location').findOne({
              where: { documentId: String(locId) },
              select: ['name'],
            });
        if (locRow?.name) {
          userWhere.$or = [
            { working_location: { $containsi: locRow.name } },
            { branch: { $containsi: locRow.name } },
          ];
        }
      } catch (e) {
        strapi.log.warn('_buildUserScopeWhere: resolve work location failed', e?.message);
      }
    }

    if (applyCreatedAtFilter) applyUserCreatedAtFilter(userWhere, params);
    return userWhere;
  };

  /** Build shared where for activity log queries (date, company, department, unitLocation, activityType, userId). Uses relation "user" and activity_log.company so filters work with Strapi 5. Excludes Course, Quiz, Feedback from all activity data. Excludes page_view_started (zero-duration) from KPI/chart/log queries so visit counts are not doubled. */
  self._buildActivityWhere = async function (params = {}) {
    const where = {};
    const requestedActivityType = params.activityType ? String(params.activityType).trim() : '';
    if (requestedActivityType) {
      // Only allow page types that exist in the Overall dashboard filter.
      if (ALLOWED_ACTIVITY_TYPES.includes(requestedActivityType)) {
        where.activity_type = { $in: ACTIVITY_TYPE_ALIASES[requestedActivityType] || [requestedActivityType] };
        if (requestedActivityType === 'Form & Templates') {
          where.$and = (where.$and || []).concat([{
            $or: [
              { activity_type: { $ne: 'Resources' } },
              { route_path: { $containsi: 'forms-templates' } },
              { route_path: { $containsi: 'form' } },
              { route_path: { $containsi: 'template' } },
            ],
          }]);
        }
        if (requestedActivityType === 'Company policy') {
          where.$and = (where.$and || []).concat([{
            $or: [
              { activity_type: { $ne: 'Resources' } },
              { route_path: { $containsi: 'polic' } },
            ],
          }]);
        }
      } else {
        // Invalid/unsupported filter value should return no rows.
        where.activity_type = { $eq: '__none__' };
      }
    } else {
      // "All Pages" means only the configured page filter set, never Course/Quiz/Feedback rows.
      where.activity_type = { $in: expandAllowedActivityTypes() };
    }
    // Exclude page_view_started: both events are stored in the DB (visible in Content Manager)
    // but dashboard KPIs and tables should only count page_view_ended which carries duration.
    where.activity_description = { $ne: 'page_view_started' };

    if (params.dateFrom || params.dateTo) {
      const from = normalizeDateBound(params.dateFrom, false);
      const to = normalizeDateBound(params.dateTo, true);
      if (from || to) {
        where.timestamp = {};
        if (from) where.timestamp.$gte = from;
        if (to) where.timestamp.$lte = to;
      }
    }
    /* When newsId is selected: do NOT filter by activity_description - frontend often sends generic "News".
       Show all News activity; likes column will show Yes/No for the selected news. */

    const numericId = await resolveAnalyticsUserId(params);
    if (params.userId != null && params.userId !== '') {
      if (numericId == null) return null;
      where.user = { id: numericId };
      return where;
    }

    const companyVal = params.company && String(params.company).trim() && !/^all\s*companies?$/i.test(String(params.company));
    if (params.unitLocation || params.department || companyVal) {
      const userWhere = await self._buildUserScopeWhere(params);
      if (userWhere === null) return null;
      const usersMatch = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: userWhere,
        select: ['id'],
      });
      const allowedUserIds = (usersMatch || []).map((u) => u.id).filter((id) => id != null);
      if (allowedUserIds.length === 0) return null;
      where.user = { id: { $in: allowedUserIds } };
    }

    return where;
  };

  /**
   * Activity Tracking KPIs: totalUser (visit count), uniqueUser, timeSpentMin, avgTimeSpentMin.
   * totalUser = count of every page visit (same user visiting 3 times = 3).
   * uniqueUser = distinct users who visited.
   */
  self.getActivityTrackingKpis = async function (params = {}) {
    const where = await self._buildActivityWhere(params);
    if (where === null) {
      return { totalUser: 0, uniqueUser: 0, timeSpentMin: 0, avgTimeSpentMin: 0 };
    }
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 50000,
      select: ['activity_duration'],
      populate: { user: { select: ['id'] } },
    });
    const list = Array.isArray(logs) ? logs : [];
    const totalUser = list.length;
    const getUserId = (l) => l.user_id ?? l.users_permissions_user_id ?? (typeof l.user === 'object' && l.user != null ? l.user.id : l.user);
    const uniqueUserIds = new Set(list.map(getUserId).filter(Boolean));
    const uniqueUser = uniqueUserIds.size;
    // activity_duration is stored in seconds; divide by 60 for display in minutes
    const timeSpentSec = list.reduce((sum, l) => sum + (Number(l.activity_duration) || 0), 0);
    const timeSpentMin = Math.round((timeSpentSec / 60) * 10) / 10;
    const avgTimeSpentMin = uniqueUser > 0 ? Math.round((timeSpentMin / uniqueUser) * 10) / 10 : 0;
    return { totalUser, uniqueUser, timeSpentMin, avgTimeSpentMin };
  };

  const ACTIVITY_PAGES = ['News', 'Location', 'Routes', 'People', 'Gallery', 'Home', 'Company policy', 'Form & Templates', 'Calendar'];

  /**
   * Top pages by time (desc) and least used pages by time (asc) for Activity Tracking charts.
   * Bar length = total time (minutes). Tooltip shows visit count.
   * Returns { topPagesByVisit: [{ name, value (min), count }], leastUsedPages: [{ name, value (min), count }] }.
   */
  self.getActivityPagesStats = async function (params = {}) {
    const where = await self._buildActivityWhere(params);
    if (where === null) {
      return { topPagesByVisit: [], leastUsedPages: [] };
    }
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: 50000,
      select: ['activity_type', 'activity_duration'],
    });
    const list = Array.isArray(logs) ? logs : [];
    const byType = {};
    list.forEach((log) => {
      const t = normalizeActivityType(log.activity_type || 'News', log.route_path);
      if (!byType[t]) byType[t] = { count: 0, timeMin: 0 };
      byType[t].count += 1;
      byType[t].timeMin += (Number(log.activity_duration) || 0) / 60; // stored as seconds → convert to minutes
    });
    const withTimeAndCount = ACTIVITY_PAGES.map((type) => ({
      name: type,
      value: byType[type] ? Math.round(byType[type].timeMin * 10) / 10 : 0,
      count: byType[type] ? byType[type].count : 0,
    }));
    const topPagesByVisit = [...withTimeAndCount].sort((a, b) => b.value - a.value).map(({ name, value, count }) => ({ name, value, count }));
    const leastUsedPages = [...withTimeAndCount].sort((a, b) => a.value - b.value).map(({ name, value, count }) => ({ name, value, count }));
    return { topPagesByVisit, leastUsedPages };
  };

  /** Allowed sort fields for activity log: activity_type, activity_duration, timestamp. */
  const ACTIVITY_LOG_SORT_FIELDS = ['activity_type', 'activity_duration', 'timestamp'];

  /**
   * Returns list of news with id, documentId, title, likesCount for activity filter dropdown (when activityType is News).
   * Likes count: News has a manyToMany relation "likes" to plugin::users-permissions.user. We populate likes and use
   * the length of that array = number of users who liked this news.
   */
  self.getNewsForActivityFilter = async function () {
    try {
      const items = await strapi.db.query('api::news.news').findMany({
        where: { publishedAt: { $notNull: true } },
        orderBy: { title: 'ASC' },
        limit: 500,
        select: ['id', 'documentId', 'title'],
        // populate: { likes: { select: ['id'] } },
      });
      const list = Array.isArray(items) ? items : [];
      const seen = new Set();
      const result = [];
      for (const n of list) {
        const docId = n.documentId ?? n.document_id ?? null;
        const key = docId != null ? String(docId) : `id:${n.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          id: n.id,
          documentId: docId,
          title: n.title || '—',
          // likesCount: Array.isArray(n.likes) ? n.likes.length : (n.likes?.length ?? 0),
        });
      }
      return result;
    } catch (e) {
      strapi.log.warn('getNewsForActivityFilter error:', e?.message);
      return [];
    }
  };

  self.getActivityLog = async function (params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.min(10000, Math.max(5, parseInt(params.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;
    const where = await self._buildActivityWhere(params);
    if (where === null) return { rows: [], total: 0, page, pageSize };

    const sortByParam = params.sortBy && String(params.sortBy).trim();
    const sortOrderParam = (params.sortOrder && String(params.sortOrder).toLowerCase()) === 'asc' ? 'asc' : 'desc';
    const sortField =
      sortByParam === 'activity'
        ? 'activity_type'
        : sortByParam === 'duration'
          ? 'activity_duration'
          : sortByParam === 'timestamp' || sortByParam === 'date'
            ? 'timestamp'
            : 'timestamp';
    const orderByField = ACTIVITY_LOG_SORT_FIELDS.includes(sortField) ? sortField : 'timestamp';
    const orderBy = { [orderByField]: sortOrderParam };

    const total = await strapi.db.query('api::activity-log.activity-log').count({ where });
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      where,
      limit: pageSize,
      offset,
      orderBy,
      populate: ['user', 'company'],
    });
    const list = Array.isArray(logs) ? logs : [];
    let rows = list.map((log) => {
      // activity_duration is stored in seconds
      const secs = Math.round(log.activity_duration || 0);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      let duration;
      if (secs === 0) duration = 0;
      else if (m === 0) duration = `${s}s`;
      else if (s === 0) duration = `${m}m`;
      else duration = `${m}m ${s}s`;
      const userId = log.user?.id ?? log.user_id ?? (typeof log.user === 'number' ? log.user : null);
      const userDocumentId = log.user?.documentId ?? log.user?.document_id ?? null;
      const userName = log.user ? (log.user.username || log.user.email || `User ${log.user.id}`) : '—';
      const companyName = log.company?.name ?? log.user?.company ?? '—';
      const activityDesc = (log.activity_description || log.activity_type || '—').trim();
      return {
        userId,
        userDocumentId,
        userName,
        company: companyName,
        activity: normalizeActivityType(log.activity_type || log.activity_description || '—', log.route_path),
        activityDescription: activityDesc,
        duration,
        timestamp: log.timestamp,
      };
    });

    if (params.activityType === 'News' && rows.length > 0) {
      try {
        const newsList = await strapi.db.query('api::news.news').findMany({
          where: { publishedAt: { $notNull: true } },
          select: ['id', 'documentId', 'title'],
          populate: { likes: { select: ['id', 'documentId'] } },
        });
        const toUserKey = (u) => {
          if (u == null) return null;
          if (typeof u === 'number') return `id:${u}`;
          if (u?.id != null) return `id:${u.id}`;
          if (u?.documentId != null) return `doc:${u.documentId}`;
          if (u?.document_id != null) return `doc:${u.document_id}`;
          return null;
        };
        const allUserKeys = (u) => {
          const keys = [];
          if (u == null) return keys;
          if (typeof u === 'number') return [`id:${u}`];
          if (u?.id != null) keys.push(`id:${u.id}`);
          if (u?.documentId != null) keys.push(`doc:${u.documentId}`);
          if (u?.document_id != null) keys.push(`doc:${u.document_id}`);
          return keys;
        };
        const newsWithLikes = (newsList || []).map((n) => {
          const keys = new Set();
          const likes = Array.isArray(n.likes) ? n.likes : [];
          for (const u of likes) {
            for (const kk of allUserKeys(u)) keys.add(kk);
          }
          return {
            id: n.id,
            documentId: n.documentId ?? n.document_id ?? null,
            title: (n.title || '').trim().toLowerCase(),
            titleOriginal: n.title || '—',
            likedByUserKeys: keys,
          };
        });

        const rowUserKeys = (r) => {
          const keys = [];
          if (r.userId != null) keys.push(`id:${r.userId}`);
          if (r.userDocumentId != null) keys.push(`doc:${r.userDocumentId}`);
          return keys;
        };
        const rowMatchesLikes = (r, likedByKeys) => rowUserKeys(r).some((k) => likedByKeys.has(k));
        const countForRow = (r, userLikesCount) => {
          let c = 0;
          for (const k of rowUserKeys(r)) {
            c = Math.max(c, userLikesCount.get(k) || 0);
          }
          return c;
        };

        if (params.newsId) {
          const newsIdVal = String(params.newsId).trim();
          const isNumeric = /^\d+$/.test(newsIdVal);
          const targetNews = newsWithLikes.find((n) =>
            isNumeric
              ? n.id === Number(newsIdVal)
              : String(n.documentId ?? '') === newsIdVal
          );
          if (targetNews) {
            rows = rows.map((r) => ({
              ...r,
              likesDisplay: rowMatchesLikes(r, targetNews.likedByUserKeys) ? 'Yes' : 'No',
            }));
          }
        } else {
          const userLikesCount = new Map();
          for (const n of newsList || []) {
            const users = Array.isArray(n.likes) ? n.likes : [];
            const seenCanonical = new Set();
            for (const u of users) {
              const canon = toUserKey(u);
              if (!canon || seenCanonical.has(canon)) continue;
              seenCanonical.add(canon);
              const count = (userLikesCount.get(canon) || 0) + 1;
              userLikesCount.set(canon, count);
              for (const k of allUserKeys(u)) {
                if (k !== canon) userLikesCount.set(k, count);
              }
            }
          }
          rows = rows.map((r) => {
            const count = countForRow(r, userLikesCount);
            const desc = (r.activityDescription || '').toLowerCase();
            const match = newsWithLikes.find(
              (n) => n.title && (desc.includes(n.title) || desc === n.title)
            );
            return {
              ...r,
              likesDisplay: String(count),
              newsTitle: match ? match.titleOriginal : null,
            };
          });
        }
      } catch (e) {
        strapi.log.warn('getActivityLog: enrich news likes failed', e?.message);
      }
    }

    return { rows, total, page, pageSize };
  };

  self.createActivityLog = async function (data) {
    const {
      user_id,
      company,
      activity_type,
      activity_description,
      duration_seconds,
      timestamp,
      event_id,
      session_id,
      route_path,
      page_type,
      entity_type,
      entity_id,
      click_count,
      source,
      client_ts,
      tz_offset,
      metadata_json,
    } = data;
    if (!user_id || !activity_description) {
      throw new Error('user_id and activity_description are required');
    }
    let companyId = null;
    if (company) {
      if (typeof company === 'number' || (typeof company === 'string' && /^\d+$/.test(company))) {
        companyId = typeof company === 'number' ? company : parseInt(company, 10);
      } else {
        const c = await strapi.db.query('api::company.company').findOne({
          where: { name: { $eqi: String(company) } },
          select: ['id'],
        });
        if (c) companyId = c.id;
      }
    }
    const metadata = metadata_json && typeof metadata_json === 'object' ? metadata_json : null;
    const normalizedEntityId = entity_id ?? metadata?.courseId ?? metadata?.course_id ?? null;
    const normalizedEntityType = entity_type || (normalizedEntityId != null ? 'course' : null);

    const entry = await strapi.documents('api::activity-log.activity-log').create({
      data: {
        user: user_id,
        company: companyId || undefined,
        activity_type: activity_type || page_type || null,
        activity_description,
        activity_duration: Math.max(0, Math.round(duration_seconds || 0)), // store as seconds
        timestamp: timestamp || new Date().toISOString(),
        event_id: event_id || null,
        session_id: session_id || null,
        route_path: route_path || null,
        page_type: page_type || null,
        entity_type: normalizedEntityType || null,
        entity_id: normalizedEntityId != null ? String(normalizedEntityId) : null,
        click_count: Math.max(0, Number(click_count) || 0),
        source: source || null,
        ingested_at: new Date().toISOString(),
        client_ts: client_ts || null,
        tz_offset: tz_offset != null ? Number(tz_offset) : null,
      },
    });
    return entry;
  };

  self.buildEmployeeAccountStatus = buildEmployeeAccountStatus;

  return self;
};

module.exports.buildEmployeeAccountStatus = buildEmployeeAccountStatus;
