'use strict';

/**
 * Follow-up migration: force-sanitize unit_locations.note for json/jsonb cast.
 *
 * Some environments already marked the previous migration as executed,
 * so we run an explicit follow-up to guarantee safe data before schema sync.
 */
module.exports = {
  async up(knex) {
    const tableName = 'unit_locations';
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) return;

    const hasNote = await knex.schema.hasColumn(tableName, 'note');
    if (!hasNote) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    if (!isPg) return;

    const column = await knex('information_schema.columns')
      .select('data_type', 'udt_name')
      .where({
        table_schema: 'public',
        table_name: tableName,
        column_name: 'note',
      })
      .first();

    if (!column) return;

    // If already JSON-typed, nothing to do.
    if (column.data_type === 'json' || column.data_type === 'jsonb' || column.udt_name === 'json' || column.udt_name === 'jsonb') {
      return;
    }

    await knex.raw(`UPDATE public.${tableName} SET note = NULL WHERE note IS NOT NULL AND btrim(note) = '';`);
    await knex.raw(`UPDATE public.${tableName} SET note = '[]' WHERE note IS NOT NULL;`);
  },

  async down() {
    // No-op: intentionally irreversible data sanitation.
  },
};
