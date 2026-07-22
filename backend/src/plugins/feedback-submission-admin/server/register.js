module.exports = ({ strapi }) => {
  strapi.admin.services.permission.actionProvider.registerMany([
    {
      section: 'plugins',
      displayName: 'Access Feedback Submission',
      uid: 'read',
      pluginName: 'feedback-submission-admin',
    },
  ]);
};
