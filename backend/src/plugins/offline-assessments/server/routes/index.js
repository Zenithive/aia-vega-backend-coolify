/**
 * Admin routes (prefixed with /offline-assessments). Permissions are checked in the
 * controller against the Content Manager permissions for Offline Module Completion.
 */

const route = (method, path, handler) => ({
  method,
  path,
  handler: `assessment.${handler}`,
  config: { policies: [] },
});

module.exports = {
  admin: {
    type: 'admin',
    routes: [
      route('GET', '/courses', 'courses'),
      route('GET', '/courses/:documentId/learners', 'learners'),
      route('POST', '/completions', 'saveCompletion'),
      route('DELETE', '/completions/:id', 'removeCompletion'),
    ],
  },
};
