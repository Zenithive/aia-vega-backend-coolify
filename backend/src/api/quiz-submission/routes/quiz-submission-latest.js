'use strict';

/**
 * Custom route: get the latest quiz submission for a user+course pair.
 * GET /api/quiz-submissions/latest?userId=&courseId=
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/quiz-submissions/latest',
      handler: 'quiz-submission.getLatest',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
