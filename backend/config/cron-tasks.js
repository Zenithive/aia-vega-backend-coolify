// @ts-nocheck
'use strict';

const { syncEmployeesFromHrms } = require('../src/cron-tasks/sync-employees');
const { syncVegaEmployees } = require('../src/cron-tasks/sync-vega-employees');
const { syncAiaEmployeePhotos } = require('../src/cron-tasks/sync-aia-employee-photos');

const CRON_TZ = process.env.CRON_TZ || process.env.TZ || 'UTC';
console.log(
  `[cron-config] loaded: CRON_ENABLED=${process.env.CRON_ENABLED ?? 'unset'} TZ=${process.env.TZ ?? 'unset'} CRON_TZ=${process.env.CRON_TZ ?? 'unset'} effective_tz=${CRON_TZ}`
);

module.exports = {
  // AIA employees — fetched from HRMS API, followed immediately by photo sync
  employeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncEmployeesFromHrms(strapi);
      await syncAiaEmployeePhotos(strapi);
    },
    options: {
      rule: '0 0 22 * * *',
      tz: CRON_TZ,
    },
  },

  // Vega employees — fetched from OneDrive Excel via MS Graph
  vegaEmployeeSyncDaily: {
    task: async ({ strapi }) => {
      await syncVegaEmployees(strapi);
    },
    options: {
      rule: '0 0 22 * * *',
      tz: CRON_TZ,
    },
  },

//   // AIA employee photos — synced from mounted NFS share at /mnt/empimages
//   // Runs once daily at 2 PM. Only updates users that don't yet have a photo.
//   aiaEmployeePhotoSync: {
//     task: async ({ strapi }) => {
//       await syncAiaEmployeePhotos(strapi);
//     },
//     options: {
//       rule: '0 0 14 * * *',
//       tz: CRON_TZ,
//     },
//   },
};