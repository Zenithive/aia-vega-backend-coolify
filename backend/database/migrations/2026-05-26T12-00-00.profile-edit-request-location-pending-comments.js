// @ts-nocheck
'use strict';

module.exports = {
  async up(knex) {
    const table = 'profile_edit_requests';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasLocationColumn = await knex.schema.hasColumn(table, 'user_location');
    if (!hasLocationColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.string('user_location').nullable();
      });
    }

    const hasCommentsColumn = await knex.schema.hasColumn(table, 'pending_admin_comments');
    if (!hasCommentsColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.jsonb('pending_admin_comments').nullable();
      });
    }
  },

  async down(knex) {
    const table = 'profile_edit_requests';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasCommentsColumn = await knex.schema.hasColumn(table, 'pending_admin_comments');
    if (hasCommentsColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('pending_admin_comments');
      });
    }

    const hasLocationColumn = await knex.schema.hasColumn(table, 'user_location');
    if (hasLocationColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('user_location');
      });
    }
  },
};
