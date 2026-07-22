'use strict';

/**
 * Quick check: do analytics service methods return data?
 * Run from backend: node scripts/check-analytics-api.js
 */

async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  global.strapi = app;

  try {
    const analytics = require('../src/plugins/analytics-dashboard/services/analytics')({ strapi: app });

    console.log('=== Analytics API check ===\n');

    const employees = await analytics.getEmployeesList({});
    const empLen = Array.isArray(employees) ? employees.length : 0;
    console.log('Employees list (no search):', empLen);
    if (empLen > 0) {
      const e0 = employees[0];
      console.log('  First:', e0 && e0.username, e0 && e0.email, 'id:', e0 && e0.id);
    }

    const learningGlobal = await analytics.getLearningGlobal({});
    console.log('\nLearning global KPIs:', learningGlobal && learningGlobal.kpis);
    const statusLen = (learningGlobal && learningGlobal.statusDistribution) ? learningGlobal.statusDistribution.length : 0;
    console.log('  statusDistribution:', statusLen);

    const overallGlobal = await analytics.getOverallGlobal({});
    console.log('\nOverall global KPIs:', overallGlobal && overallGlobal.kpis);

    const departments = await analytics.getDepartmentsList();
    const deptLen = Array.isArray(departments) ? departments.length : 0;
    console.log('\nDepartments:', deptLen);

    console.log('\n=== If counts are 0, check Strapi logs for errors. ===');
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('Check failed:', msg);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    delete global.strapi;
    await app.destroy();
    process.exit(0);
  }
}

main();
