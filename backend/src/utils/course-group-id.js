// @ts-nocheck
'use strict';

/**
 * Course lineage (group_id) handling.
 *
 * - New course (create)         → new UUID group_id (unless a valid one is already supplied).
 * - Duplicate course (clone)    → always inherits the SOURCE course's group_id; never a new one.
 * - Update                      → group_id is immutable once set.
 *
 * course_version is intentionally never touched here: it is always entered manually by the user.
 */

const { randomUUID } = require('node:crypto');

const COURSE_UID = 'api::course.course';
const LOG = '[course-group-id]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidGroupId(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Existing group_id of a course document (any draft/published row), or null. */
async function findGroupIdForDocument(strapi, documentId) {
  if (!documentId) return null;
  const rows = await strapi.db.query(COURSE_UID).findMany({
    where: { documentId: String(documentId) },
    select: ['id', 'group_id'],
  });
  const withGroup = (rows || []).find((r) => r?.group_id && String(r.group_id).trim());
  return withGroup ? String(withGroup.group_id).trim() : null;
}

/**
 * group_id of the source course. Legacy sources without one get a UUID persisted on all of
 * their rows first, so the source and its duplicate end up in the same lineage.
 */
async function getOrCreateGroupIdForDocument(strapi, documentId) {
  const existing = await findGroupIdForDocument(strapi, documentId);
  if (existing) return existing;

  const groupId = randomUUID();
  await strapi.db.query(COURSE_UID).updateMany({
    where: { documentId: String(documentId) },
    data: { group_id: groupId },
  });
  strapi.log.info(`${LOG} assigned group_id=${groupId} to legacy source course documentId=${documentId}`);
  return groupId;
}

/** Document Service middleware body: mutates context.params.data for course create/clone/update. */
async function applyCourseGroupId(strapi, context) {
  if (context.uid !== COURSE_UID) return;
  const { action } = context;
  const params = context.params || (context.params = {});

  if (action === 'clone') {
    const sourceDocumentId = params.documentId;
    if (!sourceDocumentId) return;
    const groupId = await getOrCreateGroupIdForDocument(strapi, sourceDocumentId);
    params.data = { ...(params.data || {}), group_id: groupId };
    strapi.log.info(`${LOG} clone of documentId=${sourceDocumentId} keeps group_id=${groupId}`);
    return;
  }

  if (action === 'create') {
    const data = params.data || (params.data = {});
    if (!isValidGroupId(data.group_id)) {
      data.group_id = randomUUID();
    } else {
      data.group_id = data.group_id.trim();
    }
    return;
  }

  if (action === 'update') {
    const data = params.data;
    if (!data || typeof data !== 'object') return;
    const existing = await findGroupIdForDocument(strapi, params.documentId);
    if (existing) {
      // Immutable: ignore any attempt to change lineage.
      if ('group_id' in data) data.group_id = existing;
    } else {
      // Legacy course that was never assigned a lineage.
      data.group_id = isValidGroupId(data.group_id) ? data.group_id.trim() : randomUUID();
    }
  }
}

/** One-time style backfill: every course document without group_id gets its own UUID (shared by its draft/published rows). */
async function backfillMissingCourseGroupIds(strapi) {
  const rows = await strapi.db.query(COURSE_UID).findMany({
    where: { $or: [{ group_id: { $null: true } }, { group_id: '' }] },
    select: ['id', 'documentId'],
  });
  const documentIds = [...new Set((rows || []).map((r) => r?.documentId).filter(Boolean))];
  for (const documentId of documentIds) {
    await getOrCreateGroupIdForDocument(strapi, documentId);
  }
  if (documentIds.length > 0) {
    strapi.log.info(`${LOG} backfilled group_id for ${documentIds.length} course document(s)`);
  }
}

/** Show group_id as read-only in the Content Manager edit view (value is system-managed). */
async function lockGroupIdFieldInAdmin(strapi) {
  const contentTypes = strapi.plugin('content-manager')?.service('content-types');
  const contentType = strapi.contentTypes?.[COURSE_UID];
  if (!contentTypes || !contentType) return;

  const config = await contentTypes.findConfiguration(contentType);
  const edit = config?.metadatas?.group_id?.edit;
  if (!edit || edit.editable === false) return;

  const { uid, ...rest } = config;
  await contentTypes.updateConfiguration(contentType, {
    ...rest,
    metadatas: {
      ...rest.metadatas,
      group_id: {
        ...rest.metadatas.group_id,
        edit: {
          ...edit,
          editable: false,
          description: edit.description || 'Auto-managed. Shared by all versions of this course.',
        },
      },
    },
  });
}

module.exports = {
  applyCourseGroupId,
  backfillMissingCourseGroupIds,
  lockGroupIdFieldInAdmin,
  isValidGroupId,
};
