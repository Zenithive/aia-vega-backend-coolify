// @ts-nocheck
'use strict';

/**
 * Quiz Management controllers. Every handler checks the permission of its area
 * (see ../permissions.js) before calling the service.
 */

const { PLUGIN_ID, AREA_CHECKS } = require('../permissions');
const { resolveCourseRows } = require('../../../../utils/course-catalog');

const service = (name) => strapi.plugin(PLUGIN_ID).service(name);

function allowed(ctx, area, level = 'read') {
  const ability = ctx.state?.userAbility;
  return !!ability && AREA_CHECKS[area][level](ability);
}

/** Runs the handler when the admin may use the area, mapping service errors to HTTP errors. */
function guarded(area, level, handler) {
  return async (ctx) => {
    if (!allowed(ctx, area, level)) {
      return ctx.forbidden('You do not have permission for this part of Quiz Management.');
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

/** Company + course (lineage key) + optional version (course documentId), as chosen in the filter. */
const filters = (ctx) => ({
  company: ctx.query.company || '',
  course: ctx.query.course || '',
  version: ctx.query.version || '',
});

module.exports = {
  activity: {
    /** Counts of work waiting for the current admin; areas they cannot open are left out. */
    async summary(ctx) {
      const data = {};
      if (allowed(ctx, 'reattempts')) data.pendingReattempts = await service('reattempts').countPending();
      if (allowed(ctx, 'answerReview')) data.pendingReviews = await service('answerReview').countPending();
      ctx.body = { data };
    },

    quizCourses: guarded('quizResults', 'read', async (ctx) => ({
      data: await service('quizResults').getCourses(ctx.query.company || ''),
    })),
    quizLearners: guarded('quizResults', 'read', async (ctx) => ({
      data: await service('quizResults').learnerModules(filters(ctx)),
    })),
    quizAttempts: guarded('quizResults', 'read', async (ctx) => ({
      data: await service('quizResults').attempts({
        userId: ctx.query.userId,
        courseDocumentId: ctx.query.courseDocumentId,
        moduleId: ctx.query.moduleId,
      }),
    })),
    // One attempt with every question and answer (same detail as answer review, read-only here).
    quizAttempt: guarded('quizResults', 'read', async (ctx) => ({
      data: await service('answerReview').getReview(ctx.params.id),
    })),
    quizExport: guarded('quizResults', 'read', async (ctx) => ({
      data: await service('quizResults').exportAnswers(filters(ctx)),
    })),

    // Answer review lists courses the same way as quiz results, but under its own permission.
    reviewCourses: guarded('answerReview', 'read', async (ctx) => ({
      data: await service('quizResults').getCourses(ctx.query.company || ''),
    })),
    listReviews: guarded('answerReview', 'read', async (ctx) => ({
      data: await service('answerReview').listReviews({
        company: ctx.query.company || '',
        courseRowIds: await resolveCourseRows(strapi, filters(ctx)),
        status: ctx.query.status || '',
      }),
    })),
    getReview: guarded('answerReview', 'read', async (ctx) => ({
      data: await service('answerReview').getReview(ctx.params.id),
    })),
    saveReview: guarded('answerReview', 'update', async (ctx) => ({
      data: await service('answerReview').saveReview(ctx.params.id, ctx.request.body || {}, ctx.state.user),
    })),

    listReattempts: guarded('reattempts', 'read', async () => ({ data: await service('reattempts').list() })),
  },
};
