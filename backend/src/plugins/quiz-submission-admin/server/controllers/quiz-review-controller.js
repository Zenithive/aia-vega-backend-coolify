// @ts-nocheck
'use strict';

/**
 * Descriptive answer review. Access follows the Content Manager permissions on
 * "Quiz Submissions" (Settings → Roles): read to view, update to save a review.
 */

const QUIZ_UID = 'api::quiz-submission.quiz-submission';
const CM = 'plugin::content-manager.explorer';

function can(ctx, action) {
  return !!ctx.state?.userAbility?.can(`${CM}.${action}`, QUIZ_UID);
}

async function guarded(strapi, ctx, actions, handler) {
  if (!actions.every((a) => can(ctx, a))) {
    return ctx.forbidden('You do not have permission to review quiz submissions.');
  }
  try {
    ctx.body = await handler();
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'ApplicationError') return ctx.badRequest(err.message, err.details);
    if (err?.name === 'NotFoundError') return ctx.notFound(err.message);
    strapi.log.error(`[quiz-submission-admin] ${ctx.method} ${ctx.path} failed: ${err?.stack || err}`);
    throw err;
  }
}

module.exports = ({ strapi }) => {
  const service = () => strapi.plugin('quiz-submission-admin').service('quizReviewService');

  return {
    async listReviews(ctx) {
      const { company = '', courseId = '', status = '' } = ctx.query || {};
      return guarded(strapi, ctx, ['read'], async () => ({ data: await service().listReviews({ company, courseId, status }) }));
    },

    async getReview(ctx) {
      return guarded(strapi, ctx, ['read'], async () => ({ data: await service().getReview(ctx.params.id) }));
    },

    async saveReview(ctx) {
      return guarded(strapi, ctx, ['read', 'update'], async () => ({
        data: await service().saveReview(ctx.params.id, ctx.request.body || {}, ctx.state.user),
      }));
    },
  };
};
