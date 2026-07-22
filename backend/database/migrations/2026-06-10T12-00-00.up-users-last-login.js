// @ts-nocheck
'use strict';

module.exports = {
  async up(knex) {
    const table = 'up_users';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(table, 'last_login');
    if (!hasColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.datetime('last_login').nullable();
      });
    }
  },

  async down(knex) {
    const table = 'up_users';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(table, 'last_login');
    if (hasColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('last_login');
      });
    }
  },
};
