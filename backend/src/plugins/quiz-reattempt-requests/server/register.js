module.exports = ({ strapi }) => {
  // Register permission for quiz reattempt requests access
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Quiz Reattempt Requests',
      uid: 'read',
      pluginName: 'quiz-reattempt-requests',
    },
  ]);
};
