//@ts-nocheck

'use strict';

const { recordUserLastLogin } = require('../../utils/record-user-last-login');
const customAuthController = require('../../api/auth/controllers/auth');

/**
 * users-permissions plugin extension.
 *
 * Patches the user entity service validation so that an empty or null `email`
 * is accepted (the field is optional for our users).  Strapi's default Yup
 * schema for `email`-type fields generates `.string().email()` without
 * `.nullable()`, which rejects null values even when `required: false`.
 *
 * Strategy: wrap the content-manager update/create routes that Strapi exposes
 * under `/users-permissions/users` to coerce email '' → null before the
 * entity-service layer validates the payload.
 */
module.exports = (plugin) => {
  const originalUpdateUser =
    plugin.controllers?.user?.update?.bind(plugin.controllers.user);
  const originalCreateUser =
    plugin.controllers?.user?.create?.bind(plugin.controllers.user);

  function coerceEmail(ctx) {
    const data = ctx.request?.body;
    if (data && typeof data === 'object') {
      if ('email' in data && (data.email === null || data.email === '')) {
        // Remove the key entirely so Yup's .string() check never sees null
        delete data.email;
      }
    }
  }

  if (originalUpdateUser) {
    plugin.controllers.user.update = async function update(ctx) {
      coerceEmail(ctx);
      return originalUpdateUser(ctx);
    };
  }

  if (originalCreateUser) {
    plugin.controllers.user.create = async function create(ctx) {
      coerceEmail(ctx);
      return originalCreateUser(ctx);
    };
  }

  // users-permissions also registers POST /api/auth/forgot-password (expects { email }).
  // Our flow uses employee ID ({ identifier }) and direct SMTP — override the built-in handler.
  if (typeof customAuthController.forgotPassword === 'function') {
    plugin.controllers.auth.forgotPassword = customAuthController.forgotPassword;
  }

  const originalAuthCallback = plugin.controllers?.auth?.callback?.bind(plugin.controllers.auth);
  if (originalAuthCallback) {
    plugin.controllers.auth.callback = async function authCallback(ctx) {
      await originalAuthCallback(ctx);
      const userId = ctx.body?.user?.id;
      if (!userId) return;
      const status = ctx.status || ctx.response?.status;
      if (status && status >= 400) return;
      try {
        const lastLogin = await recordUserLastLogin(strapi, userId);
        if (ctx.body?.user && lastLogin) ctx.body.user.last_login = lastLogin;
      } catch (e) {
        strapi.log.warn('[last_login] users-permissions callback update failed:', e?.message);
      }
    };
  }

  return plugin;
};
