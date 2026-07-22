// @ts-nocheck
'use strict';

const { errors } = require('@strapi/utils');
const { ValidationError } = errors;
const { captureCourseAssignmentDueDateChange } = require('../../../../lifecycles/user-progress-automation');

function isNumericId(value) {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(String(value)));
}

function extractRelationIds(raw) {
  if (raw == null) return [];
  if (isNumericId(raw)) return [Number(raw)];

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (isNumericId(item)) return Number(item);
        if (item && typeof item === 'object' && isNumericId(item.id)) return Number(item.id);
        return null;
      })
      .filter(Boolean);
  }

  if (typeof raw === 'object') {
    const items = Array.isArray(raw.set)
      ? raw.set
      : Array.isArray(raw.connect)
        ? raw.connect
        : raw.id != null
          ? [raw]
          : [];

    return items
      .map((item) => {
        if (isNumericId(item)) return Number(item);
        if (item && typeof item === 'object' && isNumericId(item.id)) return Number(item.id);
        return null;
      })
      .filter(Boolean);
  }

  return [];
}

function isPublishIntent(data) {
  return data?.publishedAt != null || data?.published_at != null;
}

function normalizeRelationItem(item) {
  if (item == null) return null;
  if (isNumericId(item)) return { id: Number(item) };
  if (typeof item === 'object') {
    if (isNumericId(item.id)) {
      return {
        id: Number(item.id),
        ...(item.documentId ? { documentId: String(item.documentId) } : {}),
      };
    }
    if (item.documentId) {
      return { documentId: String(item.documentId) };
    }
  }
  return null;
}

function mergeIndividualUserRelationPayload(data) {
  const raw = data?.individual_user;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

  const hasSet = Array.isArray(raw.set);
  const hasConnect = Array.isArray(raw.connect);
  const hasDisconnect = Array.isArray(raw.disconnect);
  if (!hasSet && !hasConnect && !hasDisconnect) return;

  const merged = new Map();
  const makeKey = (entry) => (entry?.id != null ? `id:${entry.id}` : `doc:${entry?.documentId || ''}`);

  for (const src of [raw.set || [], raw.connect || []]) {
    for (const item of src) {
      const normalized = normalizeRelationItem(item);
      if (!normalized) continue;
      merged.set(makeKey(normalized), normalized);
    }
  }

  for (const item of raw.disconnect || []) {
    const normalized = normalizeRelationItem(item);
    if (!normalized) continue;
    merged.delete(makeKey(normalized));
  }

  data.individual_user = { set: [...merged.values()] };
}

async function getExistingAssignment(where) {
  if (!where) return null;

  return await strapi.db.query('api::course-assignment.course-assignment').findOne({
    where,
    select: ['id', 'documentId', 'assignment_target_type', 'publishedAt'],
    populate: {
      individual_user: {
        select: ['id'],
      },
    },
  });
}

async function mergeIndividualUsersWithExisting(data, where) {
  if (!data || !where) return;
  const raw = data.individual_user;
  if (!raw || typeof raw !== 'object') return;

  const existingAssignment = await getExistingAssignment(where);
  const existingUsers = Array.isArray(existingAssignment?.individual_user)
    ? existingAssignment.individual_user
    : [];

  const toKey = (item) => {
    if (item?.id != null) return `id:${item.id}`;
    if (item?.documentId) return `doc:${String(item.documentId)}`;
    return null;
  };

  const toRelationEntry = (item) => {
    if (!item) return null;
    if (isNumericId(item)) return { id: Number(item) };
    if (typeof item === 'object') {
      if (isNumericId(item.id)) {
        return {
          id: Number(item.id),
          ...(item.documentId ? { documentId: String(item.documentId) } : {}),
        };
      }
      if (item.documentId) return { documentId: String(item.documentId) };
    }
    return null;
  };

  const merged = new Map();

  // Start from already saved users so publish updates cannot accidentally drop them.
  for (const user of existingUsers) {
    const entry = toRelationEntry(user);
    const key = toKey(entry);
    if (entry && key) merged.set(key, entry);
  }

  const addOps = [raw.set, raw.connect];
  for (const op of addOps) {
    if (!Array.isArray(op)) continue;
    for (const item of op) {
      const entry = toRelationEntry(item);
      const key = toKey(entry);
      if (entry && key) merged.set(key, entry);
    }
  }

  if (Array.isArray(raw.disconnect)) {
    for (const item of raw.disconnect) {
      const entry = toRelationEntry(item);
      const key = toKey(entry);
      if (key) merged.delete(key);
    }
  }

  data.individual_user = { set: [...merged.values()] };
}

function getExistingUserCount(existingAssignment) {
  const users = existingAssignment?.individual_user;
  if (!Array.isArray(users)) return 0;
  return users.filter((user) => user?.id != null).length;
}

async function validateIndividualPublish(data, where) {
  if (!isPublishIntent(data)) return;

  const existingAssignment = await getExistingAssignment(where);
  const targetType = data?.assignment_target_type ?? existingAssignment?.assignment_target_type;
  if (String(targetType || '').toLowerCase() !== 'individual') return;

  const incomingUserIds = extractRelationIds(data?.individual_user);
  const hasUsers = incomingUserIds.length > 0 || getExistingUserCount(existingAssignment) > 0;

  if (!hasUsers) {
    throw new ValidationError(
      'Individual course assignments cannot be published without importing an Excel file that adds at least one user.'
    );
  }
}

module.exports = {
  async beforeCreate(event) {
    mergeIndividualUserRelationPayload(event.params?.data);
    await validateIndividualPublish(event.params?.data, null);
  },

  async beforeUpdate(event) {
    await mergeIndividualUsersWithExisting(event.params?.data, event.params?.where);
    mergeIndividualUserRelationPayload(event.params?.data);
    await validateIndividualPublish(event.params?.data, event.params?.where);
    await captureCourseAssignmentDueDateChange(strapi, event.params?.data, event.params?.where);
  },
};