//@ts-nocheck

'use strict';

const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const COURSE_WORKFLOW_UID = 'api::course-workflow.course-workflow';
const WORKFLOW_MODULE_COMPONENT_UID = 'course.workflow-module';
const COURSE_UID = 'api::course.course';
const DEPARTMENT_UID = 'api::department.department';
const WORK_LOCATION_UID = 'api::work-location.work-location';
const USER_UID = 'plugin::users-permissions.user';
const COMPANY_UID = 'api::company.company';
const EVENT_UID = 'api::event.event';
const HOLIDAY_UID = 'api::holiday.holiday';
const MODULE_VIDEO_PROGRESS_UID = 'api::module-video-progress.module-video-progress';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';
const FEEDBACK_SUBMISSION_UID = 'api::feedback-submission.feedback-submission';
const QUIZ_REATTEMPT_REQUEST_UID = 'api::quiz-reattempt-request.quiz-reattempt-request';
const USER_PROGRESS_UID = 'api::user-progress.user-progress';

const CM_RELATION_HYDRATION_UIDS = new Set([
  MODULE_VIDEO_PROGRESS_UID,
  QUIZ_SUBMISSION_UID,
  FEEDBACK_SUBMISSION_UID,
  QUIZ_REATTEMPT_REQUEST_UID,
  USER_PROGRESS_UID,
]);

const CM_RELATION_HYDRATE_CONFIG = {
  [MODULE_VIDEO_PROGRESS_UID]: {
    courseKey: 'course',
    userKey: 'user',
    populate: {
      course: { select: ['id', 'documentId', 'title', 'publishedAt'] },
      user: { select: ['id', 'documentId', 'username', 'email'] },
    },
  },
  [QUIZ_SUBMISSION_UID]: {
    courseKey: 'course',
    userKey: 'submitted_by',
    populate: {
      course: { select: ['id', 'documentId', 'title', 'publishedAt'] },
      submitted_by: { select: ['id', 'documentId', 'username', 'email'] },
    },
  },
  [FEEDBACK_SUBMISSION_UID]: {
    courseKey: 'course',
    userKey: 'users_permissions_user',
    populate: {
      course: { select: ['id', 'documentId', 'title', 'publishedAt'] },
      users_permissions_user: { select: ['id', 'documentId', 'username', 'email'] },
    },
  },
  [QUIZ_REATTEMPT_REQUEST_UID]: {
    courseKey: 'course',
    userKey: 'users_permissions_user',
    populate: {
      course: { select: ['id', 'documentId', 'title', 'publishedAt'] },
      users_permissions_user: { select: ['id', 'documentId', 'username', 'email'] },
    },
  },
  [USER_PROGRESS_UID]: {
    courseKey: 'course',
    userKey: 'user',
    populate: {
      course: { select: ['id', 'documentId', 'title', 'publishedAt'] },
      user: { select: ['id', 'documentId', 'username', 'email'] },
    },
  },
};

function mergeWithAnd(existing, filter) {
  if (!existing || Object.keys(existing).length === 0) return filter;
  if (existing.$and && Array.isArray(existing.$and)) {
    return { ...existing, $and: [...existing.$and, filter] };
  }
  return { $and: [existing, filter] };
}

function normalizeCompanyName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (lower === 'aia' || lower.includes('aia')) return 'AIA';
  if (lower === 'vega' || lower.includes('vega')) return 'Vega';
  return String(name || '').trim();
}

function getSearchableFields(targetUid, targetModel) {
  const attrs = targetModel?.attributes || {};
  const attrNames = Object.keys(attrs);
  const fieldSet = new Set();

  const tryAdd = (field) => {
    if (!field || !attrs[field]) return;
    const type = attrs[field].type;
    if (['string', 'text', 'email', 'uid'].includes(type)) {
      fieldSet.add(field);
    }
  };

  tryAdd(targetModel?.info?.mainField);

  if (targetUid === COURSE_UID) {
    tryAdd('title');
  }

  if (targetUid === USER_UID) {
    ['username', 'email', 'emp_code', 'emp_id', 'designation', 'department'].forEach(tryAdd);
  }

  ['name', 'title', 'username', 'email'].forEach(tryAdd);

  if (fieldSet.size === 0) {
    attrNames.forEach((field) => tryAdd(field));
  }

  return [...fieldSet];
}

function getSortField(targetUid, targetModel) {
  const attrs = targetModel?.attributes || {};
  const preferred = [];

  if (targetModel?.info?.mainField) preferred.push(targetModel.info.mainField);
  if (targetUid === COURSE_UID) preferred.push('title');
  preferred.push('name', 'username', 'email', 'documentId', 'id');

  for (const field of preferred) {
    if (field === 'id') return 'id';
    if (attrs[field]) return field;
  }

  return 'id';
}

function parseRawCompanyIds(rawCompanyId) {
  if (rawCompanyId == null) return [];

  const values = Array.isArray(rawCompanyId)
    ? rawCompanyId
    : String(rawCompanyId)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

  const uniq = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!uniq.includes(normalized)) uniq.push(normalized);
  });

  return uniq;
}

function getExcludeCourseFilter(rawExcludeCourseIds) {
  const ids = parseRawCompanyIds(rawExcludeCourseIds);
  if (ids.length === 0) return null;

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const clauses = [];
  if (numericIds.length > 0) clauses.push({ id: { $notIn: numericIds } });
  if (docIds.length > 0) clauses.push({ documentId: { $notIn: docIds } });

  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function mergeFilterIfPresent(baseFilter, nextFilter) {
  if (!nextFilter || typeof nextFilter !== 'object') return baseFilter;
  if (!baseFilter || typeof baseFilter !== 'object') return nextFilter;
  return mergeWithAnd(baseFilter, nextFilter);
}

function makeFiltersCaseInsensitive(input) {
  if (Array.isArray(input)) {
    return input.map((item) => makeFiltersCaseInsensitive(item));
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  const output = {};
  const operatorMap = {
    $eq: '$containsi',
    $ne: '$nei',
    $contains: '$containsi',
    $notContains: '$notContainsi',
    $startsWith: '$startsWithi',
    $endsWith: '$endsWithi',
  };

  Object.entries(input).forEach(([key, value]) => {
    const mappedKey = operatorMap[key];
    if (mappedKey && typeof value === 'string') {
      output[mappedKey] = value;
      return;
    }

    if (!key.startsWith('$') && typeof value === 'string') {
      output[key] = { $containsi: value };
      return;
    }

    output[key] = makeFiltersCaseInsensitive(value);
  });

  return output;
}

function normalizeCaseInsensitiveQueryFilters(ctx) {
  const filters = ctx?.request?.query?.filters;
  if (!filters || typeof filters !== 'object') return;

  const normalized = makeFiltersCaseInsensitive(filters);
  ctx.request.query.filters = normalized;
  if (ctx.query && typeof ctx.query === 'object') {
    ctx.query.filters = normalized;
  }
}

const COURSE_CLONE_ASSIGNMENTS_LOG = '[course-clone-assignments]';

function extractCourseIdentityFromCmBody(body) {
  const data = body?.data ?? body?.results?.[0] ?? body;
  if (!data || typeof data !== 'object') return {};
  return {
    id: data?.id != null ? Number(data.id) : null,
    documentId: data?.documentId != null ? String(data.documentId) : null,
  };
}

async function forceRemoveCourseAssignmentLinksForCourse(strapi, identity) {
  const knex = strapi.db?.connection;
  if (!knex) return;

  let ids = [];
  if (Number.isFinite(identity?.id)) {
    ids = [Number(identity.id)];
  } else if (identity?.documentId) {
    const rows = await strapi.db.query(COURSE_UID).findMany({
      where: { documentId: String(identity.documentId) },
      select: ['id'],
      limit: 10,
    });
    ids = (rows || []).map((r) => Number(r?.id)).filter(Number.isFinite);
  }

  if (ids.length === 0) return;

  const newTable = 'courses_course_assignments_lnk';
  const oldTable = 'course_assignments_course_lnk';
  const hasNew = await knex.schema.hasTable(newTable);
  const hasOld = await knex.schema.hasTable(oldTable);

  if (hasNew) {
    await knex(newTable).whereIn('course_id', ids).del();
  }
  if (hasOld) {
    await knex(oldTable).whereIn('course_id', ids).del();
  }
}

async function hydrateRelationsForEntry(strapi, uid, entry) {
  if (!entry || typeof entry !== 'object') return entry;

  const config = CM_RELATION_HYDRATE_CONFIG[uid];
  if (!config) return entry;

  const hasCourse = !!entry?.[config.courseKey];
  const hasUser = !!entry?.[config.userKey];
  if (hasCourse && hasUser) return entry;

  const where = Number.isFinite(Number(entry?.id))
    ? { id: Number(entry.id) }
    : entry?.documentId
      ? { documentId: String(entry.documentId) }
      : null;

  if (!where) return entry;

  const hydrated = await strapi.db.query(uid).findOne({
    where,
    populate: config.populate,
  });

  if (!hydrated) return entry;

  return {
    ...entry,
    ...(entry?.[config.courseKey] ? {} : { [config.courseKey]: hydrated?.[config.courseKey] || null }),
    ...(entry?.[config.userKey] ? {} : { [config.userKey]: hydrated?.[config.userKey] || null }),
  };
}

async function hydrateRelationsInCmBody(strapi, uid, body) {
  if (!CM_RELATION_HYDRATION_UIDS.has(uid) || !body || typeof body !== 'object') return body;

  if (Array.isArray(body.results)) {
    body.results = await Promise.all(body.results.map((entry) => hydrateRelationsForEntry(strapi, uid, entry)));
    return body;
  }

  if (Array.isArray(body.data)) {
    body.data = await Promise.all(body.data.map((entry) => hydrateRelationsForEntry(strapi, uid, entry)));
    return body;
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    body.data = await hydrateRelationsForEntry(strapi, uid, body.data);
    return body;
  }

  if (body.results == null && body.data == null) {
    return hydrateRelationsForEntry(strapi, uid, body);
  }

  return body;
}

async function hydrateCourseAssignmentCoursesInBody(strapi, body) {
  if (!body || typeof body !== 'object') return body;

  const hydrateEntry = async (entry) => {
    if (!entry || typeof entry !== 'object') return entry;

    const where = Number.isFinite(Number(entry?.id))
      ? { id: Number(entry.id) }
      : entry?.documentId
        ? { documentId: String(entry.documentId) }
        : null;

    if (!where) return entry;

    const hydrated = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where,
      populate: {
        courses: { select: ['id', 'documentId', 'title'] },
      },
    });

    if (!hydrated) return entry;

    return {
      ...entry,
      courses: hydrated.courses ?? entry.courses ?? null,
    };
  };

  if (Array.isArray(body.results)) {
    body.results = await Promise.all(body.results.map(hydrateEntry));
    return body;
  }

  if (Array.isArray(body.data)) {
    body.data = await Promise.all(body.data.map(hydrateEntry));
    return body;
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    body.data = await hydrateEntry(body.data);
    return body;
  }

  if (body.results == null && body.data == null) {
    return hydrateEntry(body);
  }

  return body;
}

function getCourseLabel(course) {
  if (course == null) return '—';
  if (typeof course === 'string' || typeof course === 'number') return String(course);
  return course.title || course.name || course.documentId || String(course.id ?? '—');
}

function flattenCourseAssignmentCoursesInBody(body) {
  if (!body || typeof body !== 'object') return body;

  const flattenEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const courses = entry.courses;
    if (Array.isArray(courses)) {
      entry.courses = courses.length > 0 ? courses.map(getCourseLabel).join(', ') : '—';
    } else if (courses && typeof courses === 'object') {
      entry.courses = getCourseLabel(courses);
    }
    return entry;
  };

  if (Array.isArray(body.results)) {
    body.results = body.results.map(flattenEntry);
    return body;
  }

  if (Array.isArray(body.data)) {
    body.data = body.data.map(flattenEntry);
    return body;
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    body.data = flattenEntry(body.data);
    return body;
  }

  if (body.results == null && body.data == null) {
    return flattenEntry(body);
  }

  return body;
}

async function getCompanyNamesFromRawId(strapi, rawCompanyId) {
  const ids = parseRawCompanyIds(rawCompanyId);
  if (ids.length === 0) return [];

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const companyWhere = [];
  if (numericIds.length > 0) {
    companyWhere.push({ id: { $in: numericIds } });
  }
  if (docIds.length > 0) {
    companyWhere.push({ documentId: { $in: docIds } });
  }
  if (companyWhere.length === 0) return [];

  const companies = await strapi.db.query(COMPANY_UID).findMany({
    where: companyWhere.length === 1 ? companyWhere[0] : { $or: companyWhere },
    select: ['name'],
    limit: Math.max(5, ids.length * 3),
  });

  return [...new Set((companies || []).map((c) => normalizeCompanyName(c?.name)).filter(Boolean))];
}

async function getCompanyFilterForDepartment(strapi, sourceUid, documentId) {
  const sourceSchema = strapi.getModel(sourceUid);
  if (!sourceSchema || !sourceSchema.attributes?.company) {
    return null;
  }
  const companyAttr = sourceSchema.attributes.company;
  if (companyAttr.type !== 'relation' || companyAttr.target !== COMPANY_UID) {
    return null;
  }

  const doc = await strapi.db.query(sourceUid).findOne({
    where: { documentId },
    populate: { company: true },
  });
  if (!doc) return null;

  const company = doc.company;
  const documentIds = [];
  if (Array.isArray(company)) {
    company.forEach((c) => {
      if (c && c.documentId != null) documentIds.push(c.documentId);
    });
  } else if (company && company.documentId != null) {
    documentIds.push(company.documentId);
  }

  if (documentIds.length === 0) return null;
  return documentIds.length === 1
    ? { documentId: documentIds[0] }
    : { documentId: { $in: documentIds } };
}

async function getCompanyScopedFilter(strapi, targetUid, rawCompanyId) {
  const ids = parseRawCompanyIds(rawCompanyId);
  if (ids.length === 0) return null;

  const numericIds = [];
  const docIds = [];

  ids.forEach((raw) => {
    const numId = parseInt(raw, 10);
    const isDocId = Number.isNaN(numId) || raw.length > 10;
    if (isDocId) docIds.push(raw);
    else numericIds.push(numId);
  });

  const companyClauses = [];
  if (numericIds.length === 1) companyClauses.push({ company: { id: numericIds[0] } });
  else if (numericIds.length > 1) companyClauses.push({ company: { id: { $in: numericIds } } });

  if (docIds.length === 1) companyClauses.push({ company: { documentId: docIds[0] } });
  else if (docIds.length > 1) companyClauses.push({ company: { documentId: { $in: docIds } } });

  if (targetUid === COURSE_UID || targetUid === DEPARTMENT_UID || targetUid === WORK_LOCATION_UID) {
    if (companyClauses.length === 0) return null;
    return companyClauses.length === 1 ? companyClauses[0] : { $or: companyClauses };
  }

  if (targetUid === USER_UID) {
    const companyNames = await getCompanyNamesFromRawId(strapi, ids);
    if (companyNames.length === 0) return { id: { $eq: -1 } };
    if (companyNames.length === 1) {
      return { company: companyNames[0] };
    }
    return {
      $or: companyNames.map((name) => ({ company: name })),
    };
  }

  return null;
}

module.exports = (plugin) => {
  plugin.controllers.coursesForCompany = {
    async find(ctx) {
      const companyId = ctx.query?.companyId;
      if (!companyId) return ctx.badRequest('companyId query param is required');

      const filter = await getCompanyScopedFilter(strapi, COURSE_UID, companyId);
      if (!filter) {
        ctx.body = { results: [] };
        return;
      }

      try {
        const courses = await strapi.db.query(COURSE_UID).findMany({
          where: filter,
          select: ['id', 'documentId', 'title'],
          orderBy: { title: 'asc' },
          limit: 300,
        });
        ctx.body = { results: courses };
      } catch (err) {
        strapi.log.error('[courses-for-company]', err?.message || err);
        ctx.body = { results: [] };
      }
    },
  };

  if (Array.isArray(plugin.routes?.admin?.routes)) {
    plugin.routes.admin.routes.push({
      method: 'GET',
      path: '/courses-for-company',
      handler: 'coursesForCompany.find',
      config: { policies: [] },
    });
  }

  const relationsController = plugin.controllers.relations;
  const defaultFindAvailable = relationsController.findAvailable.bind(relationsController);

  const collectionTypesController = plugin.controllers['collection-types'];
  const defaultCollectionFind = collectionTypesController?.find?.bind(collectionTypesController);
  const defaultCollectionFindOne = collectionTypesController?.findOne?.bind(collectionTypesController);

  // Remove null email from responses so Strapi admin Yup (.string().nullable().min(1))
  // never sees null or "" — a missing key is treated as optional and skips all validators
  function normalizeUserEmailInBody(modelUid, body) {
    if (modelUid !== USER_UID || !body) return;
    const normalize = (entry) => {
      if (entry && typeof entry === 'object' && 'email' in entry && entry.email === null) {
        delete entry.email;
      }
    };
    if (body.data && typeof body.data === 'object') normalize(body.data);
    if (Array.isArray(body.results)) body.results.forEach(normalize);
    if (Array.isArray(body.data)) body.data.forEach(normalize);
  }

  if (defaultCollectionFind) {
    collectionTypesController.find = async function find(ctx) {
      normalizeCaseInsensitiveQueryFilters(ctx);
      await defaultCollectionFind(ctx);
      const modelUid = ctx.params?.model;
      await hydrateRelationsInCmBody(strapi, modelUid, ctx.body);
      if (modelUid === COURSE_ASSIGNMENT_UID) {
        await hydrateCourseAssignmentCoursesInBody(strapi, ctx.body);
        flattenCourseAssignmentCoursesInBody(ctx.body);
      }
      normalizeUserEmailInBody(modelUid, ctx.body);
    };
  }

  if (defaultCollectionFindOne) {
    collectionTypesController.findOne = async function findOne(ctx) {
      await defaultCollectionFindOne(ctx);
      const modelUid = ctx.params?.model;
      await hydrateRelationsInCmBody(strapi, modelUid, ctx.body);
      normalizeUserEmailInBody(modelUid, ctx.body);
    };
  }

  // Normalize email before saving: empty string or null → delete key so Yup never sees it
  function sanitizeUserEmailForSave(ctx) {
    if (ctx.params?.model !== USER_UID || !ctx.request?.body?.data) return;
    const data = ctx.request.body.data;
    if ('email' in data && (data.email === null || data.email === '')) {
      delete data.email;
    }
  }

  const defaultCollectionCreate = collectionTypesController?.create?.bind(collectionTypesController);
  if (defaultCollectionCreate) {
    collectionTypesController.create = async function create(ctx) {
      sanitizeUserEmailForSave(ctx);
      return defaultCollectionCreate(ctx);
    };
  }

  const defaultCollectionUpdate = collectionTypesController?.update?.bind(collectionTypesController);
  if (defaultCollectionUpdate) {
    collectionTypesController.update = async function update(ctx) {
      sanitizeUserEmailForSave(ctx);
      return defaultCollectionUpdate(ctx);
    };
  }

  const defaultCollectionClone = collectionTypesController?.clone?.bind(collectionTypesController);
  if (defaultCollectionClone) {
    collectionTypesController.clone = async function clone(ctx) {
      await defaultCollectionClone(ctx);

      const modelUid = ctx.params?.model;
      if (modelUid !== COURSE_UID) return;

      try {
        const identity = extractCourseIdentityFromCmBody(ctx.body);
        await forceRemoveCourseAssignmentLinksForCourse(strapi, identity);
        strapi.log.info(
          `${COURSE_CLONE_ASSIGNMENTS_LOG} content-manager.clone: removed assignment links for cloned course id=${identity?.id ?? 'n/a'} documentId=${identity?.documentId ?? 'n/a'}`
        );
      } catch (err) {
        strapi.log.error(
          `${COURSE_CLONE_ASSIGNMENTS_LOG} content-manager.clone: failed to remove assignment links`,
          err
        );
      }
    };
  }

  async function findAvailableFallback(ctx, targetUid, extraFilter = null) {
    const { _q = '', pageSize = 10, _limit, page = 1, _page } = ctx.request?.query ?? {};
    const requestedLimit = pageSize ?? _limit ?? 10;
    const requestedPage = page ?? _page ?? 1;
    const limit = Math.max(1, parseInt(String(requestedLimit), 10) || 10);
    const currentPage = Math.max(1, parseInt(String(requestedPage), 10) || 1);
    const offset = (currentPage - 1) * limit;

    const targetModel = strapi.getModel(targetUid);
    const sortField = getSortField(targetUid, targetModel);
    const searchableFields = getSearchableFields(targetUid, targetModel);
    const searchTerm = String(_q || '').trim();
    let where = {};

    if (searchTerm) {
      where = {
        $or: searchableFields.map((field) => ({ [field]: { $containsi: searchTerm } })),
      };
    }

    if (extraFilter && typeof extraFilter === 'object') {
      where = mergeWithAnd(where, extraFilter);
    }

    const [results, total] = await Promise.all([
      strapi.db.query(targetUid).findMany({ where, limit, offset, orderBy: { [sortField]: 'asc' } }),
      strapi.db.query(targetUid).count({ where }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / limit));

    ctx.body = {
      results,
      pagination: {
        page: currentPage,
        pageSize: limit,
        total,
        pageCount,
      },
    };
  }

  const runFindAvailableSafely = async (ctx, targetUid) => {
    try {
      return await defaultFindAvailable(ctx);
    } catch (err) {
      const msg = String(err?.message || '');
      const isLocaleBug =
        msg.includes("Cannot destructure property 'locale'") &&
        String(err?.stack || '').includes('content-manager') &&
        String(err?.stack || '').includes('relations.js');

      if (isLocaleBug && targetUid) {
        strapi.log.warn(`[content-manager ext] findAvailable locale-bug for ${targetUid}; using direct-DB fallback`);
        return findAvailableFallback(ctx, targetUid);
      }

      if (isLocaleBug) {
        strapi.log.warn('content-manager relations.findAvailable failed due to permission-denied destructure path; returning 403');
        return ctx.forbidden('You do not have permission to read this relation.');
      }

      throw err;
    }
  };

  relationsController.findAvailable = async function findAvailable(ctx) {
    const { model: sourceUid, targetField } = ctx.params;
    const id = ctx.request?.query?.id;
    const selectedCompanyId = ctx.request?.query?.companyId;
    const excludeCourseIds = ctx.request?.query?.excludeCourseIds;
    const sourceModel = sourceUid ? strapi.getModel(sourceUid) : null;
    const targetSchema = sourceModel?.attributes?.[targetField];
    let targetUid = targetSchema?.target;

    // Component relation fallback for workflow modules (e.g. targetField like "modules.course")
    if (!targetUid && sourceUid === COURSE_WORKFLOW_UID && typeof targetField === 'string') {
      if (targetField === 'users_permissions_users') targetUid = USER_UID;
      else if (targetField === 'course' || targetField.endsWith('.course') || targetField.includes('course')) targetUid = COURSE_UID;
    }

    // Handle component UID directly (course.workflow-module/course)
    if (!targetUid && sourceUid === WORKFLOW_MODULE_COMPONENT_UID && targetField === 'course') {
      targetUid = COURSE_UID;
    }

    const isWorkflowSource =
      sourceUid === COURSE_ASSIGNMENT_UID ||
      sourceUid === COURSE_WORKFLOW_UID ||
      sourceUid === WORKFLOW_MODULE_COMPONENT_UID ||
      sourceUid === EVENT_UID ||
      sourceUid === HOLIDAY_UID;

    if (isWorkflowSource && selectedCompanyId && targetUid) {
      const companyFilter = await getCompanyScopedFilter(strapi, targetUid, selectedCompanyId);
      if (companyFilter) {
        ctx.state._relationCompanyFilter = { uid: targetUid, filter: companyFilter };
      }
    }

    if (targetUid === DEPARTMENT_UID && id && sourceUid) {
      const companyFilter = await getCompanyFilterForDepartment(strapi, sourceUid, id);
      if (companyFilter) {
        ctx.state._departmentCompanyFilter = { uid: DEPARTMENT_UID, filter: { company: companyFilter } };
      }
    }

    if (
      (sourceUid === COURSE_WORKFLOW_UID || sourceUid === WORKFLOW_MODULE_COMPONENT_UID) &&
      targetUid === COURSE_UID &&
      excludeCourseIds
    ) {
      const excludeFilter = getExcludeCourseFilter(excludeCourseIds);
      if (excludeFilter) {
        ctx.state._workflowCourseExcludeFilter = { uid: COURSE_UID, filter: excludeFilter };
      }
    }

    let scopedRelationFilter = null;
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._relationCompanyFilter?.filter);
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._departmentCompanyFilter?.filter);
    scopedRelationFilter = mergeFilterIfPresent(scopedRelationFilter, ctx.state._workflowCourseExcludeFilter?.filter);

    if (!scopedRelationFilter) {
      return runFindAvailableSafely(ctx, targetUid);
    }
    return findAvailableFallback(ctx, targetUid, scopedRelationFilter);
  };

  return plugin;
};
