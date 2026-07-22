'use strict';

/**
 * notification controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::notification.notification', ({ strapi }) => ({
  /**
   * Resolve portal user from users-permissions JWT when ctx.state.user is not set
   */
  async getPortalUserFromToken(ctx) {
    const authHeader = ctx.request?.header?.authorization || ctx.request?.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    try {
      const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
      if (!jwtService) return null;
      const decoded = await jwtService.verify(token);
      const userId = decoded?.id || decoded?._id;
      if (!userId) return null;
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: userId },
        select: ['id', 'email'],
      });
      return user || null;
    } catch (e) {
      strapi.log.error('[notification.my] JWT verify failed:', e?.message || e);
      return null;
    }
  },

  /**
   * Get notifications for the currently authenticated portal user.
   * Unread only (for bell dropdown).
   * GET /api/notifications/me
   */
  async my(ctx) {
    let user = ctx.state.user;
    if (!user || !user.id) {
      user = await this.getPortalUserFromToken(ctx);
    }
    if (!user || !user.id) {
      return ctx.unauthorized('Authentication required');
    }

    const limit = Math.min(Number(ctx.query?.limit) || 50, 200);
    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      return ctx.unauthorized('Invalid user');
    }

    const notifications = await strapi.db
      .query('api::notification.notification')
      .findMany({
        where: { toUser: userId, is_read: false },
        orderBy: { createdAt: 'desc' },
        limit,
      });

    ctx.send({
      data: (notifications || []).map((n) => ({
        ...n,
        id: n.id ?? n.documentId,
      })),
    });
  },

  /**
   * Get all notifications (read + unread) for the current user.
   * GET /api/notifications/me/all
   * Query params: page (1-based), pageSize (default 20, max 100)
   */
  async myAll(ctx) {
    let user = ctx.state.user;
    if (!user || !user.id) {
      user = await this.getPortalUserFromToken(ctx);
    }
    if (!user || !user.id) {
      return ctx.unauthorized('Authentication required');
    }

    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      return ctx.unauthorized('Invalid user');
    }

    const pageSize = Math.min(Math.max(Number(ctx.query?.pageSize) || 20, 1), 100);
    const page     = Math.max(Number(ctx.query?.page) || 1, 1);
    const offset   = (page - 1) * pageSize;

    const where = { toUser: userId };

    const [notifications, total] = await Promise.all([
      strapi.db.query('api::notification.notification').findMany({
        where,
        orderBy: { createdAt: 'desc' },
        limit: pageSize,
        offset,
      }),
      strapi.db.query('api::notification.notification').count({ where }),
    ]);

    ctx.send({
      data: (notifications || []).map((n) => ({
        ...n,
        id: n.id ?? n.documentId,
      })),
      meta: {
        pagination: {
          page,
          pageSize,
          total,
          pageCount: Math.ceil(total / pageSize),
        },
      },
    });
  },

  /**
   * Mark one or more notifications as read for the current user.
   * POST /api/notifications/mark-read
   * body: { id: number } or { ids: number[] }
   */
  async markRead(ctx) {
    let user = ctx.state.user;
    if (!user || !user.id) {
      user = await this.getPortalUserFromToken(ctx);
    }
    if (!user || !user.id) {
      return ctx.unauthorized('Authentication required');
    }

    const body = ctx.request?.body || {};
    let ids = body.ids || (body.id != null ? [body.id] : []);
    if (!Array.isArray(ids)) ids = [ids];
    ids = ids
      .map((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      })
      .filter(Boolean);

    if (!ids.length) {
      return ctx.badRequest('id or ids required');
    }

    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      return ctx.unauthorized('Invalid user');
    }
    try {
      for (const id of ids) {
        try {
          await strapi.db.query('api::notification.notification').update({
            where: {
              id,
              toUser: userId,
            },
            data: { is_read: true },
          });
        } catch (innerErr) {
          strapi.log.error('[notification.markRead] update failed for id', id, innerErr?.message || innerErr);
        }
      }
    } catch (e) {
      strapi.log.error('[notification.markRead] bulk update failed:', e?.message || e);
      return ctx.internalServerError('Failed to mark notifications as read');
    }

    ctx.send({ success: true });
  },
}));
