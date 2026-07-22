// @ts-nocheck
'use strict';

function normalizeCompany(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeComment(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveUserLocation(user, company) {
  if (!user || typeof user !== 'object') return null;

  const companyValue = normalizeCompany(company || user.company);
  if (companyValue === 'aia') {
    return user.branch || null;
  }
  if (companyValue === 'vega') {
    return user.working_location || null;
  }

  return user.branch || user.working_location || null;
}

function normalizePendingComments(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && typeof item.comment === 'string');
}

function getLatestPendingComment(value) {
  const comments = normalizePendingComments(value);
  if (comments.length === 0) return null;
  return comments[comments.length - 1].comment;
}

function buildAdminDisplayName(adminUser) {
  if (!adminUser) return 'Admin';
  const first = adminUser.firstname || '';
  const last = adminUser.lastname || '';
  const full = `${first} ${last}`.trim();
  return full || adminUser.username || adminUser.email || 'Admin';
}

function isEmailEnabledFromEnv() {
  const raw = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * In-app (DB) + socket always on; email only when EMAIL_ENABLED is true in .env.
 * @param {{ isEmailEnabled?: () => boolean } | null | undefined} notifUtil
 */
function getProfileEditNotificationDeliveryOptions(notifUtil) {
  const emailEnabled = typeof notifUtil?.isEmailEnabled === 'function'
    ? notifUtil.isEmailEnabled()
    : isEmailEnabledFromEnv();
  return { sendEmail: emailEnabled, sendSocket: true };
}

module.exports = {
  normalizeCompany,
  normalizeComment,
  resolveUserLocation,
  normalizePendingComments,
  getLatestPendingComment,
  buildAdminDisplayName,
  getProfileEditNotificationDeliveryOptions,
};
