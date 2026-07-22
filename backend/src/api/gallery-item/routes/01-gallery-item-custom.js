'use strict';

/** @type {import('@strapi/strapi').Core.RouterConfig} */
module.exports = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/gallery-items/by-filters',
      handler: 'api::gallery-item.gallery-item.findFiltered',
      config: {
        auth: false,
      },
    },
  ],
};


