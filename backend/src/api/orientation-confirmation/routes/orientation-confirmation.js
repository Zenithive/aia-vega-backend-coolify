'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orientation-confirmations/confirm',
      handler: 'api::orientation-confirmation.orientation-confirmation.confirm',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/orientation-confirmations',
      handler: 'api::orientation-confirmation.orientation-confirmation.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/orientation-confirmations/:id',
      handler: 'api::orientation-confirmation.orientation-confirmation.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/orientation-confirmations',
      handler: 'api::orientation-confirmation.orientation-confirmation.create',
      config: { auth: false },
    },
    {
      method: 'PUT',
      path: '/orientation-confirmations/:id',
      handler: 'api::orientation-confirmation.orientation-confirmation.update',
      config: { auth: false },
    },
    {
      method: 'DELETE',
      path: '/orientation-confirmations/:id',
      handler: 'api::orientation-confirmation.orientation-confirmation.delete',
      config: { auth: false },
    }
  ],
};
