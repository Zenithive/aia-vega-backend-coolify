'use strict';

const COURSE_WORKFLOW_UID = 'api::course-workflow.course-workflow';
const USER_UID = 'plugin::users-permissions.user';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';

function isOfflineModuleType(value) {
  return String(value || '').trim().toLowerCase() === 'offline';
}

function isOnlineModuleType(value) {
  return String(value || '').trim().toLowerCase() === 'online';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDisplayName(user) {
  return user?.username || user?.email || (user?.id != null ? `User #${user.id}` : null);
}

function buildOfflineModuleEntries(users, baseEntries) {
  const byUsername = new Map();
  for (const entry of Array.isArray(baseEntries) ? baseEntries : []) {
    const key = typeof entry?.username === 'string' ? entry.username.trim() : '';
    if (!key || byUsername.has(key)) continue;
    byUsername.set(key, entry);
  }

  const out = [];
  for (const user of users) {
    const username = getDisplayName(user);
    if (!username) continue;
    const existing = byUsername.get(username) || {};
    out.push({ ...existing, username });
  }

  return out;
}

function sameUsernameOrder(current, next) {
  const a = Array.isArray(current) ? current : [];
  const b = Array.isArray(next) ? next : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i]?.username || '') !== String(b[i]?.username || '')) return false;
  }
  return true;
}

function toWorkflowWhere(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.id != null) return { id: input.id };
  if (input.documentId) return { documentId: input.documentId };
  return null;
}

function getWorkflowFieldKey(strapi) {
  const attributes = strapi?.contentTypes?.[COURSE_WORKFLOW_UID]?.attributes || {};
  if (attributes.modules) return 'modules';
  if (attributes.workflow) return 'workflow';
  return 'modules';
}

async function loadWorkflow(strapi, workflowLike) {
  const where = toWorkflowWhere(workflowLike);
  if (!where) return null;

  const workflowFieldKey = getWorkflowFieldKey(strapi);

  return strapi.db.query(COURSE_WORKFLOW_UID).findOne({
    where,
    select: ['id', 'documentId'],
    populate: {
      company: { select: ['id', 'documentId'] },
      users_permissions_users: { select: ['id', 'documentId', 'username', 'email'] },
      [workflowFieldKey]: {
        populate: {
          course: { select: ['id', 'documentId'] },
          offline_module: true,
        },
      },
    },
  });
}

function getWorkflowModules(workflow) {
  if (Array.isArray(workflow?.modules)) return workflow.modules;
  return Array.isArray(workflow?.workflow) ? workflow.workflow : [];
}

function getWorkflowModuleKey(module, index) {
  if (module?.id != null) return `id:${module.id}`;
  if (module?.documentId) return `doc:${module.documentId}`;
  return `idx:${index}`;
}

function getCourseIdFromModule(module) {
  return module?.course?.id ?? null;
}

async function getExistingIndividualAssignmentsForCourse(strapi, courseId) {
  const out = new Map();
  if (!courseId) return out;

  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: {
        assignment_target_type: 'Individual',
        courses: { id: Number(courseId) },
      },
      populate: { individual_user: { select: ['id'] } },
      limit: 10000,
    });

    for (const row of existing || []) {
      const users = Array.isArray(row?.individual_user) ? row.individual_user : (row?.individual_user ? [row.individual_user] : []);
      for (const user of users) {
        if (user?.id == null) continue;
        const userId = Number(user.id);
        const bucket = out.get(userId);
        if (bucket) {
          bucket.push(row);
        } else {
          out.set(userId, [row]);
        }
      }
    }
  } catch (e) {
    strapi.log.warn('[course-workflow] failed loading existing individual assignments:', e?.message || e);
  }

  return out;
}

async function syncOnlineAssignmentsForWorkflow(strapi, workflowLike) {
  let workflow = await loadWorkflow(strapi, workflowLike);
  if (!workflow) return;

  let users = await getSelectedUsersForWorkflow(strapi, workflow);
  if (users.length === 0) {
    // In some flows relation updates are applied right after workflow save.
    await sleep(200);
    workflow = await loadWorkflow(strapi, workflow);
    if (!workflow) return;
    users = await getSelectedUsersForWorkflow(strapi, workflow);
  }

  if (users.length === 0) return;
  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);

  let created = 0;
  let updated = 0;
  const workflowModules = getWorkflowModules(workflow);

  for (const module of workflowModules) {
    const courseId = getCourseIdFromModule(module);
    if (!courseId) continue;

    const dueDate = module?.due_date;
    if (!dueDate) {
      strapi.log.warn('[course-workflow] due_date is required for assignment creation (workflow=%s, module=%s)', workflow.id, module?.id ?? 'new');
      continue;
    }

    const existingAssignmentsByUserId = await getExistingIndividualAssignmentsForCourse(strapi, courseId);
    const parsedDueDate = new Date(dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      strapi.log.warn('[course-workflow] invalid due_date for assignment sync (workflow=%s, module=%s, due_date=%s)', workflow.id, module?.id ?? 'new', String(dueDate));
      continue;
    }
    const dueDateValue = parsedDueDate.toISOString().slice(0, 10);

    for (const user of users) {
      const userId = user?.id;
      if (userId == null) continue;

      const existingAssignments = existingAssignmentsByUserId.get(Number(userId)) || [];
      if (existingAssignments.length > 0) {
        try {
          const seen = new Set();
          for (const existingAssignment of existingAssignments) {
            const key = existingAssignment?.documentId
              ? `doc:${existingAssignment.documentId}`
              : existingAssignment?.id != null
                ? `id:${existingAssignment.id}`
                : null;
            if (!key || seen.has(key)) continue;
            seen.add(key);

            if (existingAssignment?.documentId) {
              await docService.update({
                documentId: existingAssignment.documentId,
                data: { due_date: dueDateValue, active: 'published' },
                status: 'published',
              });
            } else if (existingAssignment?.id != null) {
              await strapi.db.query(COURSE_ASSIGNMENT_UID).update({
                where: { id: existingAssignment.id },
                data: { due_date: dueDateValue, active: 'published' },
              });
            }
          }
          updated++;
        } catch (e) {
          strapi.log.warn('[course-workflow] failed updating due_date for existing assignment (workflow=%s, module=%s, user=%s): %s', workflow.id, module?.id ?? 'new', userId, e?.message || String(e));
        }
        continue;
      }

      try {
        const companyId = workflow?.company?.id ?? null;
        await docService.create({
          data: {
            assignment_target_type: 'Individual',
            courses: { connect: [{ id: Number(courseId) }] },
            due_date: dueDateValue,
            active: 'published',
            individual_user: { connect: [{ id: Number(userId) }] },
            ...(companyId != null ? { company: { connect: [{ id: Number(companyId) }] } } : {}),
          },
          status: 'published',
        });
        existingAssignmentsByUserId.set(Number(userId), [{ id: null }]);
        created++;
      } catch (e) {
        strapi.log.warn('[course-workflow] failed creating workflow assignment (workflow=%s, module=%s, user=%s): %s', workflow.id, module?.id ?? 'new', userId, e?.message || String(e));
      }
    }
  }

  if (created > 0 || updated > 0) {
    strapi.log.info('[course-workflow] created %d and updated %d Individual course-assignment entries for workflow %s', created, updated, workflow.id);
  }
}

async function syncWorkflowAutomationForWorkflow(strapi, workflowLike) {
  await syncOfflineModuleForWorkflow(strapi, workflowLike);
  await syncOnlineAssignmentsForWorkflow(strapi, workflowLike);
}

async function loadUserByWhere(strapi, where) {
  if (!where || typeof where !== 'object') return null;
  return strapi.db.query(USER_UID).findOne({
    where,
    select: ['id', 'documentId'],
    populate: { course_workflow: { select: ['id', 'documentId'] } },
  });
}

function toWorkflowRef(value) {
  if (value == null) return null;
  if (typeof value === 'number') return { id: value };
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) && String(n) === String(value).trim() ? { id: n } : { documentId: value };
  }
  if (typeof value === 'object') {
    const id = value.id ?? null;
    const documentId = value.documentId ?? value.document_id ?? null;
    if (id != null) return { id };
    if (documentId) return { documentId };
  }
  return null;
}

async function getSelectedUsersForWorkflow(strapi, workflow) {
  if (!workflow?.id) return [];

  const populatedUsers = Array.isArray(workflow?.users_permissions_users)
    ? workflow.users_permissions_users
    : [];
  if (populatedUsers.length > 0) {
    return populatedUsers;
  }

  const users = await strapi.db.query(USER_UID).findMany({
    where: { course_workflow: workflow.id },
    select: ['id', 'documentId', 'username', 'email'],
    orderBy: { id: 'asc' },
  });

  return Array.isArray(users) ? users : [];
}

function buildSyncedWorkflowModules(workflowModules, users) {
  let changed = false;

  const nextModules = workflowModules.map((module) => {
    if (!isOfflineModuleType(module?.module_type)) return module;

    const currentOfflineModules = Array.isArray(module?.offline_module) ? module.offline_module : [];
    const desiredOfflineModules = buildOfflineModuleEntries(users, currentOfflineModules);

    if (sameUsernameOrder(currentOfflineModules, desiredOfflineModules)) {
      return module;
    }

    changed = true;
    return {
      ...module,
      offline_module: desiredOfflineModules,
    };
  });

  return { changed, nextModules };
}

async function syncOfflineModuleForWorkflow(strapi, workflowLike) {
  let workflow = await loadWorkflow(strapi, workflowLike);
  if (!workflow) return;
  const workflowFieldKey = getWorkflowFieldKey(strapi);

  let users = await getSelectedUsersForWorkflow(strapi, workflow);
  if (users.length === 0) {
    // In some flows relation updates are applied right after workflow save.
    await sleep(200);
    workflow = await loadWorkflow(strapi, workflow);
    if (!workflow) return;
    users = await getSelectedUsersForWorkflow(strapi, workflow);
  }


  // If still no users after retry, do NOT overwrite existing offline_module entries with empty arrays.
  if (users.length === 0) return;

  const workflowModules = getWorkflowModules(workflow);
  if (workflowModules.length === 0) return;

  const { changed, nextModules } = buildSyncedWorkflowModules(workflowModules, users);
  if (!changed) return;

  await strapi.db.query(COURSE_WORKFLOW_UID).update({
    where: { id: workflow.id },
    data: { [workflowFieldKey]: nextModules },
  });
}

async function syncWorkflowFromUserEvent(strapi, event) {
  const where = event?.params?.where;
  const data = event?.params?.data;

  const previousUser = event.action === 'beforeUpdate'
    ? await loadUserByWhere(strapi, where)
    : null;

  if (event.action === 'beforeUpdate') {
    event.state = event.state || {};
    event.state.previousWorkflowRef = toWorkflowRef(previousUser?.course_workflow);
    return;
  }

  const currentResult = event?.result;
  let currentUser = null;
  if (currentResult?.id != null) {
    currentUser = await loadUserByWhere(strapi, { id: currentResult.id });
  } else if (currentResult?.documentId) {
    currentUser = await loadUserByWhere(strapi, { documentId: currentResult.documentId });
  }

  const currentWorkflowRef = toWorkflowRef(currentUser?.course_workflow);
  const previousWorkflowRef = toWorkflowRef(event?.state?.previousWorkflowRef);

  const targets = [];
  const seen = new Set();
  for (const ref of [previousWorkflowRef, currentWorkflowRef, toWorkflowRef(data?.course_workflow)]) {
    const key = ref?.id != null ? `id:${ref.id}` : ref?.documentId ? `doc:${ref.documentId}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(ref);
  }

  for (const ref of targets) {
    await syncWorkflowAutomationForWorkflow(strapi, ref);
  }
}

function registerCourseWorkflowOfflineModuleSync(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_WORKFLOW_UID],
    async afterCreate(event) {
      try {
        await syncWorkflowAutomationForWorkflow(strapi, event?.result);
      } catch (e) {
        strapi.log.error('[course-workflow] offline module sync afterCreate failed:', e?.message || e);
      }
    },
    async afterUpdate(event) {
      try {
        await syncWorkflowAutomationForWorkflow(strapi, event?.result);
      } catch (e) {
        strapi.log.error('[course-workflow] offline module sync afterUpdate failed:', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [USER_UID],
    async beforeUpdate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user beforeUpdate sync prep failed:', e?.message || e);
      }
    },
    async afterCreate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user afterCreate sync failed:', e?.message || e);
      }
    },
    async afterUpdate(event) {
      try {
        await syncWorkflowFromUserEvent(strapi, event);
      } catch (e) {
        strapi.log.error('[course-workflow] user afterUpdate sync failed:', e?.message || e);
      }
    },
  });

  strapi.log.info('Course-workflow sync is enabled (Offline module + Online Individual assignments)');
}

module.exports = { registerCourseWorkflowOfflineModuleSync };
