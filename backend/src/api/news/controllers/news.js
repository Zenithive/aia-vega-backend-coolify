'use strict';

/**
 * news controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

function ensurePublishDateNotPast(data) {
  const pub = data?.publish_date ?? data?.published_date ?? data?.publishedDate;
  if (!pub) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(pub);
  d.setHours(0, 0, 0, 0);
  if (d < today) {
    throw new Error('Please select current or future date.');
  }
}

/** Get the authenticated user's company name (lowercase) from DB. */
async function getUserCompany(strapi, userId) {
  if (!userId) return null;
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company'],
  });
  return (user?.company || '').trim().toLowerCase() || null;
}

/** Populate config used for all news DB queries. */
const NEWS_POPULATE = {
  cover_image: true,
  news_category: true,
  likes: true,
  company: { select: ['id', 'name'] },
};

function applyCompanyFilter(newsItems, userCompany) {
  if (!userCompany) return newsItems;
  return newsItems.filter((item) => {
    const companies = Array.isArray(item.company) ? item.company : [];
    if (companies.length === 0) return true;
    return companies.some((c) => (c?.name || '').toLowerCase() === userCompany);
  });
}

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async find(ctx) {
    try {
      const userCompany = await getUserCompany(strapi, ctx.state?.user?.id);
      const query = ctx.query || {};
      const page = Math.max(1, Number(query.page || query['pagination[page]'] || 1) || 1);
      const pageSize = Math.max(1, Math.min(100, Number(query.pageSize || query['pagination[pageSize]'] || 9) || 9));

      const where = { publishedAt: { $notNull: true }, active: 'published' };
      const filters = query.filters && typeof query.filters === 'object' ? query.filters : {};
      const catName = query['filters[news_category][name][$eq]'] ?? filters['news_category']?.name?.$eq;
      const catId = query['filters[news_category][id][$eq]'] ?? filters['news_category']?.id?.$eq;
      if (catName) {
        where.news_category = { name: catName };
      } else if (catId != null) {
        const id = Number(catId);
        if (!Number.isNaN(id)) where.news_category = { id };
      }

      const [newsItems, total] = await Promise.all([
        strapi.db.query('api::news.news').findMany({
          populate: NEWS_POPULATE,
          where,
          orderBy: { publishedAt: 'desc' },
          offset: (page - 1) * pageSize,
          limit: pageSize,
        }),
        strapi.db.query('api::news.news').count({ where }),
      ]);

      const filtered = applyCompanyFilter(newsItems, userCompany);
      const pageCount = Math.max(1, Math.ceil(total / pageSize));

      ctx.body = {
        data: filtered,
        meta: { pagination: { page, pageSize, pageCount, total } },
      };
    } catch (error) {
      strapi.log.error('News find error:', error);
      ctx.status = 500;
      ctx.body = { error: { message: 'Failed to fetch news' } };
    }
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    try {
      const item = await strapi.db.query('api::news.news').findOne({
        where: {
          $and: [
            { $or: [{ documentId: id }, { id: Number(id) || 0 }] },
            { publishedAt: { $notNull: true } },
            { active: 'published' },
          ],
        },
        populate: NEWS_POPULATE,
      });
      if (!item) return ctx.notFound('News not found');
      ctx.body = { data: item };
    } catch (error) {
      strapi.log.error('News findOne error:', error);
      ctx.status = 500;
      ctx.body = { error: { message: 'Failed to fetch news item' } };
    }
  },
  async create(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.create(ctx);
  },
  async update(ctx) {
    const body = ctx.request?.body?.data ?? ctx.request?.body ?? {};
    ensurePublishDateNotPast(body);
    return super.update(ctx);
  },

  /**
   * Like a news item (add current user to likes).
   * Same user cannot like again – we read likes from DB (same source as likes-state).
   * POST /api/news/:id/like
   */
  async like(ctx) {
    try {
      const user = ctx.state?.user;
      if (!user || !user.id) {
        return ctx.unauthorized('Authentication required');
      }

      const { id } = ctx.params;
      if (!id) {
        return ctx.badRequest('News ID is required');
      }

      // Read current likes from DB (same as likes-state) so we never double-add
      const news = await strapi.db.query('api::news.news').findOne({
        where: { documentId: id },
        populate: { likes: true },
      });

      if (!news) {
        return ctx.notFound('News not found');
      }

      const currentLikeIds = (news.likes || []).map((u) => (u && (u.id ?? u.documentId))).filter(Boolean);
      const alreadyLiked = currentLikeIds.some(
        (uid) => Number(uid) === Number(user.id) || String(uid) === String(user.documentId)
      );
      if (alreadyLiked) {
        ctx.body = { success: true, message: 'Already liked', likesCount: currentLikeIds.length };
        return;
      }

      const updatedLikeIds = [...currentLikeIds.map((uid) => Number(uid)).filter((n) => !Number.isNaN(n)), user.id];
      await strapi.entityService.update('api::news.news', news.id, {
        data: { likes: /** @type {*} */ (updatedLikeIds) },
      });
      // Notification + email: Admin (all) and HR Admin (news_liked)
      const meta = { newsId: id, userId: user.id };
      const notifUtil = strapi['utils']?.notification;
      if (notifUtil) {
        await notifUtil.sendNotification(
          'news_liked',
          'News Liked',
          `A user liked a news item.`,
          [],
          meta,
          ['admin', 'HRadmin'],
          { sendEmail: true, sendSocket: true }
        );
      }

      ctx.body = { success: true, message: 'News liked', likesCount: updatedLikeIds.length };
    } catch (error) {
      strapi.log.error('News like error:', error);
      ctx.body = { success: false, error: error?.message || 'Failed to like news' };
      ctx.status = 500;
    }
  },

  /**
   * Unlike a news item (remove current user from likes).
   * POST /api/news/:id/unlike
   */
  async unlike(ctx) {
    try {
      const user = ctx.state?.user;
      if (!user || !user.id) {
        return ctx.unauthorized('Authentication required');
      }

      const { id } = ctx.params;
      if (!id) {
        return ctx.badRequest('News ID is required');
      }

      // Read current likes from DB (same source as like() and likes-state)
      const news = await strapi.db.query('api::news.news').findOne({
        where: { documentId: id },
        populate: { likes: true },
      });

      if (!news) {
        return ctx.notFound('News not found');
      }

      const currentLikeIds = (news.likes || []).map((u) => (u && (u.id ?? u.documentId))).filter(Boolean);
      const updatedLikeIds = currentLikeIds
        .filter((uid) => Number(uid) !== Number(user.id) && String(uid) !== String(user.documentId))
        .map((uid) => Number(uid))
        .filter((n) => !Number.isNaN(n));
      await strapi.entityService.update('api::news.news', news.id, {
        data: { likes: updatedLikeIds },
      });

      ctx.body = { success: true, message: 'News unliked', likesCount: updatedLikeIds.length };
    } catch (error) {
      strapi.log.error('News unlike error:', error);
      ctx.body = { success: false, error: error?.message || 'Failed to unlike news' };
      ctx.status = 500;
    }
  },

  /**
   * Resolve portal user from JWT when route has auth: false (so we still get correct "liked" when token sent).
   */
  async _getUserFromToken(ctx) {
    const authHeader = ctx.request?.header?.authorization || ctx.request?.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    try {
      const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
      if (!jwtService) return null;
      const decoded = await jwtService.verify(token);
      const userId = decoded?.id ?? decoded?._id;
      if (!userId) return null;
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: userId },
        select: ['id'],
      });
      return user || null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Get like counts for multiple news items (for listing/cards).
   * GET /api/news-items/likes-counts?documentIds=id1,id2,id3
   */
  async likesCounts(ctx) {
    try {
      const raw = ctx.query?.documentIds || ctx.request?.query?.documentIds || '';
      const documentIds = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [])
        .map((id) => (id && String(id).trim()) || null)
        .filter(Boolean);
      if (documentIds.length === 0) {
        ctx.body = {};
        return;
      }

      const list = await strapi.db.query('api::news.news').findMany({
        where: { documentId: { $in: documentIds } },
        populate: { likes: true },
      });

      const counts = {};
      for (const doc of list || []) {
        const id = doc.documentId || doc.id;
        if (id) counts[id] = Array.isArray(doc.likes) ? doc.likes.length : 0;
      }
      for (const id of documentIds) {
        if (!(id in counts)) counts[id] = 0;
      }
      ctx.body = counts;
    } catch (error) {
      strapi.log.error('News likesCounts error:', error);
      ctx.body = { error: error?.message || 'Failed to load likes counts' };
      ctx.status = 500;
    }
  },

  /**
   * Get likes count and whether current user liked this news.
   * GET /api/news-items/:id/likes-state (auth: false; optional Bearer for "liked")
   */
  async likesState(ctx) {
    try {
      let user = ctx.state?.user || null;
      if (!user) user = await this._getUserFromToken(ctx);
      const { id } = ctx.params;
      if (!id) {
        return ctx.badRequest('News ID is required');
      }

      // Read directly from DB by documentId to avoid any content-API sanitization issues.
      const news = await strapi.db.query('api::news.news').findOne({
        where: { documentId: id },
        populate: { likes: true },
      });

      if (!news) {
        return ctx.notFound('News not found');
      }

      const likes = Array.isArray(news.likes) ? news.likes : [];
      const likesCount = likes.length;
      const liked = user
        ? likes.some((u) => u && Number(u.id) === Number(user.id))
        : false;

      ctx.body = { likesCount, liked };
    } catch (error) {
      strapi.log.error('News likesState error:', error);
      ctx.body = { error: error?.message || 'Failed to load likes state' };
      ctx.status = 500;
    }
  },
}));
