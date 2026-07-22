module.exports = ({ strapi }) => ({
  async getCourses(ctx) {
    try {
      const { company = '' } = ctx.query || {};
      const data = await strapi.plugin('quiz-submission-admin').service('quizSubmissionService').getCourses(company);
      ctx.body = { data };
    } catch (error) {
      strapi.log.error('[quiz-submission-admin] getCourses error:', error);
      ctx.throw(500, error?.message || 'Internal Server Error');
    }
  },

  async getSubmissions(ctx) {
    try {
      const { company = '', courseId = '' } = ctx.query || {};
      const data = await strapi
        .plugin('quiz-submission-admin')
        .service('quizSubmissionService')
        .getSubmissions({ company, courseId });
      ctx.body = { data };
    } catch (error) {
      strapi.log.error('[quiz-submission-admin] getSubmissions error:', error);
      ctx.throw(500, error?.message || 'Internal Server Error');
    }
  },
});
