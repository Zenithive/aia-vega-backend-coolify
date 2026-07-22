require('dotenv').config();
const { Client } = require('pg');

async function getColumnInfo(client, tableName, columnName) {
  const col = await client.query(
    "select data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2",
    [tableName, columnName]
  );
  return col.rows[0] || null;
}

function isJsonType(info) {
  if (!info) return false;
  return info.data_type === 'json' || info.data_type === 'jsonb' || info.udt_name === 'json' || info.udt_name === 'jsonb';
}

async function ensureActivityLogTelemetryColumns(client) {
  const tableCheck = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='activity_logs'"
  );
  if (tableCheck.rowCount === 0) {
    console.log('activity_logs not found; skipping telemetry column guard');
    return;
  }

  await client.query(`
    ALTER TABLE public.activity_logs
      ADD COLUMN IF NOT EXISTS event_id text,
      ADD COLUMN IF NOT EXISTS session_id text,
      ADD COLUMN IF NOT EXISTS route_path text,
      ADD COLUMN IF NOT EXISTS page_type text,
      ADD COLUMN IF NOT EXISTS entity_type text,
      ADD COLUMN IF NOT EXISTS entity_id text,
      ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS source text,
      ADD COLUMN IF NOT EXISTS ingested_at timestamptz,
      ADD COLUMN IF NOT EXISTS client_ts timestamptz,
      ADD COLUMN IF NOT EXISTS tz_offset integer;
  `);

  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_event_id_uk ON public.activity_logs(event_id) WHERE event_id IS NOT NULL");
  await client.query("CREATE INDEX IF NOT EXISTS activity_logs_ts_idx ON public.activity_logs(\"timestamp\")");
  await client.query("CREATE INDEX IF NOT EXISTS activity_logs_desc_ts_idx ON public.activity_logs(activity_description, \"timestamp\")");
  await client.query("CREATE INDEX IF NOT EXISTS activity_logs_route_ts_idx ON public.activity_logs(route_path, \"timestamp\")");
  await client.query("CREATE INDEX IF NOT EXISTS activity_logs_entity_ts_idx ON public.activity_logs(entity_type, entity_id, \"timestamp\")");

  const cols = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='activity_logs'
      AND column_name IN ('event_id','session_id','route_path','page_type','entity_type','entity_id','click_count','source','ingested_at','client_ts','tz_offset')
    ORDER BY column_name
  `);
  console.log('activity_logs telemetry columns present:', cols.rows.map((r) => r.column_name));
}

async function sanitizeJsonTextColumn(client, tableName, columnName, replacement = '[]') {
  const info = await getColumnInfo(client, tableName, columnName);
  if (!info) {
    console.log(`${tableName}.${columnName} not found; skipping`);
    return;
  }

  console.log(`${tableName}.${columnName} type:`, info);
  if (isJsonType(info)) {
    console.log(`${tableName}.${columnName} already json/jsonb; no pre-fix needed`);
    return;
  }

  const resBlank = await client.query(`
    UPDATE public.${tableName}
    SET ${columnName} = NULL
    WHERE ${columnName} IS NOT NULL
      AND btrim(${columnName}) = ''
  `);

  const resInvalid = await client.query(`
    UPDATE public.${tableName}
    SET ${columnName} = $1
    WHERE ${columnName} IS NOT NULL
      AND btrim(${columnName}) <> ''
      AND public._safe_parse_jsonb(${columnName}) IS NULL
  `, [replacement]);

  const invalid = await client.query(`
    SELECT count(*)::int AS c
    FROM public.${tableName}
    WHERE ${columnName} IS NOT NULL
      AND btrim(${columnName}) <> ''
      AND public._safe_parse_jsonb(${columnName}) IS NULL
  `);

  console.log(`${tableName}.${columnName} blank_to_null:`, resBlank.rowCount);
  console.log(`${tableName}.${columnName} invalid_to_fallback:`, resInvalid.rowCount);
  console.log(`${tableName}.${columnName} invalid_after_fix:`, invalid.rows[0]?.c ?? 0);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  await client.query("CREATE OR REPLACE FUNCTION public._safe_parse_jsonb(input_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN input_text::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END; $$;");

  await ensureActivityLogTelemetryColumns(client);

  await sanitizeJsonTextColumn(client, 'unit_locations', 'note', '[]');
  await sanitizeJsonTextColumn(client, 'components_course_modules', 'text_content', '[]');
  await sanitizeJsonTextColumn(client, 'components_course_modules', 'description', '[]');

  await client.query("DROP FUNCTION IF EXISTS public._safe_parse_jsonb(text);");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
