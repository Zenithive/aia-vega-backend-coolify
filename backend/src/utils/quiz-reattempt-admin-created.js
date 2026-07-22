'use strict';

const UID = 'api::quiz-reattempt-request.quiz-reattempt-request';
const TABLE = 'quiz_reattempt_requests';

function getRequestPath(strapi) {
  try {
    const ctx = strapi?.requestContext?.get?.();
    return (ctx?.request?.path || ctx?.path || ctx?.request?.url || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * True only for Strapi Admin Panel creates (Content Manager / admin API).
 * Do not treat ctx.state.user as admin — that is often the portal user JWT.
 */
function isAdminPanelCreate(strapi) {
  try {
    const ctx = strapi?.requestContext?.get?.();
    if (!ctx) return false;

    if (ctx.state?.quizReattemptFromFrontend === true) {
      return false;
    }

    const path = getRequestPath(strapi);
    if (
      path.includes('/quiz-reattempt-request/send') ||
      path.includes('/quiz-reattempt-requests/send')
    ) {
      return false;
    }

    if (path.includes('/content-manager/')) {
      return true;
    }

    if (ctx.state?.admin?.id) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function getAdminCreatedColumnMeta(strapi) {
  try {
    const meta = strapi.db.metadata.get(UID);
    const attr = meta.attributes?.adminCreated;
    return {
      tableName: meta.tableName || TABLE,
      columnName: (attr && attr.columnName) || 'admin_created',
    };
  } catch {
    return { tableName: TABLE, columnName: 'admin_created' };
  }
}

/**
 * Strapi v5 may omit boolean false from db.query / documentService writes.
 * Use knex so admin_created is always persisted as true or false, never null.
 */
async function persistAdminCreated(strapi, recordId, adminCreated) {
  if (recordId == null || recordId === '') {
    strapi.log.warn('[quiz-reattempt] persistAdminCreated skipped: missing recordId');
    return false;
  }

  const knex = strapi.db.connection;
  const { tableName, columnName } = getAdminCreatedColumnMeta(strapi);
  const value = Boolean(adminCreated);
  const patch = { [columnName]: value };

  const tryUpdate = async (where) => {
    const count = await knex(tableName).where(where).update(patch);
    return Number(count) || 0;
  };

  let updated = 0;
  const numericId = Number(recordId);
  if (Number.isFinite(numericId) && numericId > 0) {
    updated = await tryUpdate({ id: numericId });
  }

  if (updated === 0) {
    const docId = String(recordId).trim();
    if (docId && !Number.isFinite(numericId)) {
      updated = await tryUpdate({ document_id: docId });
    }
  }

  if (updated === 0) {
    try {
      const row = await strapi.db.query(UID).findOne({
        where:
          Number.isFinite(numericId) && numericId > 0
            ? { id: numericId }
            : { documentId: String(recordId) },
        select: ['id'],
      });
      if (row?.id) {
        updated = await tryUpdate({ id: Number(row.id) });
      }
    } catch {
      /* fall through */
    }
  }

  if (updated === 0) {
    strapi.log.error(
      { recordId, tableName, columnName, value },
      '[quiz-reattempt] persistAdminCreated updated 0 rows'
    );
    return false;
  }

  strapi.log.info(
    { recordId, tableName, columnName, value, updated },
    '[quiz-reattempt] persistAdminCreated success'
  );
  return true;
}

/**
 * Create a quiz reattempt request and always persist adminCreated via knex
 * (Strapi query layer may omit boolean false on INSERT).
 */
async function createQuizReattemptRequest(strapi, data, adminCreated = false) {
  const flag = Boolean(adminCreated);
  const record = await strapi.db.query(UID).create({
    data: {
      ...data,
      adminCreated: flag,
    },
  });

  const recordId = record?.id ?? record?.documentId;
  const ok = await persistAdminCreated(strapi, recordId, flag);
  if (!ok) {
    throw new Error(
      `Failed to persist adminCreated=${flag} for quiz reattempt request ${recordId}`
    );
  }

  return strapi.db.query(UID).findOne({
    where:
      record?.id != null
        ? { id: Number(record.id) }
        : { documentId: String(record.documentId) },
  });
}

module.exports = {
  UID,
  isAdminPanelCreate,
  persistAdminCreated,
  createQuizReattemptRequest,
};
