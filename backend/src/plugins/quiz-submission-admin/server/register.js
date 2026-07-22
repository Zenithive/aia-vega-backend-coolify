module.exports = ({ strapi }) => {
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Quiz Submission',
      uid: 'read',
      pluginName: 'quiz-submission-admin',
    },
  ]);
};
