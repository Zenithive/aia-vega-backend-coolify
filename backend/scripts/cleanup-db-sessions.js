require('dotenv').config();
const { Client } = require('pg');

function makeClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function safeTerminate(client, state) {
  const sql = `
    SELECT pg_terminate_backend(pid) AS terminated
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid()
      AND state = $1
  `;

  const res = await client.query(sql, [state]);
  return res.rows.filter((r) => r.terminated === true).length;
}

async function main() {
  const client = makeClient();
  await client.connect();

  try {
    const before = await client.query(`
      SELECT state, count(*)::int AS c
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
      GROUP BY state
      ORDER BY state
    `);

    const terminatedIdle = await safeTerminate(client, 'idle');
    const terminatedIdleInTx = await safeTerminate(client, 'idle in transaction');

    const after = await client.query(`
      SELECT state, count(*)::int AS c
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
      GROUP BY state
      ORDER BY state
    `);

    console.log('[db-cleanup] terminated idle sessions:', terminatedIdle);
    console.log('[db-cleanup] terminated idle-in-transaction sessions:', terminatedIdleInTx);
    console.log('[db-cleanup] sessions before:', before.rows);
    console.log('[db-cleanup] sessions after:', after.rows);
  } catch (err) {
    console.warn('[db-cleanup] could not inspect/terminate sessions:', err.message || err);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.warn('[db-cleanup] skipped due to connection/permission issue:', err.message || err);
  process.exit(0);
});
