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
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('companies_course_assignments_lnk','course_assignments_work_locations_lnk')
    ORDER BY table_name, ordinal_position;
  `);
  console.log(JSON.stringify(rows, null, 2));
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
