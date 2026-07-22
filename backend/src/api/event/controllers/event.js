'use strict';

/**
 * event controller
 * Filters events by authenticated user's company (AIA/Vega) and location when applicable.
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

function eventHasCompany(eventItem, userCompany) {
  const eventCompanies = Array.isArray(eventItem?.company) ? eventItem.company : [];
  if (eventCompanies.length === 0) return false;
  return eventCompanies.some((c) => normalizeCompanyName(c?.name) === userCompany);
}

function canUserAccessEvent(eventItem, userCompany, userLocation) {
  if (!userCompany) return false;
  if (!eventHasCompany(eventItem, userCompany)) return false;

  if (!eventItem?.event_created_for || eventItem.event_created_for === 'All') {
    return true;
  }

  if (eventItem.event_created_for === 'Location') {
    const evLocations = Array.isArray(eventItem?.work_locations) ? eventItem.work_locations : [];
    if (evLocations.length === 0) return false;
    const normalizedUserLocation = normalizeLocation(userLocation);
    if (!normalizedUserLocation) return false;

    return evLocations.some((loc) => normalizeLocation(loc?.name) === normalizedUserLocation);
  }

  return false;
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
  // AIA users store location in `branch`; Vega users use `working_location`
  const workingLocation = (
    company === 'AIA'
      ? (user?.branch || user?.working_location || '')
      : (user?.working_location || user?.branch || '')
  ).trim() || null;
  return { company, workingLocation };
}

module.exports = createCoreController('api::event.event', ({ strapi }) => ({
  async find(ctx) {
    const { company: userCompany, workingLocation: userLocation } = await getUserInfo(strapi, ctx);

    // No authenticated company means no event visibility.
    if (!userCompany) {
      ctx.body = {
        data: [],
        meta: { pagination: { page: 1, pageSize: 0, pageCount: 0, total: 0 } },
      };
      return;
    }

    const where = {
      publishedAt: { $notNull: true },
      active: 'published',
      company: { name: userCompany },
    };
    const items = await strapi.db.query('api::event.event').findMany({
      where,
      orderBy: { start_date: 'asc' },
      populate: ['event_image', 'company', 'work_locations', 'type_of_event'],
    });

    // Enforce event access rules:
    // - All: users from selected event company can see it
    // - Location: user company must match and user location must match assigned work location
    const filtered = items.filter((ev) => canUserAccessEvent(ev, userCompany, userLocation));

    ctx.body = {
      data: filtered,
      meta: { pagination: { page: 1, pageSize: filtered.length, pageCount: 1, total: filtered.length } },
    };
  },
  async findOne(ctx) {
    const { company: userCompany, workingLocation: userLocation } = await getUserInfo(strapi, ctx);

    if (!userCompany) return ctx.notFound();

    const id = ctx.params.documentId ?? ctx.params.id;
    if (!id) return ctx.badRequest('Missing event id');
    const item = await strapi.db.query('api::event.event').findOne({
      where: {
        publishedAt: { $notNull: true },
        active: 'published',
        $or: [{ documentId: id }, { id: Number(id) || 0 }],
      },
      populate: ['event_image', 'company', 'work_locations', 'type_of_event'],
    });
    if (!item) return ctx.notFound();

    if (!canUserAccessEvent(item, userCompany, userLocation)) {
      return ctx.notFound();
    }

    ctx.body = { data: item };
  },
}));
