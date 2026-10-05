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
      // Descriptive answer review (permissions checked in the controller).
      {
        method: 'GET',
        path: '/reviews',
        handler: 'quizReviewController.listReviews',
        config: { policies: [] },
      },
      {
        method: 'GET',
        path: '/reviews/:id',
        handler: 'quizReviewController.getReview',
        config: { policies: [] },
      },
      {
        method: 'PUT',
        path: '/reviews/:id',
        handler: 'quizReviewController.saveReview',
        config: { policies: [] },
      },
    ],
  },
};
