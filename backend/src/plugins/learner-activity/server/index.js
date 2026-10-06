const routes = require('./routes');
const controllers = require('./controllers');
const services = require('./services');
const { registerActions, migrateLegacyPermissions } = require('./permissions');

module.exports = {
  register({ strapi }) {
    registerActions(strapi);
    strapi.hook('strapi::content-types.afterSync').register(() => migrateLegacyPermissions(strapi));
  },
  routes,
  controllers,
  services,
};
