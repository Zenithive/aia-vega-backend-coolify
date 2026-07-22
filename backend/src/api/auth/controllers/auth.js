// @ts-nocheck
'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { recordUserLastLogin } = require('../../../utils/record-user-last-login');
const {
  isEmailEnabled,
  buildForgotPasswordEmailHtml,
  buildForgotPasswordPlainText,
} = require('../../../utils/email-template');

function createSmtpTransporter() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true';
  const username = String(process.env.SMTP_USERNAME || '').trim();
  const password = String(process.env.SMTP_PASSWORD || '').trim();

  if (!host) {
    throw new Error('SMTP_HOST is not configured');
  }

  const transporterConfig = {
    host,
    port,
    secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };

  if (username && password) {
    transporterConfig.auth = { user: username, pass: password };
  }

  return nodemailer.createTransport(transporterConfig);
}

function buildResetPasswordUrl(resetCode) {
  const base = String(
    process.env.FRONTEND_RESET_PASSWORD_URL ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      'http://localhost:3000/reset-password'
  ).trim();
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}code=${encodeURIComponent(resetCode)}`;
}

async function sendForgotPasswordEmail({ to, username, resetCode }) {
  const transporter = createSmtpTransporter();
  const fromAddress =
    String(process.env.EMAIL_FROM || '').trim() ||
    String(process.env.SMTP_USERNAME || '').trim() ||
    'noreply@example.com';
  const replyToAddress = String(process.env.EMAIL_REPLY_TO || '').trim() || fromAddress;
  const resetUrl = buildResetPasswordUrl(resetCode);
  const safeName = String(username || '').trim() || 'User';
  const subject = 'Reset your password';
  const text = buildForgotPasswordPlainText({ username: safeName, resetUrl });
  const html = buildForgotPasswordEmailHtml({ username: safeName, resetUrl });

  await transporter.sendMail({
    from: fromAddress,
    to,
    replyTo: replyToAddress,
    subject,
    text,
    html,
  });
}

/**
 * Helper: extracts and verifies the frontend JWT from the Authorization header.
 * Returns the frontend user object (with email), or null if invalid/missing.
 */
async function getVerifiedFrontendUser(ctx) {
  const authHeader = ctx.request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  try {
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const decoded = await jwtService.verify(token);
    const userId = decoded?.id;
    if (!userId) return null;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      select: ['id', 'email'],
    });
    return user || null;
  } catch {
    return null;
  }
}

/**
 * Helper: find an admin panel user by email (case-insensitive).
 * Uses the admin user service in Strapi v5.
 */
async function findAdminUserByEmail(email) {
  try {
    // Strapi v5: use admin user service's findOneByEmail
    const adminUserService = strapi.service('admin::user');
    const adminUser = await adminUserService.findOneByEmail(email.toLowerCase());
    return adminUser || null;
  } catch {
    // Fallback: direct db query
    try {
      return await strapi.db.query('admin::user').findOne({
        where: { email: { $eqi: email } },
        select: ['id', 'email', 'isActive'],
      });
    } catch {
      return null;
    }
  }
}

module.exports = {
  
  async forgotPassword(ctx) {
  try {
    const identifier = String(
      ctx.request?.body?.identifier || ctx.request?.body?.email || ''
    ).trim();
    if (!identifier) {
      return ctx.badRequest('identifier is required', {
        errorCode: 'IDENTIFIER_REQUIRED',
      });
    }

    const userQuery = strapi.db.query('plugin::users-permissions.user');
    const user =
      (await userQuery.findOne({
        where: { emp_code: identifier },
        select: ['id', 'email', 'username', 'active', 'blocked'],
      })) ||
      (await userQuery.findOne({
        where: { emp_id: identifier },
        select: ['id', 'email', 'username', 'active', 'blocked'],
      })) ||
      (await userQuery.findOne({
        where: { email: { $eqi: identifier } },
        select: ['id', 'email', 'username', 'active', 'blocked'],
      }));

    // Wrong ID
    if (!user) {
      return ctx.badRequest('The Employee ID you entered is incorrect. Please try again.', {
        errorCode: 'INVALID_IDENTIFIER',
        invalidIdentifier: true,
      });
    }

    // Optional: keep this separate if you want explicit inactive/blocked handling
    if (user.active === false || user.blocked === true) {
      return ctx.badRequest('Your account is inactive or blocked. Please contact Admin.', {
        errorCode: 'USER_INACTIVE_OR_BLOCKED',
      });
    }

    const email = String(user.email || '').trim();

    // ID exists, but no email
    if (!email) {
      return ctx.badRequest(
        'The Employee ID you have entered, does not have a personal email id registered against it. Contact an IT team representative to help you with this process.',
        {
          errorCode: 'NO_EMAIL',
          hasEmail: false,
          emailSent: false,
        }
      );
    }

    const resetCode = crypto.randomBytes(32).toString('hex');

    await strapi.entityService.update('plugin::users-permissions.user', user.id, {
      data: { resetPasswordToken: resetCode },
    });

    await sendForgotPasswordEmail({
      to: email,
      username: user.username,
      resetCode,
    });

    return ctx.send({
      success: true,
      hasEmail: true,
      emailSent: true,
      message: 'Password reset email sent.',
    });
  } catch (err) {
    strapi.log.error('forgotPassword error:', err);
    const msg = String(err?.message || err);
    if (/SMTP_HOST is not configured/i.test(msg)) {
      return ctx.internalServerError({
        errorCode: 'SMTP_NOT_CONFIGURED',
        message: 'Email service is not configured on the server.',
        emailSent: false,
      });
    }
    if (/EMAIL_ENABLED is false/i.test(msg)) {
      return ctx.internalServerError({
        errorCode: 'EMAIL_DISABLED',
        message: 'Email service is disabled. Set EMAIL_ENABLED=true in server configuration.',
        emailSent: false,
      });
    }
    if (/ECONNREFUSED|ETIMEDOUT|EAUTH|ESOCKET|ENOTFOUND|certificate/i.test(msg)) {
      ctx.status = 503;
      return ctx.send({
        errorCode: 'EMAIL_DELIVERY_FAILED',
        message:
          'Unable to send the reset email right now. Please try again later or contact IT support.',
        emailSent: false,
      });
    }
    return ctx.internalServerError({
      errorCode: 'FORGOT_PASSWORD_FAILED',
      message: 'Unable to process forgot password request',
      emailSent: false,
    });
  }
},


  async resetForgotPassword(ctx) {
    try {
      const code = String(ctx.request?.body?.code || '').trim();
      const password = String(ctx.request?.body?.password || '');
      const passwordConfirmation = String(ctx.request?.body?.passwordConfirmation || '');

      if (!code || !password || !passwordConfirmation) {
        return ctx.badRequest('code, password, and passwordConfirmation are required');
      }

      if (password.length < 8) {
        return ctx.badRequest('Password must be at least 8 characters');
      }

      if (password !== passwordConfirmation) {
        return ctx.badRequest('Passwords do not match');
      }

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { resetPasswordToken: code },
        select: ['id'],
      });

      if (!user) {
        return ctx.badRequest('Invalid or expired reset code');
      }

      await strapi.entityService.update('plugin::users-permissions.user', user.id, {
        data: {
          password,
          resetPasswordToken: null,
          is_first_login: false,
        },
        state: { isResetFlow: true },
      });

      return ctx.send({ success: true, message: 'Password reset successfully' });
    } catch (err) {
      strapi.log.error('resetForgotPassword error:', err);
      return ctx.internalServerError('Unable to reset password');
    }
  },

  async login(ctx) {
    try {
      const body = ctx.request?.body || {};
      const identifier = body.identifier;
      const password = body.password;

      if (!identifier || !password) {
        return ctx.badRequest('identifier and password are required');
      }

      const idStr = String(identifier).trim();

      const userQuery = strapi.db.query('plugin::users-permissions.user');

      // Allow login by emp_code (AIA) or emp_id (Vega)
      let user =
        (await userQuery.findOne({
          where: { emp_code: idStr },
          select: [
            'id',
            'email',
            'username',
            'emp_code',
            'emp_id',
            'company',
            'is_first_login',
            'blocked',
            'active',
            'password',
            'exit_date',
          ],
        })) ||
        (await userQuery.findOne({
          where: { emp_id: idStr },
          select: [
            'id',
            'email',
            'username',
            'emp_code',
            'emp_id',
            'company',
            'is_first_login',
            'blocked',
            'active',
            'password',
            'exit_date',
          ],
        }));

      if (!user) {
        return ctx.unauthorized('Invalid credentials');
      }

      if (user.blocked === true) {
        return ctx.unauthorized('User is blocked');
      }

      if (user.active === false) {
        return ctx.unauthorized('User is inactive');
      }

      if(user.company === 'AIA' && user.exit_date) {
        return ctx.unauthorized('User has exited the company');
      }
      
      // 2) Validate password using users-permissions user service
      const userService = strapi.plugin('users-permissions').service('user');

      const valid = await userService.validatePassword(password, user.password);
      if (!valid) {
        return ctx.unauthorized('Invalid credentials');
      }

      const lastLogin = await recordUserLastLogin(strapi, user.id);

      // 3) Issue JWT using users-permissions jwt service
      const jwtService = strapi.plugin('users-permissions').service('jwt');

      const token = jwtService.issue({ id: user.id });

      // 4) Basic sanitization: remove sensitive fields
      const {
        password: _pw,
        resetPasswordToken,
        confirmationToken,
        ...safeUser
      } = user;

      return ctx.send({
        jwt: token,
        user: { ...safeUser, last_login: lastLogin },
      });
    } catch (err) {
      strapi.log.error('Custom /auth/login error:', err);
      return ctx.internalServerError('Login failed');
    }
  },

  /**
   * Lightweight check: does the current frontend user have an Administration Panel account?
   * Returns { hasAdminAccess: true/false }. Never returns a token.
   * Route is auth:false — JWT validated manually here.
   */
  async checkAdminAccess(ctx) {
    try {
      const frontendUser = await getVerifiedFrontendUser(ctx);
      if (!frontendUser?.email) {
        return ctx.send({ hasAdminAccess: false });
      }

      const email = String(frontendUser.email).trim().toLowerCase();
      const adminUser = await findAdminUserByEmail(email);

      const hasAdminAccess = !!(adminUser && adminUser.isActive !== false);
      return ctx.send({ hasAdminAccess });
    } catch (err) {
      strapi.log.error('checkAdminAccess error:', err);
      return ctx.send({ hasAdminAccess: false });
    }
  },

  /**
   * Issues a Strapi admin JWT for the matching Administration Panel user.
   * Route is auth:false — JWT validated manually here.
   * Uses jsonwebtoken with ADMIN_JWT_SECRET (Strapi v5 compatible).
   */
  async adminToken(ctx) {
    try {
      const frontendUser = await getVerifiedFrontendUser(ctx);
      if (!frontendUser?.email) {
        return ctx.forbidden('No admin access');
      }

      const email = String(frontendUser.email).trim().toLowerCase();
      const adminUser = await findAdminUserByEmail(email);

      if (!adminUser || adminUser.isActive === false) {
        return ctx.forbidden('No admin access');
      }

      // Strapi v5: issue admin JWT using ADMIN_JWT_SECRET from env
      // This is the same secret Strapi uses internally for admin sessions.
      const adminJwtSecret = String(
        strapi.config.get('admin.auth.secret') ||
        process.env.ADMIN_JWT_SECRET ||
        ''
      );

      if (!adminJwtSecret) {
        strapi.log.error('adminToken: ADMIN_JWT_SECRET is not set');
        return ctx.internalServerError('Server configuration error');
      }

      const adminToken = jwt.sign(
        { id: adminUser.id },
        adminJwtSecret,
        { expiresIn: '1h' }
      );

      return ctx.send({ adminToken });
    } catch (err) {
      strapi.log.error('adminToken error:', err);
      return ctx.internalServerError('Failed to generate admin token');
    }
  },
  /**
   * Serves a tiny HTML page FROM port 1337 that:
   *   1. Sets localStorage["jwtToken"] on the 1337 origin  (same origin as Strapi admin)
   *   2. Immediately redirects the browser to /admin
   *
   * This fixes the cross-origin localStorage problem:
   *   - The Next.js /admin-redirect page (port 3000) can't set localStorage for port 1337
   *   - This endpoint IS on port 1337, so localStorage is shared with the admin panel
   */
  async adminHtmlRedirect(ctx) {
    const token = ctx.query?.token;

    if (!token || typeof token !== 'string') {
      ctx.status = 400;
      ctx.body = '<h1>Bad Request: missing token</h1>';
      return;
    }

    // Sanitize — only allow base64url characters (JWT format)
    const safe = token.replace(/[^A-Za-z0-9\-_\.]/g, '');

    ctx.set('Content-Type', 'text/html; charset=utf-8');
    ctx.set('Cache-Control', 'no-store, no-cache');
    // Override Strapi's helmet CSP — this response intentionally runs inline JS
    // to set localStorage on the 1337 origin before redirecting to /admin.
    ctx.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
    ctx.status = 200;
    ctx.body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Redirecting…</title></head>
<body>
<p>Redirecting to Admin Panel…</p>
<script>
  try {
    localStorage.setItem('jwtToken', '"${safe}"');
    sessionStorage.setItem('jwtToken', '"${safe}"');
  } catch(e) {}
  window.location.replace('/admin');
</script>
</body>
</html>`;
  },


  // ================= CHANGE PASSWORD (FIRST LOGIN) =================
    async changePassword(ctx) {
      try {
        const user = ctx.state.user;

        if (!user) {
          return ctx.unauthorized('You must be logged in');
        }

        const { newPassword, confirmPassword } = ctx.request.body;

        if (!newPassword || !confirmPassword) {
          return ctx.badRequest('Both fields are required');
        }

        if (newPassword.length < 8) {
          return ctx.badRequest('Password must be at least 8 characters');
        }

        if (newPassword !== confirmPassword) {
          return ctx.badRequest('Passwords do not match');
        }

       await strapi.entityService.update(
        'plugin::users-permissions.user',
        user.id,
        {
          data: {
            password: newPassword,
            is_first_login: false,
          },
          state: {
            isResetFlow: true,
          },
        }
      );
          strapi.log.info(`User ${user.email} changed password successfully`);

        return ctx.send({ message: 'Password changed successfully' });

      } catch (err) {
        strapi.log.error('Change password error:', err);
        return ctx.badRequest('Something went wrong');
      }
    },

    async updatePassword(ctx) {
      try {
        const user = ctx.state.user;
        if (!user) return ctx.unauthorized('You must be logged in');

        const { currentPassword, newPassword, confirmPassword } = ctx.request.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
          return ctx.badRequest('All fields are required');
        }
        if (newPassword.length < 8) {
          return ctx.badRequest('New password must be at least 8 characters');
        }
        if (newPassword !== confirmPassword) {
          return ctx.badRequest('New password and confirm password do not match');
        }

        if (currentPassword === newPassword) {
          return ctx.badRequest('New password must be different from your current password');
        }

        // Verify current password against stored hash
        const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: user.id },
          select: ['password'],
        });
        const isValid = await strapi.service('plugin::users-permissions.user').validatePassword(
          currentPassword,
          fullUser.password
        );
        if (!isValid) {
          return ctx.badRequest('Current password is incorrect');
        }

        await strapi.entityService.update('plugin::users-permissions.user', user.id, {
          data: { password: newPassword },
          state: { isResetFlow: true },
        });

        strapi.log.info(`User ${user.email} updated password from profile`);
        return ctx.send({ message: 'Password updated successfully' });
      } catch (err) {
        strapi.log.error('updatePassword error:', err);
        return ctx.internalServerError('Something went wrong');
      }
    },

    // src/api/auth/controllers/auth.js

    async checkUser(ctx) {
      const { identifier } = ctx.query;
      if (!identifier) return ctx.badRequest('Identifier required');

      const userQuery = strapi.db.query('plugin::users-permissions.user');

      const user =
        (await userQuery.findOne({ where: { emp_code: identifier } })) ||
        (await userQuery.findOne({ where: { emp_id: identifier } }));

      if (!user) return ctx.notFound('User not found');

      return ctx.send({
        exists: true,
        is_first_login: user.is_first_login,
      });
    }

};
