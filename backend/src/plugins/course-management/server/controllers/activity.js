// @ts-nocheck
'use strict';

/**
 * Feedback and offline module proof. Every handler checks the permission of its area
 * (see ../permissions.js) before calling the service.
 */

const { PLUGIN_ID, AREA_CHECKS } = require('../permissions');

const service = (name) => strapi.plugin(PLUGIN_ID).service(name);

/** Runs the handler when the admin may use the area, mapping service errors to HTTP errors. */
function guarded(area, level, handler) {
  return async (ctx) => {
    const ability = ctx.state?.userAbility;
    if (!ability || !AREA_CHECKS[area][level](ability)) {
      return ctx.forbidden('You do not have permission for this part of Course Management.');
    }
    try {
      ctx.body = await handler(ctx);
    } catch (err) {
      if (err?.name === 'ValidationError' || err?.name === 'ApplicationError') return ctx.badRequest(err.message, err.details);
      if (err?.name === 'NotFoundError') return ctx.notFound(err.message);
      strapi.log.error(`[${PLUGIN_ID}] ${ctx.method} ${ctx.path} failed: ${err?.stack || err}`);
      throw err;
    }
  };
}

module.exports = {
  feedbackCourses: guarded('feedback', 'read', async (ctx) => ({
    data: await service('feedback').getCourses(ctx.query.company || ''),
  })),
  feedbackResponses: guarded('feedback', 'read', async (ctx) => ({
    data: await service('feedback').responses({
      company: ctx.query.company || '',
      course: ctx.query.course || '',
      version: ctx.query.version || '',
    }),
  })),

  offlineCourses: guarded('offline', 'read', async () => ({ data: await service('offline').listCourses() })),
  offlineLearners: guarded('offline', 'read', async (ctx) => ({
    data: await service('offline').listLearners(ctx.params.documentId, ctx.query.moduleIndex),
  })),
  saveOfflineCompletion: guarded('offline', 'update', async (ctx) => ({
    data: await service('offline').saveCompletion(ctx.request.body || {}, ctx.state.user),
  })),
};
