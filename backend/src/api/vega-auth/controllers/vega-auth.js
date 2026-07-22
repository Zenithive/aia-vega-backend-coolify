'use strict';

const { createAuthUrl, consumeState, exchangeAuthorizationCode, getAuthStatus } = require('../../../utils/vega-graph-auth');

module.exports = {
  // GET /api/vega-auth/status  — check if a refresh token is stored
  async status(ctx) {
    try {
      ctx.send(await getAuthStatus());
    } catch (err) {
      ctx.internalServerError(err.message);
    }
  },

  // GET /api/vega-auth/start  — redirect browser to Microsoft login
  async start(ctx) {
    try {
      const { url } = createAuthUrl();
      ctx.redirect(url);
    } catch (err) {
      ctx.internalServerError(err.message);
    }
  },

  // GET /api/vega-auth/callback  — Microsoft redirects here after login
  async callback(ctx) {
    try {
      const { code, state, error, error_description } = ctx.query;

      if (error) {
        return ctx.badRequest(`Microsoft sign-in failed: ${error} — ${error_description || ''}`);
      }
      if (!code || !state) {
        return ctx.badRequest('Missing OAuth code or state in callback.');
      }

      consumeState(String(state));
      const tokenInfo = await exchangeAuthorizationCode(String(code));

      ctx.send({
        message: 'Microsoft delegated token acquired and stored. Vega sync will now work.',
        obtainedAt: tokenInfo.obtainedAt,
        scope: tokenInfo.scope,
      });
    } catch (err) {
      ctx.internalServerError(err.message);
    }
  },
};
