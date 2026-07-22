module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/courses',
        handler: 'quizSubmissionController.getCourses',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/submissions',
        handler: 'quizSubmissionController.getSubmissions',
        config: { policies: [] },
      },
    ],
  },
};
