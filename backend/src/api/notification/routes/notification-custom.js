'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/notifications/me',
      handler: 'api::notification.notification.my',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/notifications/me/all',
      handler: 'api::notification.notification.myAll',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/notifications/mark-read',
      handler: 'api::notification.notification.markRead',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};

