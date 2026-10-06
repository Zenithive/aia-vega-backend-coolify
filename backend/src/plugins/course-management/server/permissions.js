// @ts-nocheck
'use strict';

/**
 * Who can open the Feedback and Offline module proof tabs.
 *
 * Feedback has its own plugin permission (Settings → Roles → Plugins → Course Management).
 * Offline module proof follows the Content Manager permissions of Offline Module Completion.
 */

const PLUGIN_ID = 'course-management';
const CM = 'plugin::content-manager.explorer';
const OFFLINE_UID = 'api::offline-module-completion.offline-module-completion';

const ACTIONS = [{ uid: 'feedback', displayName: 'View feedback responses' }];

const action = (uid) => `plugin::${PLUGIN_ID}.${uid}`;

/**
 * Feedback used to live in Learner Activity (now Quiz Management), and before that in its own
 * plugin. Roles that had either permission get the Course Management one on the next start.
 */
const LEGACY_ACTIONS = {
  'plugin::learner-activity.feedback': action('feedback'),
  'plugin::feedback-submission-admin.read': action('feedback'),
};

const AREA_CHECKS = {
  feedback: { read: (ability) => ability.can(action('feedback')) },
  offline: {
    read: (ability) => ability.can(`${CM}.read`, OFFLINE_UID),
    update: (ability) => ability.can(`${CM}.read`, OFFLINE_UID) && ability.can(`${CM}.update`, OFFLINE_UID),
  },
};

function registerActions(strapi) {
  strapi.admin.services.permission.actionProvider.registerMany(
    ACTIONS.map(({ uid, displayName }) => ({ section: 'plugins', displayName, uid, pluginName: PLUGIN_ID }))
  );
}

/**
 * Copies the old role permissions to the new action. Runs right after the DB schema sync —
 * before the admin bootstrap deletes permissions whose action is no longer registered — so no
 * role loses access. Idempotent: roles that already have the new action are skipped.
 */
async function migrateLegacyPermissions(strapi) {
  try {
    const legacy = await strapi.db.query('admin::permission').findMany({
      where: { action: { $in: Object.keys(LEGACY_ACTIONS) } },
      populate: { role: { select: ['id'] } },
    });
    if (!legacy.length) return;

    const targets = [...new Set(Object.values(LEGACY_ACTIONS))];
    const existing = await strapi.db.query('admin::permission').findMany({
      where: { action: { $in: targets } },
      populate: { role: { select: ['id'] } },
    });
    const has = new Set(existing.map((p) => `${p.role?.id}:${p.action}`));

    let created = 0;
    for (const p of legacy) {
      const roleId = p.role?.id;
      const next = LEGACY_ACTIONS[p.action];
      if (!roleId || has.has(`${roleId}:${next}`)) continue;
      await strapi.db.query('admin::permission').create({
        data: { action: next, actionParameters: {}, subject: null, properties: {}, conditions: [], role: roleId },
      });
      has.add(`${roleId}:${next}`);
      created += 1;
    }
    if (created) strapi.log.info(`[${PLUGIN_ID}] carried over ${created} feedback role permission(s)`);
  } catch (err) {
    strapi.log.warn(`[${PLUGIN_ID}] could not carry over feedback permissions: ${err?.message || err}`);
  }
}

module.exports = { PLUGIN_ID, AREA_CHECKS, registerActions, migrateLegacyPermissions };
