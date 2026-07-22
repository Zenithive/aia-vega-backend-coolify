'use strict';

/**
 * Migration: Create missing course_assignments_company_lnk table.
 *
 * The course-assignment schema defines a oneToOne relation to company, which
 * Strapi v5 stores in a link table. The table was never created, causing a 500
 * error whenever the course-assignment collection type is loaded in the admin.
 */
module.exports = {
  async up(knex) {
    const table = 'course_assignments_company_lnk';

    const hasTable = await knex.schema.hasTable(table);
    if (hasTable) return;

    await knex.schema.createTable(table, (t) => {
      t.increments('id').primary();
      t.integer('course_assignment_id').unsigned().nullable();
      t.integer('company_id').unsigned().nullable();
      t.double('course_assignment_ord').nullable();
      t.double('company_ord').nullable();
    });

    // Standard Strapi link-table index conventions
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_fk  ON public.${table} (course_assignment_id)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_ifk ON public.${table} (company_id)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_ofk ON public.${table} (course_assignment_ord)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${table}_oifk ON public.${table} (company_ord)`);
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_uq ON public.${table} (course_assignment_id, company_id)`);
  },

  async down(knex) {
    const table = 'course_assignments_company_lnk';
    const hasTable = await knex.schema.hasTable(table);
    if (hasTable) {
      await knex.schema.dropTable(table);
    }
  },
};
