'use strict';

/**
 * Diagnostic: Check activity_log raw row structure and user/company data.
 * Run: node scripts/check-activity-log-data.js
 */

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  const strapi = app;

  try {
    const logs = await strapi.db.query('api::activity-log.activity-log').findMany({
      limit: 3,
      orderBy: { timestamp: 'desc' },
    });
    console.log('\n=== Activity Log Data Check ===\n');
    console.log('Activity logs count:', logs?.length ?? 0);
    if (logs?.length > 0) {
      const row = logs[0];
      console.log('Raw row keys:', Object.keys(row));
      console.log('Sample row:', JSON.stringify(row, null, 2));
    }

    const users = await strapi.db.query('plugin::users-permissions.user').findMany({
      limit: 2,
      select: ['id', 'document_id', 'username', 'email', 'company'],
    });
    console.log('\nUsers sample:', users?.map((u) => ({ id: u.id, document_id: u.document_id, name: u.username, company: u.company })));

    const companies = await strapi.db.query('api::company.company').findMany({
      limit: 5,
      select: ['id', 'document_id', 'name'],
    });
    console.log('\nCompanies sample:', companies?.map((c) => ({ id: c.id, document_id: c.document_id, name: c.name })));
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
