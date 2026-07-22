import React from 'react';
import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { Message } from '@strapi/icons';

const name = pluginPkg.strapi.name;

const FeedbackSubmissionIcon = Message;

export default {
  register(app) {
    app.registerPlugin({ id: PLUGIN_ID, name });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: FeedbackSubmissionIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Feedback Submission',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/FeedbackSubmissionsPage.jsx'),
    });
  },
  bootstrap() {},
  config: { locales: [] },
};
