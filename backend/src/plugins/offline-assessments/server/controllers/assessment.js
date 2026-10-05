// @ts-nocheck
'use strict';

/**
 * Offline assessments controller. Access follows the Content Manager permissions on
 * "Offline Module Completion" (Settings → Roles), so no separate RBAC needs maintaining.
 */

const OFFLINE_UID = 'api::offline-module-completion.offline-module-completion';
const CM = 'plugin::content-manager.explorer';

const service = () => strapi.plugin('offline-assessments').service('assessment');

function can(ctx, action) {
  return !!ctx.state?.userAbility?.can(`${CM}.${action}`, OFFLINE_UID);
}

async function guarded(ctx, actions, handler) {
  if (!actions.every((a) => can(ctx, a))) {
    return ctx.forbidden('You do not have permission to manage offline module completions.');
  }
  try {
    ctx.body = await handler();
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'ApplicationError') return ctx.badRequest(err.message, err.details);
    if (err?.name === 'NotFoundError') return ctx.notFound(err.message);
    strapi.log.error(`[offline-assessments] ${ctx.method} ${ctx.path} failed: ${err?.stack || err}`);
    throw err;
  }
}

module.exports = {
  async courses(ctx) {
    return guarded(ctx, ['read'], async () => ({ data: await service().listCourses() }));
  },

  async learners(ctx) {
    return guarded(ctx, ['read'], async () => ({
      data: await service().listLearners(ctx.params.documentId, ctx.query.moduleIndex),
    }));
  },

  async saveCompletion(ctx) {
    return guarded(ctx, ['read', 'update'], async () => ({
      data: await service().saveCompletion(ctx.request.body || {}, ctx.state.user),
    }));
  },

  async removeCompletion(ctx) {
    return guarded(ctx, ['update'], async () => ({ data: await service().removeCompletion(ctx.params.id) }));
  },
};
