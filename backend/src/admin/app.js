// @ts-nocheck
/**
 * Strapi v5 Admin Customization
 * 
 * This file extends the Strapi Admin sidebar without modifying core or Content Manager.
 * It creates a custom menu structure with role-based visibility.
 * 
 * Structure:
 * - Content Manager (visible only to Super Admin)
 * - All Modules (collapsible group, visible to business roles)
 *   ├── HR Module
 *   │   ├── Employees
 *   │   └── Designations
 *   └── Learning Module
 *       ├── Courses
 *       └── Quizzes
 * 
 * Implementation Notes:
 * - Uses app.addMenuLink() API (official Strapi v5 method)
 * - Menu items with 'parent' property create collapsible groups
 * - Role-based visibility is handled through permissions and menu hooks
 */

import CourseLanguageSyncOnSelect from './components/CourseLanguageSyncOnSelect.jsx';
import AutoFillComponentIds from './components/AutoFillComponentIds.jsx';
import HideAddButtonsForQuizFeedback from './components/HideAddButtonsForQuizFeedback.jsx';
import CourseWorkflowOfflineModuleSyncOnSelect from './components/CourseWorkflowOfflineModuleSyncOnSelect.jsx';
import CourseWorkflowDisableOfflineModuleAddButtons from './components/CourseWorkflowDisableOfflineModuleAddButtons.jsx';
import WorkflowPrerequisitePickerInput from './components/WorkflowPrerequisitePickerInput.jsx';
import CourseWorkflowModuleIndexLabel from './components/CourseWorkflowModuleIndexLabel';
import CourseAssignmentCompanyFilter from './components/CourseAssignmentCompanyFilter.jsx';
import CourseWorkflowCompanyFilter from './components/CourseWorkflowCompanyFilter.jsx';
import EventCompanyFilter from './components/EventCompanyFilter.jsx';
import HolidayCompanyFilter from './components/HolidayCompanyFilter.jsx';
import CourseAssignmentExcelUserUpload from './components/CourseAssignmentExcelUserUpload.jsx';
import KeepRelationDropdownOpen from './components/KeepRelationDropdownOpen.jsx';
import { installVegaDuplicateCourseFetchInterceptor, installCourseAssignmentCoursesTablePatch } from './utils/vegaDuplicateCourseFetch.js';

const ADMIN_HOME_PATH = '/admin';
const ADMIN_TAB_TITLE = 'AIA-VEGA';

function enforceAdminTabTitle() {
  if (typeof document === 'undefined') {
    return;
  }

  const setExactTitle = () => {
    const titleEl = document.querySelector('title');
    if (titleEl && titleEl.textContent !== ADMIN_TAB_TITLE) {
      titleEl.textContent = ADMIN_TAB_TITLE;
    }
  };

  setExactTitle();

  const titleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  if (titleDescriptor) {
    Object.defineProperty(document, 'title', {
      set() {
        if (typeof titleDescriptor.set === 'function') {
          titleDescriptor.set.call(this, ADMIN_TAB_TITLE);
        } else {
          setExactTitle();
        }
      },
      get() {
        if (typeof titleDescriptor.get === 'function') {
          return titleDescriptor.get.call(this) || ADMIN_TAB_TITLE;
        }
        return ADMIN_TAB_TITLE;
      },
      configurable: true,
    });
  }

  const titleEl = document.querySelector('title');
  if (titleEl && window.MutationObserver) {
    const observer = new MutationObserver(() => {
      setExactTitle();
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
}

function installAdminLogoHomeRedirect() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const navigateHome = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (window.location.pathname !== ADMIN_HOME_PATH) {
      window.location.assign(ADMIN_HOME_PATH);
    }
  };

  const bindClickableBrandTarget = (el) => {
    if (!el || el.dataset.vegaLogoHomeBound === '1') {
      return;
    }

    el.dataset.vegaLogoHomeBound = '1';
    el.style.cursor = 'pointer';

    if (!(el instanceof HTMLAnchorElement)) {
      el.setAttribute('role', el.getAttribute('role') || 'link');
      if (!el.hasAttribute('tabindex')) {
        el.setAttribute('tabindex', '0');
      }
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          navigateHome(event);
        }
      });
    } else {
      el.setAttribute('href', ADMIN_HOME_PATH);
    }

    el.addEventListener('click', navigateHome);
  };

  const isSidebarUploadedLogoTarget = (el) => {
    if (!(el instanceof Element)) {
      return false;
    }

    const sidebarRoot = el.closest('aside, nav, [data-testid*="main-nav" i], [data-testid*="left-menu" i]');
    if (!sidebarRoot) {
      return false;
    }

    const logoImage =
      (el.tagName === 'IMG' ? el : el.closest('img')) ||
      el.querySelector?.('img') ||
      null;

    if (!logoImage) {
      return false;
    }

    const src = String(logoImage.getAttribute('src') || '').toLowerCase();
    const alt = String(logoImage.getAttribute('alt') || '').toLowerCase();
    const indicatesLogo = src.includes('/uploads/') || src.includes('logo') || alt.includes('logo');
    if (!indicatesLogo) {
      return false;
    }

    const rect = logoImage.getBoundingClientRect();
    return Number.isFinite(rect.top) && rect.top < 220;
  };

  const installDelegatedLogoRedirect = () => {
    if (document.body?.dataset?.vegaDelegatedLogoRedirectBound === '1') {
      return;
    }

    document.body.dataset.vegaDelegatedLogoRedirectBound = '1';

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || !isSidebarUploadedLogoTarget(target)) {
          return;
        }
        navigateHome(event);
      },
      true
    );

    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }

        const active = document.activeElement instanceof Element ? document.activeElement : null;
        if (!active || !isSidebarUploadedLogoTarget(active)) {
          return;
        }

        navigateHome(event);
      },
      true
    );
  };

  const markSidebarLogoAsClickable = () => {
    const candidates = document.querySelectorAll(
      'aside img, nav img, [data-testid*="main-nav" i] img, [data-testid*="left-menu" i] img'
    );

    candidates.forEach((img) => {
      if (!(img instanceof Element) || !isSidebarUploadedLogoTarget(img)) {
        return;
      }

      const clickable = img.closest('a, button, [role="button"], [role="link"], div, span') || img;
      if (clickable instanceof HTMLElement) {
        clickable.style.cursor = 'pointer';
        if (!clickable.hasAttribute('tabindex')) {
          clickable.setAttribute('tabindex', '0');
        }
        if (!clickable.hasAttribute('role')) {
          clickable.setAttribute('role', 'link');
        }
      }
    });
  };

  const findSidebarBrandTarget = () => {
    const aside = document.querySelector('aside');
    if (!aside) {
      return null;
    }

    const directTarget =
      aside.querySelector('a[aria-label="Home"]') ||
      aside.querySelector('button[aria-label="Home"]') ||
      aside.querySelector('a[href="/admin"]') ||
      aside.querySelector('a[href="/admin/"]') ||
      aside.querySelector('[data-testid*="navbrand" i]');

    if (directTarget) {
      return directTarget;
    }

    const withBrandText = Array.from(aside.querySelectorAll('*')).find((el) => {
      const text = (el.textContent || '').trim().toLowerCase();
      return text === 'aia-vega' || text === 'strapi';
    });

    if (withBrandText) {
      return withBrandText.closest('a,button,div') || withBrandText;
    }

    const withLogoAsset = Array.from(aside.querySelectorAll('img,svg')).find((node) => {
      const clickable = node.closest('a,button,div');
      if (!clickable) {
        return false;
      }
      const topRegion = clickable.getBoundingClientRect().top;
      return Number.isFinite(topRegion) && topRegion < 220;
    });

    return withLogoAsset ? withLogoAsset.closest('a,button,div') : null;
  };

  const wireLogoLinks = () => {
    const brandTarget = findSidebarBrandTarget();
    bindClickableBrandTarget(brandTarget);
    installDelegatedLogoRedirect();
    markSidebarLogoAsClickable();
  };

  wireLogoLinks();

  if (window.MutationObserver) {
    const observer = new MutationObserver(() => {
      wireLogoLinks();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

export default {
  /**
   * Register function - runs when the admin panel initializes
   * This is where we add custom menu links to the sidebar
   * 
  * @param {any} app - Strapi admin app instance
   */
  register(app) {
    // Custom field: date picker that only allows today or future (e.g. News publish date)
    app.customFields.register({
      name: 'date-future-only',
      type: 'date',
      intlLabel: {
        id: 'app.custom-fields.date-future-only.label',
        defaultMessage: 'Date (today or future only)',
      },
      intlDescription: {
        id: 'app.custom-fields.date-future-only.description',
        defaultMessage: 'Calendar will not allow selecting past dates.',
      },
      components: {
        Input: async () => import('./components/DateFutureOnlyInput.jsx').then((m) => ({ default: m.default })),
      },
    });

    // Custom field: multi-select dropdown with configurable options and required
    app.customFields.register({
      name: 'multi-select-dropdown',
      type: 'json',
      intlLabel: {
        id: 'app.custom-fields.multi-select-dropdown.label',
        defaultMessage: 'Multi-select dropdown',
      },
      intlDescription: {
        id: 'app.custom-fields.multi-select-dropdown.description',
        defaultMessage: 'Select multiple options. Configure options in Base settings when adding the field.',
      },
      components: {
        Input: async () => import('./components/MultiSelectDropdownInput.jsx').then((m) => ({ default: m.default })),
      },
      options: {
        base: [
          {
            sectionTitle: {
              id: 'app.custom-fields.multi-select-dropdown.section',
              defaultMessage: 'Dropdown options',
            },
            items: [
              {
                intlLabel: { id: 'app.custom-fields.multi-select-dropdown.required', defaultMessage: 'Required' },
                name: 'options.required',
                type: 'checkbox',
                description: 'At least one option must be selected.',
              },
              {
                intlLabel: { id: 'app.custom-fields.multi-select-dropdown.optionsList', defaultMessage: 'Dropdown options' },
                name: 'options.optionsList',
                type: 'textarea',
                description: 'One option per line. Use "label:value" to show a different label (e.g. "Display Name:dn").',
              },
              {
                intlLabel: { id: 'app.custom-fields.multi-select-dropdown.placeholder', defaultMessage: 'Placeholder' },
                name: 'options.placeholder',
                type: 'text',
                description: 'Shown when no option is selected. Example: Select course languages',
              },
            ],
          },
        ],
      },
    });

    // Custom field: Yes/No toggle (boolean) – appears in Custom tab when adding a field
    app.customFields.register({
      name: 'yes-no-toggle',
      type: 'boolean',
      intlLabel: {
        id: 'app.custom-fields.yes-no-toggle.label',
        defaultMessage: 'Yes/No Toggle',
      },
      intlDescription: {
        id: 'app.custom-fields.yes-no-toggle.description',
        defaultMessage: 'Boolean field shown as a toggle (Yes/No). You can make it required in Base or Advanced settings.',
      },
      components: {
        Input: async () => import('./components/YesNoToggleInput.jsx').then((m) => ({ default: m.default })),
      },
      options: {
        base: [
          {
            sectionTitle: {
              id: 'app.custom-fields.yes-no-toggle.section',
              defaultMessage: 'Yes/No Toggle',
            },
            items: [
              {
                intlLabel: { id: 'app.custom-fields.yes-no-toggle.required', defaultMessage: 'Required' },
                name: 'options.required',
                type: 'checkbox',
                description: 'Field must be set (user must choose Yes or No).',
              },
            ],
          },
        ],
      },
    });

    // Custom field: number/integer with min, max, integerOnly, positiveOnly (configurable in Content-Type Builder)
    app.customFields.register({
      name: 'number-range',
      type: 'integer',
      intlLabel: {
        id: 'app.custom-fields.number-range.label',
        defaultMessage: 'Number (range / integer / positive)',
      },
      intlDescription: {
        id: 'app.custom-fields.number-range.description',
        defaultMessage: 'Integer with optional min/max. Configure in Base settings when adding the field.',
      },
      components: {
        Input: async () => import('./components/NumberRangeInput.jsx').then((m) => ({ default: m.default })),
      },
      options: {
        base: [
          {
            sectionTitle: {
              id: 'app.custom-fields.number-range.section',
              defaultMessage: 'Number range',
            },
            items: [
              {
                intlLabel: { id: 'app.custom-fields.number-range.required', defaultMessage: 'Required' },
                name: 'options.required',
                type: 'checkbox',
                description: 'Field must have a value.',
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.positiveOnly', defaultMessage: 'Positive only (no negative)' },
                name: 'options.positiveOnly',
                type: 'checkbox',
                value: true,
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.integerOnly', defaultMessage: 'Integer only (no decimals)' },
                name: 'options.integerOnly',
                type: 'checkbox',
                value: true,
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.min', defaultMessage: 'Minimum value' },
                name: 'options.min',
                type: 'text',
                description: 'Leave empty for no minimum. Example: 0',
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.max', defaultMessage: 'Maximum value' },
                name: 'options.max',
                type: 'text',
                description: 'Leave empty for no maximum. Example: 100',
              },
              {
                intlLabel: { id: 'app.custom-fields.number-range.placeholder', defaultMessage: 'Placeholder' },
                name: 'options.placeholder',
                type: 'text',
                description: 'Shown when empty. Example: Enter score',
              },
            ],
          },
        ],
      },
    });

    // Custom field: prerequisite module picker for Course Workflow — shows other modules in the same form
    app.customFields.register({
      name: 'workflow-prerequisite-picker',
      type: 'json',
      intlLabel: {
        id: 'app.custom-fields.workflow-prerequisite-picker.label',
        defaultMessage: 'Prerequisite Modules',
      },
      intlDescription: {
        id: 'app.custom-fields.workflow-prerequisite-picker.description',
        defaultMessage: 'Select other workflow modules that must be completed before this one.',
      },
      components: {
        Input: async () =>
          import('./components/WorkflowPrerequisitePickerInput.jsx').then((m) => ({ default: m.default })),
      },
    });

    // When Course language selection changes, sync modules/quiz/feedback_question in the form (on select, not on save)
    const contentManager = app.getPlugin('content-manager');
    if (contentManager && typeof contentManager.injectComponent === 'function') {
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseLanguageSyncOnSelect',
        Component: CourseLanguageSyncOnSelect,
      });
      // Fill component id fields (module_id, quiz_id, question_id, route_id, stop_id) before save
      contentManager.injectComponent('editView', 'right-links', {
        name: 'AutoFillComponentIds',
        Component: AutoFillComponentIds,
      });
      // Hide "Add entry" button for quiz and feedback since auto-creation handles it
      contentManager.injectComponent('editView', 'right-links', {
        name: 'HideAddButtonsForQuizFeedback',
        Component: HideAddButtonsForQuizFeedback,
      });
      // For Course Workflow: create offline_module entries instantly when users are selected in Offline mode
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseWorkflowOfflineModuleSyncOnSelect',
        Component: CourseWorkflowOfflineModuleSyncOnSelect,
      });
      // For Course Workflow: disable offline_module add-entry controls in Offline modules
      // because rows are auto-managed from selected users.
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseWorkflowDisableOfflineModuleAddButtons',
        Component: CourseWorkflowDisableOfflineModuleAddButtons,
      });
      // For Course Workflow: prefix each module entry label with its 1-based index (e.g. "1 - Online")
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseWorkflowModuleIndexLabel',
        Component: CourseWorkflowModuleIndexLabel,
      });
      // For Course Assignment: filter courses picker to only show courses of the selected company
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseAssignmentCompanyFilter',
        Component: CourseAssignmentCompanyFilter,
      });
      // For Course Workflow: filter users and online module course relation by selected company
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseWorkflowCompanyFilter',
        Component: CourseWorkflowCompanyFilter,
      });
      // For Event: filter work_locations to only show locations of the selected company
      contentManager.injectComponent('editView', 'right-links', {
        name: 'EventCompanyFilter',
        Component: EventCompanyFilter,
      });
      // For Holiday: filter work_locations to only show locations of selected companies
      contentManager.injectComponent('editView', 'right-links', {
        name: 'HolidayCompanyFilter',
        Component: HolidayCompanyFilter,
      });
      // For Course Assignment: upload Excel to populate individual_user relation
      contentManager.injectComponent('editView', 'right-links', {
        name: 'CourseAssignmentExcelUserUpload',
        Component: CourseAssignmentExcelUserUpload,
      });
      // Global: keep relation-field dropdown open after selecting an item
      contentManager.injectComponent('editView', 'right-links', {
        name: 'KeepRelationDropdownOpen',
        Component: KeepRelationDropdownOpen,
      });
    }

    /**
     * Add "All Modules" as the parent menu section
     * This creates a collapsible group in the sidebar
     * The 'to' property with '#' makes it non-clickable (just a group header)
     */
    app.addMenuLink({
      id: 'all-modules',
      to: '#all-modules',
      icon: 'apps',
      intlLabel: {
        id: 'custom-menu.all-modules',
        defaultMessage: 'All Modules',
      },
      // Permissions: Only show to business roles (HR, LM, Manager)
      // Super Admin will see Content Manager instead
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * HR Module - Parent menu item under "All Modules"
     * This creates a sub-group within "All Modules"
     */
    app.addMenuLink({
      id: 'hr-module',
      to: '#hr-module',
      icon: 'briefcase',
      intlLabel: {
        id: 'custom-menu.hr-module',
        defaultMessage: 'HR Module',
      },
      // Set parent to create hierarchy under "All Modules"
      // Strapi automatically handles collapsible behavior
      parent: 'all-modules',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * Employees - under HR Module
     * Direct link to Content Manager collection type route
     * When clicked, navigates to the Content Manager for employees
     */
    app.addMenuLink({
      id: 'employees',
      to: '/content-manager/collection-types/api::employee.employee',
      icon: 'user',
      intlLabel: {
        id: 'custom-menu.employees',
        defaultMessage: 'Employees',
      },
      // Parent is HR Module, creating nested structure: All Modules > HR Module > Employees
      parent: 'hr-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::employee.employee',
        },
      ],
    });

    /**
     * Designations - under HR Module
     * Redirects to Content Manager designation collection type
     */
    app.addMenuLink({
      id: 'designations',
      to: '/content-manager/collection-types/api::designation.designation',
      icon: 'tag',
      intlLabel: {
        id: 'custom-menu.designations',
        defaultMessage: 'Designations',
      },
      parent: 'hr-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::designation.designation',
        },
      ],
    });

    /**
     * Profile Edit Requests - under HR Module
     * Allows HR to review and approve/reject employee profile change requests
     */
    app.addMenuLink({
      id: 'profile-edit-requests',
      to: '/content-manager/collection-types/api::profile-edit-request.profile-edit-request',
      icon: 'pencil',
      intlLabel: {
        id: 'custom-menu.profile-edit-requests',
        defaultMessage: 'Profile Edit Requests',
      },
      parent: 'hr-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::profile-edit-request.profile-edit-request',
        },
      ],
    });

    /**
     * Learning Module - Parent menu item under "All Modules"
     * Another sub-group within "All Modules"
     */
    app.addMenuLink({
      id: 'learning-module',
      to: '#learning-module',
      icon: 'book',
      intlLabel: {
        id: 'custom-menu.learning-module',
        defaultMessage: 'Learning Module',
      },
      parent: 'all-modules',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: null,
        },
      ],
    });

    /**
     * Courses - under Learning Module
     * Redirects to Content Manager course collection type
     */
    app.addMenuLink({
      id: 'courses',
      to: '/content-manager/collection-types/api::course.course',
      icon: 'graduation-cap',
      intlLabel: {
        id: 'custom-menu.courses',
        defaultMessage: 'Courses',
      },
      parent: 'learning-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::course.course',
        },
      ],
    });

    /**
     * Quizzes - under Learning Module
     * Note: Content type is "quizze" (singular) but plural is "quizzes"
     * The route uses the singular form as defined in the schema
     */
    app.addMenuLink({
      id: 'quizzes',
      to: '/content-manager/collection-types/api::quizze.quizze',
      icon: 'question',
      intlLabel: {
        id: 'custom-menu.quizzes',
        defaultMessage: 'Quizzes',
      },
      parent: 'learning-module',
      permissions: [
        {
          action: 'plugin::content-manager.read',
          subject: 'api::quizze.quizze',
        },
      ],
    });
  },

  /**
   * Bootstrap function - runs after register
   * Used for additional setup and menu customization
   * 
  * @param {any} app - Strapi admin app instance
   */
  bootstrap(app) {
    /**
     * Customize Content Manager menu visibility
     * 
     * In Strapi v5, the Content Manager plugin adds its own menu item.
     * To hide it for non-Super Admins, we need to use menu customization.
     * 
     * Note: The exact API may vary by Strapi version.
     * If modifyMenuLink is not available, configure via role permissions instead.
     */
    
    try {
      // Keep default Content Manager/Home navigation behavior.
      // Role-based visibility should be managed from Settings -> Roles.
    } catch (error) {
      // If modifyMenuLink is not available, that's okay
      // Visibility will be controlled through role permissions instead
      console.log('Menu modification API not available, using permissions-based visibility');
    }
    
    console.log('Custom Admin Menu Plugin: Menu structure registered');
    console.log('Note: Configure Content Manager visibility via role permissions in Strapi admin');
    console.log('For business roles, revoke general Content Manager permissions');
    
    // Keep browser tab title fixed to AIA-VEGA and force logo clicks to admin home
    if (typeof window !== 'undefined') {
      installVegaDuplicateCourseFetchInterceptor();
      installCourseAssignmentCoursesTablePatch();

      enforceAdminTabTitle();
      installAdminLogoHomeRedirect();
    }
    
    console.log('AIA-VEGA Admin Panel initialized');
  },

  /**
   * Config object for admin panel configuration
   */
  config: {
    // Locale configuration - add locales here if needed
    locales: [],
    // Translations - Replace "Strapi" with "AIA-VEGA"
    translations: {
      en: {
        'app.components.LeftMenu.navbrand.title': 'AIA-VEGA',
        'app.components.LeftMenu.navbrand.workplace': 'Admin Panel',
        'Auth.form.welcome.title': 'Welcome to AIA-VEGA',
        'Auth.form.welcome.subtitle': 'Log in to your account',
        'app.components.HomePage.welcome': 'Welcome to AIA-VEGA',
        'app.components.HomePage.welcome.again': 'Welcome',
        'Settings.application.title': 'AIA-VEGA Settings',
      },
    },
    
    head: {
    link: [
    {
      rel: 'icon',
      type: 'image/png',
      href: '/favicon.png',
    },
    {
      rel: 'shortcut icon',
      type: 'image/x-icon',
      href: '/favicon.ico',
    },
  ],
},
    // Tutorial configuration
    tutorials: false,
    // Notification configuration
    notifications: { releases: false },
  },
};
