// @ts-nocheck
'use strict';

/**
 * Persist employee portal login time on up_users.last_login.
 * @param {import('@strapi/strapi').Core.Strapi} strapi
 * @param {number} userId
 * @returns {Promise<Date|null>}
 */
async function recordUserLastLogin(strapi, userId) {
  if (userId == null) return null;
  const lastLogin = new Date();
  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: userId },
    data: { last_login: lastLogin },
  });
  return lastLogin;
}

module.exports = { recordUserLastLogin };
