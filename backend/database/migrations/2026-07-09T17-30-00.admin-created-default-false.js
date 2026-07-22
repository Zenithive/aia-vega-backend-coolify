'use strict';

/**
 * Migration: ensure admin_created column exists, backfill nulls to false,
 * and set PostgreSQL DEFAULT so INSERTs that omit the field get false.
 */
module.exports = {
  async up(knex) {
    const table = 'quiz_reattempt_requests';
    const column = 'admin_created';

    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(table, column);
    if (!hasColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.boolean(column).defaultTo(false);
      });
    }

    await knex(table).whereNull(column).update({ [column]: false });

    await knex.schema.alterTable(table, (t) => {
      t.boolean(column).defaultTo(false).alter();
    });
  },

  async down(knex) {
    const table = 'quiz_reattempt_requests';
    const column = 'admin_created';

    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasColumn = await knex.schema.hasColumn(table, column);
    if (!hasColumn) return;

    await knex.schema.alterTable(table, (t) => {
      t.boolean(column).defaultTo(null).alter();
    });
  },
};
