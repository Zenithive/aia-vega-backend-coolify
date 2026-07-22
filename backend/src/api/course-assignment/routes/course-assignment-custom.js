'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/course-assignments/import-users-from-excel',
      handler: 'course-assignment.importUsersFromExcel',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/course-assignments/assign',
      handler: 'course-assignment.assign',
      config: {
        policies: [],
      },
    },
  ],
};
