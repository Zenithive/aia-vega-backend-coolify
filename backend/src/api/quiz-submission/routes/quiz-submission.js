'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/quiz-submissions/submit',
      handler: 'api::quiz-submission.quiz-submission.submit',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/quiz-submissions',
      handler: 'api::quiz-submission.quiz-submission.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/quiz-submissions/:id',
      handler: 'api::quiz-submission.quiz-submission.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/quiz-submissions',
      handler: 'api::quiz-submission.quiz-submission.create',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/quiz-submissions/:id',
      handler: 'api::quiz-submission.quiz-submission.update',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/quiz-submissions/:id',
      handler: 'api::quiz-submission.quiz-submission.delete',
      config: { auth: false },
    },
  ],
};