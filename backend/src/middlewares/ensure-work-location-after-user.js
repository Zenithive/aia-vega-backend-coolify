'use strict';

const { ensureWorkLocationForUser } = require('../utils/ensure-work-location-for-user');

/**
 * After a user is created or updated via Content Manager, ensure a Work Location entry exists.
 * For AIA company, use 'branch' field; for Vega company, use 'working_location' field.
 */
module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();

    const debugEnabled = String(process.env.WORK_LOCATION_MW_DEBUG || '').toLowerCase() === 'true';
    const logDebug = (message) => {
      if (debugEnabled) strapi.log.info(message);
    };

    const method = ctx.method;
    const path = (ctx.path || ctx.request?.path || '').toLowerCase();
    logDebug(`[WorkLocationMW] Triggered for path: ${path}, method: ${method}, status: ${ctx.status}`);
    if (!path.includes('content-manager') || !path.includes('users-permissions.user')) {
      logDebug('[WorkLocationMW] Not a user Content Manager route. Skipping.');
      return;
    }
    if (method !== 'POST' && method !== 'PUT') {
      logDebug('[WorkLocationMW] Not a POST or PUT. Skipping.');
      return;
    }
    if (ctx.status < 200 || ctx.status > 299) {
      logDebug(`[WorkLocationMW] Status not 2xx (${ctx.status}). Skipping.`);
      return;
    }

    const body = ctx.body;
    if (!body) {
      logDebug('[WorkLocationMW] No body found. Skipping.');
      return;
    }
    const doc = body?.document ?? body?.data ?? body;
    const company = doc?.company;
    let locationName = null;
    if (company === 'AIA') {
      locationName = doc?.branch;
    } else if (company === 'Vega') {
      locationName = doc?.working_location;
    }
    logDebug(`[WorkLocationMW] company: ${company}, locationName: ${locationName}`);
    if (!locationName || !company) {
      logDebug('[WorkLocationMW] Missing locationName or company. Skipping.');
      return;
    }

    try {
      await ensureWorkLocationForUser(strapi, locationName, company);
      strapi.log.info(`[WorkLocationMW] ensureWorkLocationForUser called for location: ${locationName}, company: ${company}`);
    } catch (err) {
      strapi.log.warn('ensureWorkLocationForUser (middleware) failed', err);
    }
  };
};
