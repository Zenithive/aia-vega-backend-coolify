'use strict';

/**
 * module-video-progress router
 */


module.exports = {
  routes: [
    // Default CRUD routes (if needed, can be added here)
    {
      method: 'POST',
      path: '/module-video-progresses/mark-as-read',
      handler: 'module-video-progress.markAsRead',
    },
  ],
};

