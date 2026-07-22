import React, { useMemo, Children, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Typography, Flex, Button } from '@strapi/design-system';
import { 
  Briefcase,
  PinMap,
  User,
  Book,
  Question,
  Message,
  Cog
} from '@strapi/icons';
import { SectionConfigModal } from '../../components/SectionConfigModal';

/**
 * All Modules page
 *
 * This page provides the collapsible module UX matching Strapi's default UI styling.
 * Each item links to the real Content Manager routes.
 */

const AdminLink = ({ to, label }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  // Add query parameter to signal hiding the sidebar
  const linkTo = `${to}?fromModules=true`;
  
  return (
    <Box
      as={Link}
      to={linkTo}
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
      style={{
        textDecoration: 'none',
        display: 'block',
        borderRadius: '4px',
        transition: 'all 0.15s ease',
        marginBottom: '2px',
        backgroundColor: isActive ? 'var(--strapi-primary-100)' : 'transparent',
      }}
      onClick={() => {
        // Set a session flag so downstream pages know to hide the CM sidebar
        // BUT only for HR Admin and LM Admin, NOT for Super Admin
        try {
          // Check if user is Super Admin - check multiple sources
          let isSuperAdmin = false;
          
          // Check window roles (set by AllModules page)
          const windowRoles = window['__MODULES_SIDEBAR_ROLES__'] || [];
          isSuperAdmin = windowRoles.some(r => {
            const name = (r?.name || '').toLowerCase();
            return name === 'super admin' || name.includes('super admin');
          });
          
          // If not found, check Redux store
          if (!isSuperAdmin) {
            try {
              const state = window.strapi && window.strapi.store && typeof window.strapi.store.getState === 'function' ? window.strapi.store.getState() : {};
              const adminUser = state?.admin_app?.user;
              const reduxRoles = adminUser?.roles || [];
              isSuperAdmin = reduxRoles.some(r => {
                const name = (r?.name || '').toLowerCase();
                return name === 'super admin' || name.includes('super admin');
              });
            } catch (e) {
              // Ignore Redux errors
            }
          }
          
          if (!isSuperAdmin) {
            // HR Admin, LM Admin, or Admin - hide CM sidebar
            window.sessionStorage.setItem('hideCmSidebar', 'true');
          } else {
            // Super Admin should see the sidebar
            window.sessionStorage.removeItem('hideCmSidebar');
          }
        } catch (err) {
          // ignore storage errors
        }
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'var(--strapi-neutral-100)';
          const labelEl = e.currentTarget.querySelector('[data-role="module-link-label"]');
          if (labelEl) {
            if (labelEl && labelEl.style) labelEl.style.color = '#4945ff';
          }
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'transparent';
          const labelEl = e.currentTarget.querySelector('[data-role="module-link-label"]');
          if (labelEl) {
            if (labelEl && labelEl.style) labelEl.style.color = '#212134';
          }
        }
      }}
    >
      <Flex alignItems="center" gap={2}>
        <Box
          width="4px"
          height="4px"
          background={isActive ? 'primary600' : 'neutral400'}
          hasRadius
          style={{ flexShrink: 0 }}
        />
        <Typography 
          variant="omega" 
          textColor={isActive ? 'primary600' : 'neutral900'}
          fontWeight={isActive ? 'semiBold' : 'regular'}
          data-role="module-link-label"
          style={{ color: isActive ? '#4945ff' : '#212134' }}
        >
          {label}
        </Typography>
      </Flex>
    </Box>
  );
};

const Section = ({ title, children, icon: Icon }) => {
  const childrenArray = Children.toArray(children).filter(child => child !== null && child !== undefined);
  const itemCount = childrenArray.length;

  if (itemCount === 0) return null;

  // Evenly distribute: max 4 items per column, add columns as collection count increases
  const numColumns = Math.max(1, Math.ceil(itemCount / 4));
  const basePerCol = Math.floor(itemCount / numColumns);
  const remainder = itemCount % numColumns;

  const columns = [];
  let idx = 0;
  for (let c = 0; c < numColumns; c++) {
    const colSize = basePerCol + (c < remainder ? 1 : 0);
    columns.push(childrenArray.slice(idx, idx + colSize));
    idx += colSize;
  }

  return (
    <Box
      marginBottom={4}
      padding={6}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      style={{
        transition: 'all 0.2s ease',
        backgroundColor: '#ffffff',
        borderColor: '#e0e0e0',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Flex
        gap={3}
        alignItems="center"
        style={{
          padding: '0 0 16px 0',
          marginBottom: '8px',
        }}
      >
        {Icon && (
          <Box
            padding={2}
            background="primary100"
            hasRadius
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f0f0ff',
              borderRadius: '4px',
            }}
          >
            <Icon
              aria-hidden
              width="18px"
              height="18px"
              fill="#4945ff"
              style={{ color: '#4945ff' }}
            />
          </Box>
        )}
        <Typography
          variant="sigma"
          textColor="neutral800"
          fontWeight="semiBold"
          style={{ flex: 1, fontSize: '13px', color: '#32324d', letterSpacing: '0.01em' }}
        >
          {title}
        </Typography>
      </Flex>
      <Box
        paddingTop={2}
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${numColumns}, 1fr)`,
          gap: '0 16px',
        }}
      >
        {columns.map((col, i) => (
          <Box key={i}>{col}</Box>
        ))}
      </Box>
    </Box>
  );
};

// Custom hook to hide Content Manager sidebar when fromModules query param is present
const useHideContentManagerSidebar = () => {
  React.useEffect(() => {
    const hideSidebar = () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('fromModules') === 'true') {
        // Multiple selectors to catch the sidebar
        const selectors = [
          '[class*="LeftMenu"]',
          '[class*="sideNav"]',
          'nav[aria-label*="Content Manager"]',
          '[data-testid="content-manager-sidebar"]',
          // Strapi v5 specific: Layouts.Root's first child (sidebar)
          '[class*="Layouts-Root"] > nav:first-child',
          '[class*="Layouts-Root"] > aside:first-child',
        ];

        selectors.forEach((selector) => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            // Check if it's actually a sidebar (has links to content types)
            if (el.querySelector('a[href*="/content-manager/collection-types"]') || 
                el.querySelector('a[href*="/content-manager/single-types"]')) {
              if (el && el.style) el.style.display = 'none';
              // Also hide parent if it's a container
              const parent = el.parentElement;
              if (parent && parent.classList.toString().includes('Layouts-Root')) {
                // Expand the main content area
                const mainContent = Array.from(parent.children).find(
                  (child) => child !== el && !child.classList.toString().includes('DragLayer')
                );
                if (mainContent) {
                  if (mainContent && mainContent.style) {
                    mainContent.style.width = '100%';
                    mainContent.style.maxWidth = '100%';
                    mainContent.style.flex = '1 1 100%';
                  }
                }
              }
            }
          });
        });
      }
    };

    // Run immediately and on route changes
    hideSidebar();
    const interval = setInterval(hideSidebar, 300);
    
    // Also listen to navigation events
    const handlePopState = () => {
      setTimeout(hideSidebar, 100);
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      clearInterval(interval);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
};

const AllModulesPage = () => {
  // Use the hook to hide sidebar when navigating from All Modules
  useHideContentManagerSidebar();

  // State to store roles fetched from API
  const [apiRoles, setApiRoles] = useState([]);
  // State to store flattened admin permissions (from /admin/users/me/permissions)
  const [permissions, setPermissions] = useState([]);
  // Section config (Super Admin) and content types
  const [sectionConfig, setSectionConfig] = useState(null);
  const [collectionTypes, setCollectionTypes] = useState([]);
  const [showConfigModal, setShowConfigModal] = useState(false);
  // Loading state for permissions
  const [loadingPermissions, setLoadingPermissions] = useState(true);

  // Get token from Redux store
  const token = useSelector((state) => (state && state.admin_app && state.admin_app.token) ? state.admin_app.token : undefined);

  // Fetch current user from API as fallback
  useEffect(() => {
    if (!token) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AllModules] No token found, skipping API call');
      }
      return;
    }

    const fetchUserRoles = async () => {
      try {
        // Try Strapi admin API endpoint with roles populated
        const baseURL = (window.strapi && window.strapi.backendURL) || 'http://localhost:1337';
        const response = await fetch(`${baseURL}/admin/users/me?populate=roles`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
        });
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] API response status:', response.status, response.statusText);
        }
        
        if (response.ok) {
          const responseData = await response.json();
          if (process.env.NODE_ENV === 'development') {
            console.log('[AllModules] Fetched user from API:', responseData);
          }
          
          // Handle Strapi v5 API response structure: { data: { ... } }
          const userData = responseData?.data || responseData;
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[AllModules] Extracted userData:', userData);
            console.log('[AllModules] userData.roles:', userData?.roles);
          }
          
          if (userData?.roles) {
            const roles = Array.isArray(userData.roles) ? userData.roles : [userData.roles];
            setApiRoles(roles);
            
            // CRITICAL: Store roles IMMEDIATELY in window and sessionStorage
            // This allows the global script to access them right away
            try {
              window['__MODULES_SIDEBAR_ROLES__'] = roles;
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
              // Trigger a custom event to notify global script immediately
              window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: roles }));
            } catch (e) {
              // Ignore storage errors
            }
            
            if (process.env.NODE_ENV === 'development') {
              console.log('[AllModules] Set API roles:', roles);
            }
          } else if (userData?.role) {
            // Handle single role
            const roles = [userData.role];
            setApiRoles(roles);
            
            // CRITICAL: Store roles IMMEDIATELY in window and sessionStorage
            try {
              window['__MODULES_SIDEBAR_ROLES__'] = roles;
              sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
              // Trigger a custom event to notify global script immediately
              window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: roles }));
            } catch (e) {
              // Ignore storage errors
            }
            
            if (process.env.NODE_ENV === 'development') {
              console.log('[AllModules] Set API role (single):', userData.role);
            }
          }
        } else {
          const errorText = await response.text();
          if (process.env.NODE_ENV === 'development') {
            console.log('[AllModules] API error response:', errorText);
          }
          // Try alternative endpoint with populate
          const altResponse = await fetch(`${baseURL}/admin/users/me?populate=*`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            credentials: 'include',
          });
          if (altResponse.ok) {
            const responseData = await altResponse.json();
            if (process.env.NODE_ENV === 'development') {
              console.log('[AllModules] Fetched user from alternative API:', responseData);
            }
            // Handle Strapi v5 API response structure
            const userData = responseData?.data || responseData;
            if (userData?.roles) {
              const roles = Array.isArray(userData.roles) ? userData.roles : [userData.roles];
              setApiRoles(roles);
              
              // CRITICAL: Store roles IMMEDIATELY
              try {
                window['__MODULES_SIDEBAR_ROLES__'] = roles;
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
                window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: roles }));
              } catch (e) {
                // Ignore storage errors
              }
            } else if (userData?.role) {
              const roles = [userData.role];
              setApiRoles(roles);
              
              // CRITICAL: Store roles IMMEDIATELY
              try {
                window['__MODULES_SIDEBAR_ROLES__'] = roles;
                sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
                window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: roles }));
              } catch (e) {
                // Ignore storage errors
              }
            }
          }
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] Failed to fetch user from API:', error);
        }
      }
    };
    fetchUserRoles();
  }, [token]);

  // Strapi admin stores user info - try multiple paths
  // Memoize the selector to avoid creating a new function on every render
  const selectRoles = useMemo(() => (state) => {
    // Try multiple paths to find user roles
    const adminUser = state?.admin_app?.user;
    const authUser = state?.auth?.user || state?.auth?.userInfo;
    const adminApi = state?.adminApi;
    
    // Try to get roles from various locations
    let foundRoles = 
      adminUser?.roles ||
      authUser?.roles ||
      adminUser?.userInfo?.roles ||
      authUser?.userInfo?.roles ||
      state?.admin_app?.userInfo?.roles ||
      state?.auth?.userInfo?.roles ||
      // Check adminApi
      adminApi?.user?.roles ||
      adminApi?.userInfo?.roles ||
      // Try single role property
      (adminUser?.role ? [adminUser.role] : null) ||
      (authUser?.role ? [authUser.role] : null) ||
      (adminApi?.user?.role ? [adminApi.user.role] : null) ||
      // Try window.strapi
      (window.strapi && window.strapi.user && window.strapi.user.roles) ||
      (window.strapi && window.strapi.currentUser && window.strapi.currentUser.roles) ||
      (window.strapi && window.strapi.admin && window.strapi.admin.user && window.strapi.admin.user.roles) ||
      (window.strapi && window.strapi.user && window.strapi.user.role ? [window.strapi.user.role] : null) ||
      (window.strapi && window.strapi.currentUser && window.strapi.currentUser.role ? [window.strapi.currentUser.role] : null) ||
      [];
    
    // If roles is an array of role objects, return as is
    // If it's a single role object, wrap it in an array
    if (foundRoles && !Array.isArray(foundRoles)) {
      foundRoles = [foundRoles];
    }
    
    // Debug: log the entire state structure to find where roles are stored
    if (process.env.NODE_ENV === 'development' && (!foundRoles || foundRoles.length === 0)) {
      console.log('[AllModules] admin_app:', state?.admin_app);
      console.log('[AllModules] admin_app.permissions:', state?.admin_app?.permissions);
      console.log('[AllModules] adminApi:', adminApi);
      // Check if permissions object has role info
      const permissions = state?.admin_app?.permissions;
      if (permissions && typeof permissions === 'object') {
        console.log('[AllModules] permissions keys:', Object.keys(permissions));
        // Try to find role info in permissions
        Object.keys(permissions).forEach(key => {
          if (key.toLowerCase().includes('role') || key.toLowerCase().includes('user')) {
            console.log(`[AllModules] Found ${key}:`, permissions[key]);
          }
        });
      }
      console.log('[AllModules] Found roles from Redux:', foundRoles);
      console.log('[AllModules] adminUser:', adminUser);
      console.log('[AllModules] authUser:', authUser);
      console.log('[AllModules] adminApi.user:', adminApi?.user);
    }
    
    return foundRoles || [];
  }, []);
  
  const reduxRoles = useSelector(selectRoles);

  // Combine Redux roles and API roles (API takes precedence if Redux is empty)
  const roles = useMemo(() => {
    if (reduxRoles && reduxRoles.length > 0) {
      return reduxRoles;
    }
    if (apiRoles && apiRoles.length > 0) {
      return apiRoles;
    }
    return [];
  }, [reduxRoles, apiRoles]);

  // Store roles in window and sessionStorage IMMEDIATELY when fetched
  // This allows the global script to access roles as early as possible
  useEffect(() => {
    // Store Redux roles immediately if available
    if (reduxRoles && reduxRoles.length > 0) {
      try {
        window['__MODULES_SIDEBAR_ROLES__'] = reduxRoles;
        sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(reduxRoles));
        // Trigger a custom event to notify global script
        window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: reduxRoles }));
      } catch (e) {
        // Ignore storage errors
      }
    }
    
    // Store API roles when they arrive (they take precedence)
    if (apiRoles && apiRoles.length > 0) {
      try {
        window['__MODULES_SIDEBAR_ROLES__'] = apiRoles;
        sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(apiRoles));
        // Trigger a custom event to notify global script
        window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: apiRoles }));
      } catch (e) {
        // Ignore storage errors
      }
    }
    
    // Store combined roles
    if (roles && roles.length > 0) {
      try {
        window['__MODULES_SIDEBAR_ROLES__'] = roles;
        sessionStorage.setItem('__modules_sidebar_roles__', JSON.stringify(roles));
        // Trigger a custom event to notify global script
        window.dispatchEvent(new CustomEvent('modules-sidebar-roles-updated', { detail: roles }));
      } catch (e) {
        // Ignore storage errors
      }
    }
  }, [roles, reduxRoles, apiRoles]);

  const roleFlags = useMemo(() => {
    // Helper to check exact match first, then contains
    const hasCodeOrName = (needle) =>
      roles.some(
        (r) =>
          r?.code?.toLowerCase() === needle.toLowerCase() ||
          r?.name?.toLowerCase() === needle.toLowerCase()
      );
    const contains = (needle) =>
      roles.some(
        (r) =>
          r?.code?.toLowerCase().includes(needle.toLowerCase()) ||
          r?.name?.toLowerCase().includes(needle.toLowerCase())
      );
    
    // Match exact role names: "Super Admin", "HR Admin", "LM Admin", "Admin"
    // Priority: exact match first, then contains
    const isSuperAdmin =
      hasCodeOrName('super admin') ||
      hasCodeOrName('strapi-super-admin') ||
      contains('super admin') ||
      contains('super-admin');
    
    // For HR Admin: check for exact "hr admin" first, then just "hr"
    const isHR = 
      hasCodeOrName('hr admin') ||
      contains('hr admin') ||
      (hasCodeOrName('hr') && !contains('lm') && !contains('admin')); // Only match "hr" if it doesn't contain "lm" or "admin"
    
    // For LM Admin: check for exact "lm admin" first, then just "lm"
    const isLM = 
      hasCodeOrName('lm admin') ||
      contains('lm admin') ||
      (hasCodeOrName('lm') && !contains('hr') && !contains('admin')) || // Only match "lm" if it doesn't contain "hr" or "admin"
      (contains('lm') && !contains('hr') && !contains('hr admin') && !contains('admin')); // Only match "lm" if it doesn't contain "hr" or "admin"
    
    // For Admin: check for exact "admin" but not "super admin", "hr admin", or "lm admin"
    const isAdmin = 
      (hasCodeOrName('admin') || contains('admin')) && 
      !contains('super') && 
      !contains('hr') && 
      !contains('lm');
    
    // Debug logging (remove in production if needed)
    if (process.env.NODE_ENV === 'development') {
      console.log('[AllModules] Roles detected:', roles);
      console.log('[AllModules] Role flags:', { isSuperAdmin, isHR, isLM, isAdmin });
    }
    
    return { isSuperAdmin, isHR, isLM, isAdmin };
  }, [roles]);

  // If roles are empty (could not be read), be permissive: user already passed plugin permission to reach here.
  const rolesKnown = Array.isArray(roles) && roles.length > 0;
  const effectiveFlags = rolesKnown
    ? roleFlags
    : {
        // When roles are unknown, allow everything (user already has plugin permission)
        isSuperAdmin: true,
        isHR: true,
        isLM: true,
        isAdmin: true,
      };
  
  // Ensure only one role is active at a time (Super Admin takes precedence)
  const finalFlags = effectiveFlags.isSuperAdmin
    ? { isSuperAdmin: true, isHR: false, isLM: false, isAdmin: false }
    : { isSuperAdmin: false, isHR: effectiveFlags.isHR, isLM: effectiveFlags.isLM, isAdmin: effectiveFlags.isAdmin };

  const { isSuperAdmin, isHR, isLM, isAdmin } = finalFlags;

  // Fetch admin permissions for the current user and normalize them into { action, subject }[]
  useEffect(() => {
    if (!token) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[AllModules] No token found, skipping permissions fetch');
      }
      setLoadingPermissions(false);
      return;
    }

    const fetchPermissions = async () => {
      try {
        const baseURL = (window.strapi && window.strapi.backendURL) || 'http://localhost:1337';
        const response = await fetch(`${baseURL}/admin/users/me/permissions`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        if (!response.ok) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[AllModules] Permissions API error:', response.status, response.statusText);
          }
          setLoadingPermissions(false);
          return;
        }

        const data = await response.json();

        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] Raw permissions from API:', data);
        }

        const flat = [];

        const flatten = (node) => {
          if (!node) return;
          if (Array.isArray(node)) {
            node.forEach(flatten);
            return;
          }
          if (typeof node === 'object') {
            if (typeof node.action === 'string') {
              flat.push(node);
            }
            Object.values(node).forEach(flatten);
          }
        };

        flatten(data);

        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] Flattened permissions:', flat);
        }

        setPermissions(flat);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] Failed to fetch permissions:', error);
        }
      } finally {
        setLoadingPermissions(false);
      }
    };

    fetchPermissions();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const baseURL = (window.strapi && window.strapi.backendURL) || 'http://localhost:1337';
    const fetchConfig = async () => {
      try {
        const [configRes, ctRes] = await Promise.all([
          fetch(`${baseURL}/modules-sidebar/section-config`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${baseURL}/modules-sidebar/content-types`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (configRes.ok) {
          const cfg = await configRes.json();
          setSectionConfig(cfg);
        }
        if (ctRes.ok) {
          const { collectionTypes: cts } = await ctRes.json();
          setCollectionTypes(cts || []);
        }
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[AllModules] Failed to fetch section config/content-types:', e);
        }
      }
    };
    fetchConfig();
  }, [token]);

  // Helper that answers: can the current admin user READ a given content-type UID?
  // This is driven purely by admin permissions (Administration -> Roles & Permissions).
  const canSee = React.useCallback(
    (subjectUid) => {
      if (!subjectUid) return false;

      // Super Admin: always allowed
      if (isSuperAdmin) return true;

      if (!Array.isArray(permissions) || permissions.length === 0) {
        return false;
      }

      const hasPermission = permissions.some((perm) => {
        const action = perm?.action || '';
        const subject = perm?.subject ?? null;

        // Typical content manager "read" actions
        const isCmRead =
          action === 'plugin::content-manager.explorer.read' ||
          action === 'plugin::content-manager.collection-types.read' ||
          action === 'plugin::content-manager.single-types.read' ||
          action === 'plugin::content-manager.collection-types.explorer.read';

        // Global CM read (subject === null) means user can read all content types
        if (isCmRead && subject == null) {
          return true;
        }

        return isCmRead && subject === subjectUid;
      });

      return hasPermission;
    },
    [permissions, isSuperAdmin]
  );

  // If user has at least one "content-manager read" permission or is Super Admin, show the page.
  const canSeeAllModules =
    isSuperAdmin ||
    permissions.some((perm) => {
      const action = perm?.action || '';
      return (
        action === 'plugin::content-manager.explorer.read' ||
        action === 'plugin::content-manager.collection-types.read' ||
        action === 'plugin::content-manager.single-types.read' ||
        action === 'plugin::content-manager.collection-types.explorer.read'
      );
    });

  const iconMap = { Briefcase, PinMap, User, Message, Book, Question, Cog };
  const HIDDEN_COLLECTION_UIDS = new Set([
    'api::city.city',
    'api::townhall.townhall',
    'api::profile-edit-request.profile-edit-request',
  ]);
  const effectiveSections = useMemo(() => {
    if (!sectionConfig?.sections?.length) return null;
    const assigned = new Set();
    sectionConfig.sections.forEach((s) =>
      (s.collectionUids || []).forEach((u) => {
        if (!HIDDEN_COLLECTION_UIDS.has(u)) assigned.add(u);
      })
    );
    const unassigned = (collectionTypes || []).filter(
      (ct) => !assigned.has(ct.uid) && !HIDDEN_COLLECTION_UIDS.has(ct.uid)
    );
    let sections = [...sectionConfig.sections];
    if (!sections.some((s) => s.id === 'other')) {
      sections = [...sections, { id: 'other', title: 'Other', icon: 'Cog', collectionUids: [] }];
    }
    const otherSectionId = 'other';
    return sections.map((s) => ({
      ...s,
      collectionUids: [
        ...(s.collectionUids || []).filter((u) => !HIDDEN_COLLECTION_UIDS.has(u)),
        ...(s.id === otherSectionId ? unassigned.map((ct) => ct.uid) : []),
      ],
    }));
  }, [sectionConfig, collectionTypes]);

  return (
    <>
      <Page.Title>All Modules</Page.Title>
      <Page.Main>
        <Layouts.Header
          title="All Modules"
          subtitle="Access your content through organized modules"
          as="h2"
        />
        <Layouts.Content>
          {isSuperAdmin && (
            <Flex justifyContent="flex-end" marginBottom={4} paddingLeft={8} paddingRight={8}>
              <Button variant="secondary" size="S" startIcon={<Cog />} onClick={() => setShowConfigModal(true)}>
                Configure Sections
              </Button>
            </Flex>
          )}
          {loadingPermissions ? (
            <Box paddingLeft={6} paddingRight={6} paddingTop={6} paddingBottom={6} display="flex" justifyContent="center" alignItems="center">
              <Typography variant="omega" textColor="neutral600">
                Loading permissions...
              </Typography>
            </Box>
          ) : canSeeAllModules ? (
            <Box
              paddingLeft={8}
              paddingRight={8}
              paddingTop={6}
              paddingBottom={8}
              style={{
                width: '100%',
                maxWidth: '1400px',
                margin: '0 auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '20px',
                alignItems: 'stretch',
              }}
            >
              {effectiveSections?.length > 0 ? (
                effectiveSections.map((section) => {
                  const Icon = iconMap[section.icon] || User;
                  const visibleCollections = (section.collectionUids || []).filter((uid) => canSee(uid));
                  if (visibleCollections.length === 0) return null;
                  return (
                    <Section key={section.id} title={section.title} icon={Icon}>
                      {visibleCollections.map((uid) => {
                        const ct = collectionTypes.find((c) => c.uid === uid);
                        const label = ct?.displayName || (uid === 'plugin::users-permissions.user' ? 'User' : uid.split('.').pop() || uid);
                        return (
                          <AdminLink
                            key={uid}
                            label={label}
                            to={`/content-manager/collection-types/${uid}`}
                          />
                        );
                      })}
                    </Section>
                  );
                })
              ) : (
                <>
              {/* 1. Organization - driven by admin permissions */}
              {(canSee('api::company.company') ||
                canSee('api::company-policy.company-policy') ||
                canSee('api::department.department') ||
                canSee('api::designation.designation')) && (
                <Section title="Organization" icon={Briefcase}>
                  {canSee('api::company.company') && (
                    <AdminLink
                      label="Company"
                      to="/content-manager/collection-types/api::company.company"
                    />
                  )}
                  {canSee('api::company-policy.company-policy') && (
                    <AdminLink
                      label="Company Policies"
                      to="/content-manager/collection-types/api::company-policy.company-policy"
                    />
                  )}
                  {canSee('api::department.department') && (
                    <AdminLink
                      label="Department"
                      to="/content-manager/collection-types/api::department.department"
                    />
                  )}
                  {canSee('api::designation.designation') && (
                    <AdminLink
                      label="Designation"
                      to="/content-manager/collection-types/api::designation.designation"
                    />
                  )}
                </Section>
              )}

              {/* 2. HR Management - driven by admin permissions */}
              {(canSee('plugin::users-permissions.user') ||
                canSee('api::activity-log.activity-log') ||
                canSee('api::holiday.holiday') ||
                canSee('api::gallery-item.gallery-item') ||
                canSee('api::form-template.form-template')) && (
                <Section title="HR Management" icon={User}>
                  {canSee('plugin::users-permissions.user') && (
                    <AdminLink label="User" to="/content-manager/collection-types/plugin::users-permissions.user" />
                  )}
                  {canSee('api::activity-log.activity-log') && (
                    <AdminLink
                      label="Activity Log"
                      to="/content-manager/collection-types/api::activity-log.activity-log"
                    />
                  )}
                  {canSee('api::holiday.holiday') && (
                    <AdminLink
                      label="Holidays"
                      to="/content-manager/collection-types/api::holiday.holiday"
                    />
                  )}
                  {canSee('api::gallery-item.gallery-item') && (
                    <AdminLink
                      label="Gallery Items"
                      to="/content-manager/collection-types/api::gallery-item.gallery-item"
                    />
                  )}
                  {canSee('api::form-template.form-template') && (
                    <AdminLink
                      label="Form Templates"
                      to="/content-manager/collection-types/api::form-template.form-template"
                    />
                  )}
                </Section>
              )}

              {/* 3. Location Management - driven by admin permissions */}
              {(canSee('api::area.area') ||
                canSee('api::unit-location.unit-location') ||
                canSee('api::route.route')) && (
                <Section title="Location Management" icon={PinMap}>
                  {canSee('api::area.area') && (
                    <AdminLink label="Area" to="/content-manager/collection-types/api::area.area" />
                  )}
                  {canSee('api::unit-location.unit-location') && (
                    <AdminLink
                      label="Unit Locations"
                      to="/content-manager/collection-types/api::unit-location.unit-location"
                    />
                  )}
                  {canSee('api::route.route') && (
                    <AdminLink label="Routes" to="/content-manager/collection-types/api::route.route" />
                  )}
                </Section>
              )}

              {/* 4. Content & Communication - driven by admin permissions */}
              {(canSee('api::notification.notification') ||
                canSee('api::news.news') ||
                canSee('api::news-category.news-category') ||
                canSee('api::event.event') ||
                canSee('api::important-link.important-link')) && (
                <Section title="Content & Communication" icon={Message}>
                  {canSee('api::notification.notification') && (
                    <AdminLink
                      label="Notifications"
                      to="/content-manager/collection-types/api::notification.notification"
                    />
                  )}
                  {canSee('api::news.news') && (
                    <AdminLink label="News" to="/content-manager/collection-types/api::news.news" />
                  )}
                  {canSee('api::news-category.news-category') && (
                    <AdminLink
                      label="News Categories"
                      to="/content-manager/collection-types/api::news-category.news-category"
                    />
                  )}
                  {canSee('api::event.event') && (
                    <AdminLink label="Events" to="/content-manager/collection-types/api::event.event" />
                  )}
                  {canSee('api::important-link.important-link') && (
                    <AdminLink
                      label="Important Links"
                      to="/content-manager/collection-types/api::important-link.important-link"
                    />
                  )}
                </Section>
              )}

              {/* 5. Learning Management - driven by admin permissions */}
              {(canSee('api::course.course') ||
                canSee('api::course-category.course-category') ||
                canSee('api::course-assignment.course-assignment')) && (
                <Section title="Learning Management" icon={Book}>
                  {canSee('api::course.course') && (
                    <AdminLink
                      label="Courses"
                      to="/content-manager/collection-types/api::course.course"
                    />
                  )}
                  {canSee('api::course-category.course-category') && (
                    <AdminLink
                      label="Course Categories"
                      to="/content-manager/collection-types/api::course-category.course-category"
                    />
                  )}
                  {canSee('api::course-assignment.course-assignment') && (
                    <AdminLink
                      label="Course Assignments"
                      to="/content-manager/collection-types/api::course-assignment.course-assignment"
                    />
                  )}
                </Section>
              )}

              {/* 6. Quiz Management - driven by admin permissions */}
              {(canSee('api::quizze.quizze') ||
                canSee('api::quiz-submission.quiz-submission') ||
                canSee('api::user-progress.user-progress') ||
                canSee('api::quiz-reattempt-request.quiz-reattempt-request')) && (
                <Section title="Quiz Management" icon={Question}>
                  {/* NOTE: Real UID is api::quizze.quizze; keeping label as "Quizzes" */}
                  {canSee('api::quizze.quizze') && (
                    <AdminLink
                      label="Quizzes"
                      to="/content-manager/collection-types/api::quizze.quizze"
                    />
                  )}
                  {canSee('api::quiz-submission.quiz-submission') && (
                    <AdminLink
                      label="Quiz Submissions"
                      to="/content-manager/collection-types/api::quiz-submission.quiz-submission"
                    />
                  )}
                  {canSee('api::user-progress.user-progress') && (
                    <AdminLink
                      label="User Progress"
                      to="/content-manager/collection-types/api::user-progress.user-progress"
                    />
                  )}
                  {canSee('api::quiz-reattempt-request.quiz-reattempt-request') && (
                    <AdminLink
                      label="Quiz Reattempt Requests"
                      to="/plugins/quiz-reattempt-requests"
                    />
                  )}
                </Section>
              )}
                </>
              )}
            </Box>
          ) : (
            <Box paddingLeft={6} paddingRight={6} paddingTop={6} paddingBottom={6}>
              <Typography variant="omega" textColor="danger600">
                You do not have access to All Modules.
              </Typography>
            </Box>
          )}
        </Layouts.Content>
      </Page.Main>
      {showConfigModal && (
        <SectionConfigModal
          onClose={() => setShowConfigModal(false)}
          onSave={(cfg) => {
            setSectionConfig(cfg);
            setShowConfigModal(false);
          }}
          initialConfig={sectionConfig}
          collectionTypes={collectionTypes}
        />
      )}
    </>
  );
};

export default AllModulesPage;

