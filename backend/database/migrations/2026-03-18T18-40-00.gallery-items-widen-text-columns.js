'use strict';

/**
 * Migration: ensure gallery_items long fields are text to prevent varchar(255) publish/update failures.
 * - title: varchar(255) -> text
 * - description: varchar(255) -> text
 * - location: varchar(255) -> text
 */

module.exports = {
  async up(knex) {
    const q = (sql) => knex.raw(sql);

    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "title" TYPE text');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "description" TYPE text');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "location" TYPE text');
  },

  async down(knex) {
    const q = (sql) => knex.raw(sql);

    // Truncate to fit varchar(255) if rollback is needed.
    await q('UPDATE "public"."gallery_items" SET "title" = LEFT(COALESCE("title", \'\'), 255)');
    await q('UPDATE "public"."gallery_items" SET "description" = LEFT(COALESCE("description", \'\'), 255)');
    await q('UPDATE "public"."gallery_items" SET "location" = LEFT(COALESCE("location", \'\'), 255)');

    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "title" TYPE varchar(255)');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "description" TYPE varchar(255)');
    await q('ALTER TABLE "public"."gallery_items" ALTER COLUMN "location" TYPE varchar(255)');
  },
};
