'use strict';

const { isAdminPanelCreate, persistAdminCreated } = require('../../../../utils/quiz-reattempt-admin-created');

module.exports = {
  async beforeCreate(event) {
    try {
      const data = event?.params?.data || {};
      const isAdmin = isAdminPanelCreate(strapi);

      strapi.log.info({
        isAdmin,
        adminCreatedInData: data?.adminCreated,
        path: strapi?.requestContext?.get?.()?.request?.path || 'unknown',
        requestStatus: data?.request_status || 'unknown',
      }, '[quiz-reattempt lifecycle] beforeCreate');

      // Always set from context — do not trust whatever the form/payload sent.
      data.adminCreated = isAdmin;
      strapi.log.info({ adminCreated: isAdmin }, '[quiz-reattempt lifecycle] adminCreated set');

      // If admin directly creates a record already in Approved/Rejected status,
      // capture approved_by at creation time (normally only set on update).
      if (isAdmin && (data.request_status === 'Approved' || data.request_status === 'Rejected')) {
        try {
          const ctx = strapi?.requestContext?.get?.();
          const adminUser = ctx?.state?.admin || ctx?.state?.user || null;
          if (adminUser?.id) {
            data.approved_by = adminUser.id;
            strapi.log.info({ adminUserId: adminUser.id }, '[quiz-reattempt lifecycle] approved_by set at creation');
          }
        } catch { /* keep null */ }
      }
    } catch (error) {
      strapi.log.warn({ err: error?.message }, '[quiz-reattempt lifecycle] beforeCreate failed');
    }
  },

  async afterCreate(event) {
    try {
      const result = event?.result;
      if (!result?.id && !result?.documentId) return;

      const isAdmin = isAdminPanelCreate(strapi);
      const recordId = result.id ?? result.documentId;
      await persistAdminCreated(strapi, recordId, isAdmin);
    } catch (error) {
      strapi.log.warn({ err: error?.message }, '[quiz-reattempt lifecycle] afterCreate failed');
    }
  },

  async beforeUpdate(event) {
    try {
      const data = event?.params?.data || {};
      const newStatus = data?.request_status;
      const entryId = event?.params?.where?.id ?? event?.params?.where?.documentId ?? null;

      strapi.log.info({
        entryId,
        newStatus,
        path: strapi?.requestContext?.get?.()?.request?.path || 'unknown',
      }, '[quiz-reattempt lifecycle] beforeUpdate');

      if (newStatus !== 'Approved' && newStatus !== 'Rejected') return;

      try {
        const ctx = strapi?.requestContext?.get?.();
        const adminUser = ctx?.state?.user || ctx?.state?.admin || null;
        if (adminUser?.id) {
          data.approved_by = adminUser.id;
          strapi.log.info({ entryId, adminUserId: adminUser.id }, '[quiz-reattempt lifecycle] approved_by set on update');
        }
      } catch { /* no admin context */ }
    } catch (error) {
      strapi.log.warn({ err: error?.message }, '[quiz-reattempt lifecycle] beforeUpdate failed');
    }
  },
};
