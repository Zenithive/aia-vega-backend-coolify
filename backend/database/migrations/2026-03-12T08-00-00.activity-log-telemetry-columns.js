'use strict';

/**
 * Migration: Extend activity_logs to support telemetry event ingestion (Option A).
 *
 * Changes:
 *  - Makes activity_type and activity_description nullable (removes required constraint)
 *  - Changes activity_duration default to 0 (allows zero-duration events)
 *  - Adds 11 new telemetry columns: event_id, session_id, route_path, page_type,
 *    entity_type, entity_id, click_count, source, ingested_at, client_ts, tz_offset
 *  - Changes company relation from manyToMany join-table to plain company_id FK
 *    (the 2025-01-29 migration already added company_id FK to the DB; this aligns the
 *    schema so Strapi no longer tries to manage a join table)
 *  - Adds performance indexes: timestamp, page_type, user_id, unique event_id
 */
module.exports = {
  async up(knex) {
    const table = 'activity_logs';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    // ── 1. Add new telemetry columns (idempotent via hasColumn check) ──────────
    const newColumns = [
      { name: 'event_id',    define: (t) => t.string('event_id', 255).nullable() },
      { name: 'session_id',  define: (t) => t.string('session_id', 255).nullable() },
      { name: 'route_path',  define: (t) => t.string('route_path', 1024).nullable() },
      { name: 'page_type',   define: (t) => t.string('page_type', 100).nullable() },
      { name: 'entity_type', define: (t) => t.string('entity_type', 100).nullable() },
      { name: 'entity_id',   define: (t) => t.string('entity_id', 255).nullable() },
      { name: 'click_count', define: (t) => t.integer('click_count').notNullable().defaultTo(0) },
      { name: 'source',      define: (t) => t.string('source', 50).nullable().defaultTo('web') },
      { name: 'ingested_at', define: (t) => t.datetime('ingested_at', { useTz: false }).nullable() },
      { name: 'client_ts',   define: (t) => t.datetime('client_ts', { useTz: false }).nullable() },
      { name: 'tz_offset',   define: (t) => t.integer('tz_offset').nullable() },
    ];

    for (const col of newColumns) {
      const exists = await knex.schema.hasColumn(table, col.name);
      if (!exists) {
        await knex.schema.alterTable(table, col.define);
      }
    }

    // ── 2. Drop NOT NULL / enum constraint on activity_type and activity_description ──
    if (isPg) {
      await q(`ALTER TABLE ${table} ALTER COLUMN activity_type DROP NOT NULL`);
      await q(`ALTER TABLE ${table} ALTER COLUMN activity_description DROP NOT NULL`);
      await q(`ALTER TABLE ${table} ALTER COLUMN activity_duration SET DEFAULT 0`);
      // Drop CHECK constraint Strapi may have added for the enumeration field
      await q(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_activity_type_check`);
    } else {
      // MySQL — knex .alter() rewrites the column definition
      await knex.schema.alterTable(table, (t) => {
        t.string('activity_type', 255).nullable().alter();
        t.string('activity_description', 255).nullable().alter();
        t.integer('activity_duration').notNullable().defaultTo(0).alter();
      });
    }

    // ── 3. Indexes ──────────────────────────────────────────────────────────────
    if (isPg) {
      await q(`CREATE INDEX IF NOT EXISTS ${table}_timestamp_idx ON public.${table} (timestamp)`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_page_type_idx ON public.${table} (page_type)`);
      await q(`CREATE INDEX IF NOT EXISTS ${table}_user_id_idx  ON public.${table} (user_id)`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_event_id_uq ON public.${table} (event_id) WHERE event_id IS NOT NULL`);
    } else {
      const idxDefs = [
        { cols: ['timestamp'],  name: `${table}_timestamp_idx` },
        { cols: ['page_type'],  name: `${table}_page_type_idx` },
        { cols: ['user_id'],    name: `${table}_user_id_idx` },
      ];
      for (const idx of idxDefs) {
        try {
          await knex.schema.alterTable(table, (t) => t.index(idx.cols, idx.name));
        } catch { /* already exists */ }
      }
      try {
        await knex.schema.alterTable(table, (t) => t.unique(['event_id'], `${table}_event_id_uq`));
      } catch { /* already exists */ }
    }
  },

  async down(knex) {
    const table = 'activity_logs';
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) return;

    const client = knex.client.config.client;
    const isPg = client === 'postgres' || client === 'postgresql';
    const q = (sql) => knex.raw(sql);

    // Drop indexes
    if (isPg) {
      await q(`DROP INDEX IF EXISTS public.${table}_timestamp_idx`);
      await q(`DROP INDEX IF EXISTS public.${table}_page_type_idx`);
      await q(`DROP INDEX IF EXISTS public.${table}_user_id_idx`);
      await q(`DROP INDEX IF EXISTS public.${table}_event_id_uq`);
    } else {
      for (const idxName of [`${table}_timestamp_idx`, `${table}_page_type_idx`, `${table}_user_id_idx`]) {
        try { await knex.schema.alterTable(table, (t) => t.dropIndex([], idxName)); } catch { /* ignore */ }
      }
      try { await knex.schema.alterTable(table, (t) => t.dropUnique(['event_id'], `${table}_event_id_uq`)); } catch { /* ignore */ }
    }

    // Drop new columns
    const newCols = ['event_id', 'session_id', 'route_path', 'page_type', 'entity_type', 'entity_id', 'click_count', 'source', 'ingested_at', 'client_ts', 'tz_offset'];
    for (const col of newCols) {
      const exists = await knex.schema.hasColumn(table, col);
      if (exists) {
        await knex.schema.alterTable(table, (t) => t.dropColumn(col));
      }
    }
  },
};
