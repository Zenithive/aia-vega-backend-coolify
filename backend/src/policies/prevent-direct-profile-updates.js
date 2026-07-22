/**
 * Prevent users from directly updating sensitive profile fields
 * Users must use the profile-edit-request system instead
 * 
 * Usage in route: policies: ['prevent-direct-profile-updates']
 */
// @ts-nocheck
module.exports = async (policyContext, config, { strapi }) => {
  const { state } = policyContext;
  const user = state.user;

  // Only applies to authenticated users updating their own profile
  if (!user) {
    return true; // Let other policies/auth handle it
  }

  const method = policyContext.method;
  const routePath = policyContext.route?.config?.path || '';

  // Apply to PUT/PATCH on user update endpoints
  if (!['PUT', 'PATCH'].includes(method)) {
    return true;
  }

  // Check if user is updating themselves (not an admin updating another user)
  const targetUserId = policyContext.params?.id;
  const isUpdatingSelf = targetUserId && (
    String(targetUserId) === String(user.id) || 
    String(targetUserId) === String(user.documentId)
  );

  if (!isUpdatingSelf) {
    return true; // Allow (other policies will handle admin updates)
  }

  // Get the request body
  const bodyData = (policyContext.request?.body?.data) || policyContext.request?.body || {};
  
  // Sensitive fields that require profile-edit-request
  const SENSITIVE_FIELDS = [
    'photograph',
    'email',
    'contact_no',
    'designation',
    'department',
    'working_location',
    'branch',
    'date_of_birth',
  ];

  // Check if any sensitive fields are being updated
  const attemptedSensitiveUpdates = Object.keys(bodyData).filter((key) =>
    SENSITIVE_FIELDS.includes(key)
  );

  if (attemptedSensitiveUpdates.length > 0) {
    return policyContext.forbidden(
      `Cannot directly update ${attemptedSensitiveUpdates.join(', ')}. ` +
      'Use the profile-edit-request API to request changes for approval.'
    );
  }

  return true; // Allow non-sensitive updates
};
