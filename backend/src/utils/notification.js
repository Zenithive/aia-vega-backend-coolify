// @ts-nocheck
'use strict';

const {
  isEmailEnabled: isEmailEnabledFromTemplate,
  buildUserNotificationEmailHtml,
  buildAdminNotificationEmailHtml,
  buildAdminEmailPlainText,
} = require('./email-template');

/**
 * Event-based notification utility for Strapi v5.
 * Centralizes notification logic: DB + email + socket.io.
 * Use via: strapi.utils.notification.sendNotification(...)
 */

module.exports = (strapi) => {
  const NOTIFICATION_UID = 'api::notification.notification';
  const USER_UID = 'plugin::users-permissions.user';

  function isEmailEnabled() {
    return isEmailEnabledFromTemplate();
  }

  /**
   * Enrich meta with human-readable names (userName, courseTitle, newsTitle)
   * so the admin UI can show friendly labels without extra API calls.
   */
  async function enrichMeta(meta = {}) {
    /** @type {Record<string, any>} */
    const out = { ...(meta || {}) };

    // Resolve userName from userId (portal user: username, email)
    if (out.userId != null && out.userId !== '' && !out.userName) {
      try {
        const userRow = await strapi.db.query(USER_UID).findOne({
          where: { id: Number(out.userId) },
          select: ['id', 'username', 'email'],
        });
        if (userRow) {
          out.userName =
            userRow.username ||
            userRow.email ||
            `User ${userRow.id}`;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta user error:', err?.message || err);
      }
    }

    // Resolve courseTitle, company, courseDocumentId from courseId (numeric id or documentId)
    if (out.courseId != null && out.courseId !== '') {
      try {
        const courseId = Number(out.courseId);
        let courseRow = null;
        if (!Number.isNaN(courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { id: courseId },
            populate: ['company'],
          });
        }
        if (!courseRow && String(out.courseId)) {
          courseRow = await strapi.db.query('api::course.course').findOne({
            where: { documentId: String(out.courseId) },
            populate: ['company'],
          });
        }
        if (courseRow?.title && !out.courseTitle) {
          out.courseTitle = courseRow.title;
        }
        if (courseRow?.documentId && !out.courseDocumentId) {
          out.courseDocumentId = courseRow.documentId;
        }
        if (!out.company && courseRow) {
          const companies = Array.isArray(courseRow.company)
            ? courseRow.company
            : courseRow.company
              ? [courseRow.company]
              : [];
          if (companies[0]?.name) out.company = companies[0].name;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta course error:', err?.message || err);
      }
    }

    // Optional: resolve newsTitle from newsId (documentId)
    if (out.newsId && !out.newsTitle) {
      try {
        const newsRow = await strapi.db.query('api::news.news').findOne({
          where: { documentId: String(out.newsId) },
          select: ['id', 'title'],
        });
        if (newsRow?.title) {
          out.newsTitle = newsRow.title;
        }
      } catch (err) {
        strapi.log.warn('[notification] enrichMeta news error:', err?.message || err);
      }
    }

    return out;
  }

  /**
   * Send email via Strapi email plugin (Nodemailer).
   * Requires .env: SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, EMAIL_FROM
   */
  async function sendEmail(to, subject, body, htmlOverride) {
    if (!to || !subject) {
      console.log(`[EMAIL] ❌ Skipped — missing to="${to}" or subject="${subject}"`);
      return;
    }

    const emailEnabled = isEmailEnabled();
    console.log(`[EMAIL] EMAIL_ENABLED env="${process.env.EMAIL_ENABLED}" → resolved=${emailEnabled}`);

    if (!emailEnabled) {
      console.log(`[EMAIL] ❌ Blocked — EMAIL_ENABLED is false. Set EMAIL_ENABLED=true in .env to send emails.`);
      strapi.log.warn(`[notification.sendEmail] Email blocked: EMAIL_ENABLED=false (to: ${to})`);
      return;
    }

    console.log(`[EMAIL] 📤 Attempting to send email:`);
    console.log(`[EMAIL]   → To:      ${to}`);
    console.log(`[EMAIL]   → Subject: ${subject}`);
    console.log(`[EMAIL]   → SMTP:    ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
    console.log(`[EMAIL]   → From:    ${process.env.EMAIL_FROM}`);

    const text = body || '';
    const html = htmlOverride || (text ? text.replace(/\n/g, '<br>') : '');
    const payload = {
      to,
      subject,
      ...(text && { text }),
      ...(html && { html }),
    };
    if (!payload.text && !payload.html) payload.text = '(No content)';

    const emailService =
      strapi.plugin?.('email')?.service?.('email') ||
      strapi.plugins?.email?.services?.email;

    if (!emailService || typeof emailService.send !== 'function') {
      console.log(`[EMAIL] ❌ Email plugin service not found — check config/plugins.js and EMAIL_ENABLED in .env`);
      strapi.log.warn('[notification] Email plugin not available – skipping send. Enable email in config/plugins.js and set SMTP_* in .env');
      return;
    }

    try {
      await emailService.send(payload);
      console.log(`[EMAIL] ✅ Email sent successfully to: ${to}`);
    } catch (err) {
      const msg = err?.message || String(err);
      console.log(`[EMAIL] ❌ Email send FAILED to: ${to}`);
      console.log(`[EMAIL]   → Error: ${msg}`);
      if (/ECONNREFUSED/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Cannot connect to SMTP server. Check SMTP_HOST (${process.env.SMTP_HOST}) and SMTP_PORT (${process.env.SMTP_PORT}) are correct and reachable.`);
      } else if (/ETIMEDOUT/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Connection timed out. The SMTP server may be unreachable from this machine.`);
      } else if (/auth|credentials|login|Invalid login/i.test(msg)) {
        console.log(`[EMAIL]   → HINT: Authentication failed. Check SMTP_USERNAME and SMTP_PASSWORD in .env`);
      }
      strapi.log.error('[notification] Email send failed:', msg);
    }
  }

  /**
   * Emit socket.io event to target user(s)
   */
  function triggerSocket(userIds, payload) {
    const io = strapi.$io;
    if (!io) {
      strapi.log.warn('[notification] Socket skipped: strapi.$io not available');
      return;
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      strapi.log.warn('[notification] Socket skipped: no userIds provided');
      return;
    }
    const ids = userIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `user_${id}`;
      io.server.to(room).emit('new-notification', payload);
    });
  }

  /**
   * Emit socket.io event to admin user(s)
   */
  function triggerAdminSocket(adminIds, payload) {
    const io = strapi.$io;
    if (!io) {
      strapi.log.warn('[notification] Admin socket skipped: strapi.$io not available');
      return;
    }
    if (!Array.isArray(adminIds) || adminIds.length === 0) {
      strapi.log.warn('[notification] Admin socket skipped: no adminIds provided');
      return;
    }
    const ids = adminIds.filter(Boolean).map(String);
    ids.forEach((id) => {
      const room = `admin_${id}`;
      io.server.to(room).emit('new-notification', payload);
    });
  }

  /**
   * Get admin users by conceptual role codes (admin, LMadmin, HRadmin).
   *
   * Implementation note:
   * - We fetch all admin users and filter in JS by role name so we don't
   *   depend on the exact shape of the role/roles relation.
   * - Current project roles (from screenshot):
   *     "Admin"       → main admin
   *     "HR admin"    → HR Admin
   *     "LM admin"    → LM Admin
   *     "Super Admin" → super admin
   */
  async function getAdminUsersByRoles(roleCodes) {
    if (!Array.isArray(roleCodes) || roleCodes.length === 0) return [];

    const normalizedRoleCodes = roleCodes
      .map((r) => String(r || '').trim().toLowerCase())
      .filter(Boolean);

    const wantsAdmin = normalizedRoleCodes.some((c) => c === 'admin' || c.includes('super'));
    const wantsLM = normalizedRoleCodes.some((c) => c.includes('lm'));
    const wantsHR = normalizedRoleCodes.some((c) => c.includes('hr'));
    if (!wantsAdmin && !wantsLM && !wantsHR) return [];

    try {
      // Step 1: Fetch all admin roles to find matching IDs (reliable - no name guessing)
      const allRoles = await strapi.db.query('admin::role').findMany({
        select: ['id', 'name', 'code'],
      });
      strapi.log.info('[notification] all admin roles: ' + JSON.stringify(allRoles));

      const matchedRoleIds = [];
      for (const role of allRoles || []) {
        const n = String(role.name || '').trim().toLowerCase();
        const c = String(role.code || '').trim().toLowerCase();
        const isAdminRole = wantsAdmin && (n === 'admin' || n.includes('super') || c.includes('super'));
        const isLMRole = wantsLM && n.includes('lm');
        const isHRRole = wantsHR && n.includes('hr');
        if (isAdminRole || isLMRole || isHRRole) {
          matchedRoleIds.push(role.id);
        }
      }

      strapi.log.info('[notification] matched role IDs for ' + JSON.stringify(roleCodes) + ': ' + JSON.stringify(matchedRoleIds));

      if (matchedRoleIds.length === 0) {
        strapi.log.warn('[notification] no matching roles found for codes: ' + JSON.stringify(roleCodes));
        return [];
      }

      // Step 2: Fetch all admin users with their roles populated, then filter by role ID
      const allAdmins = await strapi.db.query('admin::user').findMany({
        populate: ['roles'],
        select: ['id', 'email'],
      });

      const result = (allAdmins || []).filter((admin) => {
        const userRoleIds = (admin.roles || []).map((r) => r?.id).filter(Boolean);
        return userRoleIds.some((id) => matchedRoleIds.includes(id));
      });

      if (result.length === 0) {
        strapi.log.warn('[notification] no admin users matched roles: ' + JSON.stringify(roleCodes));
      } else {
        strapi.log.info('[notification] admin recipients for ' + JSON.stringify(roleCodes) + ': ' + JSON.stringify(result.map((u) => ({ id: u?.id, email: u?.email }))));
      }

      return result;
    } catch (err) {
      strapi.log.error('[notification] getAdminUsersByRoles error: ' + (err?.message || String(err)));
      return [];
    }
  }

  /**
   * Get users by department ID (user.department is string matching dept name)
   */
  async function getUsersByDepartment(departmentId) {
    if (!departmentId) return [];
    try {
      const dept = await strapi.db.query('api::department.department').findOne({
        where: { id: Number(departmentId) },
        select: ['name'],
      });
      if (!dept?.name) return [];
      const users = await strapi.db.query(USER_UID).findMany({
        where: { department: { $eqi: dept.name }, blocked: { $ne: true } },
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByDepartment error:', err?.message || err);
      return [];
    }
  }

  /**
   * Get users by company ID (user.company is enum AIA/Vega)
   */
  async function getUsersByCompany(companyId) {
    if (!companyId) return [];
    try {
      const company = await strapi.db.query('api::company.company').findOne({
        where: { id: Number(companyId) },
        select: ['name'],
      });
      if (!company?.name) return [];
      const users = await strapi.db.query(USER_UID).findMany({
        where: { company: company.name, blocked: { $ne: true } },
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByCompany error:', err?.message || err);
      return [];
    }
  }

  /**
   * Get users by work location ID (user.working_location or user.branch matches location name)
   */
  async function getUsersByWorkLocation(workLocationId) {
    if (!workLocationId) return [];
    try {
      const loc = await strapi.db.query('api::work-location.work-location').findOne({
        where: { id: Number(workLocationId) },
        populate: ['company'],
      });
      if (!loc?.name) return [];
      const companyName = (loc.company?.name || loc.company || '').trim();
      const locName = String(loc.name).trim();
      const where = { blocked: { $ne: true } };
      if (companyName === 'Vega') {
        where.company = 'Vega';
        where.working_location = { $eqi: locName };
      } else {
        where.company = companyName || 'AIA';
        where.branch = { $eqi: locName };
      }
      const users = await strapi.db.query(USER_UID).findMany({
        where,
        select: ['id', 'email'],
      });
      return users || [];
    } catch (err) {
      strapi.log.error('[notification] getUsersByWorkLocation error:', err?.message || err);
      return [];
    }
  }

  /**
   * Build a readable plain-text body for admin notifications.
   */
  function buildAdminEmailBody(title, message, meta = {}) {
    return buildAdminEmailPlainText(title, message, meta);
  }

  /**
   * Main send notification function.
   * - User notifications (toUser): stored for portal bell + email + socket to user.
   * - Admin notifications (admin_user, forRole): stored for Strapi admin bell + email to admin/LM/HR.
   * Targeting: admin gets all; HR gets news_liked; LM gets course-related (feedback, quiz submit, quiz reattempt).
   * Admin emails are always sent when adminRoles are provided (sendEmail option applies to both user and admin).
   * @param {string} type - Notification type (enum)
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Array} usersArray - Array of user objects { id, email } (portal users)
   * @param {Object} meta - Additional metadata
   * @param {Array} adminRoles - Admin role codes: ['admin','LMadmin','HRadmin']
   * @param {Object} options - { sendEmail: true, sendSocket: true }
   *   Email is sent only when options.sendEmail is true AND process.env.EMAIL_ENABLED is true.
   *   In-app (DB) and socket delivery are independent of EMAIL_ENABLED.
   */
  async function sendNotification(type, title, message, usersArray = [], meta = {}, adminRoles = [], options = {}) {
    const { sendEmail: doEmail = true, sendSocket: doSocket = true } = options;
    const globalEmailEnabled = isEmailEnabled();
    const shouldSendEmail = doEmail && globalEmailEnabled;
    console.log(`[NOTIFICATION] 🔔 sendNotification called`);
    console.log(`[NOTIFICATION]   → type:         ${type}`);
    console.log(`[NOTIFICATION]   → title:        ${title}`);
    console.log(`[NOTIFICATION]   → users:        ${usersArray.length}`);
    console.log(`[NOTIFICATION]   → adminRoles:   ${JSON.stringify(adminRoles)}`);
    console.log(`[NOTIFICATION]   → emailEnabled: ${globalEmailEnabled}, willSendEmail: ${shouldSendEmail}`);
    const users = Array.isArray(usersArray) ? usersArray.filter(Boolean) : [];
    const roles = Array.isArray(adminRoles) ? adminRoles.filter(Boolean) : [];
    const enrichedMeta = await enrichMeta(meta);

    const payload = { type, title, message, meta: enrichedMeta };

    for (const user of users) {
      const userId = user?.id ?? user?.documentId;
      if (!userId) continue;
      try {
        const notification = await strapi.entityService.create(NOTIFICATION_UID, {
          data: {
            type,
            title,
            message,
            is_read: false,
            toUser: userId,
            meta: enrichedMeta,
          },
        });
        if (shouldSendEmail && user?.email) {
          const htmlBody = buildUserNotificationEmailHtml(type, title, message, enrichedMeta);
          await sendEmail(user.email, title, message, htmlBody);
        }
        if (doSocket && strapi.$io) {
          triggerSocket([String(userId)], { ...payload, id: notification?.id });
        }
      } catch (err) {
        strapi.log.error('[notification] sendNotification user error:', err?.message || err);
      }
    }

    for (const roleCode of roles) {
      const adminUsers = await getAdminUsersByRoles([roleCode]);
      for (const admin of adminUsers) {
        const adminId = admin?.id ?? admin?.documentId;
        if (!adminId) continue;
        try {
          const notification = await strapi.entityService.create(NOTIFICATION_UID, {
            data: {
              type,
              title,
              message,
              is_read: false,
              admin_user: adminId,
              forRole: roleCode,
              meta: enrichedMeta,
            },
          });
          if (shouldSendEmail && admin?.email) {
            const emailBody = buildAdminEmailBody(title, message, enrichedMeta);
            const htmlBody = buildAdminNotificationEmailHtml(title, message, enrichedMeta);
            await sendEmail(admin.email, title, emailBody, htmlBody);
          }
          if (doSocket && strapi.$io) {
            triggerAdminSocket([String(adminId)], { ...payload, id: notification?.id });
          }
        } catch (err) {
          strapi.log.error('[notification] sendNotification admin error:', err?.message || err);
        }
      }
    }
  }

  return {
    sendNotification,
    sendEmail,
    isEmailEnabled,
    enrichMeta,
    triggerSocket,
    triggerAdminSocket,
    getAdminUsersByRoles,
    getUsersByDepartment,
    getUsersByCompany,
    getUsersByWorkLocation,
  };
};
