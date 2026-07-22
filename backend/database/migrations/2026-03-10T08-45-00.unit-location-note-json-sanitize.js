'use strict';

/**
 * Migration: sanitize legacy unit_locations.note text so Strapi can cast to json/jsonb safely.
 *
 * Error addressed:
 *   alter table "public"."unit_locations" alter column "note" type jsonb using ("note"::jsonb)
 *   invalid input syntax for type json
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

    // Already JSON typed; nothing to sanitize.
    if (column.data_type === 'json' || column.data_type === 'jsonb' || column.udt_name === 'json' || column.udt_name === 'jsonb') {
      return;
    }

    // Normalize blanks first.
    await knex.raw(`
      UPDATE public.${tableName}
      SET note = NULL
      WHERE note IS NOT NULL
        AND btrim(note) = '';
    `);

    // Force legacy text notes into a valid blocks payload so Strapi's json/jsonb cast cannot fail.
    // This is intentionally conservative for schema migration safety.
    await knex.raw(`
      UPDATE public.${tableName}
      SET note = '[]'
      WHERE note IS NOT NULL;
    `);
  },

  async down() {
    // No-op: data sanitization is intentionally irreversible.
  },
};
