module.exports = ({ strapi }) => ({
  async getCourses(ctx) {
    try {
      const { company = '' } = ctx.query || {};
      const data = await strapi.plugin('feedback-submission-admin').service('feedbackSubmissionService').getCourses(company);
      ctx.body = { data };
    } catch (error) {
      strapi.log.error('[feedback-submission-admin] getCourses error:', error);
      ctx.throw(500, error?.message || 'Internal Server Error');
    }
  },

  async getSubmissions(ctx) {
    try {
      const { company = '', courseId = '' } = ctx.query || {};
      const data = await strapi
        .plugin('feedback-submission-admin')
        .service('feedbackSubmissionService')
        .getSubmissions({ company, courseId });
      ctx.body = { data };
    } catch (error) {
      strapi.log.error('[feedback-submission-admin] getSubmissions error:', error);
      ctx.throw(500, error?.message || 'Internal Server Error');
    }
  },
});
