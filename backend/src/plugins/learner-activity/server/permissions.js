// @ts-nocheck
'use strict';

/**
 * Who can open each Quiz Management tab (plugin id stays "learner-activity" so existing role
 * permissions and links keep working).
 *
 * Quiz results and reattempt requests have their own plugin permissions
 * (Settings → Roles → Plugins → Quiz Management). Answer review follows the Content Manager
 * permissions of Quiz Submission. Feedback and offline module proof moved to Course Management.
 */

const PLUGIN_ID = 'learner-activity';
const CM = 'plugin::content-manager.explorer';
const QUIZ_UID = 'api::quiz-submission.quiz-submission';

const ACTIONS = [
  { uid: 'quiz-results', displayName: 'View quiz results' },
  { uid: 'reattempts', displayName: 'Manage quiz reattempt requests' },
];

const action = (uid) => `plugin::${PLUGIN_ID}.${uid}`;

/**
 * Plugin permissions of the separate plugins this one replaced. Roles that had them get the
 * matching Quiz Management permission on the next start (see migrateLegacyPermissions).
 * (The old feedback permission is carried over by Course Management.)
 */
const LEGACY_ACTIONS = {
  'plugin::quiz-submission-admin.read': action('quiz-results'),
  'plugin::quiz-reattempt-requests.read': action('reattempts'),
};

/** Ability checks per area, used by the controllers. */
const AREA_CHECKS = {
  quizResults: { read: (ability) => ability.can(action('quiz-results')) },
  reattempts: { read: (ability) => ability.can(action('reattempts')) },
  answerReview: {
    read: (ability) => ability.can(`${CM}.read`, QUIZ_UID),
    update: (ability) => ability.can(`${CM}.read`, QUIZ_UID) && ability.can(`${CM}.update`, QUIZ_UID),
  },
};

function registerActions(strapi) {
  strapi.admin.services.permission.actionProvider.registerMany(
    ACTIONS.map(({ uid, displayName }) => ({ section: 'plugins', displayName, uid, pluginName: PLUGIN_ID }))
  );
}

/**
 * Copies the old plugins' role permissions to the new actions. Runs right after the DB schema
 * sync — before the admin bootstrap deletes permissions whose plugin is no longer installed —
 * so no role loses access. Idempotent: roles that already have the new action are skipped.
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
    if (created) strapi.log.info(`[${PLUGIN_ID}] carried over ${created} role permission(s) from the replaced plugins`);
  } catch (err) {
    strapi.log.warn(`[${PLUGIN_ID}] could not carry over old plugin permissions: ${err?.message || err}`);
  }
}

module.exports = { PLUGIN_ID, AREA_CHECKS, registerActions, migrateLegacyPermissions };
