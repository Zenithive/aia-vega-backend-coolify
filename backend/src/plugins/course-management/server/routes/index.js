/**
 * Admin routes (prefixed with /course-management).
 * Access is checked per action in the controllers against the existing Content Manager
 * permissions for api::course.course and api::course-assignment.course-assignment, so roles
 * configured in Settings → Roles apply here unchanged.
 */

const route = (method, path, handler) => ({
  method,
  path,
  handler,
  config: { policies: [] },
});

module.exports = {
  admin: {
    type: 'admin',
    routes: [
      route('GET', '/options', 'course.options'),
      route('GET', '/courses', 'course.find'),
      route('POST', '/courses', 'course.create'),
      route('GET', '/courses/:documentId', 'course.findOne'),
      route('PUT', '/courses/:documentId', 'course.update'),
      route('DELETE', '/courses/:documentId', 'course.delete'),
      route('POST', '/courses/:documentId/duplicate', 'course.duplicate'),
      route('POST', '/courses/:documentId/publish', 'course.publish'),
      route('POST', '/courses/:documentId/unpublish', 'course.unpublish'),

      route('GET', '/assignment-options', 'assignment.options'),
      route('GET', '/assignment-courses', 'assignment.courses'),
      route('GET', '/assignment-users', 'assignment.searchUsers'),
      route('POST', '/assignment-users', 'assignment.usersByIds'),
      route('GET', '/assignments', 'assignment.find'),
      route('POST', '/assignments', 'assignment.create'),
      route('GET', '/assignments/:documentId', 'assignment.findOne'),
      route('PUT', '/assignments/:documentId', 'assignment.update'),
      route('DELETE', '/assignments/:documentId', 'assignment.delete'),
      route('PUT', '/assignments/:documentId/learner-due-date', 'assignment.updateLearnerDueDate'),

      // Feedback and offline module proof (permissions in ../permissions.js)
      route('GET', '/feedback/courses', 'activity.feedbackCourses'),
      route('GET', '/feedback', 'activity.feedbackResponses'),
      route('GET', '/offline/courses', 'activity.offlineCourses'),
      route('GET', '/offline/courses/:documentId/learners', 'activity.offlineLearners'),
      route('POST', '/offline/completions', 'activity.saveOfflineCompletion'),
      route('DELETE', '/offline/completions/:id', 'activity.removeOfflineCompletion'),
    ],
  },
};
