// @ts-nocheck
'use strict';

/**
 * Course assignment controller. Same RBAC as the Content Manager: the admin role must hold
 * the action on the Course Assignment content type (Settings → Roles).
 */

const ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const CM = 'plugin::content-manager.explorer';

const service = () => strapi.plugin('course-management').service('assignment');

function can(ctx, action) {
  return !!ctx.state?.userAbility?.can(`${CM}.${action}`, ASSIGNMENT_UID);
}

async function guarded(ctx, actions, handler) {
  if (!actions.every((a) => can(ctx, a))) {
    return ctx.forbidden('You do not have permission to manage course assignments.');
  }
  try {
    const body = await handler();
    if (body === null) return ctx.notFound('Assignment not found');
    ctx.body = body;
  } catch (err) {
    const name = err?.name;
    if (name === 'ValidationError' || name === 'YupValidationError' || name === 'ApplicationError') {
      return ctx.badRequest(err.message, err.details);
    }
    if (name === 'NotFoundError') return ctx.notFound(err.message);
    strapi.log.error(`[course-management] ${ctx.method} ${ctx.path} failed: ${err?.stack || err}`);
    throw err;
  }
}

module.exports = {
  async options(ctx) {
    return guarded(ctx, ['read'], () => service().getOptions());
  },

  async courses(ctx) {
    return guarded(ctx, ['read'], () => service().listCourses(ctx.query.company));
  },

  async find(ctx) {
    return guarded(ctx, ['read'], () => service().list({ courseDocumentId: ctx.query.course }));
  },

  async findOne(ctx) {
    return guarded(ctx, ['read'], () => service().get(ctx.params.documentId));
  },

  // Saving always publishes, so learners get the course: needs publish as well.
  async create(ctx) {
    return guarded(ctx, ['create', 'publish'], () => service().create(ctx.request.body?.data));
  },

  async update(ctx) {
    return guarded(ctx, ['update', 'publish'], () => service().update(ctx.params.documentId, ctx.request.body?.data));
  },

  async delete(ctx) {
    return guarded(ctx, ['delete'], () => service().remove(ctx.params.documentId));
  },

  async updateLearnerDueDate(ctx) {
    return guarded(ctx, ['update'], () => service().updateLearnerDueDate(ctx.params.documentId, ctx.request.body?.data));
  },

  async searchUsers(ctx) {
    return guarded(ctx, ['read'], () => service().searchUsers({ companyDocumentId: ctx.query.company, q: ctx.query.q }));
  },

  async usersByIds(ctx) {
    return guarded(ctx, ['read'], () => service().usersByIds(ctx.request.body?.ids));
  },
};
