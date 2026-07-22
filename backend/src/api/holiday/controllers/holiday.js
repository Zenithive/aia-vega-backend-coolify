'use strict';

/**
 * holiday controller
 * Filters holidays by authenticated user's company (AIA/Vega) and location when applicable.
 */

const { createCoreController } = require('@strapi/strapi').factories;

function normalizeCompanyName(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'AIA') return 'AIA';
  if (upper === 'VEGA') return 'Vega';
  return null;
}

function normalizeLocation(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAnySelectedLocations(holidayItem) {
  const locations = Array.isArray(holidayItem?.work_locations) ? holidayItem.work_locations : [];
  return locations.length > 0;
}

function holidayIncludesUserCompany(holidayItem, userCompany) {
  if (!userCompany) return false;
  const companies = Array.isArray(holidayItem?.companies) ? holidayItem.companies : [];
  if (companies.length === 0) return false;
  return companies.some((c) => normalizeCompanyName(c?.name) === userCompany);
}

function holidayIncludesUserLocation(holidayItem, userLocation) {
  const normalizedUserLocation = normalizeLocation(userLocation);
  if (!normalizedUserLocation) return false;

  const locations = Array.isArray(holidayItem?.work_locations) ? holidayItem.work_locations : [];
  if (locations.length === 0) return false;

  return locations.some((loc) => normalizeLocation(loc?.name) === normalizedUserLocation);
}

function canUserAccessHoliday(holidayItem, userCompany, userLocation) {
  const hasLocations = hasAnySelectedLocations(holidayItem);

  // Rule 1: If location is selected, holiday visibility is location-based.
  if (hasLocations) {
    return holidayIncludesUserLocation(holidayItem, userLocation);
  }

  // Rule 2: If location is not selected, holiday visibility is company-based.
  return holidayIncludesUserCompany(holidayItem, userCompany);
}

async function getUserInfo(strapi, ctx) {
  let userId = ctx.state?.user?.id;
  if (!userId) {
    const authHeader = ctx.request?.header?.authorization || ctx.request?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
        if (jwtService) {
          const decoded = await jwtService.verify(token);
          userId = decoded?.id ?? decoded?._id;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }
  if (!userId) return { company: null, workingLocation: null };
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company', 'working_location', 'branch'],
  });
  const company = normalizeCompanyName(user?.company);
  // Strict field mapping avoids stale cross-field values leaking visibility.
  const workingLocation = (
    company === 'AIA'
      ? (user?.branch || '')
      : company === 'Vega'
        ? (user?.working_location || '')
        : ''
  ).trim() || null;
  return { company, workingLocation };
}

module.exports = createCoreController('api::holiday.holiday', ({ strapi }) => ({
  async find(ctx) {
    const { company: userCompany, workingLocation: userLocation } = await getUserInfo(strapi, ctx);

    const all = await strapi.db.query('api::holiday.holiday').findMany({
      where: { publishedAt: { $notNull: true }, active: 'published' },
      orderBy: { date: 'asc' },
      populate: ['companies', 'work_locations'],
    });

    const items = (all || []).filter((h) => canUserAccessHoliday(h, userCompany, userLocation));

    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },
  async findOne(ctx) {
    const { company: userCompany, workingLocation: userLocation } = await getUserInfo(strapi, ctx);

    const id = ctx.params.documentId ?? ctx.params.id;
    if (!id) return ctx.badRequest('Missing holiday id');

    const item = await strapi.db.query('api::holiday.holiday').findOne({
      where: {
        publishedAt: { $notNull: true },
        active: 'published',
        $or: [{ documentId: id }, { id: Number(id) || 0 }],
      },
      populate: ['companies', 'work_locations'],
    });

    if (!item) return ctx.notFound();
    if (!canUserAccessHoliday(item, userCompany, userLocation)) return ctx.notFound();

    ctx.body = { data: item };
  },
}));
