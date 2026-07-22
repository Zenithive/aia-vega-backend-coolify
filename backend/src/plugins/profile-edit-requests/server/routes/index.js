module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/requests/count',
        handler: 'profileEditController.getPendingCount',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/requests/locations',
        handler: 'profileEditController.getLocationOptions',
        config: {
          policies: [],
        },
      },
      {
        method: 'GET',
        path: '/requests',
        handler: 'profileEditController.getRequests',
        config: {
          policies: [],
        },
      },
      {
        method: 'POST',
        path: '/requests/:id/pending-comment',
        handler: 'profileEditController.addPendingComment',
        config: {
          policies: [],
        },
      },
      {
        method: 'PUT',
        path: '/requests/:id',
        handler: 'profileEditController.updateStatus',
        config: {
          policies: [],
        },
      },
    ],
  },
};
