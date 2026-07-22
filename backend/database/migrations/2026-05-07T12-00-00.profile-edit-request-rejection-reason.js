// @ts-nocheck
'use strict';

module.exports = {
  async up(knex) {
    const table = 'profile_edit_requests';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasReasonColumn = await knex.schema.hasColumn(table, 'reason_for_rejection');
    if (!hasReasonColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.text('reason_for_rejection').nullable();
      });
    }
  },

  async down(knex) {
    const table = 'profile_edit_requests';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const hasReasonColumn = await knex.schema.hasColumn(table, 'reason_for_rejection');
    if (hasReasonColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('reason_for_rejection');
      });
    }
  },
};