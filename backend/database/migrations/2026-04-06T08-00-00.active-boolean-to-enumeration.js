'use strict';

/**
 * Migration: Convert `active` column values from boolean text to enumeration strings.
 *
 * By the time this migration runs, Strapi's own schema sync has already altered
 * the column type from boolean to character varying. This migration only needs to
 * UPDATE existing row values:
 *
 *   'true' / 't' / '1'  -> 'published'
 *   'false' / 'f' / '0' -> 'unpublished'
 *   NULL                 -> 'published'   (default)
 *   already correct      -> left untouched
 *
 * Affected tables:
 *   company_policies, form_templates, course_assignments, courses,
 *   companies, events, news_categories, unit_locations, important_links,
 *   news_items, holidays
 */

const TABLES = [
  'company_policies',
  'form_templates',
  'course_assignments',
  'courses',
  'companies',
  'events',
  'news_categories',
  'unit_locations',
  'important_links',
  'news_items',
  'holidays',
];

module.exports = {
  async up(knex) {
    for (const table of TABLES) {
      const hasTable = await knex.schema.hasTable(table);
      if (!hasTable) {
        console.log(`[migration] Table "${table}" not found, skipping.`);
        continue;
      }

      const hasColumn = await knex.schema.hasColumn(table, 'active');
      if (!hasColumn) {
        console.log(`[migration] Column "active" not found in "${table}", skipping.`);
        continue;
      }

      console.log(`[migration] Updating "${table}".active values to enumeration strings.`);

      // Map truthy text representations -> 'published'
      await knex(table)
        .whereRaw(`"active"::text IN ('true', 't', '1', 'yes')`)
        .update({ active: 'published' });

      // Map falsy text representations -> 'unpublished'
      await knex(table)
        .whereRaw(`"active"::text IN ('false', 'f', '0', 'no')`)
        .update({ active: 'unpublished' });

      // Fill any NULLs with the default
      await knex(table).whereNull('active').update({ active: 'published' });

      // Rows already containing 'published' or 'unpublished' are left as-is.

      console.log(`[migration] "${table}".active values updated successfully.`);
    }
  },

  async down(knex) {
    for (const table of TABLES) {
      const hasTable = await knex.schema.hasTable(table);
      if (!hasTable) continue;

      const hasColumn = await knex.schema.hasColumn(table, 'active');
      if (!hasColumn) continue;

      console.log(`[migration] Rolling back "${table}".active enum values to boolean text.`);

      // Strapi's own schema rollback handles the type change back to boolean.
      // We only need to restore values to what PostgreSQL expects for boolean casting.
      await knex(table).where('active', 'published').update({ active: 'true' });
      await knex(table).where('active', 'unpublished').update({ active: 'false' });

      console.log(`[migration] "${table}".active rolled back successfully.`);
    }
  },
};
