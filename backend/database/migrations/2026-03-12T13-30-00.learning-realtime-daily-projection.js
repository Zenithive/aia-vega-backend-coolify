'use strict';

/**
 * Migration: Add learning_realtime_daily projection table.
 *
 * Purpose:
 * - Fast real-time learning totals without scanning raw activity_logs.
 * - Additive only; does not modify existing tables/contracts.
 */
module.exports = {
  async up(knex) {
    const table = 'learning_realtime_daily';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) {
      await knex.schema.createTable(table, (t) => {
        t.increments('id').primary();
        t.string('date_key', 10).notNullable(); // YYYY-MM-DD UTC
        t.integer('user_id').notNullable();
        t.integer('company_id').nullable();
        t.integer('module_time_seconds').notNullable().defaultTo(0);
        t.integer('video_time_seconds').notNullable().defaultTo(0);
        t.integer('quiz_time_seconds').notNullable().defaultTo(0);
        t.integer('feedback_time_seconds').notNullable().defaultTo(0);
        t.integer('learning_module_enter_count').notNullable().defaultTo(0);
        t.integer('learning_module_exit_count').notNullable().defaultTo(0);
        t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
        t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());
      });
    }

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    if (isPg) {
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_date_user_uq ON public.${table} (date_key, user_id);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_date_idx ON public.${table} (date_key);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_user_idx ON public.${table} (user_id);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_company_idx ON public.${table} (company_id);`);
      return;
    }

    // sqlite / mysql fallback
    await knex.schema.alterTable(table, (t) => {
      t.unique(['date_key', 'user_id'], `${table}_date_user_uq`);
      t.index(['date_key'], `${table}_date_idx`);
      t.index(['user_id'], `${table}_user_idx`);
      t.index(['company_id'], `${table}_company_idx`);
    });
  },

  async down(knex) {
    const table = 'learning_realtime_daily';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    if (isPg) {
      await q(`DROP INDEX IF EXISTS public.${table}_date_user_uq;`);
      await q(`DROP INDEX IF EXISTS public.${table}_date_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_user_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_company_idx;`);
    }

    await knex.schema.dropTableIfExists(table);
  },
};
