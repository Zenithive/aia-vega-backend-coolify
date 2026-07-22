module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', ''),
  cron: {
    enabled: env.bool('CRON_ENABLED', true),
  },
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // Trust X-Forwarded-* only in production (behind nginx / load balancer). Local dev unchanged.
  proxy: {
    koa: env('NODE_ENV') === 'production',
  },
  // Node default requestTimeout is 300000 ms (5 min) — too low for large video uploads.
  http: {
    serverOptions: {
      requestTimeout: 0,
      headersTimeout: 0,
      keepAliveTimeout: 5 * 60 * 1000,
    },
  },
  // NOTE: watchIgnoreFiles belongs in config/admin.js (Strapi 4/5), not here.
});
