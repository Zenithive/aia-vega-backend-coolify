// @ts-nocheck
'use strict';

/**
 * Profile edit request notifications:
 * - afterCreate (Pending): notify admin roles
 * - afterUpdate (Approved/Rejected): notify the requester
 */

const PROFILE_EDIT_REQUEST_UID = 'api::profile-edit-request.profile-edit-request';
const { getProfileEditNotificationDeliveryOptions } = require('../utils/profile-edit-request-helpers');

function runDetached(strapi, label, work) {
  Promise.resolve()
    .then(work)
    .catch((e) => {
      strapi.log.error(`[profile-edit-request-notification] ${label}:`, e?.message || e);
    });
}

function getRelationId(rel) {
  if (rel == null) return null;
  if (typeof rel === 'number') return rel;
  if (typeof rel === 'object' && rel !== null) return rel.id ?? rel.documentId ?? rel.document_id ?? null;
  return null;
}

function getDisplayName(user) {
  if (!user) return 'Employee';
  return user.username || user.employee_name || user.name || user.email || `User ${user.id || ''}`.trim();
}

function buildChangedFieldsText(requestedChanges) {
  if (!requestedChanges || typeof requestedChanges !== 'object') return '';
  const fields = Object.keys(requestedChanges).filter(Boolean);
  if (fields.length === 0) return '';
  return fields.join(', ');
}

function buildRejectionReasonText(reason) {
  if (typeof reason !== 'string') return '';
  const normalized = reason.trim();
  if (!normalized) return '';
  return ` Reason: ${normalized}`;
}

async function refetchProfileEditRequest(strapi, recordId) {
  if (recordId == null) return null;

  return await strapi.db.query(PROFILE_EDIT_REQUEST_UID).findOne({
    where: Number.isFinite(Number(recordId)) ? { id: Number(recordId) } : { documentId: String(recordId) },
    populate: {
      users_permissions_user: true,
      reviewed_by: true,
    },
  });
}

function registerProfileEditRequestNotificationLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [PROFILE_EDIT_REQUEST_UID],

    async afterCreate(event) {
      try {
        const notifUtil = strapi.utils?.notification;
        if (!notifUtil) return;

        const { result } = event;
        const status = result?.request_status || 'Pending';
        if (status !== 'Pending') return;

        const recordId = result?.id ?? result?.documentId;

        runDetached(strapi, 'afterCreate', async () => {
          const record = await refetchProfileEditRequest(strapi, recordId);
          if (!record) return;

          const requester = record.users_permissions_user;
          const requesterId = getRelationId(requester) ?? record.users_permissions_user_id;
          if (!requesterId) return;

          const requesterName = getDisplayName(requester);
          const changedFields = buildChangedFieldsText(record.requested_changes);

          const title = 'New Profile Edit Request';
          const message = changedFields
            ? `${requesterName} submitted a profile edit request for: ${changedFields}.`
            : `${requesterName} submitted a profile edit request.`;

          await notifUtil.sendNotification(
            'profile_edit_request',
            title,
            message,
            [],
            {
              requestId: record.id ?? record.documentId,
              userId: requesterId,
              userName: requesterName,
              changedFields,
              source: 'profile_edit_request',
              action: 'created',
            },
            ['admin', 'HRadmin'],
            getProfileEditNotificationDeliveryOptions(notifUtil)
          );
        });
      } catch (e) {
        strapi.log.error('[profile-edit-request-notification] afterCreate:', e?.message || e);
      }
    },

    async afterUpdate(event) {
      try {
        const notifUtil = strapi.utils?.notification;
        if (!notifUtil) return;

        const statusFromPayload = event?.params?.data?.request_status;
        if (statusFromPayload !== 'Approved' && statusFromPayload !== 'Rejected') return;

        const { result } = event;
        const status = result?.request_status;
        if (status !== 'Approved' && status !== 'Rejected') return;

        const recordId = result?.id ?? result?.documentId;

        runDetached(strapi, 'afterUpdate', async () => {
          const record = await refetchProfileEditRequest(strapi, recordId);
          if (!record) return;

          const requester = record.users_permissions_user;
          const requesterId = getRelationId(requester) ?? record.users_permissions_user_id;
          if (!requesterId) return;

          const requesterName = getDisplayName(requester);
          const changedFields = buildChangedFieldsText(record.requested_changes);
          const statusLower = status.toLowerCase();
          const rejectionReasonText = status === 'Rejected'
            ? buildRejectionReasonText(record.reason_for_rejection)
            : '';

          const title = `Profile Edit Request ${status}`;
          const message = changedFields
            ? `Your profile edit request for ${changedFields} has been ${statusLower}.${rejectionReasonText}`
            : `Your profile edit request has been ${statusLower}.${rejectionReasonText}`;

          await notifUtil.sendNotification(
            'profile_edit_request',
            title,
            message,
            [{ id: requesterId, email: requester?.email }],
            {
              requestId: record.id ?? record.documentId,
              userId: requesterId,
              userName: requesterName,
              changedFields,
              status,
              reason_for_rejection: record.reason_for_rejection || null,
              source: 'profile_edit_request',
              action: 'status_update',
            },
            [],
            getProfileEditNotificationDeliveryOptions(notifUtil)
          );
        });
      } catch (e) {
        strapi.log.error('[profile-edit-request-notification] afterUpdate:', e?.message || e);
      }
    },
  });

  strapi.log.info('Profile edit request: admin notify on create, user notify on approve/reject');
}

module.exports = { registerProfileEditRequestNotificationLifecycles };
