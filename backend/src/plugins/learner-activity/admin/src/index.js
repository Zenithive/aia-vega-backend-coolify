/**
 * Quiz Management Plugin (Admin) — plugin id "learner-activity" kept so permissions and links stay valid
 *
 * One menu entry for learners' quizzes — answer review, reattempt requests and quiz results.
 * Visible when the admin may open any tab.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';
import { MENU_PERMISSIONS } from './permissions';
import MenuIcon from './components/MenuIcon.jsx';

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    app.registerPlugin({ id: PLUGIN_ID, name });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: MenuIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.main`,
        defaultMessage: 'Quiz Management',
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
