// @ts-nocheck

/**
 * modules-sidebar (Admin)
 *
 * This is a Strapi v5 admin plugin (JavaScript only).
 *
 * - Adds ONE sidebar entry: "All Modules"
 * - Clicking it opens a page with collapsible sections (HR Module, Learning Module)
 * - Each item links to real Content Manager routes (Content Manager itself remains untouched)
 *
 * Important limitation (Strapi v5 public APIs):
 * - Strapi's built-in Content Manager sidebar link is registered with `permissions: []`,
 *   which means it is always visible. There is no public API to remove/hide core menu items.
 * - We therefore control **access** via RBAC (roles/permissions), and provide a separate
 *   "All Modules" entry for business roles.
 */

import pluginPkg from '../../package.json';
import { PLUGIN_ID } from './pluginId';

// Icon components must be React components (NOT strings).
// Use an available icon from @strapi/icons (Refresh may not exist in all versions)
import { PuzzlePiece, Question, Bell } from '@strapi/icons';
import BellWithBadge from './components/BellWithBadge.jsx';

const name = pluginPkg.strapi.name;

// Global helper: control Content Manager visibility per role and source
// Wrap in try-catch to prevent breaking the admin panel if there's an error
if (typeof window !== 'undefined') {
  try {
    // CRITICAL: Set body flag IMMEDIATELY (before any UI renders)
    // PRIORITY: Redux (most up-to-date) > sessionStorage (may be stale after logout/login)
    // This ensures icons are hidden/shown correctly from the very start
    (function setBodyFlagImmediately() {
      try {
        const setFlag = (value) => {
          if (document.body) {
            document.body.setAttribute('data-hide-cm-sidebar', value);
            document.body.dataset.hideCmSidebar = value;
          } else {
            // Body not ready - check every 5ms until it appears
            setTimeout(() => setFlag(value), 5);
          }
        };
        
        // STEP 1: Check Redux FIRST (most up-to-date, especially after login)
        try {
          const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const reduxRoles = adminUser?.roles || authUser?.roles || [];
          
          if (reduxRoles && reduxRoles.length > 0) {
            // Roles found in Redux - use immediately!
            const isSuper = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            setFlag(isSuper ? 'false' : 'true');
            return; // Exit early - we have the correct value
          }
        } catch (e) {
          // Continue to fallback
        }
        
        // STEP 2: Fallback to sessionStorage (only if Redux doesn't have roles)
        const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
        if (storedSuperAdmin) {
          setFlag(storedSuperAdmin === 'true' ? 'false' : 'true');
          return; // Exit - we have a stored value
        }
        
        // STEP 3: No roles found anywhere - set to "pending" (hide until we know)
        setFlag('pending');
      } catch (e) {
        // Ignore errors
      }
    })();
    
    const ensureStyle = () => {
    const id = 'modules-sidebar-hide-cm';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      /* Hide while pending (boot) and for HR/LM/Admin (true). Show only for Super Admin (false). */
      body[data-hide-cm-sidebar="pending"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="pending"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="pending"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="pending"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/settings"],
      body[data-hide-cm-sidebar="pending"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="pending"] a[href="/content-manager"],
      body[data-hide-cm-sidebar="pending"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="pending"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="pending"] a[href*="/settings"],
      body[data-hide-cm-sidebar="pending"] a[href*="/admin/settings"],
      body[data-hide-cm-sidebar="true"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] a[href*="/admin/settings"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      /* Show for Super Admin or when body flag is explicitly "false" */
      body[data-hide-cm-sidebar="false"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="false"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="false"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="false"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="false"] nav a[href="/admin"],
      body[data-hide-cm-sidebar="false"] nav a[href="/admin/home"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/settings"] {
        display: inline-block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      /* Hide Content Manager nav & sidebar when body flag is set */
      /* Only hide the main Content Manager link in sidebar, NOT collection type links */
      body[data-hide-cm-sidebar="true"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] [class*="Sidebar"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] [class*="Sidebar"] a[href="/content-manager"],
      /* Hide Home link for HR/LM Admin */
      /* Home icon is now always visible for all roles */
      /* Hide Deploy/Cloud link for HR/LM Admin */
      body[data-hide-cm-sidebar="true"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/admin/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/admin/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/deploy"],
      /* Hide Settings link for HR/LM Admin */
      body[data-hide-cm-sidebar="true"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/admin/settings"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/admin/settings"],
      /* Hide hamburger menu button for HR/LM Admin (mobile view) */
      body[data-hide-cm-sidebar="true"] button[aria-label*="menu" i],
      body[data-hide-cm-sidebar="true"] button[aria-label*="Menu"],
      body[data-hide-cm-sidebar="true"] [class*="Hamburger"],
      body[data-hide-cm-sidebar="true"] [class*="MenuButton"],
      body[data-hide-cm-sidebar="true"] [class*="MobileMenu"],
      body[data-hide-cm-sidebar="true"] button[class*="Menu"],
      /* Show sidebar always for HR/LM Admin (no hamburger menu needed) */
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > nav:first-child,
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > aside:first-child {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        width: auto !important;
        height: auto !important;
        overflow: visible !important;
      }
      /* Ensure header items are visible for HR/LM Admin (only All Modules, not Settings) */
      body[data-hide-cm-sidebar="true"] header a[href*="plugins/modules-sidebar"],
      body[data-hide-cm-sidebar="true"] [class*="Header"] a[href*="plugins/modules-sidebar"],
      body[data-hide-cm-sidebar="true"] [class*="TopBar"] a[href*="plugins/modules-sidebar"],
      body[data-hide-cm-sidebar="true"] [class*="AppBar"] a[href*="plugins/modules-sidebar"],
      body[data-hide-cm-sidebar="true"] a[data-moved-to-header="true"]:not([href*="settings"]) {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        margin: 0 4px !important;
      }
      /* On mobile, ensure header links are visible and hamburger is hidden (only All Modules, not Settings) */
      @media (max-width: 1080px) {
        body[data-hide-cm-sidebar="true"] header a[href*="plugins/modules-sidebar"],
        body[data-hide-cm-sidebar="true"] [class*="Header"] a[href*="plugins/modules-sidebar"],
        body[data-hide-cm-sidebar="true"] a[data-moved-to-header="true"]:not([href*="settings"]) {
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        body[data-hide-cm-sidebar="true"] button[aria-label*="menu" i],
        body[data-hide-cm-sidebar="true"] button[aria-label*="Menu"],
        body[data-hide-cm-sidebar="true"] [class*="Hamburger"],
        body[data-hide-cm-sidebar="true"] [class*="MenuButton"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
        }
      }
      /* Hide in mobile/hamburger menu (dropdown, popover, etc.) */
      body[data-hide-cm-sidebar="true"] [role="menu"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] [role="menu"] a[href="/content-manager"],
      /* Home icon is now always visible for all roles in menu */
      body[data-hide-cm-sidebar="true"] [role="menu"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] [role="menu"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] [role="menuitem"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] [role="menuitem"] a[href="/content-manager"],
      /* Home icon is now always visible for all roles in menuitem */
      body[data-hide-cm-sidebar="true"] [role="menuitem"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] [role="menuitem"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] [class*="Popover"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] [class*="Popover"] a[href="/content-manager"],
      /* Home icon is now always visible for all roles in popover */
      body[data-hide-cm-sidebar="true"] [class*="Popover"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] [class*="Popover"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] [class*="Popover"] a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] [class*="Dropdown"] a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] [class*="Dropdown"] a[href="/content-manager"],
      /* Home icon is now always visible for all roles in dropdown */
      body[data-hide-cm-sidebar="true"] [class*="Dropdown"] a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] [class*="Dropdown"] a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] [class*="Dropdown"] a[href*="/settings"],
      /* While pending (boot), hide target links until roles are known */
      body[data-hide-cm-sidebar="pending"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="pending"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="pending"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="pending"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="pending"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="pending"] aside a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="true"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="true"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] aside a[href*="/settings"],
      body[data-hide-cm-sidebar="true"] [data-hidden-by-modules-sidebar="true"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      /* Show for Super Admin */
      body[data-hide-cm-sidebar="false"] nav a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="false"] nav a[href="/content-manager"],
      body[data-hide-cm-sidebar="false"] aside a[href="/admin/content-manager"],
      body[data-hide-cm-sidebar="false"] aside a[href="/content-manager"],
      body[data-hide-cm-sidebar="false"] nav a[href="/admin"],
      body[data-hide-cm-sidebar="false"] nav a[href="/admin/home"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/deploy"],
      body[data-hide-cm-sidebar="false"] aside a[href="/admin"],
      body[data-hide-cm-sidebar="false"] aside a[href="/admin/home"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/plugins/cloud"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/deploy"],
      body[data-hide-cm-sidebar="false"] nav a[href*="/settings"],
      body[data-hide-cm-sidebar="false"] aside a[href*="/settings"] {
        display: inline-block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      body[data-hide-cm-sidebar="true"] nav[aria-label*="Content Manager"],
      body[data-hide-cm-sidebar="true"] nav[aria-label*="content manager"],
      body[data-hide-cm-sidebar="true"] [data-testid="content-manager-sidebar"],
      body[data-hide-cm-sidebar="true"] [class*="LeftMenu"],
      body[data-hide-cm-sidebar="true"] [class*="sideNav"],
      body[data-hide-cm-sidebar="true"] [class*="SideNav"],
      body[data-hide-cm-sidebar="true"] [class*="LeftNav"],
      body[data-hide-cm-sidebar="true"] [class*="CollectionTypes"],
      body[data-hide-cm-sidebar="true"] [class*="CollectionTypesList"],
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > nav:first-child,
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > aside:first-child,
      body[data-hide-cm-sidebar="true"] [data-hidden-by-modules-sidebar="true"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
      }
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > *:not([data-hidden-by-modules-sidebar="true"]):last-child,
      body[data-hide-cm-sidebar="true"] [class*="Layouts-Root"] > *:not([data-hidden-by-modules-sidebar="true"]):nth-child(2) {
        width: 100% !important;
        max-width: 100% !important;
        flex: 1 1 100% !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
      }
      /* Keep sidebar brand/logo clickable for all roles */
      body[data-hide-cm-sidebar="pending"] [class*="NavBrand"] a,
      body[data-hide-cm-sidebar="pending"] [class*="Brand"] a,
      body[data-hide-cm-sidebar="true"] [class*="NavBrand"] a,
      body[data-hide-cm-sidebar="true"] [class*="Brand"] a {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      /* Home link remains visible for all roles. */
      /* Ensure brand/logo links stay visible even if href is /admin */
      body[data-hide-cm-sidebar="pending"] [class*="NavBrand"] a[href="/admin"],
      body[data-hide-cm-sidebar="pending"] [class*="Brand"] a[href="/admin"],
      body[data-hide-cm-sidebar="true"] [class*="NavBrand"] a[href="/admin"],
      body[data-hide-cm-sidebar="true"] [class*="Brand"] a[href="/admin"] {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  };

  // Cache for roles to avoid repeated API calls
  let cachedRoles = null;
  let rolesFetchPromise = null;
  let roleFlagsCache = null;
  let lastToken = null;
  let lastUserId = null;
  let isInitialLoad = true; // Track if this is the first load after page refresh
  let cachedIsSuperAdmin = null; // Cache Super Admin status to avoid repeated checks
  
  // Clear cache when token or user changes (user logged out/in)
  // Also clear on initial load to ensure fresh role detection
  const clearCacheIfUserChanged = () => {
    try {
      const state = window.strapi?.store?.getState?.() || {};
      const currentToken = state?.admin_app?.token;
      const currentUserId = state?.admin_app?.user?.id || 
                           state?.auth?.user?.id ||
                           null;
      
      // On initial load, check Redux FIRST before clearing cache
      // Only clear cache if Redux doesn't have roles
      if (isInitialLoad) {
        // Check Redux store first - roles might already be there
        try {
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const reduxRoles = adminUser?.roles || authUser?.roles || [];
          
          if (reduxRoles && reduxRoles.length > 0) {
            // Roles found in Redux - use them, don't clear cache
            cachedRoles = reduxRoles;
            isInitialLoad = false;
            lastToken = currentToken;
            lastUserId = currentUserId;
            
            // Set body flag immediately
            const isSuper = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            }
            
            try {
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
              sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
              window['__MODULES_SIDEBAR_ROLES__'] = reduxRoles;
            } catch (e) {}
            
            return; // Don't clear cache - we have roles
          }
        } catch (e) {
          // Ignore Redux errors
        }
        
        // No roles in Redux - clear cache for fresh detection
        if (process.env.NODE_ENV === 'development') {
          console.log('[CM Hide] Initial load, clearing cache for fresh role detection');
        }
        cachedRoles = null;
        roleFlagsCache = null;
        rolesFetchPromise = null;
        delete window['__MODULES_SIDEBAR_ROLES__'];
        delete window['__lastRoleLogKey'];
        delete window['__lastShouldHide'];
        delete window['__lastSidebarLogKey'];
        try {
          sessionStorage.removeItem('__modules_sidebar_roles__');
        } catch (e) {
          // Ignore
        }
        isInitialLoad = false;
        lastToken = currentToken;
        lastUserId = currentUserId;
        return;
      }
      
      // Clear if:
      // 1. User ID actually changed (different user logged in)
      // 2. Token went from existing to null (logout)
      // 3. User ID went from existing to null (logout)
      // 4. Token changed from null to something (login after logout)
      // 5. Token changed from something to something different (new session)
      const userChanged = currentUserId !== null && currentUserId !== lastUserId && lastUserId !== null;
      const isLoggedOut = (!currentToken && lastToken) || (currentUserId === null && lastUserId !== null);
      
      // CRITICAL: Clear persistent Super Admin status on logout or user change
      if (isLoggedOut || userChanged) {
        try {
          sessionStorage.removeItem('__is_super_admin__');
        } catch (e) {
          // Ignore
        }
      }
      const isLoggedIn = (currentToken && !lastToken) || (currentUserId !== null && lastUserId === null);
      const tokenChanged = currentToken !== lastToken && lastToken !== null && currentToken !== null;
      
      if (userChanged || isLoggedOut || isLoggedIn || tokenChanged) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[CM Hide] User/token changed, clearing cache', { 
            userChanged, 
            isLoggedOut, 
            isLoggedIn, 
            tokenChanged,
            currentUserId,
            lastUserId,
            hasToken: !!currentToken,
            hadToken: !!lastToken
          });
        }
        cachedRoles = null;
        roleFlagsCache = null;
        rolesFetchPromise = null;
      // Reset initial load flag on login to force fresh API fetch
      if (isLoggedIn || userChanged || tokenChanged) {
        isInitialLoad = true;
        // Aggressively clear window/sessionStorage roles on login to prevent stale data
        delete window.__MODULES_SIDEBAR_ROLES__;
        // Also clear Super Admin cache
        cachedIsSuperAdmin = null;
        lastSuperAdminCheck = 0;
        try {
          sessionStorage.removeItem('__modules_sidebar_roles__');
        } catch (e) {
          // Ignore
        }
      }
        lastToken = currentToken;
        lastUserId = currentUserId;
        // Also clear debug flags
        delete window.__lastRoleLogKey;
        delete window.__lastShouldHide;
        delete window.__lastSidebarLogKey;
      } else {
        // Update token/user tracking without clearing cache (token refresh)
        lastToken = currentToken;
        lastUserId = currentUserId;
      }
    } catch (e) {
      // Ignore errors
    }
  };
  
  // Also try to get roles from window (set by AllModules page)
  const getRolesFromWindow = () => {
    try {
      // Check if AllModules page has set roles in window
      if (window['__MODULES_SIDEBAR_ROLES__']) {
        return window['__MODULES_SIDEBAR_ROLES__'];
      }
      // Check if roles are in sessionStorage (set by AllModules)
      const stored = sessionStorage.getItem('__modules_sidebar_roles__');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          // Ignore parse errors
        }
      }
    } catch (e) {
      // Ignore errors
    }
    return null;
  };

  const getRoles = async () => {
    // CRITICAL: On initial load, check Redux FIRST before clearing cache
    // This ensures we can use roles immediately if they're already in Redux
    if (isInitialLoad) {
      // Check Redux store immediately - roles might already be there after login
      try {
        const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
        const adminUser = state?.admin_app?.user;
        const authUser = state?.auth?.user || state?.auth?.userInfo;
        const reduxRoles = adminUser?.roles || authUser?.roles || [];
        
        if (reduxRoles && reduxRoles.length > 0) {
          // Roles found in Redux - use them immediately!
          cachedRoles = reduxRoles;
          isInitialLoad = false; // Mark as loaded
          
          // Cache immediately
          try {
            sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
            window['__MODULES_SIDEBAR_ROLES__'] = reduxRoles;
            
            // Check if Super Admin and set body flag immediately
            const isSuper = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
            
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            }
            
            cachedIsSuperAdmin = isSuper ? true : false;
          } catch (e) {
            // Ignore storage errors
          }
          
          return reduxRoles; // Return immediately - no need for API call
        }
      } catch (e) {
        // Ignore Redux errors, continue to API
      }
    }
    
    // Check if user/token changed (user logged out/in) - this clears cache
    clearCacheIfUserChanged();
    
    // On initial load or after login, check cache/sessionStorage first
    if (isInitialLoad) {
      // Try sessionStorage first (might have roles from previous session)
      try {
        const stored = sessionStorage.getItem('__modules_sidebar_roles__');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            // Check if Super Admin status matches
            const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
            if (storedSuperAdmin) {
              cachedRoles = parsed;
              isInitialLoad = false;
              
              if (document.body) {
                document.body.setAttribute('data-hide-cm-sidebar', storedSuperAdmin === 'true' ? 'false' : 'true');
              }
              
              return parsed; // Use cached roles
            }
          }
        }
      } catch (e) {
        // Ignore
      }
      
      // Clear any stale window/sessionStorage roles on initial load (only if Redux didn't have roles)
      delete window['__MODULES_SIDEBAR_ROLES__'];
      try {
        sessionStorage.removeItem('__modules_sidebar_roles__');
      } catch (e) {
        // Ignore
      }
      // Continue to Redux/API check below
    } else {
      // Not initial load - check if we have valid cached roles
      // But verify they match the current user by checking token/user ID
      const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
      const currentToken = state?.admin_app?.token;
      const currentUserId = state?.admin_app?.user?.id || state?.auth?.user?.id || null;
      
      // If token/user changed since cache was set, invalidate cache
      if (cachedRoles && (currentToken !== lastToken || currentUserId !== lastUserId)) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[CM Hide] Token/user mismatch, invalidating cache');
        }
        cachedRoles = null;
        roleFlagsCache = null;
        rolesFetchPromise = null;
        isInitialLoad = true; // Force fresh fetch
      } else if (cachedRoles) {
        // Cache is valid - use it
        return cachedRoles;
      }
    }

    // Try window/sessionStorage ONLY if not initial load (set by AllModules page)
    // On initial load, we skip this to force fresh API fetch
    if (!isInitialLoad) {
      const windowRoles = getRolesFromWindow();
      if (windowRoles && windowRoles.length > 0) {
        cachedRoles = windowRoles;
        return cachedRoles;
      }
    }

    // If fetch is in progress, return the promise
    if (rolesFetchPromise) {
      return rolesFetchPromise;
    }

    // Try Redux store - check multiple times with a short delay to catch store initialization
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const state =
          (window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {}) ||
          window['__STRAPI_ADMIN_STATE__'] ||
          {};
        const adminUser = state?.admin_app?.user;
        const authUser = state?.auth?.user || state?.auth?.userInfo;
        const reduxRoles = 
          adminUser?.roles ||
          authUser?.roles ||
          (window.strapi && window.strapi.user && window.strapi.user.roles) ||
          (window.strapi && window.strapi.currentUser && window.strapi.currentUser.roles);
        
        if (reduxRoles && reduxRoles.length > 0) {
          // Use Redux roles immediately (even on initial load if we got here)
          cachedRoles = reduxRoles;
          if (process.env.NODE_ENV === 'development') {
            console.log('[CM Hide] Found roles from Redux:', cachedRoles);
          }
          
          // Set body flag immediately
          const isSuper = reduxRoles.some(r => {
            const name = (r?.name || '').toLowerCase();
            return name === 'super admin' || name.includes('super admin');
          });
          
          if (document.body) {
            document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
          }
          
          try {
            sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
            sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
            window['__MODULES_SIDEBAR_ROLES__'] = reduxRoles;
          } catch (e) {}
          
          isInitialLoad = false;
          return reduxRoles;
        }
        
        // If no roles found and this is not the last attempt, wait a bit
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (e) {
        if (process.env.NODE_ENV === 'development' && attempt === 2) {
          console.log('[CM Hide] Redux error:', e);
        }
      }
    }

    // Fallback to API if Redux doesn't have roles
    rolesFetchPromise = (async () => {
      try {
        // Wait a bit for Redux store to be ready
        let attempts = 0;
        let state = {};
        let token = null;
        
        while (attempts < 10 && !token) {
          state = (window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {}) || window['__STRAPI_ADMIN_STATE__'] || {};
          token = state?.admin_app?.token;
          if (!token) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }
        }
        
        if (!token) {
          // Token still not available - might be on login page or store not ready
          return [];
        }
        
        const baseURL = (window.strapi && window.strapi.backendURL) || 'http://localhost:1337';
        const response = await fetch(`${baseURL}/admin/users/me?populate=roles`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
        });
        
        if (response.ok) {
          const responseData = await response.json();
          const userData = responseData?.data || responseData;
          const roles = userData?.roles || [];
          if (roles.length > 0) {
            cachedRoles = Array.isArray(roles) ? roles : [roles];
            // Mark initial load as complete after successful API fetch
            isInitialLoad = false;
            if (process.env.NODE_ENV === 'development') {
              console.log('[CM Hide] Fetched roles from API:', cachedRoles.map(r => ({ name: r?.name, code: r?.code })));
            }
            return cachedRoles;
          } else {
            // API returned empty roles - try Redux as fallback
            if (isInitialLoad) {
              const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
              const adminUser = state?.admin_app?.user;
              const authUser = state?.auth?.user || state?.auth?.userInfo;
              const reduxRoles = adminUser?.roles || authUser?.roles;
              if (reduxRoles && reduxRoles.length > 0) {
                cachedRoles = reduxRoles;
                isInitialLoad = false;
                if (process.env.NODE_ENV === 'development') {
                  console.log('[CM Hide] API returned empty, using Redux roles as fallback:', cachedRoles);
                }
                return cachedRoles;
              }
            }
          }
        }
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[CM Hide] API fetch error:', e);
        }
        // On error, try Redux as fallback if initial load
        if (isInitialLoad) {
          try {
            const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
            const adminUser = state?.admin_app?.user;
            const authUser = state?.auth?.user || state?.auth?.userInfo;
            const reduxRoles = adminUser?.roles || authUser?.roles;
            if (reduxRoles && reduxRoles.length > 0) {
              cachedRoles = reduxRoles;
              isInitialLoad = false;
              if (process.env.NODE_ENV === 'development') {
                console.log('[CM Hide] API error, using Redux roles as fallback:', cachedRoles);
              }
              return cachedRoles;
            }
          } catch (e2) {
            // Ignore
          }
        }
      }
      return [];
    })();

    const roles = await rolesFetchPromise;
    rolesFetchPromise = null;
    return roles;
  };

  // Helper function to calculate role flags from roles array
  const getRoleFlagsFromRoles = (roles) => {
    try {
      if (!roles || roles.length === 0) {
        return { isSuper: false, isHR: false, isLM: false, isAdmin: false };
      }
      
      const hasName = (needle) =>
        roles.some((r) => {
          const name = (r?.name || '').toLowerCase();
          return name === needle.toLowerCase();
        });
      const hasCode = (needle) =>
        roles.some((r) => {
          const code = (r?.code || '').toLowerCase();
          return code === needle.toLowerCase();
        });
      const hasInc = (needle) =>
        roles.some(
          (r) => {
            const name = (r?.name || '').toLowerCase();
            const code = (r?.code || '').toLowerCase();
            return name.includes(needle.toLowerCase()) || code.includes(needle.toLowerCase());
          }
        );

      // Exact role names: "Super Admin", "HR Admin", "LM Admin", "Admin"
      const isSuper = 
        hasName('super admin') || 
        hasCode('strapi-super-admin') || 
        hasInc('super admin') ||
        hasInc('super-admin');
      const isHR = 
        hasName('hr admin') || 
        hasInc('hr admin') ||
        (hasInc('hr') && !hasInc('lm') && !hasInc('admin')); // Only match "hr" if it doesn't contain "lm" or "admin"
      const isLM = 
        hasName('lm admin') || 
        hasInc('lm admin') ||
        (hasInc('lm') && !hasInc('hr') && !hasInc('admin')); // Only match "lm" if it doesn't contain "hr" or "admin"
      const isAdmin = 
        hasName('admin') || 
        hasCode('admin') ||
        (hasInc('admin') && !hasInc('super') && !hasInc('hr') && !hasInc('lm')); // Match "admin" but not "super admin", "hr admin", or "lm admin"
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[CM Hide] Role detection:', { 
          roles: roles.map(r => ({ name: r?.name, code: r?.code })),
          isSuper, 
          isHR, 
          isLM,
          isAdmin
        });
      }
      
      return { isSuper, isHR, isLM, isAdmin };
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[CM Hide] Error calculating role flags:', error);
      }
      return { isSuper: false, isHR: false, isLM: false, isAdmin: false };
    }
  };

  const getRoleFlags = async () => {
    try {
      const roles = await getRoles();
      return getRoleFlagsFromRoles(roles);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[CM Hide] Error getting role flags:', error);
      }
      return { isSuper: false, isHR: false, isLM: false, isAdmin: false };
    }
  };

  const hideContentManagerSidebar = async () => {
    ensureStyle();
    
    // CRITICAL: If we know it's Super Admin from cache, skip all manipulation to prevent blinking
    if (cachedIsSuperAdmin === true) {
      // Just ensure body flag is correct, then exit
      document.body.setAttribute('data-hide-cm-sidebar', 'false');
      return; // Exit early - don't touch anything for Super Admin
    }
    
    // Check if user changed first (before getting roles) - this clears cache on logout/login
    clearCacheIfUserChanged();
    
    const params = new URLSearchParams(window.location.search);
    const fromModules = params.get('fromModules') === 'true';
    const flag = window.sessionStorage.getItem('hideCmSidebar') === 'true';
    
    // CRITICAL: Check multiple sources IMMEDIATELY in order of speed
    // 0. Check cached roles (set during initial load)
    // 1. Check window.__MODULES_SIDEBAR_ROLES__ (set by AllModules page - fastest)
    // 2. Check sessionStorage (cached from previous page)
    // 3. Check Redux store (might be ready)
    // 4. Check API (slowest, but most reliable)
    let currentRoles = null;
    
    // Priority 0: Use cached roles if available (from initial load detection)
    if (cachedRoles && cachedRoles.length > 0) {
      currentRoles = cachedRoles;
    }
    
    // Priority 1: Window roles (set by AllModules page)
    if (window.__MODULES_SIDEBAR_ROLES__ && Array.isArray(window.__MODULES_SIDEBAR_ROLES__) && window.__MODULES_SIDEBAR_ROLES__.length > 0) {
      currentRoles = window.__MODULES_SIDEBAR_ROLES__;
      cachedRoles = currentRoles;
    }
    
    // Priority 2: SessionStorage (cached roles)
    if (!currentRoles || currentRoles.length === 0) {
      try {
        const stored = sessionStorage.getItem('__modules_sidebar_roles__');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            currentRoles = parsed;
            cachedRoles = currentRoles;
            // Also set in window for faster access next time
            window.__MODULES_SIDEBAR_ROLES__ = currentRoles;
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Priority 3: Redux store (check multiple times with retries, but be more aggressive)
    if (!currentRoles || currentRoles.length === 0) {
      // First, try immediately without waiting (roles might already be in store after login)
      try {
        const state = window.strapi?.store?.getState?.() || {};
        const adminUser = state?.admin_app?.user;
        const authUser = state?.auth?.user || state?.auth?.userInfo;
        const reduxRoles = adminUser?.roles || authUser?.roles || [];
        if (reduxRoles && reduxRoles.length > 0) {
          currentRoles = reduxRoles;
          cachedRoles = reduxRoles;
          // Cache in sessionStorage and window for next time
          try {
            sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
            window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
          } catch (e) {
            // Ignore storage errors
          }
        }
      } catch (e) {
        // Ignore Redux errors
      }
      
      // If still no roles, retry with delays
      if (!currentRoles || currentRoles.length === 0) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const state = window.strapi?.store?.getState?.() || {};
            const adminUser = state?.admin_app?.user;
            const authUser = state?.auth?.user || state?.auth?.userInfo;
            const reduxRoles = adminUser?.roles || authUser?.roles || [];
            if (reduxRoles && reduxRoles.length > 0) {
              currentRoles = reduxRoles;
              cachedRoles = reduxRoles;
              // Cache in sessionStorage and window for next time
              try {
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
                window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
              } catch (e) {
                // Ignore storage errors
              }
              break; // Found roles, exit retry loop
            }
          } catch (e) {
            // Ignore Redux errors
          }
          // If no roles found and not last attempt, wait a bit
          if (attempt < 4) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
      }
    }
    
    // Priority 4: API call (only if nothing else worked, and don't wait too long)
    if (!currentRoles || currentRoles.length === 0) {
      // Start API call but don't block - use timeout
      try {
        const apiRolesPromise = getRoles();
        // Give API 300ms max, then proceed with whatever we have
        currentRoles = await Promise.race([
          apiRolesPromise,
          new Promise(resolve => setTimeout(() => resolve([]), 300))
        ]);
        // If API returned roles, cache them
        if (currentRoles && currentRoles.length > 0) {
          cachedRoles = currentRoles;
          try {
            sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(currentRoles));
            window.__MODULES_SIDEBAR_ROLES__ = currentRoles;
          } catch (e) {
            // Ignore storage errors
          }
        }
      } catch (e) {
        // Ignore API errors
        currentRoles = currentRoles || [];
      }
    }
    
    // Get role flags (always refresh if cache was cleared or if we have roles but cached flags are all false)
    let roleFlags = roleFlagsCache;
    
    // Only use cached flags if:
    // 1. We have cached flags
    // 2. We have cached roles
    // 3. Current roles match cached roles (same length and same content)
    // 4. Cached flags are not all false (which means they were cached when roles were empty)
    const rolesMatch = cachedRoles && currentRoles && 
                       cachedRoles.length === currentRoles.length &&
                       cachedRoles.length > 0 &&
                       cachedRoles.every((r, i) => {
                         const curr = currentRoles[i];
                         return (r?.id && curr?.id && r.id === curr.id) || 
                                (r?.name && curr?.name && r.name === curr.name) ||
                                (r?.code && curr?.code && r.code === curr.code);
                       });
    const cachedFlagsValid = roleFlags && cachedRoles && cachedRoles.length > 0 && 
                            (roleFlags.isSuper || roleFlags.isHR || roleFlags.isLM);
    
    if (!roleFlags || !cachedRoles || !rolesMatch || !cachedFlagsValid) {
      // Recalculate flags - either no cache, roles changed, or flags were cached when roles were empty
      // Pass currentRoles directly to avoid calling getRoles() again
      roleFlags = await getRoleFlagsFromRoles(currentRoles);
      // Only cache flags if we have actual roles (not empty)
      if (currentRoles && currentRoles.length > 0) {
        roleFlagsCache = roleFlags;
      } else {
        // Don't cache false flags when roles are empty - they'll be recalculated when roles arrive
        roleFlagsCache = null;
      }
    }
    const { isSuper, isHR, isLM, isAdmin } = roleFlags;
    const isHRorLMorAdmin = (!isSuper) && (isHR || isLM || isAdmin);
    
    // Update Super Admin cache
    if (isSuper) {
      cachedIsSuperAdmin = true;
      lastSuperAdminCheck = Date.now();
    } else {
      cachedIsSuperAdmin = false;
      lastSuperAdminCheck = Date.now();
    }
    
    // Debug logging (only log once per role change, not on every interval)
    const logKey = `${isSuper}-${isHR}-${isLM}-${fromModules}-${flag}`;
    if (process.env.NODE_ENV === 'development' && window.__lastRoleLogKey !== logKey) {
      // Only log when roles are actually detected (not empty)
      if (cachedRoles && cachedRoles.length > 0) {
        console.log('[CM Hide] Role flags:', { isSuper, isHR, isLM, isAdmin, isHRorLMorAdmin, fromModules, flag });
      }
      window.__lastRoleLogKey = logKey;
    }

    // Single source of truth: body[data-hide-cm-sidebar] only.
    // Start as "pending" (hidden) until roles are known. Then:
    // - Super Admin => "false" (show)
    // - HR Admin / LM Admin / Admin => "true" (hide)
    const setBodyFlag = (value) => {
      if (document.body) {
        document.body.setAttribute('data-hide-cm-sidebar', value);
        return;
      }
      const wait = () => {
        if (document.body) document.body.setAttribute('data-hide-cm-sidebar', value);
        else setTimeout(wait, 5);
      };
      wait();
    };

    let nextFlag = 'pending';
    const hasRoles = Array.isArray(currentRoles) && currentRoles.length > 0;
    if (hasRoles) {
      nextFlag = isSuper ? 'false' : ((isHR || isLM || isAdmin) ? 'true' : 'false');
      try {
        sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
      } catch (e) {}
    } else {
      // If we have a stored value, use it. Otherwise remain pending.
      try {
        const stored = sessionStorage.getItem('__is_super_admin__');
        if (stored === 'true') nextFlag = 'false';
        else if (stored === 'false') nextFlag = 'true';
      } catch (e) {}
    }

    setBodyFlag(nextFlag);
    // IMPORTANT: stop here. CSS handles menu visibility; no DOM mutations, no inline styles, no "fromModules" logic.
    return;
    
    // Only log when value changes AND roles are detected
    if (process.env.NODE_ENV === 'development' && window.__lastShouldHide !== shouldHide && cachedRoles && cachedRoles.length > 0) {
      console.log('[CM Hide] Final shouldHide:', shouldHide, 'body flag:', document.body.dataset.hideCmSidebar, 'isSuper:', isSuper);
      window.__lastShouldHide = shouldHide;
    }

    // Hide Content Manager sidebar ONLY for HR Admin, LM Admin, and Admin (not Super Admin)
    const shouldHideCMSidebar = shouldHide;
    // Also hide sidebar when coming from All Modules, but NOT for Super Admin
    // If fromModules flag is set, hide sidebar (user came from All Modules, so likely HR/LM/Admin)
    // OR if we have valid role detection for HR/LM/Admin
    const shouldHideFromModules = (fromModules || flag) && (isHRorLMorAdmin || (!isSuper && !isHR && !isLM && !isAdmin)) && !isSuper;
    
    // Only log when values change AND roles are detected
    const sidebarLogKey = `${shouldHide}-${shouldHideCMSidebar}-${shouldHideFromModules}`;
    if (process.env.NODE_ENV === 'development' && window.__lastSidebarLogKey !== sidebarLogKey && cachedRoles && cachedRoles.length > 0) {
      console.log('[CM Hide] Sidebar hide flags:', { shouldHide, shouldHideCMSidebar, shouldHideFromModules, fromModules, flag, isSuper });
      window.__lastSidebarLogKey = sidebarLogKey;
    }

    // Hide CM menu link for HR/LM/Admin - be very aggressive
    // BUT: Super Admin should NEVER have CM hidden, even if other flags are set
    // Force hide if we have valid HR/LM/Admin role detection (even if shouldHide is false)
    const forceHideForHRorLMorAdmin = (isHR || isLM || isAdmin) && !isSuper;
    const shouldActuallyHide = (shouldHide || forceHideForHRorLMorAdmin) && !isSuper; // Ensure Super Admin is never hidden
    
    // For Super Admin: Always show and unhide any previously hidden elements
    // This MUST run every time, even if roles are temporarily empty
    // Check if user is Super Admin from multiple sources to be safe
    let isSuperAdminSafe = isSuper;
    
    // If not detected from roleFlags, check other sources
    if (!isSuperAdminSafe) {
      // Check current roles
      if (currentRoles && currentRoles.length > 0) {
        isSuperAdminSafe = currentRoles.some(r => {
          const name = (r?.name || '').toLowerCase();
          return name === 'super admin' || name.includes('super admin');
        });
      }
      
      // Check window roles (set by AllModules page)
      if (!isSuperAdminSafe && window.__MODULES_SIDEBAR_ROLES__) {
        isSuperAdminSafe = window.__MODULES_SIDEBAR_ROLES__.some(r => {
          const name = (r?.name || '').toLowerCase();
          return name === 'super admin' || name.includes('super admin');
        });
      }
      
      // Check Redux store as last resort
      if (!isSuperAdminSafe) {
        try {
          const state = window.strapi?.store?.getState?.() || {};
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const reduxRoles = adminUser?.roles || authUser?.roles || [];
          if (reduxRoles.length > 0) {
            isSuperAdminSafe = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
          }
        } catch (e) {
          // Ignore
        }
      }
    }
    
    if (isSuperAdminSafe) {
      // Super Admin: Always show CM icon, Home, and Deploy - unhide aggressively
      document.querySelectorAll('a').forEach((el) => {
        const href = el.getAttribute('href') || '';
        // Match any /admin/content-manager or /content-manager URL (with or without query params)
        const isMainCMLink = 
          (href.startsWith('/admin/content-manager') || href.startsWith('/content-manager')) &&
          !href.includes('/content-manager/collection-types') &&
          !href.includes('/content-manager/single-types') &&
          href !== '/admin/content-manager/collection-types' &&
          href !== '/admin/content-manager/single-types';
        
        // Match Home link
        const isHomeLink = 
          href === '/admin' || 
          href === '/admin/home' || 
          (href.startsWith('/admin') && href.endsWith('/admin'));
        
        // Match Deploy/Cloud link
        const isDeployLink = 
          href.includes('/plugins/cloud') || 
          href.includes('/admin/plugins/cloud') ||
          href.includes('/deploy');
        
        const isSettingsLink = 
          href.includes('/settings') || 
          href.includes('/admin/settings');
        
        if (isMainCMLink || isHomeLink || isDeployLink || isSettingsLink) {
          // Mark as Super Admin link and unhide
          el.setAttribute('data-super-admin', 'true');
          el.style.cssText = 'display: inline-block !important; visibility: visible !important; opacity: 1 !important;';
          el.removeAttribute('data-hidden-by-modules-sidebar');
          
          // Also unhide parent elements
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 5) {
            if (parent.hasAttribute('data-hidden-by-modules-sidebar')) {
              parent.style.removeProperty('display');
              parent.style.removeProperty('visibility');
              parent.style.removeProperty('opacity');
              parent.removeAttribute('data-hidden-by-modules-sidebar');
            }
            parent = parent.parentElement;
            depth++;
          }
        }
      });
    } else if (shouldActuallyHide) {
      // Find ALL links first, then filter
      // Run this even if roles aren't fully detected yet - hide proactively
      const allLinks = document.querySelectorAll('a');
      allLinks.forEach((el) => {
        // Skip if already hidden
        if (el.hasAttribute('data-hidden-by-modules-sidebar') && el.style.display === 'none') {
          return;
        }
        
        const href = el.getAttribute('href') || '';
        const text = (el.textContent || '').toLowerCase().trim();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        
        // Check if this is the MAIN Content Manager link (not collection type links)
        // Match any /admin/content-manager or /content-manager URL (with or without query params)
        const isMainCMLink = 
          (href.startsWith('/admin/content-manager') || href.startsWith('/content-manager')) &&
          !href.includes('/content-manager/collection-types') &&
          !href.includes('/content-manager/single-types') &&
          href !== '/admin/content-manager/collection-types' &&
          href !== '/admin/content-manager/single-types';
        
        // Hide Home icon/menu entry for non-super users, but never treat brand/logo as Home.
        const isBrandLink =
          !!el.closest('[class*="NavBrand"]') || !!el.closest('[class*="Brand"]');
        const isHomeLink = !isBrandLink && (
          href === '/admin' ||
          href === '/admin/home' ||
          (href.startsWith('/admin') && href.endsWith('/admin')) ||
          text === 'home' ||
          ariaLabel === 'home' ||
          title === 'home'
        );
        
        // Check if this is the Deploy/Cloud link
        const isDeployLink = 
          href.includes('/plugins/cloud') || 
          href.includes('/admin/plugins/cloud') ||
          href.includes('/deploy') ||
          text.includes('deploy') || 
          text.includes('cloud') ||
          ariaLabel.includes('deploy') || 
          ariaLabel.includes('cloud') ||
          title.includes('deploy') || 
          title.includes('cloud');
        
        // Check if this is the Settings link
        const isSettingsLink = 
          href.includes('/settings') || 
          href.includes('/admin/settings') ||
          text.includes('settings') || 
          text.includes('setting') ||
          ariaLabel.includes('settings') || 
          ariaLabel.includes('setting') ||
          title.includes('settings') || 
          title.includes('setting');
        
        // Check if it's in the left sidebar (main navigation) OR mobile menu
        const isInLeftSidebar = el.closest('nav[class*="MainNav"]') ||
                               el.closest('aside[class*="MainNav"]') ||
                               el.closest('[class*="MainNav"]') ||
                               el.closest('nav:first-of-type') ||
                               (el.closest('nav') && !el.closest('[class*="Layouts-Root"] > *:not(:first-child)'));
        
        // Check if it's in mobile/hamburger menu (dropdown, popover, etc.)
        const isInMobileMenu = el.closest('[role="menu"]') ||
                              el.closest('[role="menuitem"]') ||
                              el.closest('[class*="Popover"]') ||
                              el.closest('[class*="Dropdown"]') ||
                              el.closest('[class*="Menu"]') ||
                              el.closest('button[aria-label*="menu"]')?.parentElement?.contains(el) ||
                              el.closest('button[aria-label*="Menu"]')?.parentElement?.contains(el);
        
        // Exclude if in main content area or All Modules page
        const isInMainContent = el.closest('[class*="Layouts-Root"] > *:not(:first-child)');
        const isInAllModules = el.closest('[class*="AllModules"]') || 
                               el.closest('[data-modules-sidebar]') ||
                               window.location.pathname.includes('/plugins/modules-sidebar/all-modules');
        
        if ((isMainCMLink || isHomeLink || isDeployLink || isSettingsLink) && (isInLeftSidebar || isInMobileMenu) && !isInMainContent && !isInAllModules) {
          // Hide for HR/LM Admin - be very aggressive
          // Remove Super Admin marker if present
          el.removeAttribute('data-super-admin');
          el.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important;';
          el.setAttribute('data-hidden-by-modules-sidebar', 'true');
          
          // Also hide parent list item and any parent containers
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 5) {
            if (parent.tagName === 'LI' || parent.classList.toString().includes('Nav')) {
              parent.style.cssText = 'display: none !important; visibility: hidden !important;';
              parent.setAttribute('data-hidden-by-modules-sidebar', 'true');
            }
            parent = parent.parentElement;
            depth++;
          }
          
          // Removed verbose logging - only log once per link
          if (process.env.NODE_ENV === 'development' && !el.hasAttribute('data-logged-hidden')) {
            const linkType = isMainCMLink ? 'Content Manager' : isHomeLink ? 'Home' : isDeployLink ? 'Deploy' : 'Settings';
            console.log(`[CM Hide] Hid ${linkType} link:`, href);
            el.setAttribute('data-logged-hidden', 'true');
          }
        }
      });
      
      // Also hide hamburger menu button for HR/LM Admin (mobile view)
      // Since only Media and All Modules are visible, no need for hamburger menu
      if (shouldActuallyHide) {
        const hamburgerButtons = document.querySelectorAll(
          'button[aria-label*="menu" i], ' +
          'button[aria-label*="Menu"], ' +
          '[class*="Hamburger"], ' +
          '[class*="MenuButton"], ' +
          '[class*="MobileMenu"], ' +
          'button[class*="Menu"]'
        );
        hamburgerButtons.forEach((btn) => {
          // Only hide if it's actually a hamburger/menu button (not a regular menu item)
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const isMenuButton = ariaLabel.includes('menu') || 
                             btn.classList.toString().includes('Hamburger') ||
                             btn.classList.toString().includes('MenuButton') ||
                             btn.classList.toString().includes('MobileMenu');
          if (isMenuButton) {
            // CSS will handle hiding based on body attribute - no inline styles needed
            btn.setAttribute('data-target-link', 'true');
            
            if (process.env.NODE_ENV === 'development' && !btn.hasAttribute('data-logged-hidden')) {
              console.log('[CM Hide] Hid hamburger menu button');
              btn.setAttribute('data-logged-hidden', 'true');
            }
          }
        });
        
        // Move "All Modules" to header for mobile view (like Media Library)
        // Find the header where Media Library is located
        const header = document.querySelector('header') || 
                      document.querySelector('[class*="Header"]') ||
                      document.querySelector('[class*="TopBar"]') ||
                      document.querySelector('[class*="AppBar"]');
        
        if (header) {
          // Find Media Library link in header to use as reference
          const mediaLibraryLink = header.querySelector('a[href*="media-library"]') ||
                                  header.querySelector('a[href*="media"]') ||
                                  Array.from(header.querySelectorAll('a')).find(a => {
                                    const href = a.getAttribute('href') || '';
                                    const text = (a.textContent || '').toLowerCase();
                                    const ariaLabel = (a.getAttribute('aria-label') || '').toLowerCase();
                                    return href.includes('media') || text.includes('media') || ariaLabel.includes('media');
                                  });
          
          // Find the container where Media Library icon is (usually a button or link wrapper)
          const mediaContainer = mediaLibraryLink ? 
            (mediaLibraryLink.closest('button') || mediaLibraryLink.closest('[class*="IconButton"]') || mediaLibraryLink.parentElement) :
            null;
          
          if (mediaContainer || mediaLibraryLink) {
            const referenceElement = mediaContainer || mediaLibraryLink;
            const headerActions = referenceElement.parentElement || header;
            
            // Find or create "All Modules" link in header
            let allModulesLink = header.querySelector('a[href*="plugins/modules-sidebar/all-modules"]') ||
                                header.querySelector('a[href*="/modules-sidebar/all-modules"]');
            
            if (!allModulesLink) {
              // Find "All Modules" link in sidebar
              const sidebarAllModules = document.querySelector('nav a[href*="plugins/modules-sidebar/all-modules"]') ||
                                       document.querySelector('aside a[href*="plugins/modules-sidebar/all-modules"]') ||
                                       document.querySelector('a[href*="plugins/modules-sidebar/all-modules"]');
              if (sidebarAllModules) {
                // Clone the link
                allModulesLink = sidebarAllModules.cloneNode(true);
                allModulesLink.style.cssText = 'display: inline-flex !important; visibility: visible !important; opacity: 1 !important;';
                allModulesLink.removeAttribute('data-hidden-by-modules-sidebar');
                allModulesLink.setAttribute('data-moved-to-header', 'true');
                
                // Insert after Media Library container
                if (referenceElement && referenceElement.nextSibling) {
                  headerActions.insertBefore(allModulesLink, referenceElement.nextSibling);
                } else if (referenceElement) {
                  headerActions.appendChild(allModulesLink);
                } else {
                  header.appendChild(allModulesLink);
                }
              }
            } else {
              // Ensure it's visible in header
              allModulesLink.style.cssText = 'display: inline-flex !important; visibility: visible !important; opacity: 1 !important;';
              allModulesLink.removeAttribute('data-hidden-by-modules-sidebar');
            }
          }
        }
      }
    } else if (isSuper) {
      // Show for Super Admin - remove any hiding (CM, Home, Deploy, Settings)
      document.querySelectorAll('[data-hidden-by-modules-sidebar="true"]').forEach((el) => {
        const href = el.getAttribute('href') || '';
        const isMainCMLink = href === '/admin/content-manager' || href === '/content-manager';
        const isHomeLink = href === '/admin' || href === '/admin/home' || (href.startsWith('/admin') && href.endsWith('/admin'));
        const isDeployLink = href.includes('/plugins/cloud') || href.includes('/admin/plugins/cloud') || href.includes('/deploy');
        const isSettingsLink = href.includes('/settings') || href.includes('/admin/settings');
        
        if (isMainCMLink || isHomeLink || isDeployLink || isSettingsLink) {
          el.style.removeProperty('display');
          el.style.removeProperty('visibility');
          el.style.removeProperty('opacity');
          el.removeAttribute('data-hidden-by-modules-sidebar');
          
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 5) {
            if (parent.hasAttribute('data-hidden-by-modules-sidebar')) {
              parent.style.removeProperty('display');
              parent.style.removeProperty('visibility');
              parent.removeAttribute('data-hidden-by-modules-sidebar');
            }
            parent = parent.parentElement;
            depth++;
          }
        }
      });
    }

    // Hide CM left sidebar ONLY for HR Admin and LM Admin (Super Admin keeps it visible)
    // Use more comprehensive selectors
    const sidebarSelectors = [
      'nav[aria-label*="Content Manager"]',
      'nav[aria-label*="content manager"]',
      '[data-testid="content-manager-sidebar"]',
      '[class*="LeftMenu"]',
      '[class*="sideNav"]',
      '[class*="SideNav"]',
      '[class*="LeftNav"]',
      '[class*="CollectionTypes"]',
      '[class*="CollectionTypesList"]',
      'aside[class*="Sidebar"]',
      'nav[class*="Sidebar"]',
    ];
    
    // CRITICAL: For Super Admin, don't touch sidebar at all to prevent blinking
    if (!isSuper) {
      // Only manipulate sidebar for HR/LM Admin
      // Also check Layouts-Root children
      const layoutsRoot = document.querySelector('[class*="Layouts-Root"]');
      if (layoutsRoot) {
        const children = Array.from(layoutsRoot.children);
        children.forEach((child, index) => {
          // First child is usually the sidebar
          if (index === 0) {
            const hasCollectionLinks = 
              child.querySelector('a[href*="/content-manager/collection-types"]') ||
              child.querySelector('a[href*="/content-manager/single-types"]') ||
              child.textContent?.includes('COLLECTION TYPES') ||
              child.textContent?.includes('SINGLE TYPES') ||
              child.querySelector('[class*="CollectionTypes"]');
            
            if (hasCollectionLinks || index === 0) {
              // Always check first child - it's likely the sidebar
              // Force hide if we have valid HR/LM/Admin role detection
              const forceHideForHRorLMorAdmin = (isHR || isLM || isAdmin) && !isSuper;
              const shouldActuallyHideSidebar = (forceHideForHRorLMorAdmin || shouldHide || shouldHideFromModules) && !isSuper;
              
              if (shouldActuallyHideSidebar) {
                // Hide sidebar for HR/LM Admin - be very aggressive
                child.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; width: 0 !important; height: 0 !important; overflow: hidden !important;';
                child.setAttribute('data-hidden-by-modules-sidebar', 'true');
                
                // Expand main content to full width
                children.slice(1).forEach((mainContent) => {
                  mainContent.style.cssText += 'width: 100% !important; max-width: 100% !important; flex: 1 1 100% !important; margin-left: 0 !important; padding-left: 0 !important;';
                });
              }
            }
          }
        });
      }
    }
    // For Super Admin: Do NOTHING with sidebar - let it be natural to prevent blinking
    
    // CRITICAL: Only manipulate sidebar for HR/LM Admin, not Super Admin
    if (!isSuper) {
      // Also hide using specific selectors
      sidebarSelectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
          const hasCollectionLinks = 
            el.querySelector('a[href*="/content-manager/collection-types"]') ||
            el.querySelector('a[href*="/content-manager/single-types"]') ||
            el.textContent?.includes('COLLECTION TYPES') ||
            el.textContent?.includes('SINGLE TYPES');
          
          if (hasCollectionLinks) {
            if (shouldHide || shouldHideFromModules) {
              // Aggressively hide sidebar
              el.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; width: 0 !important; height: 0 !important; overflow: hidden !important;';
              el.setAttribute('data-hidden-by-modules-sidebar', 'true');
              
              // Also expand any main content siblings
              const parent = el.parentElement;
              if (parent) {
                Array.from(parent.children).forEach((sibling) => {
                  if (sibling !== el) {
                    sibling.style.cssText += 'width: 100% !important; max-width: 100% !important; flex: 1 1 100% !important;';
                  }
                });
              }
            }
          }
        });
      });
    }
    // For Super Admin: Do NOTHING with sidebar - let it be natural to prevent blinking
  };

  // Function to immediately fetch roles from API on login
  // This ensures roles are detected immediately without needing to visit AllModules
  const fetchRolesImmediately = async () => {
    try {
      // Check if we already have roles cached
      if (cachedRoles && cachedRoles.length > 0) {
        return cachedRoles;
      }
      
      // Check Redux store first (fastest) - check multiple times aggressively
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const state = window.strapi?.store?.getState?.() || {};
          const token = state?.admin_app?.token;
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const reduxRoles = adminUser?.roles || authUser?.roles || [];
          
          if (reduxRoles && reduxRoles.length > 0) {
            // Roles found in Redux - use immediately!
            cachedRoles = reduxRoles;
            const isSuper = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            
            try {
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
              sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
              window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
            } catch (e) {}
            
            // Set body flag immediately
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            } else {
              const setFlag = () => {
                if (document.body) {
                  document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
                } else {
                  setTimeout(setFlag, 5);
                }
              };
              setFlag();
            }
            
            cachedIsSuperAdmin = isSuper ? true : false;
            isInitialLoad = false;
            
            // Hide links immediately
            if (typeof hideLinksNow === 'function') {
              setTimeout(hideLinksNow, 10);
            }
            
            // Trigger hide logic
            if (typeof runHideLogic === 'function') {
              setTimeout(runHideLogic, 10);
            }
            
            return reduxRoles;
          }
          
          if (!token && attempt < 9) {
            // No token yet, wait a bit and retry
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }
          
          if (token) {
            // Token exists - fetch from API
            break; // Exit loop to fetch from API
          }
        } catch (e) {
          // Ignore errors, continue
        }
      }
      
      // If Redux doesn't have roles, fetch from API
      const state = window.strapi?.store?.getState?.() || {};
      const token = state?.admin_app?.token;
      
      if (!token) {
        // No token yet, wait a bit and retry
        setTimeout(fetchRolesImmediately, 100);
        return;
      }
      
      // Fetch roles from API immediately
      const baseURL = window.strapi?.backendURL || 'http://localhost:1337';
      const response = await fetch(`${baseURL}/admin/users/me?populate=roles`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });
      
      if (response.ok) {
        const responseData = await response.json();
        const userData = responseData?.data || responseData;
        const roles = userData?.roles || [];
        
        if (roles && roles.length > 0) {
          // Cache roles immediately
          cachedRoles = Array.isArray(roles) ? roles : [roles];
          try {
            sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(cachedRoles));
            window.__MODULES_SIDEBAR_ROLES__ = cachedRoles;
            
            // Check if Super Admin and persist
            const isSuper = cachedRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
            
            // Set body flag immediately
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            } else {
              const setFlag = () => {
                if (document.body) {
                  document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
                } else {
                  setTimeout(setFlag, 5);
                }
              };
              setFlag();
            }
            
            cachedIsSuperAdmin = isSuper ? true : false;
            isInitialLoad = false;
            
            // Hide links immediately
            if (typeof hideLinksNow === 'function') {
              setTimeout(hideLinksNow, 10);
            }
            
            // Trigger hide logic to ensure everything is updated
            if (typeof runHideLogic === 'function') {
              setTimeout(runHideLogic, 10);
            }
          } catch (e) {
            // Ignore storage errors
          }
          
          return cachedRoles;
        }
      }
    } catch (e) {
      // Ignore errors, will retry
    }
    
    return null;
  };
  
  // CRITICAL: Check Redux store IMMEDIATELY on script load (before UI renders)
  // This ensures body flag is set before any icons appear
  const checkReduxImmediately = () => {
    try {
      const state = window.strapi?.store?.getState?.() || {};
      const adminUser = state?.admin_app?.user;
      const authUser = state?.auth?.user || state?.auth?.userInfo;
      const token = state?.admin_app?.token;
      const reduxRoles = adminUser?.roles || authUser?.roles || [];
      
      if (reduxRoles && reduxRoles.length > 0) {
        // Roles found in Redux - set body flag immediately
        const isSuper = reduxRoles.some(r => {
          const name = (r?.name || '').toLowerCase();
          return name === 'super admin' || name.includes('super admin');
        });
        
        // Cache immediately
        cachedRoles = reduxRoles;
        cachedIsSuperAdmin = isSuper ? true : false;
        try {
          sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
          sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
          window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
        } catch (e) {}
        
        // Set body flag immediately (even if body doesn't exist yet, it will be set when body appears)
        if (document.body) {
          document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
        } else {
          // Body not ready - set it when body appears
          const setFlagWhenBodyReady = () => {
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            } else {
              setTimeout(setFlagWhenBodyReady, 5);
            }
          };
          setFlagWhenBodyReady();
        }
        
        // Trigger hide logic after a short delay (to ensure function is defined)
        setTimeout(() => {
          if (typeof runHideLogic === 'function') {
            runHideLogic();
          }
        }, 50);
        
        return true; // Roles found
      } else if (token) {
        // Token exists but no roles yet - fetch from API
        fetchRolesImmediately();
      }
    } catch (e) {
      // Ignore errors
    }
    return false;
  };
  
  // Check Redux immediately
  checkReduxImmediately();
  
  // Start fetching roles immediately on script load
  // Also retry if token not ready yet
  fetchRolesImmediately();
  
  // Retry fetching roles when Redux store updates (user logs in)
  try {
    const store = window.strapi?.store;
    if (store && typeof store.subscribe === 'function') {
      let lastToken = null;
      store.subscribe(() => {
        try {
          const state = store.getState();
          const currentToken = state?.admin_app?.token;
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const reduxRoles = adminUser?.roles || authUser?.roles || [];
          
          // If token just appeared (user logged in), check roles immediately
          if (!lastToken && currentToken) {
            // Check if roles are already in Redux
            if (reduxRoles && reduxRoles.length > 0) {
              // Roles already in Redux - set body flag immediately
              const isSuper = reduxRoles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return name === 'super admin' || name.includes('super admin');
              });
              
              cachedRoles = reduxRoles;
              cachedIsSuperAdmin = isSuper ? true : false;
              try {
                sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
                window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
              } catch (e) {}
              
              // Set body flag immediately - CSS will handle visibility
              if (document.body) {
                document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
              } else {
                // Body not ready - set it when body appears
                const setFlagWhenBodyReady = () => {
                  if (document.body) {
                    document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
                  } else {
                    setTimeout(setFlagWhenBodyReady, 5);
                  }
                };
                setFlagWhenBodyReady();
              }
              
              // Also trigger hide logic to ensure everything is updated
              if (typeof runHideLogic === 'function') {
                setTimeout(runHideLogic, 10);
              }
            } else {
              // No roles in Redux yet - fetch from API
              fetchRolesImmediately();
            }
          } else if (reduxRoles && reduxRoles.length > 0 && (!cachedRoles || cachedRoles.length === 0)) {
            // Roles appeared in Redux - set body flag immediately
            const isSuper = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            
            cachedRoles = reduxRoles;
            cachedIsSuperAdmin = isSuper ? true : false;
            try {
              sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
              window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
            } catch (e) {}
            
            // Set body flag immediately - CSS will handle visibility
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
            } else {
              // Body not ready - set it when body appears
              const setFlagWhenBodyReady = () => {
                if (document.body) {
                  document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
                } else {
                  setTimeout(setFlagWhenBodyReady, 5);
                }
              };
              setFlagWhenBodyReady();
            }
            
            // Trigger hide logic to ensure everything is updated
            if (typeof runHideLogic === 'function') {
              setTimeout(runHideLogic, 10);
            }
          }
          
          lastToken = currentToken;
        } catch (e) {
          // Ignore errors
        }
      });
    }
  } catch (e) {
    // Ignore errors
  }

  // Run periodically to catch route changes
  // Run immediately when DOM is ready
  const runHideLogic = () => {
    // Just run full hide logic - CSS will handle the hiding based on body attribute
    hideContentManagerSidebar().catch(() => {
      // Ignore errors
    });
  };
  
  // Home visibility logic removed: keep Home visible for all admin roles.
  const enforceHomeHiddenForNonSuper = () => {};


  // Run immediately and multiple times to catch early role detection
  // This ensures roles are detected as soon as Redux store is ready
  // Also ensures links are hidden immediately on page load for HR/LM Admin
  const runImmediate = () => {
    // Run immediately - don't wait
    runHideLogic();
    // Run again after very short delays to catch store initialization and DOM changes
    setTimeout(runHideLogic, 10);
    setTimeout(runHideLogic, 25);
    setTimeout(runHideLogic, 50);
    setTimeout(runHideLogic, 100);
    setTimeout(runHideLogic, 200);
    setTimeout(runHideLogic, 300);
    setTimeout(runHideLogic, 500);
    setTimeout(runHideLogic, 800);
    setTimeout(runHideLogic, 1200);
    setTimeout(runHideLogic, 2000);
  };

  // Subscribe to Redux store when available (may not exist at plugin load)
  const registerReduxSubscriber = (store) => {
    if (!store || typeof store.subscribe !== 'function') return false;
      let lastState = null;
      let lastRoles = null;
      store.subscribe(() => {
        try {
          const currentState = store.getState();
          const currentUser = currentState?.admin_app?.user || currentState?.auth?.user;
          const lastUser = lastState?.admin_app?.user || lastState?.auth?.user;

          // CRITICAL: User just logged out - reset sidebar state immediately so next user never sees previous role
          const userJustLoggedOut = lastUser && !currentUser;
          if (userJustLoggedOut) {
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', 'pending');
              document.body.dataset.hideCmSidebar = 'pending';
            }
            try {
              sessionStorage.removeItem('__is_super_admin__');
              sessionStorage.removeItem('__modules_sidebar_roles__');
            } catch (e) {}
            delete window.__MODULES_SIDEBAR_ROLES__;
            cachedRoles = null;
            roleFlagsCache = null;
            cachedIsSuperAdmin = null;
            lastRoles = null;
            lastToken = null;
            lastUserId = null;
            isInitialLoad = true;
            lastState = currentState;
            runHideLogic();
            return;
          }

          // Check if user just logged in (user changed from null/undefined to having data)
          const userJustLoggedIn = (!lastUser && currentUser) ||
                                  (lastUser?.id !== currentUser?.id);

          // ALWAYS check for roles on every state change (not just on login)
          // This ensures we catch roles as soon as they're available in Redux
          const roles = currentUser?.roles || [];
          const rolesChanged = roles !== lastRoles && roles && roles.length > 0;

          if (rolesChanged || userJustLoggedIn) {
            if (roles && roles.length > 0) {
              // If user just logged in (different user), clear old sessionStorage
              if (userJustLoggedIn) {
                try {
                  sessionStorage.removeItem('__is_super_admin__');
                  sessionStorage.removeItem('__modules_sidebar_roles__');
                } catch (e) {}
              }
              
              const isSuper = roles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return name === 'super admin' || name.includes('super admin');
              });
              
              // Check if HR, LM, or Admin
              const isHR = roles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return name.includes('hr admin') || (name.includes('hr') && !name.includes('lm') && !name.includes('admin'));
              });
              const isLM = roles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return name.includes('lm admin') || (name.includes('lm') && !name.includes('hr') && !name.includes('admin'));
              });
              const isAdmin = roles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return (name === 'admin' || name.includes('admin')) && !name.includes('super') && !name.includes('hr') && !name.includes('lm');
              });
              
              // Calculate body flag value immediately
              const shouldHide = !isSuper && (isHR || isLM || isAdmin);
              const bodyFlagValue = shouldHide ? 'true' : 'false';
              
              // CRITICAL: Set body flag SYNCHRONOUSLY (no delays)
              const setBodyFlagSync = (value) => {
                if (document.body) {
                  document.body.setAttribute('data-hide-cm-sidebar', value);
                  document.body.dataset.hideCmSidebar = value;
                } else {
                  // Body not ready - set it when body appears (check every 1ms for speed)
                  const setFlag = () => {
                    if (document.body) {
                      document.body.setAttribute('data-hide-cm-sidebar', value);
                      document.body.dataset.hideCmSidebar = value;
                    } else {
                      setTimeout(setFlag, 1);
                    }
                  };
                  setFlag();
                }
              };
              setBodyFlagSync(bodyFlagValue);
              
              // Immediately set persistent status
              try {
                sessionStorage.setItem('__is_super_admin__', isSuper ? 'true' : 'false');
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
                window.__MODULES_SIDEBAR_ROLES__ = roles;
              } catch (e) {}
              
              // Update cache immediately
              cachedRoles = roles;
              cachedIsSuperAdmin = isSuper ? true : false;
              roleFlagsCache = null; // Force recalculation
              isInitialLoad = false;
              
              lastRoles = roles;
              
              // CSS handles visibility - no need for runHideLogic delay
            }
          }
          
          lastState = currentState;
          
          // Use proper cache clearing logic (only clears on user/token change)
          clearCacheIfUserChanged();
          // Also check window roles immediately (set by AllModules page)
          const windowRoles = getRolesFromWindow();
          if (windowRoles && windowRoles.length > 0 && !isInitialLoad) {
            cachedRoles = windowRoles;
          }
          runHideLogic();
        } catch (e) {
          // Ignore errors but still run hide logic
          runHideLogic();
        }
      });
    return true;
  };

  try {
    if (!registerReduxSubscriber(window.strapi?.store)) {
      // Store may not exist at plugin load; poll until it does so logout/login are always observed
      let attempts = 0;
      const pollStore = () => {
        attempts++;
        if (registerReduxSubscriber(window.strapi?.store)) return;
        if (attempts < 100) setTimeout(pollStore, 50);
      };
      setTimeout(pollStore, 50);
    }
  } catch (e) {
    // Ignore errors
  }

  // Also watch for window.__MODULES_SIDEBAR_ROLES__ changes (set by AllModules page)
  let lastWindowRoles = null;
  const checkWindowRoles = () => {
    const currentRoles = window.__MODULES_SIDEBAR_ROLES__;
    if (currentRoles !== lastWindowRoles && currentRoles && Array.isArray(currentRoles) && currentRoles.length > 0) {
      lastWindowRoles = currentRoles;
      cachedRoles = currentRoles;
      roleFlagsCache = null; // Force recalculation
      runHideLogic();
    }
  };
  
  // Listen for custom event when roles are updated (from AllModules page)
  window.addEventListener('modules-sidebar-roles-updated', (event) => {
    if (event.detail && Array.isArray(event.detail) && event.detail.length > 0) {
      cachedRoles = event.detail;
      roleFlagsCache = null; // Force recalculation
      lastWindowRoles = event.detail;
      // Run hiding logic immediately
      runHideLogic();
    }
  });
  
  // Check window roles very frequently to catch role updates immediately
  setInterval(checkWindowRoles, 50); // Check every 50ms for faster detection

  // CRITICAL: Run IMMEDIATELY, even before DOM is ready
  // Inject CSS first - this must happen before anything else
  ensureStyle();
  
  // CRITICAL: Set body flag immediately based on sessionStorage (before UI renders)
  // This ensures icons are hidden/shown correctly from the start
  const setBodyFlagBeforeRender = () => {
    try {
      const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
      if (document.body) {
        // Set flag immediately - CSS will handle visibility
        if (storedSuperAdmin === 'true') {
          document.body.setAttribute('data-hide-cm-sidebar', 'false');
        } else if (storedSuperAdmin === 'false') {
          document.body.setAttribute('data-hide-cm-sidebar', 'true');
        } else {
          // Unknown (e.g. after logout or first load): hide restricted items until we know role
          document.body.setAttribute('data-hide-cm-sidebar', 'pending');
        }
      } else {
        // Body not ready - set it when body appears
        const checkBody = setInterval(() => {
          if (document.body) {
            if (storedSuperAdmin === 'true') {
              document.body.setAttribute('data-hide-cm-sidebar', 'false');
            } else if (storedSuperAdmin === 'false') {
              document.body.setAttribute('data-hide-cm-sidebar', 'true');
            } else {
              document.body.setAttribute('data-hide-cm-sidebar', 'pending');
            }
            clearInterval(checkBody);
          }
        }, 5); // Check every 5ms for fastest possible setting

        // Stop checking after 2 seconds
        setTimeout(() => clearInterval(checkBody), 2000);
      }
    } catch (e) {
      // Ignore errors
    }
  };
  
  // Set body flag immediately
  setBodyFlagBeforeRender();
  
  // CRITICAL: Aggressive initial role detection with async retries
  // This function will keep checking Redux store until roles are found
  const detectInitialRoles = async () => {
    let initialIsSuperAdmin = null; // null = unknown, true = Super Admin, false = HR/LM Admin
    let initialRoles = null;
    
    // First, check persistent Super Admin status from sessionStorage (fastest)
    try {
      const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
      if (storedSuperAdmin === 'true') {
        initialIsSuperAdmin = true;
        // Set body flag immediately
        if (document.body) {
          document.body.setAttribute('data-hide-cm-sidebar', 'false');
        }
        cachedIsSuperAdmin = true;
        return; // Early exit if we know it's Super Admin
      } else if (storedSuperAdmin === 'false') {
        initialIsSuperAdmin = false;
        // Set body flag immediately to hide links
        if (document.body) {
          document.body.setAttribute('data-hide-cm-sidebar', 'true');
        }
        cachedIsSuperAdmin = false;
        // Continue to check for roles to cache them
      }
    } catch (e) {
      // Ignore
    }
    
    // Check for cached roles in sessionStorage
    try {
      const storedRoles = sessionStorage.getItem('__modules_sidebar_roles__');
      if (storedRoles) {
        const parsed = JSON.parse(storedRoles);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          initialRoles = parsed;
          
          // Check if Super Admin from cached roles
          const isSuper = parsed.some(r => {
            const name = (r?.name || '').toLowerCase();
            return name === 'super admin' || name.includes('super admin');
          });
          
          if (isSuper) {
            initialIsSuperAdmin = true;
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', 'false');
            }
            cachedIsSuperAdmin = true;
            cachedRoles = parsed;
            window.__MODULES_SIDEBAR_ROLES__ = parsed;
            isInitialLoad = false;
            return; // Early exit
          } else {
            // Check if HR, LM, or Admin
            const isHR = parsed.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name.includes('hr admin') || (name.includes('hr') && !name.includes('lm') && !name.includes('admin'));
            });
            const isLM = parsed.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name.includes('lm admin') || (name.includes('lm') && !name.includes('hr') && !name.includes('admin'));
            });
            const isAdmin = parsed.some(r => {
              const name = (r?.name || '').toLowerCase();
              return (name === 'admin' || name.includes('admin')) && !name.includes('super') && !name.includes('hr') && !name.includes('lm');
            });
            
            if (isHR || isLM || isAdmin) {
              initialIsSuperAdmin = false;
              if (document.body) {
                document.body.setAttribute('data-hide-cm-sidebar', 'true');
              }
              cachedIsSuperAdmin = false;
              cachedRoles = parsed;
              window.__MODULES_SIDEBAR_ROLES__ = parsed;
              isInitialLoad = false;
              return; // Early exit
            }
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    // Aggressively check Redux store with retries (up to 20 times, every 50ms = 1 second total)
    // This ensures we catch roles as soon as Redux store is populated after login
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const state = window.strapi?.store?.getState?.() || {};
        const adminUser = state?.admin_app?.user;
        const authUser = state?.auth?.user || state?.auth?.userInfo;
        const reduxRoles = adminUser?.roles || authUser?.roles || [];
        
        if (reduxRoles && reduxRoles.length > 0) {
          initialRoles = reduxRoles;
          
          const isSuper = reduxRoles.some(r => {
            const name = (r?.name || '').toLowerCase();
            return name === 'super admin' || name.includes('super admin');
          });
          
          if (isSuper) {
            initialIsSuperAdmin = true;
            cachedIsSuperAdmin = true;
            // Persist immediately
            try {
              sessionStorage.setItem('__is_super_admin__', 'true');
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
            } catch (e) {}
          } else {
            // Check if HR, LM, or Admin
            const isHR = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name.includes('hr admin') || (name.includes('hr') && !name.includes('lm') && !name.includes('admin'));
            });
            const isLM = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name.includes('lm admin') || (name.includes('lm') && !name.includes('hr') && !name.includes('admin'));
            });
            const isAdmin = reduxRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return (name === 'admin' || name.includes('admin')) && !name.includes('super') && !name.includes('hr') && !name.includes('lm');
            });
            
            if (isHR || isLM || isAdmin) {
              initialIsSuperAdmin = false;
              cachedIsSuperAdmin = false;
              // Persist immediately
              try {
                sessionStorage.setItem('__is_super_admin__', 'false');
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
              } catch (e) {}
            }
          }
          
          // Update body flag immediately when roles are found
          if (document.body) {
            if (initialIsSuperAdmin === true) {
              document.body.setAttribute('data-hide-cm-sidebar', 'false');
            } else if (initialIsSuperAdmin === false) {
              document.body.setAttribute('data-hide-cm-sidebar', 'true');
            }
          }
          
          // Cache roles
          cachedRoles = reduxRoles;
          window.__MODULES_SIDEBAR_ROLES__ = reduxRoles;
          isInitialLoad = false;
          
          // Found roles, exit retry loop
          break;
        }
      } catch (e) {
        // Ignore Redux errors, continue retrying
      }
      
      // Wait 50ms before next attempt (except on last attempt)
      if (attempt < 19) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // If roles still not found after retries, keep pending (never assume Super Admin)
    if (initialIsSuperAdmin === null && document.body) {
      const current = document.body.getAttribute('data-hide-cm-sidebar');
      if (current !== 'true' && current !== 'false') {
        document.body.setAttribute('data-hide-cm-sidebar', 'pending');
      }
    }
  };
  
  // Start aggressive role detection immediately (don't await - let it run in background)
  detectInitialRoles().catch(() => {
    // Ignore errors - hideContentManagerSidebar will handle it
  });
  
  // Also set initial body flag based on sessionStorage (synchronous check)
  // This runs immediately, even before DOM is ready
  const setInitialBodyFlag = () => {
    try {
      const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
      if (document.body) {
        if (!document.body.hasAttribute('data-hide-cm-sidebar')) {
          if (storedSuperAdmin === 'true') {
            document.body.setAttribute('data-hide-cm-sidebar', 'false');
            cachedIsSuperAdmin = true;
          } else if (storedSuperAdmin === 'false') {
            document.body.setAttribute('data-hide-cm-sidebar', 'true');
            cachedIsSuperAdmin = false;
            // Body flag is set - CSS will handle hiding automatically
          } else {
            // Unknown at boot: keep "pending" (hide until roles are known)
            document.body.setAttribute('data-hide-cm-sidebar', 'pending');
          }
        } else if (storedSuperAdmin === 'false' && document.body.getAttribute('data-hide-cm-sidebar') !== 'true') {
          // Update if flag doesn't match
          document.body.setAttribute('data-hide-cm-sidebar', 'true');
          cachedIsSuperAdmin = false;
          // Body flag is set - CSS will handle hiding automatically
        }
      }
    } catch (e) {
      // Ignore
    }
  };
  
  // Set initial flag immediately if body exists
  setInitialBodyFlag();
  
  // Also check Redux one more time when body becomes available
  const setBodyFlagWhenReady = () => {
    if (document.body) {
      // Check Redux one more time
      const state = window.strapi?.store?.getState?.() || {};
      const adminUser = state?.admin_app?.user;
      const authUser = state?.auth?.user || state?.auth?.userInfo;
      const reduxRoles = adminUser?.roles || authUser?.roles || [];
      
      if (reduxRoles && reduxRoles.length > 0) {
        const isSuper = reduxRoles.some(r => {
          const name = (r?.name || '').toLowerCase();
          return name === 'super admin' || name.includes('super admin');
        });
        
        document.body.setAttribute('data-hide-cm-sidebar', isSuper ? 'false' : 'true');
        cachedRoles = reduxRoles;
        cachedIsSuperAdmin = isSuper ? true : false;
      } else {
        // Use sessionStorage if Redux doesn't have roles yet
        setInitialBodyFlag();
      }
    } else {
      setTimeout(setBodyFlagWhenReady, 10);
    }
  };
  
  // Set flag when body becomes available
  if (!document.body) {
    const bodyObserver = new MutationObserver(() => {
      if (document.body) {
        setBodyFlagWhenReady();
        bodyObserver.disconnect();
      }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
    
    // Also try with setTimeout as backup
    setBodyFlagWhenReady();
  } else {
    setBodyFlagWhenReady();
  }
  
  // Cache Super Admin status (will be updated by detectInitialRoles)
  // Note: cachedIsSuperAdmin is declared above in detectInitialRoles scope, but we need it globally
  // It's already declared globally earlier, so this is just for reference
  let lastSuperAdminCheck = 0;
  const SUPER_ADMIN_CHECK_INTERVAL = 1000; // Check every 1 second max
  
  // CRITICAL: Run hide logic very frequently initially to catch roles as soon as they're available
  // This ensures links are hidden/shown immediately when roles are detected
  const runAggressiveInitialChecks = () => {
    // Run immediately
    runHideLogic();
    // Run multiple times with increasing intervals to catch roles as Redux store populates
    setTimeout(runHideLogic, 5);
    setTimeout(runHideLogic, 10);
    setTimeout(runHideLogic, 20);
    setTimeout(runHideLogic, 30);
    setTimeout(runHideLogic, 50);
    setTimeout(runHideLogic, 75);
    setTimeout(runHideLogic, 100);
    setTimeout(runHideLogic, 150);
    setTimeout(runHideLogic, 200);
    setTimeout(runHideLogic, 300);
    setTimeout(runHideLogic, 500);
    setTimeout(runHideLogic, 800);
    setTimeout(runHideLogic, 1200);
  };
  
  // Start aggressive initial checks immediately
  runAggressiveInitialChecks();
  
  // IMPORTANT: Do not use inline styles or DOM markers (they caused flicker and wrong role state).
  // We rely ONLY on body[data-hide-cm-sidebar] + injected CSS.
  const hideLinksNow = () => {};
  
  // CRITICAL: MutationObserver to hide links immediately as they appear in DOM
  // This catches dynamically added links and hides them instantly for HR/LM/Admin
  const setupLinkObserver = () => {
    if (typeof MutationObserver === 'undefined') return;
    
    const observer = new MutationObserver((mutations) => {
      // Check if we should hide links
      const shouldHide = document.body?.getAttribute('data-hide-cm-sidebar') === 'true';
      
      if (shouldHide) {
        hideLinksNow(); // Hide links immediately
      }
    });
    
    // Start observing when DOM is ready
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } else {
      // Wait for body to be ready
      const checkBody = setInterval(() => {
        if (document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });
          clearInterval(checkBody);
        }
      }, 10);
      
      // Stop checking after 5 seconds
      setTimeout(() => clearInterval(checkBody), 5000);
    }
  };
  
  // Setup MutationObserver immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLinkObserver);
  } else {
    setupLinkObserver();
  }
  
  // Also run hideLinksNow periodically to catch any missed links
  setInterval(() => {
    if (document.body && document.body.getAttribute('data-hide-cm-sidebar') === 'true') {
      hideLinksNow();
    }
  }, 100);
  
  // Home redirect logic removed: keep Home available to all admin roles.
  const redirectIfNeeded = async () => {};

  
  const getAdminHomeTargetByRole = () => '/admin';

  
  const isLogoOrHomeAnchor = (anchor) => {
    if (!anchor) return false;
    const href = (anchor.getAttribute('href') || '').trim();
    let anchorPath = '';
    try {
      anchorPath = new URL(anchor.href, window.location.origin).pathname || '';
    } catch (e) {
      anchorPath = href.split('?')[0].split('#')[0];
    }
    const ariaLabel = (anchor.getAttribute('aria-label') || '').toLowerCase();
    const title = (anchor.getAttribute('title') || '').toLowerCase();
    const text = (anchor.textContent || '').toLowerCase().trim();
    const isHomeHref =
      href === '/admin' ||
      href === '/admin/' ||
      href === '/admin/home' ||
      anchorPath === '/admin' ||
      anchorPath === '/admin/';
    const isHomeByLabel = ariaLabel === 'home' || title === 'home' || text === 'home';
    
    // Strapi logo/brand link usually points to /admin and sits in main nav.
    const isBrandLike = isHomeHref && (
      anchor.closest('[class*="NavBrand"]') ||
      anchor.closest('[class*="Brand"]') ||
      anchor.closest('[class*="MainNav"]') ||
      anchor.closest('nav')
    );
    
    return isHomeHref || isHomeByLabel || isBrandLike;
  };
  
  // Keep brand/logo clickable for all roles (some global hide rules target /admin links).
  const ensureLogoIsClickable = () => {
    const id = 'modules-sidebar-logo-clickable-fix';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      nav a[href="/admin"],
      nav a[href="/admin/"],
      nav a[href="/admin/home"],
      aside a[href="/admin"],
      aside a[href="/admin/"],
      aside a[href="/admin/home"],
      [class*="NavBrand"] a,
      [class*="Brand"] a {
        display: inline-flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  };
  
  ensureLogoIsClickable();
  
  const forceBrandInteractive = () => {
    const candidates = document.querySelectorAll(
      '[class*="NavBrand"], [class*="Brand"], nav a[href="/admin"], nav a[href="/admin/"], nav a[href="/admin/home"], aside a[href="/admin"], aside a[href="/admin/"], aside a[href="/admin/home"]'
    );
    candidates.forEach((node) => {
      if (!node || !node.style) return;
      node.style.setProperty('display', 'inline-flex', 'important');
      node.style.setProperty('visibility', 'visible', 'important');
      node.style.setProperty('opacity', '1', 'important');
      node.style.setProperty('pointer-events', 'auto', 'important');
      node.removeAttribute('data-hidden-by-modules-sidebar');
      
      let parent = node.parentElement;
      let depth = 0;
      while (parent && depth < 4) {
        parent.style?.setProperty('pointer-events', 'auto', 'important');
        if (parent.hasAttribute('data-hidden-by-modules-sidebar')) {
          parent.style?.setProperty('display', 'block', 'important');
          parent.style?.setProperty('visibility', 'visible', 'important');
          parent.style?.setProperty('opacity', '1', 'important');
          parent.removeAttribute('data-hidden-by-modules-sidebar');
        }
        parent = parent.parentElement;
        depth += 1;
      }
    });
  };
  
  forceBrandInteractive();
  setTimeout(forceBrandInteractive, 50);
  setTimeout(forceBrandInteractive, 200);
  setInterval(forceBrandInteractive, 1000);
  
  // Keep default Strapi navigation behavior for logo/home links.
  
  // Deprecated: link visibility is controlled ONLY by body[data-hide-cm-sidebar] + CSS.
  // Keeping this as a no-op to avoid any blinking / late role side-effects.
  const markLinksAsHidden = () => {
    return;
    if (!document.body) {
      setTimeout(markLinksAsHidden, 10);
      return;
    }
    
    // CRITICAL: Check sessionStorage first for persistent Super Admin status
    // This ensures Super Admin status persists even if roles are temporarily empty
    let persistentIsSuperAdmin = null;
    try {
      const storedSuperAdmin = sessionStorage.getItem('__is_super_admin__');
      if (storedSuperAdmin === 'true') {
        persistentIsSuperAdmin = true;
      } else if (storedSuperAdmin === 'false') {
        persistentIsSuperAdmin = false;
      }
    } catch (e) {
      // Ignore
    }
    
    // Only check roles if cache is stale or not set
    const now = Date.now();
    const shouldCheck = cachedIsSuperAdmin === null || (now - lastSuperAdminCheck) > SUPER_ADMIN_CHECK_INTERVAL;
    
    let isSuperAdmin = cachedIsSuperAdmin;
    let roles = null;
    
    if (shouldCheck) {
      // Check roles from multiple sources immediately (fastest)
      // Priority 1: Window roles (set by AllModules page)
      if (window.__MODULES_SIDEBAR_ROLES__ && Array.isArray(window.__MODULES_SIDEBAR_ROLES__) && window.__MODULES_SIDEBAR_ROLES__.length > 0) {
        roles = window.__MODULES_SIDEBAR_ROLES__;
      }
      
      // Priority 2: SessionStorage
      if (!roles || roles.length === 0) {
        try {
          const stored = sessionStorage.getItem('__modules_sidebar_roles__');
          if (stored) {
            roles = JSON.parse(stored);
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // Priority 3: Redux store (check immediately)
      if (!roles || roles.length === 0) {
        try {
          const state = window.strapi?.store?.getState?.() || {};
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          roles = adminUser?.roles || authUser?.roles || [];
        } catch (e) {
          // Ignore
        }
      }
      
      // Check if Super Admin
      if (roles && Array.isArray(roles) && roles.length > 0) {
        isSuperAdmin = roles.some(r => {
          const name = (r?.name || '').toLowerCase();
          return name === 'super admin' || name.includes('super admin');
        });
        
        // CRITICAL: Persist Super Admin status to sessionStorage
        // This ensures it persists even if roles are temporarily empty
        try {
          sessionStorage.setItem('__is_super_admin__', isSuperAdmin ? 'true' : 'false');
        } catch (e) {
          // Ignore
        }
      } else {
        // Roles are empty - try one more aggressive check of Redux store
        // This is critical for immediate hiding on login
        try {
          const state = window.strapi?.store?.getState?.() || {};
          const adminUser = state?.admin_app?.user;
          const authUser = state?.auth?.user || state?.auth?.userInfo;
          const fallbackRoles = adminUser?.roles || authUser?.roles || [];
          
          if (fallbackRoles && fallbackRoles.length > 0) {
            isSuperAdmin = fallbackRoles.some(r => {
              const name = (r?.name || '').toLowerCase();
              return name === 'super admin' || name.includes('super admin');
            });
            
            // Persist immediately
            try {
              sessionStorage.setItem('__is_super_admin__', isSuperAdmin ? 'true' : 'false');
            } catch (e) {}
          } else {
            // Still no roles - use persistent status if available
            if (persistentIsSuperAdmin === true) {
              isSuperAdmin = true;
            } else if (persistentIsSuperAdmin === false) {
              isSuperAdmin = false;
            } else {
              // No persistent status and no roles - default to false but don't hide
              // This is safer - we'll wait for role detection
              isSuperAdmin = false;
            }
          }
        } catch (e) {
          // If Redux check fails, use persistent status
          if (persistentIsSuperAdmin === true) {
            isSuperAdmin = true;
          } else if (persistentIsSuperAdmin === false) {
            isSuperAdmin = false;
          } else {
            isSuperAdmin = false;
          }
        }
      }
      
      // Cache the result
      cachedIsSuperAdmin = isSuperAdmin;
      lastSuperAdminCheck = now;
    } else {
      // Use cached value, but also check persistent status if cache is null
      if (cachedIsSuperAdmin === null && persistentIsSuperAdmin !== null) {
        isSuperAdmin = persistentIsSuperAdmin;
        cachedIsSuperAdmin = isSuperAdmin;
      }
    }
    
    // CRITICAL: If Super Admin (from any source), ensure links are visible and body flag is correct
    // This MUST run every time, even if roles are temporarily empty
    if (isSuperAdmin || persistentIsSuperAdmin === true) {
      // Set body flag to false to show all links
      document.body.setAttribute('data-hide-cm-sidebar', 'false');
      
      // Ensure all CM/Home/Deploy/Settings links are visible for Super Admin
      const allLinks = document.querySelectorAll('a');
      allLinks.forEach((link) => {
        const href = link.getAttribute('href') || '';
        const isTargetLink = 
          (href.includes('/admin/content-manager') && !href.includes('/content-manager/collection-types') && !href.includes('/content-manager/single-types')) ||
          (href.includes('/content-manager') && !href.includes('/content-manager/collection-types') && !href.includes('/content-manager/single-types')) ||
          href === '/admin' || 
          href === '/admin/home' ||
          href.includes('/plugins/cloud') ||
          href.includes('/deploy') ||
          href.includes('/settings') ||
          href.includes('/admin/settings');
        
        if (isTargetLink) {
          // Mark as Super Admin link - CSS will show it when body flag is 'false'
          link.setAttribute('data-super-admin', 'true');
          // Remove any conflicting attributes - CSS will handle visibility
          link.removeAttribute('data-hidden-by-modules-sidebar');
          link.removeAttribute('data-target-link');
        }
      });
      
      return; // Exit early - don't hide anything for Super Admin
    }
    
    // If not Super Admin, mark links as hidden immediately
    // Set body flag to "true" to trigger CSS hiding
    // BUT: Only do this if we're sure it's NOT Super Admin (persistent status is false)
    // CRITICAL: Also check Redux store one more time for immediate detection
    if (persistentIsSuperAdmin !== true) {
      // Double-check Redux store for immediate role detection (critical for login)
      let quickCheck = false;
      try {
        const state = window.strapi?.store?.getState?.() || {};
        const adminUser = state?.admin_app?.user;
        const authUser = state?.auth?.user || state?.auth?.userInfo;
        const quickRoles = adminUser?.roles || authUser?.roles || [];
        
        if (quickRoles && quickRoles.length > 0) {
          const isQuickSuper = quickRoles.some(r => {
            const name = (r?.name || '').toLowerCase();
            return name === 'super admin' || name.includes('super admin');
          });
          
          if (isQuickSuper) {
            // It's Super Admin - don't hide
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', 'false');
            }
            try {
              sessionStorage.setItem('__is_super_admin__', 'true');
            } catch (e) {}
            quickCheck = true;
          } else {
            // Not Super Admin - hide immediately
            if (document.body) {
              document.body.setAttribute('data-hide-cm-sidebar', 'true');
            }
            try {
              sessionStorage.setItem('__is_super_admin__', 'false');
            } catch (e) {}
            quickCheck = true;
          }
        }
      } catch (e) {
        // Ignore errors
      }
      
      // If quick check didn't find roles, use persistent status
      if (!quickCheck) {
        if (document.body) {
          document.body.setAttribute('data-hide-cm-sidebar', 'true');
        }
      }
    }
    // Mark all CM/Home/Deploy links immediately - be very aggressive
    // Don't skip based on data-processed-by-marklinks - React might re-render and remove it
    const allLinks = document.querySelectorAll('a');
    allLinks.forEach((link) => {
      // Skip if marked as Super Admin
      if (link.hasAttribute('data-super-admin')) {
        return;
      }
      
      const href = link.getAttribute('href') || '';
      const isBrandLink =
        !!link.closest('[class*="NavBrand"]') || !!link.closest('[class*="Brand"]');
      const isTargetLink = 
        (href.includes('/admin/content-manager') && !href.includes('/content-manager/collection-types') && !href.includes('/content-manager/single-types')) ||
        (href.includes('/content-manager') && !href.includes('/content-manager/collection-types') && !href.includes('/content-manager/single-types')) ||
        (!isBrandLink && (href === '/admin' || href === '/admin/home')) ||
        href.includes('/plugins/cloud') ||
        href.includes('/deploy') ||
        href.includes('/settings') ||
        href.includes('/admin/settings');
      
      if (isTargetLink) {
        // DON'T set inline styles - let CSS handle it via body attribute
        // Just mark it so we know it's a target link
        link.setAttribute('data-target-link', 'true');
        // Remove Super Admin marker if present (CSS will hide it)
        link.removeAttribute('data-super-admin');
      }
    });
    
    // Also hide hamburger menu buttons (only if not Super Admin)
    const hamburgerButtons = document.querySelectorAll('button[aria-label*="menu" i], button[aria-label*="Menu"], [class*="Hamburger"], [class*="MenuButton"]');
    hamburgerButtons.forEach((btn) => {
      // Skip if marked as Super Admin
      if (btn.hasAttribute('data-super-admin')) {
        return;
      }
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('menu') || btn.classList.toString().includes('Hamburger')) {
        // DON'T set inline styles - CSS will handle it via body attribute
        btn.setAttribute('data-target-link', 'true');
      }
    });
  };
  
  // CRITICAL: Run markLinksAsHidden immediately to set body flag correctly
  // This ensures Super Admin links are visible from the start
  markLinksAsHidden();
  runImmediate();
  enforceHomeHiddenForNonSuper();
  
  // Also run markLinksAsHidden on an interval to catch new links
  // Reduced frequency to prevent conflicts and blinking
  setInterval(() => {
    markLinksAsHidden();
  }, 1000); // Run every 1 second to catch new links without causing conflicts
  
  // Run multiple times immediately to catch early role detection
  // Use requestAnimationFrame for earliest possible execution
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      markLinksAsHidden();
      runHideLogic();
      enforceHomeHiddenForNonSuper();
      requestAnimationFrame(() => {
        markLinksAsHidden();
        runHideLogic();
        enforceHomeHiddenForNonSuper();
      });
    });
  }
  
  // Also run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      markLinksAsHidden();
      runImmediate();
      enforceHomeHiddenForNonSuper();
    });
  } else {
    markLinksAsHidden();
    runImmediate();
    enforceHomeHiddenForNonSuper();
  }
  
  // Run when window loads (after all resources)
  window.addEventListener('load', () => {
    markLinksAsHidden();
    redirectIfNeeded(); // Check if redirect needed on page load
    setTimeout(() => { markLinksAsHidden(); runHideLogic(); enforceHomeHiddenForNonSuper(); redirectIfNeeded(); }, 10);
    setTimeout(() => { markLinksAsHidden(); runHideLogic(); enforceHomeHiddenForNonSuper(); redirectIfNeeded(); }, 50);
    setTimeout(() => { markLinksAsHidden(); runHideLogic(); enforceHomeHiddenForNonSuper(); redirectIfNeeded(); }, 100);
    setTimeout(() => { markLinksAsHidden(); runHideLogic(); enforceHomeHiddenForNonSuper(); redirectIfNeeded(); }, 200);
    setTimeout(() => { markLinksAsHidden(); runHideLogic(); enforceHomeHiddenForNonSuper(); redirectIfNeeded(); }, 500);
  });
  
  // Also run immediately when script loads (if DOM already ready)
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    markLinksAsHidden();
    redirectIfNeeded(); // Check if redirect needed immediately
    runImmediate();
    enforceHomeHiddenForNonSuper();
  }
  
  // Also check redirect on popstate (browser back/forward)
  window.addEventListener('popstate', () => {
    setTimeout(redirectIfNeeded, 100);
  });
  
  // Check redirect periodically (in case roles are detected late)
  setInterval(() => {
    redirectIfNeeded();
    enforceHomeHiddenForNonSuper();
  }, 500);
  
  // Run markLinksAsHidden on interval to catch new links
  // CRITICAL: Always run for Super Admin to ensure links stay visible
  setInterval(() => {
    markLinksAsHidden();
  }, 500); // Run every 500ms to catch new links
  
  // Clear cache on page visibility change (user might have logged in another tab)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Page became visible - clear cache to refresh roles
      cachedRoles = null;
      roleFlagsCache = null;
      lastToken = null;
      lastUserId = null;
      runHideLogic();
    }
  });
  
  // Clear cache on storage event (sessionStorage changes from other tabs)
  window.addEventListener('storage', (e) => {
    if (e.key === '__modules_sidebar_roles__' || e.key === null) {
      cachedRoles = null;
      roleFlagsCache = null;
      runHideLogic();
    }
  });
  
  // Run on interval - more frequent initially to catch role detection
  // After initial period, reduce frequency
  let intervalCount = 0;
  const intervalId = setInterval(() => {
    runHideLogic();
    intervalCount++;
    // After 20 runs (10 seconds at 500ms), reduce to less frequent checks
    if (intervalCount > 20) {
      clearInterval(intervalId);
      // Continue with less frequent checks
      setInterval(runHideLogic, 2000);
    }
  }, 500);
  
  // Run on navigation
  window.addEventListener('popstate', () => {
    setTimeout(runHideLogic, 100);
  });
  
  // Also run on hashchange
  window.addEventListener('hashchange', () => {
    setTimeout(runHideLogic, 100);
  });
  
  // Run when route changes (for SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Clear cache on route change to catch role updates (especially login/logout)
      if (currentUrl.includes('/auth/login') || currentUrl.includes('/logout')) {
        // User is logging in/out - reset sidebar state so next user never sees previous role
        if (document.body) {
          document.body.setAttribute('data-hide-cm-sidebar', 'pending');
          document.body.dataset.hideCmSidebar = 'pending';
        }
        cachedRoles = null;
        roleFlagsCache = null;
        rolesFetchPromise = null;
        isInitialLoad = true;
        lastToken = null;
        lastUserId = null;
        cachedIsSuperAdmin = null;
        lastSuperAdminCheck = 0;
        delete window.__MODULES_SIDEBAR_ROLES__;
        try {
          sessionStorage.removeItem('__modules_sidebar_roles__');
          sessionStorage.removeItem('__is_super_admin__');
        } catch (e) {
          // Ignore
        }
      } else if (currentUrl.includes('/admin') && !lastUrl.includes('/admin')) {
        // User just navigated to admin (likely after login) - force fresh fetch
        cachedRoles = null;
        roleFlagsCache = null;
        rolesFetchPromise = null;
        isInitialLoad = true;
        cachedIsSuperAdmin = null;
        lastSuperAdminCheck = 0;
        delete window.__MODULES_SIDEBAR_ROLES__;
        try {
          sessionStorage.removeItem('__modules_sidebar_roles__');
        } catch (e) {
          // Ignore
        }
      }
      
      // Check if redirect is needed
      setTimeout(() => {
        redirectIfNeeded();
        runHideLogic();
        enforceHomeHiddenForNonSuper();
      }, 100);
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Also watch for new links being added to the DOM and hide them immediately if needed
  // This ensures links are hidden as soon as they appear, even before roles are fully detected
  const linkObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if it's a link or contains links
          if (node.tagName === 'A' || node.querySelector('a')) {
            shouldCheck = true;
          }
          // Also check if mobile menu was opened (popover, dropdown, etc.)
          if (node.getAttribute && (
            node.getAttribute('role') === 'menu' ||
            node.getAttribute('role') === 'menuitem' ||
            node.classList?.toString().includes('Popover') ||
            node.classList?.toString().includes('Dropdown') ||
            node.classList?.toString().includes('Menu')
          )) {
            shouldCheck = true;
          }
        }
      });
    });
    if (shouldCheck) {
      // Run hiding logic immediately when new links are added or menu opens
      setTimeout(runHideLogic, 10);
      setTimeout(runHideLogic, 50); // Run again after a short delay to catch menu items
    }
  });
  
  // Start observing the document for new links and menu changes
  if (document.body) {
    linkObserver.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: true, // Watch for attribute changes (like menu opening)
      attributeFilter: ['role', 'class', 'aria-expanded', 'aria-hidden']
    });
  }
  
  // Also watch for clicks on hamburger menu button to re-run hiding logic
  document.addEventListener('click', (e) => {
    const target = e.target;
    // Check if hamburger menu button was clicked
    if (target && (
      target.getAttribute('aria-label')?.toLowerCase().includes('menu') ||
      target.closest('button[aria-label*="menu"]') ||
      target.closest('button[aria-label*="Menu"]') ||
      target.classList?.toString().includes('Menu') ||
      target.classList?.toString().includes('Hamburger')
    )) {
      // Menu button clicked - run hiding logic after menu opens
      setTimeout(runHideLogic, 100);
      setTimeout(runHideLogic, 300);
      setTimeout(runHideLogic, 500);
    }
  }, true); // Use capture phase to catch early
  } catch (error) {
    // Silently fail - don't break the admin panel if our code has an error
    if (process.env.NODE_ENV === 'development') {
      console.error('[modules-sidebar] Error in global script:', error);
    }
  }
}

export default {
  register(app) {
    // Register the plugin (required for Strapi admin to recognize it)
    app.registerPlugin({
      id: PLUGIN_ID,
      name,
    });

    /**
     * Add "All Modules" to the left sidebar.
     *
     * permissions:
     * - This ties visibility to our custom admin permission action:
     *   `plugin::modules-sidebar.read`
     * - Grant this permission to HR Admin / LM Admin / Manager roles.
     * - Super Admin can also have it, but typically they'll use Content Manager directly.
     */
    app.addMenuLink({
      // IMPORTANT: Strapi expects a relative path like `plugins/<pluginId>` (no leading slash)
      // See @strapi/plugin-cloud implementation in node_modules.
      to: `plugins/${PLUGIN_ID}/all-modules`,
      icon: PuzzlePiece,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.all-modules`,
        defaultMessage: 'All Modules',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      /**
       * IMPORTANT: Strapi v5 requires `Component` to return:
       *   Promise<{ default: React.ComponentType }>
       * Returning the component directly will crash the Admin UI (blank screen).
       */
      // Import the JSX page entry (Vite needs .jsx for JSX parsing)
      Component: () => import('./pages/AllModules/index.jsx'),
    });

    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}/notifications`,
      icon: BellWithBadge,
      intlLabel: {
        id: `${PLUGIN_ID}.menu.my-notifications`,
        defaultMessage: 'My Notifications',
      },
      permissions: [
        {
          action: `plugin::${PLUGIN_ID}.read`,
          subject: null,
        },
      ],
      Component: () => import('./pages/AdminNotificationsPage.jsx'),
    });

    // No need to manually add routes here: `addMenuLink` already mounts the route via `Component`.
    // Adding routes incorrectly can also break the Admin router.

    /**
     * Override the "+" button in media fields to open file picker instead of Media Library
     * This intercepts clicks on the plus/add button and opens native file browser
     * SIMPLIFIED VERSION - Only runs when needed, less aggressive
     */
    if (typeof window !== 'undefined') {
      try {
        console.log('[Direct Upload] Initializing simplified direct upload override...');
        
        // Simple function to process a single button
        const processMediaButton = (button) => {
          try {
            // Skip if already processed
            if (button.hasAttribute('data-direct-upload-override')) {
              return;
            }
            
            // Check if button is in a media field
            const mediaField = button.closest('[class*="RelationsInput"]');
            if (!mediaField) return;
            
            // Check if it's an add button (has plus icon or add text)
            const hasPlusIcon = button.querySelector('svg path[d*="M8"], svg path[d*="M 8"]') !== null;
            const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
            const isAddButton = hasPlusIcon || ariaLabel.includes('add') || ariaLabel.includes('select');
            const isRemoveButton = ariaLabel.includes('remove') || ariaLabel.includes('delete');
            
            if (!isAddButton || isRemoveButton) return;
            
            // Mark as processed
            button.setAttribute('data-direct-upload-override', 'true');
            
            // Create file input
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*,video/*,audio/*,application/*,text/*';
            fileInput.multiple = mediaField.querySelector('[multiple]') !== null;
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
            
            // Add click handler
            const clickHandler = (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              fileInput.click();
            };
            
            button.addEventListener('click', clickHandler, true);
            
            // Handle file upload
            fileInput.addEventListener('change', async (e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              
              try {
                const state = window.strapi?.store?.getState?.();
                const token = state?.admin_app?.token || localStorage.getItem('jwtToken');
                
                const uploadPromises = files.map(async (file) => {
                  const formData = new FormData();
                  formData.append('files', file);
                  const response = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData,
                  });
                  if (!response.ok) throw new Error(`Upload failed for ${file.name}`);
                  const data = await response.json();
                  return Array.isArray(data) ? data : [data];
                });
                
                const uploadedFiles = (await Promise.all(uploadPromises)).flat();
                
                if (uploadedFiles.length > 0) {
                  const hiddenInput = mediaField.querySelector('input[type="hidden"]');
                  if (hiddenInput) {
                    const isMultiple = fileInput.multiple;
                    if (isMultiple) {
                      const currentIds = JSON.parse(hiddenInput.value || '[]');
                      hiddenInput.value = JSON.stringify([...currentIds, ...uploadedFiles.map(f => f.id)]);
                    } else {
                      hiddenInput.value = uploadedFiles[0].id;
                    }
                    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  
                  // Trigger React update
                  setTimeout(() => {
                    window.dispatchEvent(new Event('resize'));
                  }, 100);
                }
              } catch (error) {
                console.error('[Direct Upload] Upload error:', error);
                alert('Upload failed: ' + error.message);
              } finally {
                fileInput.value = '';
              }
            });
          } catch (error) {
            console.error('[Direct Upload] Error processing button:', error);
          }
        };
        
        // Watch for new buttons being added to the DOM
        const observer = new MutationObserver((mutations) => {
          try {
            mutations.forEach((mutation) => {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                  // Check if it's a button or contains buttons
                  if (node.tagName === 'BUTTON') {
                    processMediaButton(node);
                  } else {
                    const buttons = node.querySelectorAll && node.querySelectorAll('button');
                    if (buttons) {
                      buttons.forEach(btn => processMediaButton(btn));
                    }
                  }
                }
              });
            });
          } catch (error) {
            console.error('[Direct Upload] Error in observer:', error);
          }
        });
        
        // Start observing when DOM is ready
        const startObserving = () => {
          try {
            if (document.body) {
              observer.observe(document.body, {
                childList: true,
                subtree: true,
              });
              
              // Process existing buttons
              document.querySelectorAll('button').forEach(btn => processMediaButton(btn));
            }
          } catch (error) {
            console.error('[Direct Upload] Error starting observer:', error);
          }
        };
        
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', startObserving);
        } else {
          startObserving();
        }
        
        // Also try to close media library modal if it opens
        const modalObserver = new MutationObserver((mutations) => {
          try {
            mutations.forEach((mutation) => {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.querySelector && 
                    (node.querySelector('[class*="AssetDialog"]') || 
                     node.querySelector('[role="dialog"][aria-modal="true"]'))) {
                  const closeBtn = node.querySelector('button[aria-label*="close" i]');
                  if (closeBtn) {
                    setTimeout(() => closeBtn.click(), 50);
                  }
                }
              });
            });
          } catch (error) {
            console.error('[Direct Upload] Error in modal observer:', error);
          }
        });
        
        if (document.body) {
          modalObserver.observe(document.body, {
            childList: true,
            subtree: true,
          });
        }
      } catch (error) {
        console.error('[Direct Upload] Error initializing direct upload override:', error);
        // Don't break the entire admin panel if this fails
      }
    }
  },
};
