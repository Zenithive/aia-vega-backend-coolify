/**
 * Quiz Management admin routes (prefixed with /learner-activity). Permissions are checked per area in the controller.
 */

const route = (method, path, handler) => ({
  method,
  path,
  handler: `activity.${handler}`,
  config: { policies: [] },
});

module.exports = {
  admin: {
    type: 'admin',
    routes: [
      route('GET', '/summary', 'summary'),

      route('GET', '/quiz-results/courses', 'quizCourses'),
      route('GET', '/quiz-results', 'quizLearners'),
      route('GET', '/quiz-results/attempts', 'quizAttempts'),
      route('GET', '/quiz-results/attempts/:id', 'quizAttempt'),
      route('GET', '/quiz-results/export', 'quizExport'),

      route('GET', '/reviews/courses', 'reviewCourses'),
      route('GET', '/reviews', 'listReviews'),
      route('GET', '/reviews/:id', 'getReview'),
      route('PUT', '/reviews/:id', 'saveReview'),

      route('GET', '/reattempts', 'listReattempts'),
    ],
  },
};
