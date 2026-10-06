/**
 * Course Management Plugin (Admin)
 *
 * A guided UI for course administrators over the existing Course and Course Assignment
 * content types: build a course, then assign it. Visible to every admin role that can read
 * courses or course assignments in the Content Manager.
 */

import { Book } from '@strapi/icons';
import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { MENU_PERMISSIONS } from './utils/usePermissions';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: Book,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Course Management',
      },
      permissions: MENU_PERMISSIONS,
      Component: () => import('./pages/App.jsx'),
    });
  },

  bootstrap() {},
  config: {
    locales: [],
  },
};
