'use strict';

/**
 * gallery-item controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::gallery-item.gallery-item', ({ strapi }) => ({
  async findFiltered(ctx) {
    const { company, type, sortBy, search, date, page, pageSize } = ctx.query;
    const companyQuery = company != null ? String(company) : '';
    const typeQuery = type != null ? String(type) : '';
    const sortByQuery = sortBy != null ? String(sortBy) : '';
    const searchQuery = search != null ? String(search) : '';
    const dateQuery = date != null ? String(date) : '';
    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.max(1, Math.min(100, Number(pageSize) || 24));

    // ---- 1) Build where (same pattern as form-template/important-link) ----
    /** @type {any} */
    const where = {
      publishedAt: { $notNull: true },
    };

    if (companyQuery) {
      const upper = companyQuery.trim().toUpperCase();
      const normalizedCompany = upper === 'VEGA' ? 'Vega' : upper === 'AIA' ? 'AIA' : companyQuery.trim();
      where.company = { name: normalizedCompany };
    }

    // Type filter: 'image' | 'video' from frontend
    // In this project schema, the field is `media_type` (enumeration: "Image" | "Video").
    if (typeQuery) {
      const t = typeQuery.toLowerCase();
      const value = t === 'video' ? 'Video' : 'Image';
      where.media_type = value;
    }

    // Search filter: title and description (case-insensitive contains)
    if (searchQuery && searchQuery.trim()) {
      const s = searchQuery.trim();
      where.$or = [
        { title: { $containsi: s } },
        { description: { $containsi: s } },
      ];
    }

    // Date filter: exact day match on `date` field.
    if (dateQuery) {
      const start = new Date(`${dateQuery}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        where.date = {
          $gte: start.toISOString().slice(0, 10),
          $lt: end.toISOString().slice(0, 10),
        };
      }
    }

    // ---- 2) Build sort ----
    let sort = [];
    const normalizedSortBy = sortByQuery.trim().toLowerCase();
    switch (normalizedSortBy) {
      case 'oldest':
        sort = [{ date: 'asc' }, { createdAt: 'asc' }];
        break;
      case 'title a-z':
      case 'title-asc':
        sort = [{ title: 'asc' }];
        break;
      case 'title z-a':
      case 'title-desc':
        sort = [{ title: 'desc' }];
        break;
      case 'latest':
      case 'newest':
      default:
        sort = [{ date: 'desc' }, { createdAt: 'desc' }];
        break;
    }

    // ---- 3) Populate relations/media so frontend has URLs & company name ----
    const populate = {
      image: true,
      video: true,
      company: true,
    };

    const [entities, total] = await Promise.all([
      strapi.db.query('api::gallery-item.gallery-item').findMany({
        where,
        orderBy: /** @type {any} */ (sort),
        populate,
        offset: (pageNum - 1) * pageSizeNum,
        limit: pageSizeNum,
      }),
      strapi.db.query('api::gallery-item.gallery-item').count({ where }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / pageSizeNum));

    ctx.body = {
      data: entities,
      meta: {
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          pageCount,
          total,
        },
      },
    };
  },
}));
