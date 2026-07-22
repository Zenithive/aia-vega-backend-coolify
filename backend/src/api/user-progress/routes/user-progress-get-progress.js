'use strict';

/**
 * Custom route: fetch a user's progress for a specific course.
 * GET /api/user-progress/progress?userId=&courseId=
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/user-progress/progress',
      handler: 'user-progress.getProgress',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
