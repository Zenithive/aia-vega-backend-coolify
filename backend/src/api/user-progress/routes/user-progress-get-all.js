'use strict';

/**
 * GET /api/user-progress/all?userId=
 * Returns all progress records for a user (for course list completion badges).
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/user-progress/all',
      handler: 'user-progress.getAllProgress',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
