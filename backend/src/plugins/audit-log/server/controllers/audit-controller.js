module.exports = ({ strapi }) => ({
  async getLogs(ctx) {
    try {
    const {
      page = 1,
      pageSize = 25,
      dateFrom,
      dateTo,
      contentType,
      action,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      company,
      search,
    } = ctx.query;

    const result = await strapi.plugin('audit-log').service('auditService').getAuditLogs({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      dateFrom,
      dateTo,
      contentType,
      action,
      sortBy,
      sortOrder,
      company,
      search,
    });

      ctx.body = result;
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  async getContentTypes(ctx) {
    try {
      const contentTypes = await strapi.plugin('audit-log').service('auditService').getAvailableContentTypes();
      ctx.body = contentTypes;
    } catch (error) {
      ctx.throw(500, error);
    }
  },
});
