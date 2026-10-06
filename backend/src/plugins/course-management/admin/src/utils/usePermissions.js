// @ts-nocheck
import { useRBAC } from '@strapi/strapi/admin';
import { PLUGIN_ID, COURSE_UID, ASSIGNMENT_UID, OFFLINE_UID } from '../pluginId';

const actionsFor = (subject) => {
  const action = (name) => [{ action: `plugin::content-manager.explorer.${name}`, subject }];
  return {
    read: action('read'),
    create: action('create'),
    update: action('update'),
    delete: action('delete'),
    publish: action('publish'),
  };
};

/** Course permissions come from the Content Manager role settings — no separate RBAC to maintain. */
const PERMISSIONS = actionsFor(COURSE_UID);

/** Same for Course Assignments (Settings → Roles → Course Assignments). */
const ASSIGNMENT_PERMISSIONS = actionsFor(ASSIGNMENT_UID);

export function useCoursePermissions() {
  const { allowedActions, isLoading } = useRBAC(PERMISSIONS);
  return { ...allowedActions, isLoading };
}

/** canRead, canCreate, canUpdate, canPublish; saving an assignment publishes it, so create/update need publish too. */
export function useAssignmentPermissions() {
  const { allowedActions, isLoading } = useRBAC(ASSIGNMENT_PERMISSIONS);
  return {
    ...allowedActions,
    canAssign: !!(allowedActions.canCreate && allowedActions.canPublish),
    canEdit: !!(allowedActions.canUpdate && allowedActions.canPublish),
    isLoading,
  };
}

/*
 * Feedback: plugin permission (Settings → Roles → Plugins → Course Management).
 * Offline module proof: Content Manager permissions on Offline Module Completion.
 * Same rules as the server (server/permissions.js). Separate useRBAC calls, because useRBAC
 * names results after the action ("canRead"), so different subjects would merge.
 */
const FEEDBACK_PERMISSIONS = [{ action: `plugin::${PLUGIN_ID}.feedback`, subject: null }];
const OFFLINE_PERMISSIONS = actionsFor(OFFLINE_UID);

/** canFeedback, canOffline, canOfflineUpdate */
export function useActivityPermissions() {
  const feedbackPerms = useRBAC(FEEDBACK_PERMISSIONS);
  const offlinePerms = useRBAC([...OFFLINE_PERMISSIONS.read, ...OFFLINE_PERMISSIONS.update]);
  return {
    canFeedback: !!feedbackPerms.allowedActions.canFeedback,
    canOffline: !!offlinePerms.allowedActions.canRead,
    canOfflineUpdate: !!(offlinePerms.allowedActions.canRead && offlinePerms.allowedActions.canUpdate),
    isLoading: feedbackPerms.isLoading || offlinePerms.isLoading,
  };
}

export const MENU_PERMISSIONS = [
  ...PERMISSIONS.read,
  ...ASSIGNMENT_PERMISSIONS.read,
  ...FEEDBACK_PERMISSIONS,
  ...OFFLINE_PERMISSIONS.read,
];
