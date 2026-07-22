'use strict';

/**
 * Migration: analytics_events indexes for ingestion and 5-min aggregation queries.
 */
module.exports = {
  async up(knex) {
    const table = 'analytics_events';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    if (isPg) {
      await q(`CREATE INDEX IF NOT EXISTS ${table}_occurred_at_idx ON public.${table} (occurred_at);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_event_name_idx ON public.${table} (event_name);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_route_path_idx ON public.${table} (route_path);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_entity_idx ON public.${table} (entity_type, entity_id);`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_user_id_idx ON public.${table} (user_id);`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_event_id_uq ON public.${table} (event_id);`);
      return;
    }

    // sqlite / mysql fallback
    await knex.schema.alterTable(table, (t) => {
      t.index(['occurred_at'], `${table}_occurred_at_idx`);
      t.index(['event_name'], `${table}_event_name_idx`);
      t.index(['route_path'], `${table}_route_path_idx`);
      t.index(['entity_type', 'entity_id'], `${table}_entity_idx`);
      t.index(['user_id'], `${table}_user_id_idx`);
      t.unique(['event_id'], `${table}_event_id_uq`);
    });
  },

  async down(knex) {
    const table = 'analytics_events';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    if (isPg) {
      await q(`DROP INDEX IF EXISTS public.${table}_occurred_at_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_event_name_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_route_path_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_entity_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_user_id_idx;`);
      await q(`DROP INDEX IF EXISTS public.${table}_event_id_uq;`);
      return;
    }

    await knex.schema.alterTable(table, (t) => {
      t.dropIndex(['occurred_at'], `${table}_occurred_at_idx`);
      t.dropIndex(['event_name'], `${table}_event_name_idx`);
      t.dropIndex(['route_path'], `${table}_route_path_idx`);
      t.dropIndex(['entity_type', 'entity_id'], `${table}_entity_idx`);
      t.dropIndex(['user_id'], `${table}_user_id_idx`);
      t.dropUnique(['event_id'], `${table}_event_id_uq`);
    });
  },
};
