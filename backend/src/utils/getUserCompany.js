'use strict';

/**
 * Get authenticated user's company name (AIA or Vega) from JWT.
 * Used for company-scoped filtering across policies, form-templates, unit-locations, etc.
 * @param {object} strapi - Strapi instance
 * @param {object} ctx - Koa context
 * @returns {Promise<string|null>} 'AIA' | 'Vega' | null
 */
async function getUserCompany(strapi, ctx) {
  let userId = ctx.state?.user?.id;
  if (!userId) {
    const authHeader = ctx.request?.header?.authorization || ctx.request?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const jwtService = strapi.plugins?.['users-permissions']?.services?.jwt;
        if (jwtService) {
          const decoded = await jwtService.verify(token);
          userId = decoded?.id ?? decoded?._id;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }
  if (!userId) return null;
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['company'],
  });
  const raw = (user?.company || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'AIA') return 'AIA';
  if (upper === 'VEGA') return 'Vega';
  return null;
}

module.exports = getUserCompany;
