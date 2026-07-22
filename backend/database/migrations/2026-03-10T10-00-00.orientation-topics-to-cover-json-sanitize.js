'use strict';

/**
 * Migration: sanitize components_course_orientations.topics_to_cover
 *
 * Strapi wants to ALTER this column from text to jsonb.
 * PostgreSQL rejects the cast when existing rows contain values that are not
 * valid JSON (e.g. plain strings).  This migration NULLs those invalid rows so
 * the subsequent ALTER succeeds.
 */

module.exports = {
  async up(knex) {
    const tableExists = await knex.schema.hasTable('components_course_orientations');
    if (!tableExists) return;

    const columnExists = await knex.schema.hasColumn(
      'components_course_orientations',
      'topics_to_cover'
    );
    if (!columnExists) return;

    // Check the current column type. If it is already jsonb nothing to do.
    const info = await knex
      .select('data_type')
      .from('information_schema.columns')
      .where({ table_name: 'components_course_orientations', column_name: 'topics_to_cover' })
      .first();

    if (!info || info.data_type === 'jsonb') return;

    // NULL out any row whose value cannot be parsed by PostgreSQL as JSON.
    // We create a temporary function that silently returns NULL on a JSON parse
    // failure (instead of raising an exception) so we can identify bad rows in a
    // single UPDATE without a cursor or PL/pgSQL block.
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

    await knex.raw(`
      UPDATE "public"."components_course_orientations"
      SET   "topics_to_cover" = NULL
      WHERE "topics_to_cover" IS NOT NULL
        AND _tmp_try_cast_jsonb("topics_to_cover") IS NULL
    `);

    // Clean up the helper function.
    await knex.raw(`DROP FUNCTION IF EXISTS _tmp_try_cast_jsonb(text)`);
  },

  async down() {
    // Nulled data cannot be recovered; this is intentionally a no-op.
  },
};
