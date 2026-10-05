/**
 * Offline Assessments Plugin (Admin)
 *
 * Upload learners' practical-test proof for offline course modules.
 * Visible to roles that can read Offline Module Completions in the Content Manager.
 */

import { CheckCircle } from '@strapi/icons';
import pluginPkg from '../../package.json';
import { PLUGIN_ID, OFFLINE_UID } from './pluginId';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({ id: PLUGIN_ID, name });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: CheckCircle,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Offline Assessments',
      },
      permissions: [{ action: 'plugin::content-manager.explorer.read', subject: OFFLINE_UID }],
      Component: () => import('./pages/OfflineAssessments.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
