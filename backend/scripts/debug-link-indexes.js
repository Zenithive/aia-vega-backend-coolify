require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  const { rows } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='companies_course_assignments_lnk'
    ORDER BY indexname;
  `);
  console.log(JSON.stringify(rows, null, 2));
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
