/**
 * Audit Log Plugin (Admin)
 *
 * Tracks all changes made to user/employee collection.
 * Shows create, update, delete operations with field-level change tracking.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { List } from '@strapi/icons';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    // Audit Log - sidebar link
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: List,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: ' Audit log - Employee Data Changes',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/AuditLogPage.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
