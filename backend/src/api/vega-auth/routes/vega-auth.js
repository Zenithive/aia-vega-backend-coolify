'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/vega-auth/status',
      handler: 'vega-auth.status',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/vega-auth/start',
      handler: 'vega-auth.start',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/vega-auth/callback',
      handler: 'vega-auth.callback',
      config: { auth: false },
    },
  ],
};
