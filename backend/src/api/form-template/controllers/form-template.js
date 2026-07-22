'use strict';

/**
 * form-template controller
 * Filters form templates by authenticated user's company (AIA/Vega).
 */

const { createCoreController } = require('@strapi/strapi').factories;
const getUserCompany = require('../../../utils/getUserCompany');

module.exports = createCoreController('api::form-template.form-template', ({ strapi }) => ({
  async find(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const where = { publishedAt: { $notNull: true }, active: 'published' };
    const query = ctx.query || {};

    const search = String(query.search || '').trim();
    const date = String(query.date || '').trim();
    const page = Math.max(1, Number(query.page || query['pagination[page]'] || 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize || query['pagination[pageSize]'] || 10) || 10));
    const sortParam = String(query.sort || 'createdAt:desc').trim();
    const [sortFieldRaw, sortOrderRaw] = sortParam.split(':');
    const allowedSortFields = new Set(['createdAt', 'updatedAt', 'title']);
    const sortField = allowedSortFields.has(sortFieldRaw) ? sortFieldRaw : 'createdAt';
    const sortOrder = String(sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    if (userCompany) {
      where.company = { name: userCompany };
    }

    if (search) {
      where.title = { $containsi: search };
    }

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        where.createdAt = {
          $gte: start.toISOString(),
          $lt: end.toISOString(),
        };
      }
    }

    const [items, total] = await Promise.all([
      strapi.db.query('api::form-template.form-template').findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        offset: (page - 1) * pageSize,
        limit: pageSize,
        populate: ['form_pdf', 'form_excel', 'form_word', 'company'],
      }),
      strapi.db.query('api::form-template.form-template').count({ where }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    ctx.body = {
      data: items,
      meta: { pagination: { page, pageSize, pageCount, total } },
    };
  },

  async findOne(ctx) {
    const userCompany = await getUserCompany(strapi, ctx);
    const docId = ctx.params.documentId ?? ctx.params.id;
    const where = { publishedAt: { $notNull: true }, active: 'published' };
    if (docId) where.documentId = docId;
    if (userCompany) where.company = { name: userCompany };
    const item = await strapi.db.query('api::form-template.form-template').findOne({
      where,
      populate: ['form_pdf', 'form_excel', 'form_word', 'company'],
    });
    if (!item) {
      return ctx.notFound();
    }
    ctx.body = { data: item };
  },
}));
