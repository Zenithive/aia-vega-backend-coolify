'use strict';

const jwt = require('jsonwebtoken');

/**
 * Local plugin (server part)
 *
 * - Registers an Administration Panel permission action that we can assign to roles.
 * - This is upgrade-safe and does NOT touch Strapi core or node_modules.
 * - Adds a custom upload route that allows direct file uploads without Media Library permissions.
 * - Section config API for super admin to customize All Modules sections.
 */

async function getAdminUserFromToken(ctx, strapi) {
  const authHeader = ctx.request?.header?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const secret = strapi.config.get('admin.auth.secret');
    if (!secret) return null;
    const decoded = jwt.verify(token, secret);
    const userId = decoded?.id ?? decoded?.userId;
    if (!userId) return null;
    const adminUser = await strapi.db.query('admin::user').findOne({
      where: { id: userId },
      populate: ['roles'],
    });
    return adminUser || null;
  } catch {
    return null;
  }
}

const DEFAULT_SECTION_CONFIG = {
  defaultSection: 'other',
  sections: [
    { id: 'org', title: 'Organization', icon: 'Briefcase', collectionUids: ['api::company.company', 'api::company-policy.company-policy', 'api::department.department', 'api::designation.designation'] },
    { id: 'hr', title: 'HR Management', icon: 'User', collectionUids: ['plugin::users-permissions.user', 'api::activity-log.activity-log', 'api::holiday.holiday', 'api::gallery-item.gallery-item', 'api::form-template.form-template'] },
    { id: 'location', title: 'Location Management', icon: 'PinMap', collectionUids: ['api::area.area', 'api::unit-location.unit-location', 'api::route.route'] },
    { id: 'content', title: 'Content & Communication', icon: 'Message', collectionUids: ['api::notification.notification', 'api::news.news', 'api::news-category.news-category', 'api::event.event', 'api::important-link.important-link'] },
    { id: 'learning', title: 'Learning Management', icon: 'Book', collectionUids: ['api::course.course', 'api::course-category.course-category', 'api::course-assignment.course-assignment'] },
    { id: 'quiz', title: 'Quiz Management', icon: 'Question', collectionUids: ['api::quizze.quizze', 'api::quiz-submission.quiz-submission', 'api::user-progress.user-progress'] },
    { id: 'other', title: 'Other', icon: 'Cog', collectionUids: [] },
  ],
};

module.exports = {
  register({ strapi }) {
    /**
     * Register a custom admin permission action.
     *
     * Admin permissions live under "Settings → Administration Panel → Roles".
     * We'll use this permission to control who can see the "All Modules" sidebar entry.
     */
    strapi.admin.services.permission.actionProvider.registerMany([
      {
        section: 'plugins',
        displayName: 'Access All Modules sidebar',
        uid: 'read', // action uid => plugin::modules-sidebar.read
        pluginName: 'modules-sidebar',
      },
      {
        section: 'plugins',
        displayName: 'Direct upload files',
        uid: 'upload',
        pluginName: 'modules-sidebar',
      },
      {
        section: 'plugins',
        displayName: 'Configure section layout',
        uid: 'configure',
        pluginName: 'modules-sidebar',
      },
    ]);
  },

  bootstrap({ strapi }) {
    /**
     * Custom upload route that bypasses Media Library permissions
     * This allows HR/LM Admin to upload files directly without accessing Media Library
     */
    strapi.server.routes([
      {
        method: 'POST',
        path: '/modules-sidebar/upload',
        handler: async (ctx) => {
          try {
            // Check if user is authenticated (required for any upload)
            if (!ctx.state.user) {
              return ctx.unauthorized('You must be authenticated to upload files');
            }

            // Get uploaded files from the request
            const { files } = ctx.request;
            
            if (!files || !files.files) {
              return ctx.badRequest('No files provided');
            }

            // Use Strapi's upload service to handle the file upload
            // This bypasses Media Library permission checks
            const uploadedFiles = await strapi.plugin('upload').service('upload').upload({
              data: ctx.request.body.fileInfo ? JSON.parse(ctx.request.body.fileInfo) : {},
              files: Array.isArray(files.files) ? files.files : [files.files],
            });

            // Return the uploaded file(s) in the same format as Media Library
            ctx.body = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
          } catch (error) {
            strapi.log.error('Direct upload error:', error);
            ctx.throw(500, `Upload failed: ${error.message}`);
          }
        },
        config: {
          auth: {
            scope: ['authenticated'],
          },
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/modules-sidebar/content-types',
        handler: async (ctx) => {
          try {
            const contentTypes = strapi.contentTypes;
            const collectionTypes = Object.entries(contentTypes)
              .filter(([uid, ct]) => {
                if (ct.kind !== 'collectionType') return false;
                if (uid.startsWith('api::')) return true;
                if (uid === 'plugin::users-permissions.user') return true;
                return false;
              })
              .map(([uid, ct]) => ({
                uid,
                displayName: ct.info?.displayName || ct.info?.singularName || uid,
              }))
              .sort((a, b) => a.displayName.localeCompare(b.displayName));
            ctx.body = { collectionTypes };
          } catch (error) {
            strapi.log.error('modules-sidebar content-types error:', error);
            ctx.throw(500, error.message);
          }
        },
        config: { auth: false, policies: [] },
      },
      {
        method: 'GET',
        path: '/modules-sidebar/section-config',
        handler: async (ctx) => {
          try {
            const store = strapi.store({ type: 'plugin', name: 'modules-sidebar' });
            const config = await store.get({ key: 'sectionConfig' });
            ctx.body = config || DEFAULT_SECTION_CONFIG;
          } catch (error) {
            strapi.log.error('modules-sidebar section-config GET error:', error);
            ctx.body = DEFAULT_SECTION_CONFIG;
          }
        },
        config: { auth: false, policies: [] },
      },
      {
        method: 'PUT',
        path: '/modules-sidebar/section-config',
        handler: async (ctx) => {
          try {
            let adminUser = ctx.state?.user || ctx.state?.admin;
            if (!adminUser) {
              adminUser = await getAdminUserFromToken(ctx, strapi);
              if (adminUser) ctx.state.admin = adminUser;
            }
            if (!adminUser) return ctx.unauthorized('Authentication required');
            let roles = adminUser.roles || [];
            if (roles.length === 0 && adminUser.role) roles = [adminUser.role];
            const isSuperAdmin = roles.some((r) => {
              const n = (r?.name || r?.displayName || '').toLowerCase();
              return n === 'super admin' || n.includes('super admin');
            });
            if (!isSuperAdmin) return ctx.forbidden('Only Super Admin can modify section configuration');
            const body = ctx.request?.body;
            if (!body || typeof body !== 'object') return ctx.badRequest('Invalid config');
            const store = strapi.store({ type: 'plugin', name: 'modules-sidebar' });
            await store.set({ key: 'sectionConfig', value: body });
            ctx.body = { success: true };
          } catch (error) {
            strapi.log.error('modules-sidebar section-config PUT error:', error);
            ctx.throw(500, error.message);
          }
        },
        config: { auth: false, policies: [] },
      },
      {
        method: 'GET',
        path: '/modules-sidebar/admin-notifications',
        handler: async (ctx) => {
          try {
            let adminUser = ctx.state?.user || ctx.state?.admin;
            if (!adminUser) {
              adminUser = await getAdminUserFromToken(ctx, strapi);
              if (adminUser) ctx.state.admin = adminUser;
            }
            if (!adminUser) return ctx.unauthorized('Authentication required');

            const adminId = adminUser.id;
            const limit = Math.min(Number(ctx.query?.limit) || 100, 200);
            const notifications = await strapi.db.query('api::notification.notification').findMany({
              where: { admin_user: adminId },
              orderBy: { createdAt: 'desc' },
              limit,
            });

            const notifUtil = strapi.utils?.notification;
            const enriched = await Promise.all(
              (notifications || []).map(async (n) => {
                const meta = n.meta || {};
                const enrichedMeta = notifUtil?.enrichMeta
                  ? await notifUtil.enrichMeta(meta)
                  : meta;
                return {
                  id: n.id,
                  documentId: n.documentId,
                  type: n.type,
                  title: n.title,
                  message: n.message,
                  is_read: n.is_read,
                  meta: enrichedMeta,
                  createdAt: n.createdAt,
                };
              })
            );

            ctx.body = { data: enriched };
          } catch (error) {
            strapi.log.error('modules-sidebar admin-notifications error:', error);
            ctx.throw(500, error.message);
          }
        },
        config: { auth: false, policies: [] },
      },
      {
        method: 'GET',
        path: '/modules-sidebar/admin-notifications/count',
        handler: async (ctx) => {
          try {
            let adminUser = ctx.state?.user || ctx.state?.admin;
            if (!adminUser) {
              adminUser = await getAdminUserFromToken(ctx, strapi);
              if (adminUser) ctx.state.admin = adminUser;
            }
            if (!adminUser) return ctx.unauthorized('Authentication required');

            // `since` is an ISO timestamp from the client's localStorage (last visit time).
            // Count only notifications for this admin created after that timestamp.
            const since = ctx.query?.since ? new Date(ctx.query.since) : null;
            const where = { admin_user: adminUser.id };
            if (since && !isNaN(since.getTime())) {
              where.createdAt = { $gt: since };
            }

            const count = await strapi.db.query('api::notification.notification').count({ where });

            ctx.body = { count: count || 0 };
          } catch (error) {
            strapi.log.error('modules-sidebar admin-notifications/count error:', error);
            ctx.throw(500, error.message);
          }
        },
        config: { auth: false, policies: [] },
      },
      {
        method: 'POST',
        path: '/modules-sidebar/admin-notifications/mark-all-read',
        handler: async (ctx) => {
          try {
            let adminUser = ctx.state?.user || ctx.state?.admin;
            if (!adminUser) {
              adminUser = await getAdminUserFromToken(ctx, strapi);
              if (adminUser) ctx.state.admin = adminUser;
            }
            if (!adminUser) return ctx.unauthorized('Authentication required');

            await strapi.db.query('api::notification.notification').updateMany({
              where: { admin_user: adminUser.id, is_read: false },
              data: { is_read: true },
            });

            ctx.body = { success: true };
          } catch (error) {
            strapi.log.error('modules-sidebar admin-notifications/mark-all-read error:', error);
            ctx.throw(500, error.message);
          }
        },
        config: { auth: false, policies: [] },
      },
    ]);
  },
};

