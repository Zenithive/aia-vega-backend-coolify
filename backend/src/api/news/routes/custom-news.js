'use strict';

/**
 * Custom news routes for like/unlike functionality.
 * Full path (same as other APIs: quiz-submissions, notifications, etc.) → POST /api/news-items/:id/like
 */
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/news-items/likes-counts',
      handler: 'news.likesCounts',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/news-items/:id/like',
      handler: 'news.like',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/news-items/:id/likes-state',
      handler: 'news.likesState',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/news-items/:id/unlike',
      handler: 'news.unlike',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
