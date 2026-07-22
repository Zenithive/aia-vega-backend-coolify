module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/courses',
        handler: 'feedbackSubmissionController.getCourses',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/submissions',
        handler: 'feedbackSubmissionController.getSubmissions',
        config: { policies: [] },
      },
    ],
  },
};
