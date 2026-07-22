'use strict';

/**
 * unit-location controller
 * Filters locations by authenticated user's company (AIA/Vega).
 */

const { createCoreController } = require('@strapi/strapi').factories;
const getUserCompany = require('../../../utils/getUserCompany');

module.exports = createCoreController('api::unit-location.unit-location', ({ strapi }) => ({
  async find(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const where = { publishedAt: { $notNull: true }, active: 'published' };
    if (userCompany) {
      where.company = { name: userCompany };
    }
    const items = await strapi.db.query('api::unit-location.unit-location').findMany({
      where,
      orderBy: { name: 'asc' },
      populate: ['company', 'city'],
    });
    ctx.body = {
      data: items,
      meta: { pagination: { page: 1, pageSize: items.length, pageCount: 1, total: items.length } },
    };
  },

  async findOne(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const docId = ctx.params.documentId ?? ctx.params.id;
    const where = {
      documentId: docId,
      publishedAt: { $notNull: true },
      active: 'published',
    };
    if (userCompany) {
      where.company = { name: userCompany };
    }
    const exists = await strapi.db.query('api::unit-location.unit-location').findOne({
      where,
      select: ['id'],
    });
    if (!exists) {
      return ctx.notFound();
    }
    return super.findOne(ctx);
  },
}));
