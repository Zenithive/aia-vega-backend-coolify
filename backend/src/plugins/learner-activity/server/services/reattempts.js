// @ts-nocheck
'use strict';

/**
 * Quiz reattempt requests raised by learners. Approve / reject goes through the Content
 * Manager update endpoint from the admin UI so the request lifecycle records the approver.
 */

const REATTEMPT_UID = 'api::quiz-reattempt-request.quiz-reattempt-request';

module.exports = ({ strapi }) => ({
  async countPending() {
    return strapi.db.query(REATTEMPT_UID).count({ where: { request_status: 'Pending' } });
  },

  async list() {
    return strapi.db.query(REATTEMPT_UID).findMany({
      populate: ['users_permissions_user', 'course', 'approved_by'],
      orderBy: { createdAt: 'desc' },
    });
  },
});
