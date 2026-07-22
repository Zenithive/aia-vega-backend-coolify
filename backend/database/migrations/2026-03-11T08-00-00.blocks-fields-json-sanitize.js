'use strict';

/**
 * Migration: sanitize all "blocks" (jsonb) columns that still hold plain-text values.
 *
 * Strapi's schema-sync ALTER TABLE … ALTER COLUMN … TYPE jsonb fails when a
 * column contains rows that are not valid JSON.  This migration creates a
 * transient PL/pgSQL helper, uses it to NULL out every un-parseable row in
 * each affected column, then drops the helper — leaving the columns clean so
 * PostgreSQL can complete the ALTER.
 *
 * Tables / columns covered:
 *   - components_course_modules  . text_content
 *   - components_course_modules  . description
 *   - unit_locations             . note  (covered by an earlier migration, kept here as guard)
 */

const TARGETS = [
  { table: 'components_course_modules', column: 'text_content' },
  { table: 'components_course_modules', column: 'description' },
];

module.exports = {
  async up(knex) {
    // Create a helper function that silently returns NULL instead of throwing
    // when the input text cannot be parsed as JSONB.
    await knex.raw(`
      CREATE OR REPLACE FUNCTION _tmp_try_cast_jsonb(val text)
      RETURNS jsonb
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      BEGIN
        RETURN val::jsonb;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
      $$
    `);

    for (const { table, column } of TARGETS) {
      const tableExists = await knex.schema.hasTable(table);
      if (!tableExists) continue;

      const columnExists = await knex.schema.hasColumn(table, column);
      if (!columnExists) continue;

      // Skip if already jsonb — nothing to sanitize.
      const info = await knex
        .select('data_type')
        .from('information_schema.columns')
        .where({ table_name: table, column_name: column })
        .first();

      if (!info || info.data_type === 'jsonb') continue;

      await knex.raw(`
        UPDATE "${table}"
        SET   "${column}" = NULL
        WHERE "${column}" IS NOT NULL
          AND _tmp_try_cast_jsonb("${column}") IS NULL
      `);
    }

    await knex.raw(`DROP FUNCTION IF EXISTS _tmp_try_cast_jsonb(text)`);
  },

  async down() {
    // Nulled data cannot be recovered — intentional no-op.
  },
};
