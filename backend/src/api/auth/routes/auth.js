'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/auth/forgot-password',
      handler: 'auth.forgotPassword',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/reset-forgot-password',
      handler: 'auth.resetForgotPassword',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/login',
      handler: 'auth.login',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/auth/check-admin-access',
      handler: 'auth.checkAdminAccess',
      config: {
        auth: false, // JWT validated manually inside controller
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/auth/admin-token',
      handler: 'auth.adminToken',
      config: {
        auth: false, // JWT validated manually inside controller
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/auth/admin-html-redirect',
      handler: 'auth.adminHtmlRedirect',
      config: {
        auth: false, // token is validated by its own presence and structure
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/change-password',
      handler: 'auth.changePassword',
      config: {
        policies: ['global::isAuthenticated'],
      },
    },
     {
      method: 'GET',
      path: '/auth/check-user',
      handler: 'auth.checkUser',
      auth: false ,
    },
    {
      method: 'POST',
      path: '/auth/update-password',
      handler: 'auth.updatePassword',
      config: {
        policies: ['global::isAuthenticated'],
      },
    },
  ],
};
