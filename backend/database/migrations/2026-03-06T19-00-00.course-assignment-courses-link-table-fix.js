'use strict';

/**
 * Migration: Fix missing courses<->course-assignments link table after relation rename
 *
 * New schema expects: public.courses_course_assignments_lnk
 * Older deployments may still have: public.course_assignments_course_lnk
 *
 * This migration creates the expected link table if missing and backfills rows
 * from the legacy table to preserve existing course assignments.
 */
module.exports = {
  async up(knex) {
    const newTable = 'courses_course_assignments_lnk';
    const oldTable = 'course_assignments_course_lnk';

    const hasNewTable = await knex.schema.hasTable(newTable);
    if (!hasNewTable) {
      await knex.schema.createTable(newTable, (table) => {
        table.increments('id').primary();
        table.integer('course_id').unsigned().nullable();
        table.integer('course_assignment_id').unsigned().nullable();
        table.double('course_assignment_ord').nullable();
        table.double('course_ord').nullable();
      });

      // Match Strapi link-table index conventions.
      await knex.raw(`CREATE INDEX IF NOT EXISTS ${newTable}_fk ON public.${newTable} (course_id)`);
      await knex.raw(`CREATE INDEX IF NOT EXISTS ${newTable}_ifk ON public.${newTable} (course_assignment_id)`);
      await knex.raw(`CREATE INDEX IF NOT EXISTS ${newTable}_ofk ON public.${newTable} (course_assignment_ord)`);
      await knex.raw(`CREATE INDEX IF NOT EXISTS ${newTable}_oifk ON public.${newTable} (course_ord)`);
      await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${newTable}_uq ON public.${newTable} (course_id, course_assignment_id)`);
    }

    const hasOldTable = await knex.schema.hasTable(oldTable);
    if (!hasOldTable) return;

    // Backfill existing links from legacy table (idempotent via NOT EXISTS).
    await knex.raw(`
      INSERT INTO public.${newTable} (course_id, course_assignment_id)
      SELECT old.course_id, old.course_assignment_id
      FROM public.${oldTable} old
      WHERE old.course_id IS NOT NULL
        AND old.course_assignment_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.${newTable} cur
          WHERE cur.course_id = old.course_id
            AND cur.course_assignment_id = old.course_assignment_id
        );
    `);
  },

  async down(knex) {
    const newTable = 'courses_course_assignments_lnk';
    const hasNewTable = await knex.schema.hasTable(newTable);
    if (hasNewTable) {
      await knex.schema.dropTable(newTable);
    }
  },
};
