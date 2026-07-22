import React from 'react';
import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { Book } from '@strapi/icons';

const name = pluginPkg.strapi.name;

const QuizSubmissionIcon = Book;

export default {
  register(app) {
    app.registerPlugin({ id: PLUGIN_ID, name });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: QuizSubmissionIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Quiz Submission',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/QuizSubmissionsPage.jsx'),
    });
  },
  bootstrap() {},
  config: { locales: [] },
};
