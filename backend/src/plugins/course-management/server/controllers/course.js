// @ts-nocheck
'use strict';

/**
 * Course Management controller.
 *
 * Thin HTTP layer: every write goes through the course service, which only uses the
 * Document Service for api::course.course — so the existing document middlewares
 * (group_id lineage, component id generation, duplicate assignment stripping,
 * published-course lock) keep running exactly as they do for the Content Manager.
 */

const COURSE_UID = 'api::course.course';
const CM = 'plugin::content-manager.explorer';

const ACTIONS = {
  read: `${CM}.read`,
  create: `${CM}.create`,
  update: `${CM}.update`,
  delete: `${CM}.delete`,
  publish: `${CM}.publish`,
};

const service = () => strapi.plugin('course-management').service('course');

/** Same RBAC as the Content Manager: the admin role must hold the action on the Course content type. */
function can(ctx, action) {
  const ability = ctx.state?.userAbility;
  if (!ability) return false;
  return ability.can(ACTIONS[action], COURSE_UID);
}

/** Runs handler after the permission check and maps Strapi errors to proper HTTP responses. */
async function guarded(ctx, actions, handler) {
  const required = Array.isArray(actions) ? actions : [actions];
  if (!required.every((a) => can(ctx, a))) {
    return ctx.forbidden('You do not have permission to perform this action on courses.');
  }
  try {
    const body = await handler();
    if (body === null) return ctx.notFound('Course not found');
    ctx.body = body;
  } catch (err) {
    const name = err?.name;
    if (name === 'ValidationError' || name === 'YupValidationError') {
      return ctx.badRequest(err.message, err.details);
    }
    if (name === 'NotFoundError') return ctx.notFound(err.message);
    if (name === 'ForbiddenError') return ctx.forbidden(err.message);
    if (name === 'ApplicationError') return ctx.badRequest(err.message, err.details);
    strapi.log.error(`[course-management] ${ctx.method} ${ctx.path} failed: ${err?.stack || err}`);
    throw err;
  }
}

module.exports = {
  async options(ctx) {
    return guarded(ctx, 'read', () => service().getOptions());
  },

  async find(ctx) {
    return guarded(ctx, 'read', () => service().list(ctx.query || {}));
  },

  async findOne(ctx) {
    return guarded(ctx, 'read', () => service().get(ctx.params.documentId));
  },

  async create(ctx) {
    const data = ctx.request.body?.data;
    return guarded(ctx, 'create', () => service().create(data));
  },

  async update(ctx) {
    const data = ctx.request.body?.data;
    return guarded(ctx, 'update', () => service().update(ctx.params.documentId, data));
  },

  async delete(ctx) {
    return guarded(ctx, 'delete', () => service().remove(ctx.params.documentId));
  },

  async duplicate(ctx) {
    const body = ctx.request.body || {};
    return guarded(ctx, ['read', 'create'], () =>
      service().duplicate(ctx.params.documentId, {
        title: body.title,
        course_version: body.course_version,
      })
    );
  },

  async publish(ctx) {
    return guarded(ctx, 'publish', () => service().publish(ctx.params.documentId));
  },

  async unpublish(ctx) {
    return guarded(ctx, 'publish', () => service().unpublish(ctx.params.documentId));
  },
};
