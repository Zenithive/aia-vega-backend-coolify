// @ts-nocheck
import { useRBAC } from '@strapi/strapi/admin';
import { PLUGIN_ID, QUIZ_UID } from './pluginId';

const plugin = (uid) => ({ action: `plugin::${PLUGIN_ID}.${uid}`, subject: null });
const cm = (action, subject) => ({ action: `plugin::content-manager.explorer.${action}`, subject });

/*
 * Same rules as the server (server/permissions.js).
 *
 * useRBAC names each result after the last part of the *action* (".read" → canRead), not
 * after any key we choose, so the Content Manager check must be a separate useRBAC call.
 */
const PLUGIN_PERMISSIONS = [plugin('quiz-results'), plugin('reattempts')];
const REVIEW_PERMISSIONS = [cm('read', QUIZ_UID), cm('update', QUIZ_UID)];

/** Any of these shows the menu entry. */
export const MENU_PERMISSIONS = [...PLUGIN_PERMISSIONS, REVIEW_PERMISSIONS[0]];

/** canQuizResults, canReattempts, canReview, canReviewUpdate */
export function useActivityPermissions() {
  const pluginPerms = useRBAC(PLUGIN_PERMISSIONS);
  const reviewPerms = useRBAC(REVIEW_PERMISSIONS);
  return {
    canQuizResults: !!pluginPerms.allowedActions.canQuizResults,
    canReattempts: !!pluginPerms.allowedActions.canReattempts,
    canReview: !!reviewPerms.allowedActions.canRead,
    canReviewUpdate: !!(reviewPerms.allowedActions.canRead && reviewPerms.allowedActions.canUpdate),
    isLoading: pluginPerms.isLoading || reviewPerms.isLoading,
  };
}
