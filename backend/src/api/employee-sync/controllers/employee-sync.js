//@ts-nocheck
'use strict';

const bcrypt = require('bcryptjs');
const { syncEmployeesFromHrms, backfillUserOrgTaxonomy } = require('../../../cron-tasks/sync-employees');
const { syncVegaEmployees } = require('../../../cron-tasks/sync-vega-employees');
const { syncAiaEmployeePhotos } = require('../../../cron-tasks/sync-aia-employee-photos');

module.exports = {
  async trigger(ctx) {
    const secret = ctx.request.headers['x-sync-secret'] || ctx.request.body?.secret;
    const expected = process.env.EMPLOYEE_SYNC_SECRET || 'sync-secret-2026';

    if (secret !== expected) {
      return ctx.unauthorized('Invalid or missing sync secret');
    }

    syncEmployeesFromHrms(strapi)
      .then(() => syncAiaEmployeePhotos(strapi))
      .catch((err) => {
        strapi.log.error('[employee-sync] manual trigger failed:', err?.message || err);
      });

    return ctx.send({ message: 'Employee sync triggered (photo sync will follow). Check Strapi logs for progress.' });
  },

  async triggerVega(ctx) {
    const secret = ctx.request.headers['x-sync-secret'] || ctx.request.body?.secret;
    const expected = process.env.EMPLOYEE_SYNC_SECRET || 'sync-secret-2026';

    if (secret !== expected) {
      return ctx.unauthorized('Invalid or missing sync secret');
    }

    syncVegaEmployees(strapi).catch((err) => {
      strapi.log.error('[vega-sync] manual trigger failed:', err?.message || err);
    });

    return ctx.send({ message: 'Vega employee sync triggered. Check Strapi logs for progress.' });
  },

  async patchPasswords(ctx) {
    const secret = ctx.request.headers['x-sync-secret'] || ctx.request.body?.secret;
    const expected = process.env.EMPLOYEE_SYNC_SECRET || 'sync-secret-2026';

    if (secret !== expected) {
      return ctx.unauthorized('Invalid or missing sync secret');
    }

    const defaultPassword = process.env.EMPLOYEE_DEFAULT_PASSWORD || 'Welcome@123';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // Get the Employee role id
    const employeeRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'employee' },
      select: ['id'],
    });
    const roleId = employeeRole?.id;

    // Single bulk update for all AIA users — no loop
    const knex = strapi.db.connection;
    const usersTable = 'up_users';
    const rolesTable = 'up_users_role_lnk';

    // Update password in bulk
    const updated = await knex(usersTable)
      .where({ company: 'AIA' })
      .update({ password: passwordHash });

    // Update role in bulk if we found the employee role
    if (roleId) {
      // up_users_role_lnk is the join table for user <-> role in Strapi v5
      const userIds = await knex(usersTable)
        .where({ company: 'AIA' })
        .pluck('id');

      if (userIds.length) {
        await knex(rolesTable).whereIn('user_id', userIds).update({ role_id: roleId });
      }
    }

    strapi.log.info(`[patch-passwords] bulk-patched ${updated} AIA users`);
    return ctx.send({ message: `Patched ${updated} AIA users with default password and Employee role.` });
  },

  async backfillOrgTaxonomy(ctx) {
    const secret = ctx.request.headers['x-sync-secret'] || ctx.request.body?.secret;
    const expected = process.env.EMPLOYEE_SYNC_SECRET || 'sync-secret-2026';

    if (secret !== expected) {
      return ctx.unauthorized('Invalid or missing sync secret');
    }

    const batchSize = Number(ctx.request.body?.batchSize || 500);

    backfillUserOrgTaxonomy(strapi, { batchSize }).catch((err) => {
      strapi.log.error('[employee-sync backfill] manual trigger failed:', err?.message || err);
    });

    return ctx.send({
      message: 'Department/work-location backfill triggered from existing users. Check Strapi logs for progress.',
      batchSize,
    });
  },
};
