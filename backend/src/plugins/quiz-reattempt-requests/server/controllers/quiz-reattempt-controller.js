module.exports = ({ strapi }) => ({
  async getCount(ctx) {
    try {
      const count = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').count({
        where: { request_status: 'Pending' },
      });
      ctx.body = { count: count || 0 };
    } catch (error) {
      strapi.log.error('[quiz-reattempt plugin] getCount error:', error);
      ctx.throw(500, error);
    }
  },

  async getRequests(ctx) {
    try {
      const data = await strapi.db.query('api::quiz-reattempt-request.quiz-reattempt-request').findMany({
        populate: ['users_permissions_user', 'course', 'approved_by'],
        orderBy: { createdAt: 'desc' },
      });
      strapi.log.info('[quiz-reattempt plugin] getRequests returning', Array.isArray(data) ? data.length : 0, 'entries');
      ctx.body = { data };
    } catch (error) {
      strapi.log.error('[quiz-reattempt plugin] getRequests error:', error);
      ctx.throw(500, error);
    }
  },

  async updateStatus(ctx) {
    try {
      const { id } = ctx.params;
      const { request_status } = ctx.request.body.data || ctx.request.body || {};

      if (!request_status) {
        return ctx.throw(400, 'request_status is required');
      }

      const updated = await strapi.service('api::quiz-reattempt-request.quiz-reattempt-request').updateStatus(id, request_status);
      ctx.body = { data: updated };
    } catch (error) {
      strapi.log.error('Quiz reattempt updateStatus error:', error?.message || error);
      ctx.throw(500, error?.message || 'Internal Server Error');
    }
  },
});
