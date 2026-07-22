'use strict';

/**
 * quiz-reattempt-request router - explicit routes so we can set auth: false for create
 */
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/quiz-reattempt-requests',
      handler: 'api::quiz-reattempt-request.quiz-reattempt-request.create',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/quiz-reattempt-requests',
      handler: 'api::quiz-reattempt-request.quiz-reattempt-request.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/quiz-reattempt-requests/:id',
      handler: 'api::quiz-reattempt-request.quiz-reattempt-request.findOne',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/quiz-reattempt-requests/:id',
      handler: 'api::quiz-reattempt-request.quiz-reattempt-request.update',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/quiz-reattempt-requests/:id',
      handler: 'api::quiz-reattempt-request.quiz-reattempt-request.delete',
      config: { auth: false },
    },
  ],
};
