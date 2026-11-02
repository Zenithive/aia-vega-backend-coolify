//@ts-nocheck
"use strict";

const {
  isEmailEnabled,
  isLearnerEmailNotificationAllowed,
  buildUserNotificationEmailHtml,
} = require('../../../utils/email-template');

module.exports = ({ strapi }) => ({

  isEmailEnabled() {
    return isEmailEnabled();
  },

  async send({ type, title, message, toUser, fromUser, meta = {}, email = true, socket = true }) {
    const emailEnabled = this.isEmailEnabled();
    
    // 1. Save notification in DB (Dashboard Notification)
    const notification = await strapi.entityService.create("api::notification.notification", {
      data: {
        type,
        title,
        message,
        toUser,
        fromUser,
        meta,
      },
    });

    // 2. SOCKET.IO real-time event
    if (socket && toUser && strapi.$io) {
      strapi.$io.server.to(`user_${toUser}`).emit('new-notification', {
        id: notification.id,
        type,
        title,
        message,
        meta,
      });
    }

    // 3. EMAIL NOTIFICATION using Strapi Email Plugin
    if (email && toUser && emailEnabled && isLearnerEmailNotificationAllowed(type)) {
      const user = await strapi.query("plugin::users-permissions.user").findOne({
        where: { id: toUser },
      });

      if (user?.email) {
        console.log(`[EMAIL] 📤 Sending to user: ${user.email} | subject: ${title}`);
        void Promise.resolve()
          .then(() => strapi.plugins["email"].services.email.send({
            to: user.email,
            subject: title,
            text: message,
            html: buildUserNotificationEmailHtml(type, title, message, meta),
          }))
          .then(() => console.log(`[EMAIL] ✅ Sent to: ${user.email}`))
          .catch((err) => {
            console.log(`[EMAIL] ❌ Failed to: ${user.email} — ${err?.message || err}`);
            strapi.log.error('Email send error:', err);
          });
      }
    }

    return notification;
  },

  /**
   * Send notifications to users and admins (event-based)
   * @param {string} type - Notification type
   * @param {string} title - Notification title
   * @param {string} message - Notification message
   * @param {Array} usersArray - Array of user objects (user-permissions or admin)
   * @param {Object} meta - Additional metadata
   * @param {Array} adminRoles - Array of admin roles to notify (optional)
   */
  async sendEventNotification(type, title, message, usersArray, meta = {}, adminRoles = []) {
    // Notify each user
    for (const user of usersArray) {
      await strapi.entityService.create('api::notification.notification', {
        data: {
          type,
          title,
          message,
          is_read: false,
          toUser: user.id,
          meta,
        },
      });
      // Socket
      if (strapi.$io) {
        strapi.$io.server.to(`user_${user.id}`).emit('new-notification', { type, title, message, meta });
      }
    }
    // Notify admin panel users (admin, LMadmin, HRadmin)
    if (adminRoles.length) {
      const adminUsers = await strapi.db.query('admin::user').findMany({
        where: { role: { code: adminRoles } },
        select: ['id', 'email', 'role'],
      });
      for (const admin of adminUsers) {
        await strapi.entityService.create('api::notification.notification', {
          data: {
            type,
            title,
            message,
            is_read: false,
            admin_user: admin.id,
            forRole: admin.role.code,
            meta,
          },
        });
        if (strapi.$io) {
          strapi.$io.server.to(`admin_${admin.id}`).emit('new-notification', { type, title, message, meta });
        }
      }
    }
  },

  async getUsersByDepartment(departmentId) {
    return await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { department: departmentId },
      select: ['id', 'email'],
    });
  },
  async getUsersByCompany(companyId) {
    return await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { company: companyId },
      select: ['id', 'email'],
    });
  },
  async getUsersByWorkLocation(workLocationId) {
    return await strapi.db.query('plugin::users-permissions.user').findMany({
      where: { work_location: workLocationId },
      select: ['id', 'email'],
    });
  },

});