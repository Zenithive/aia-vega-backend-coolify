
// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';

/** @param {any} value */
function isOffline(value) {
  return String(value || '').trim().toLowerCase() === 'offline';
}

function getUsersCountFromDom() {
  const nodes = document.querySelectorAll('span, p, label, strong, h1, h2, h3, h4, h5, h6, div');
  for (const el of nodes) {
    if (el.childElementCount > 0) continue;
    const txt = (el.textContent || '').trim();
    const m = txt.match(/^users_permissions_users\s*\((\d+)\)$/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** @param {any} raw */
function getRelationCount(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const candidates = [
    raw.count,
    raw.total,
    raw.meta?.count,
    raw.meta?.pagination?.total,
    raw.pagination?.total,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** @param {any} raw */
function isCountOnlyRelationState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;

  const relationKeys = ['set', 'data', 'results', 'connect', 'disconnect'];
  if (relationKeys.some((key) => Array.isArray(raw[key]))) return false;

  return getRelationCount(raw) != null;
}

/**
 * @param {any} raw
 * @param {any[]} previousUsers
 */
function getSelectedUsersFromRelation(raw, previousUsers) {
  const prev = Array.isArray(previousUsers) ? previousUsers : [];

  if (raw == null) {
    return { users: [], resolved: true };
  }

  if (typeof raw === 'string' && raw.trim() === '') {
    return { users: [], resolved: true };
  }

  if (Array.isArray(raw)) {
    return { users: getUniqueSelectedUsers(raw), resolved: true };
  }

  if (raw && typeof raw === 'object') {
    if (Object.keys(raw).length === 0) {
      return { users: [], resolved: true };
    }

    /** @type {any[] | null} */
    let next = null;

    if (Array.isArray(raw.set)) {
      next = getUniqueSelectedUsers(raw.set);
    } else if (Array.isArray(raw.data)) {
      next = getUniqueSelectedUsers(raw.data);
    } else if (Array.isArray(raw.results)) {
      next = getUniqueSelectedUsers(raw.results);
    }

    const connectList = Array.isArray(raw.connect) ? raw.connect : [];
    const disconnectList = Array.isArray(raw.disconnect) ? raw.disconnect : [];
    const hasConnect = connectList.length > 0;
    const hasDisconnect = disconnectList.length > 0;
    const hasBaseList = Array.isArray(raw.set) || Array.isArray(raw.data) || Array.isArray(raw.results);

    // When connect exists without a base list, it represents the full selected state
    if ((hasConnect || hasDisconnect) && !hasBaseList) {
      return { users: getUniqueSelectedUsers(connectList), resolved: true };
    }

    if (hasConnect || hasDisconnect) {
      if (!next) next = [...prev];

      if (hasDisconnect) {
        const toRemove = disconnectList;
        const beforeLen = next.length;
        next = next.filter((existingUser) => !toRemove.some((u) => usersMatch(existingUser, u)));
        const removedByMatch = beforeLen - next.length;

        if (!hasBaseList && !hasConnect && removedByMatch < toRemove.length) {
          const deficit = toRemove.length - removedByMatch;
          next = next.slice(0, Math.max(0, next.length - deficit));
        }
      }

      if (hasConnect) {
        connectList.forEach((u) => {
          if (!next.some((existingUser) => usersMatch(existingUser, u))) {
            next.push(u);
          }
        });
      }

      return { users: getUniqueSelectedUsers(next), resolved: true };
    }

    if (next) {
      return { users: next, resolved: true };
    }

    const count = getRelationCount(raw);
    if (count != null) {
      if (count <= 0) return { users: [], resolved: true };
      if (count < prev.length) return { users: prev.slice(0, count), resolved: true };
    }

    const relationKeys = ['set', 'data', 'results', 'connect', 'disconnect'];
    if (relationKeys.some((k) => Object.prototype.hasOwnProperty.call(raw, k))) {
      return { users: [], resolved: true };
    }
  }

  return { users: prev, resolved: false };
}

function getUserDisplayName(user) {
  if (!user || typeof user !== 'object') return null;

  const candidates = [
    user.username,
    user.email,
    user.label,
    user.displayName,
    user.mainField,
    user.name,
    user.value?.label,
    user.attributes?.username,
    user.attributes?.email,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  const fallbackId = user.id ?? user.documentId ?? user.value;
  if (fallbackId != null && String(fallbackId).trim()) return `User #${String(fallbackId).trim()}`;

  return null;
}

/** @param {any} user */
function getUserIdentityTokens(user) {
  if (!user || typeof user !== 'object') return [];

  /** @type {string[]} */
  const tokens = [];
  /** @param {string} prefix @param {any} value */
  const add = (prefix, value) => {
    if (value == null) return;
    const s = String(value).trim();
    if (!s) return;
    tokens.push(`${prefix}:${s.toLowerCase()}`);
  };

  add('id', user.id);
  add('doc', user.documentId);
  add('id', user.value?.id);
  add('doc', user.value?.documentId);

  add('name', user.username);
  add('name', user.email);
  add('name', user.label);
  add('name', user.displayName);
  add('name', user.mainField);
  add('name', user.name);
  add('name', user.value?.label);
  add('name', user.attributes?.username);
  add('name', user.attributes?.email);

  return [...new Set(tokens)];
}

/** @param {any} a @param {any} b */
function usersMatch(a, b) {
  const left = getUserIdentityTokens(a);
  if (left.length === 0) return false;
  const right = new Set(getUserIdentityTokens(b));
  return left.some((t) => right.has(t));
}

/** @param {any[]} users */
function getUniqueSelectedUsers(users) {
  const list = Array.isArray(users) ? users : [];
  /** @type {any[]} */
  const out = [];

  for (const user of list) {
    if (!out.some((u) => usersMatch(u, user))) {
      out.push(user);
    }
  }

  return out;
}

/** @param {any} user @param {number} index */
function getUserKey(user, index) {
  if (!user || typeof user !== 'object') return `idx:${index}`;
  if (user.id != null) return `id:${String(user.id)}`;
  if (user.documentId) return `doc:${String(user.documentId)}`;

  if (user.value != null) {
    if (typeof user.value === 'object') {
      if (user.value.id != null) return `id:${String(user.value.id)}`;
      if (user.value.documentId) return `doc:${String(user.value.documentId)}`;
    }
    return `val:${String(user.value)}`;
  }

  return `idx:${index}`;
}

/** @param {string} prefix @param {number} i */
function tempKey(prefix, i) {
  return `${prefix}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {any[]} users @param {any[]} currentRows */
function buildOfflineModuleFromUsers(users, currentRows) {
  const existingRows = Array.isArray(currentRows) ? currentRows : [];

  const out = [];
  const processedUserKeys = new Set();

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userKey = getUserKey(user, i);

    if (processedUserKeys.has(userKey)) continue;
    processedUserKeys.add(userKey);

    const username = getUserDisplayName(user);

    let existing = null;
    for (const row of existingRows) {
      if (row?.username === username) {
        existing = row;
        break;
      }
    }

    const finalUsername = username || existing?.username || `User #${i + 1}`;

    if (existing) {
      out.push({ ...existing, username: finalUsername });
    } else {
      out.push({ username: finalUsername, __temp_key__: tempKey('wf-offline', i) });
    }
  }

  return out;
}

/** @param {any[]} a @param {any[]} b */
function sameUsernames(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (String(left[i]?.username || '') !== String(right[i]?.username || '')) return false;
  }
  return true;
}

/** @param {any} values */
function getWorkflowItemsFromValues(values) {
  if (Array.isArray(values?.modules)) return values.modules;
  if (Array.isArray(values?.workflow)) return values.workflow;
  return [];
}

/** @param {any} values @param {any[]} nextWorkflowItems */
function withUpdatedWorkflowItems(values, nextWorkflowItems) {
  if (Array.isArray(values?.modules)) {
    return {
      ...values,
      modules: nextWorkflowItems,
    };
  }

  return {
    ...values,
    workflow: nextWorkflowItems,
  };
}

/** @param {any[]} workflowItems @param {any[]} selectedUsers */
function syncWorkflowOfflineModules(workflowItems, selectedUsers) {
  let changed = false;

  const nextWorkflowItems = workflowItems.map((item) => {
    if (!isOffline(item?.module_type)) return item;

    const currentRows = Array.isArray(item?.offline_module) ? item.offline_module : [];
    const nextRows = buildOfflineModuleFromUsers(selectedUsers, currentRows);

    if (sameUsernames(currentRows, nextRows)) return item;

    changed = true;
    return {
      ...item,
      offline_module: nextRows,
    };
  });

  return { changed, nextWorkflowItems };
}

function hasOfflineModuleNeedingBackfill(workflowItems, selectedUsers) {
  if (!Array.isArray(workflowItems) || workflowItems.length === 0) return false;
  if (!Array.isArray(selectedUsers) || selectedUsers.length === 0) return false;

  for (const item of workflowItems) {
    if (!isOffline(item?.module_type)) continue;
    const rows = Array.isArray(item?.offline_module) ? item.offline_module : [];
    if (rows.length === 0) return true;
  }

  return false;
}

/** @param {any[]} workflowItems */
function hasExistingOfflineRows(workflowItems) {
  for (const item of workflowItems) {
    if (!isOffline(item?.module_type)) continue;
    if (Array.isArray(item?.offline_module) && item.offline_module.length > 0) {
      return true;
    }
  }
  return false;
}

/** @param {any} raw */
function isAmbiguousUsersState(raw) {
  if (raw == null) return true;
  if (isCountOnlyRelationState(raw)) return true;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;

  const relationKeys = ['set', 'data', 'results', 'connect', 'disconnect'];
  const hasRelationShape = relationKeys.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  if (hasRelationShape) return false;

  return true;
}

function isExplicitlyEmptyUsersSelection(raw, domCount) {
  if (typeof domCount === 'number') return domCount <= 0;

  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === 'string') return raw.trim() === '';

  if (!raw || typeof raw !== 'object') return false;

  if (Array.isArray(raw.set)) return raw.set.length === 0;
  if (Array.isArray(raw.data)) return raw.data.length === 0;
  if (Array.isArray(raw.results)) return raw.results.length === 0;

  const hasConnect = Array.isArray(raw.connect);
  const hasDisconnect = Array.isArray(raw.disconnect);

  if (hasConnect && hasDisconnect) {
    return raw.connect.length === 0;
  }

  if (hasConnect) return raw.connect.length === 0;

  if (hasDisconnect) {
    return raw.disconnect.length > 0;
  }

  const count = getRelationCount(raw);
  if (typeof count === 'number' && count === 0) return true;

  return false;
}

function getUsersSelectionSignature(raw, domCount) {
  const domPart = typeof domCount === 'number' ? `dom:${domCount}` : 'dom:null';

  if (raw == null) return `${domPart}|raw:null`;
  if (typeof raw === 'string') return `${domPart}|raw:str:${raw.trim()}`;

  if (Array.isArray(raw)) {
    const arr = raw.map((u, i) => getUserKey(u, i)).join('|');
    return `${domPart}|raw:arr:${arr}`;
  }

  if (typeof raw !== 'object') {
    return `${domPart}|raw:other:${String(raw)}`;
  }

  const toKeyList = (arr) => (Array.isArray(arr) ? arr.map((u, i) => getUserKey(u, i)).join('|') : '');
  const setPart = toKeyList(raw.set);
  const dataPart = toKeyList(raw.data);
  const resultsPart = toKeyList(raw.results);
  const connectPart = toKeyList(raw.connect);
  const disconnectPart = toKeyList(raw.disconnect);
  const countPart = getRelationCount(raw);

  return `${domPart}|set:${setPart}|data:${dataPart}|results:${resultsPart}|connect:${connectPart}|disconnect:${disconnectPart}|count:${countPart ?? 'null'}`;
}

/** @param {{ slug?: string, model?: string }} props */
function CourseWorkflowOfflineModuleSyncOnSelect({ slug, model }) {
  const uid = slug || model;
  const values = useForm('useContentManagerContext', (state) => state?.values, false);
  const setValues = useForm('useContentManagerContext', (state) => state?.setValues, false);
  const lastSelectedUsersRef = useRef(/** @type {any[]} */ ([]));
  const hasInitializedRef = useRef(false);
  const lastUsersSelectionSignatureRef = useRef('');

  useEffect(() => {
    if (uid !== COURSE_WORKFLOW_MODEL || !values || typeof setValues !== 'function') return;

    const selectedUsersRaw = values.users_permissions_users;
    const { users: selectedUsers, resolved } = getSelectedUsersFromRelation(
      selectedUsersRaw,
      lastSelectedUsersRef.current,
    );

    let effectiveUsers = selectedUsers;
    const domCount = getUsersCountFromDom();
    const selectionSignature = getUsersSelectionSignature(selectedUsersRaw, domCount);

    if (typeof domCount === 'number') {
      if (domCount <= 0) {
        effectiveUsers = [];
      } else if (effectiveUsers.length > domCount) {
        effectiveUsers = effectiveUsers.slice(0, domCount);
      } else if (effectiveUsers.length < domCount && lastSelectedUsersRef.current.length >= domCount) {
        effectiveUsers = lastSelectedUsersRef.current.slice(0, domCount);
      }
    }

    if (!resolved && typeof domCount !== 'number') return;

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      lastUsersSelectionSignatureRef.current = selectionSignature;
      lastSelectedUsersRef.current = effectiveUsers;
      return;
    }

    const workflowItems = getWorkflowItemsFromValues(values);
    if (workflowItems.length === 0) return;

    const usersSelectionChanged = lastUsersSelectionSignatureRef.current !== selectionSignature;
    const shouldBackfillOnModuleChange = hasOfflineModuleNeedingBackfill(workflowItems, effectiveUsers);
    if (!usersSelectionChanged && !shouldBackfillOnModuleChange) return;

    const relationCount = getRelationCount(selectedUsersRaw);
    const effectiveCount = typeof domCount === 'number'
      ? domCount
      : (typeof relationCount === 'number' ? relationCount : null);

    // On publish/reopen, Strapi may return users relation in ambiguous shape (null/count-only)
    // before full relation hydration. Never clear existing offline rows in that transient state.
    if (
      effectiveUsers.length === 0 &&
      hasExistingOfflineRows(workflowItems) &&
      isAmbiguousUsersState(selectedUsersRaw) &&
      (effectiveCount == null || effectiveCount > 0)
    ) {
      return;
    }

    if (
      effectiveUsers.length === 0 &&
      hasExistingOfflineRows(workflowItems) &&
      !isExplicitlyEmptyUsersSelection(selectedUsersRaw, domCount)
    ) {
      return;
    }

    lastUsersSelectionSignatureRef.current = selectionSignature;
    lastSelectedUsersRef.current = effectiveUsers;

    const { changed, nextWorkflowItems } = syncWorkflowOfflineModules(workflowItems, effectiveUsers);
    if (!changed) return;

    setValues(withUpdatedWorkflowItems(values, nextWorkflowItems));
  }, [uid, values, setValues]);

  return null;
}

export default CourseWorkflowOfflineModuleSyncOnSelect;
