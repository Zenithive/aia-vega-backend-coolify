//@ts-nocheck
'use strict';

const { recomputeProgress, ensureOfflineCompletionEntries, loadProgress } = require('../utils/course-modules');

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';

let _creatingSubEntries = false;
// Pre-existing learners must have their due date backfilled before any assignment is diffed against it.
let _backfillPromise = Promise.resolve();

// Admin checkbox on course-assignment: also push the assignment due date to learners already assigned.
const UPDATE_EXISTING_FLAG = 'update_existing_learners_due_date';

// Lifecycles for the same assignment (afterCreate on publish, afterUpdate) are processed one at a time,
// so the per-learner diff in syncLearnerDueDates always reads the result of the previous run.
const _assignmentQueue = new Map();

function runSerializedForAssignment(key, task) {
  if (!key) return task();
  const previous = _assignmentQueue.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  _assignmentQueue.set(key, next);
  const cleanup = () => {
    if (_assignmentQueue.get(key) === next) _assignmentQueue.delete(key);
  };
  next.then(cleanup, cleanup);
  return next;
}

function formatDueDateValue(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).trim();
  return d.toISOString().slice(0, 10);
}

function formatDueDateForDisplay(value) {
  const normalized = formatDueDateValue(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return normalized;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = months[Number(month) - 1] || month;
  return `${day} ${monthLabel} ${year}`;
}

function getAssignmentLifecycleKey(record) {
  if (!record) return '';
  return String(record.documentId ?? record.id ?? '');
}

async function resolveAssignmentNotificationPayload(strapi, result, params = {}) {
  const assignmentId = result?.id ?? result?.documentId;
  let payload = null;
  if (params?.data) {
    payload = await getAssignedUserIdsFromParams(strapi, params, result);
  }
  if (!payload || !payload.userIds || payload.userIds.length === 0) {
    if (assignmentId != null) {
      await new Promise((r) => setTimeout(r, 200));
      payload = await getAssignedUserIds(strapi, assignmentId);
    }
  }
  return payload;
}

/**
 * The learner's own due date lives on their user-progress row (user + course).
 * A learner with no row, or a row without due_date, has not been assigned yet → gets the assignment due date.
 * A learner who already has a due_date keeps it, unless the admin ticked "update existing learners".
 * Returns who was newly assigned and whose due date actually changed, so notifications go only to them.
 */
async function syncLearnerDueDates(strapi, courseId, userIds, dueDate, { applyToExisting = false } = {}) {
  const outcome = { newlyAssignedUserIds: [], dueDateChangedUserIds: [] };
  const dueValue = formatDueDateValue(dueDate);
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!courseId || ids.length === 0) return outcome;

  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: { course: Number(courseId), user: { $in: ids }, publishedAt: { $notNull: true } },
    select: ['id', 'documentId', 'due_date'],
    populate: { user: { select: ['id'] } },
  });

  const rowsByUserId = new Map();
  for (const row of rows || []) {
    const uid = Number(row.user?.id ?? row.user);
    if (!uid) continue;
    if (!rowsByUserId.has(uid)) rowsByUserId.set(uid, []);
    rowsByUserId.get(uid).push(row);
  }

  const missingUserIds = ids.filter((id) => !rowsByUserId.has(id));
  if (missingUserIds.length > 0) {
    await createUserProgressEntries(strapi, courseId, missingUserIds, dueValue);
    outcome.newlyAssignedUserIds.push(...missingUserIds);
  }

  const toSet = [];
  for (const [uid, userRows] of rowsByUserId) {
    const current = formatDueDateValue(userRows.find((r) => r.due_date)?.due_date);
    if (!current) {
      toSet.push(...userRows);
      outcome.newlyAssignedUserIds.push(uid);
    } else if (applyToExisting && dueValue && current !== dueValue) {
      toSet.push(...userRows);
      outcome.dueDateChangedUserIds.push(uid);
    }
  }

  const documentIds = [...new Set(toSet.map((r) => r.documentId).filter(Boolean))];
  if (dueValue && documentIds.length > 0) {
    // updateMany covers both draft and published rows of each progress document.
    await strapi.db.query(USER_PROGRESS_UID).updateMany({
      where: { documentId: { $in: documentIds } },
      data: { due_date: dueValue },
    });
  }

  strapi.log.info(
    'user-progress-automation: learner due dates synced courseId=%s due=%s newlyAssigned=%d changed=%d untouched=%d',
    courseId,
    dueValue || 'n/a',
    outcome.newlyAssignedUserIds.length,
    outcome.dueDateChangedUserIds.length,
    ids.length - outcome.newlyAssignedUserIds.length - outcome.dueDateChangedUserIds.length
  );
  return outcome;
}

async function clearUpdateExistingFlag(strapi, result) {
  const where = result?.documentId ? { documentId: String(result.documentId) } : { id: result?.id };
  if (where.id == null && !where.documentId) return;
  try {
    // updateMany does not re-trigger afterUpdate, and resets both draft and published rows.
    await strapi.db.query(COURSE_ASSIGNMENT_UID).updateMany({ where, data: { [UPDATE_EXISTING_FLAG]: false } });
  } catch (e) {
    strapi.log.warn('user-progress-automation: failed to reset %s: %s', UPDATE_EXISTING_FLAG, e?.message || e);
  }
}

/**
 * Applies a published course-assignment to its learners:
 *  - newly added learners → user-progress with the assignment due date + "Course Assigned"
 *  - existing learners    → untouched, unless UPDATE_EXISTING_FLAG is ticked → "Due Date Updated"
 *                           only for learners whose stored due date actually differs.
 */
async function processPublishedAssignment(strapi, result, params = {}, { payload = null } = {}) {
  await _backfillPromise;
  payload = payload || await resolveAssignmentNotificationPayload(strapi, result, params);
  let { courseId, courseIds, userIds, targetType } = payload || {};
  if (!courseId || !userIds || userIds.length === 0) {
    if (result?.id == null && result?.documentId == null) strapi.log.warn('user-progress-automation: assignment has no id/documentId', result);
    return;
  }
  userIds = [...new Set(userIds)];

  const dueDate = params?.data?.due_date ?? result?.due_date ?? payload?.due_date;
  const applyToExisting = Boolean(params?.data?.[UPDATE_EXISTING_FLAG] ?? result?.[UPDATE_EXISTING_FLAG]);
  const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];
  const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };

  for (const rawCourseId of allCourseIds) {
    const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
    if (!numericCourseId) continue;

    const { newlyAssignedUserIds, dueDateChangedUserIds } = await syncLearnerDueDates(
      strapi, numericCourseId, userIds, dueDate, { applyToExisting }
    );

    if (newlyAssignedUserIds.length > 0) {
      const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);
      await notifyAssignmentUsersForCourse(strapi, {
        type: 'course_assigned',
        title: 'Course Assigned',
        message: `"${courseTitle}" has been assigned to you.`,
        rawCourseId,
        userIds: newlyAssignedUserIds,
        meta: { assignedBy: null, level: levelMap[targetType] || targetType },
        targetType,
        excludeCompletedUsers: false,
      });
      await createOfflineCompletionEntries(strapi, numericCourseId, newlyAssignedUserIds);
    }

    if (dueDateChangedUserIds.length > 0) {
      await sendDueDateChangedNotifications(strapi, result, {
        courseId: rawCourseId,
        courseIds: [rawCourseId],
        userIds: dueDateChangedUserIds,
        due_date: dueDate,
        targetType,
      });
    }

    if (targetType !== 'Individual') {
      await createCourseAssignmentEntries(strapi, numericCourseId, userIds, dueDate, payload?.company);
    }
  }

  if (applyToExisting) await clearUpdateExistingFlag(strapi, result);
}

async function filterUsersNotCompleted(strapi, userIds, numericCourseId) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!normalizedIds.length || !numericCourseId) return [];

  try {
    const completedRows = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: {
        course: Number(numericCourseId),
        user: { $in: normalizedIds },
        progress_status: 'Completed',
      },
      select: ['id'],
      populate: { user: { select: ['id'] } },
    });
    const completedSet = new Set(
      (completedRows || [])
        .map((row) => row.user?.id ?? row.user)
        .filter((id) => id != null)
        .map(Number)
    );
    return normalizedIds.filter((id) => !completedSet.has(id));
  } catch (e) {
    strapi.log.warn('user-progress-automation: filterUsersNotCompleted failed:', e?.message || e);
    return normalizedIds;
  }
}

async function resolveCourseTitleForNotification(strapi, rawCourseId) {
  let courseTitle = 'A new course';
  try {
    const resolvedId = typeof rawCourseId === 'string' && isNaN(Number(rawCourseId)) ? null : Number(rawCourseId);
    const course = await strapi.db.query(COURSE_UID).findOne({
      where: resolvedId ? { id: resolvedId } : { documentId: rawCourseId },
      select: ['title'],
    });
    if (course?.title) courseTitle = course.title;
  } catch { /* keep default */ }
  return courseTitle;
}

async function notifyAssignmentUsersForCourse(strapi, {
  type,
  title,
  message,
  rawCourseId,
  userIds,
  meta = {},
  targetType = null,
  excludeCompletedUsers = true,
}) {
  const notifUtil = strapi.utils?.notification;
  if (!notifUtil || !rawCourseId || !Array.isArray(userIds) || userIds.length === 0) return;

  const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
  if (!numericCourseId) return;

  const recipientUserIds = excludeCompletedUsers
    ? await filterUsersNotCompleted(strapi, userIds, numericCourseId)
    : [...new Set((userIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!recipientUserIds.length) {
    strapi.log.info(
      'user-progress-automation: skip %s — no eligible users for courseId=%s',
      type,
      numericCourseId
    );
    return;
  }

  const usersWithEmail = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { id: { $in: recipientUserIds } },
    select: ['id', 'email'],
  });
  if (!usersWithEmail.length) return;

  const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };
  const enrichedMeta = {
    ...meta,
    courseId: rawCourseId,
    ...(targetType ? { level: levelMap[targetType] || targetType } : {}),
  };

  const emailEnabled = typeof notifUtil.isEmailEnabled === 'function' ? notifUtil.isEmailEnabled() : false;
  await notifUtil.sendNotification(
    type,
    title,
    message,
    usersWithEmail,
    enrichedMeta,
    [],
    { sendEmail: emailEnabled, sendSocket: true }
  );
}

async function sendDueDateChangedNotifications(strapi, result, payload) {
  const { courseId, courseIds, userIds, due_date, targetType } = payload || {};
  if (!userIds?.length) return;

  const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];
  const dueDateDisplay = formatDueDateForDisplay(due_date ?? result?.due_date);

  for (const rawCourseId of allCourseIds) {
    if (!rawCourseId) continue;
    const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);
    const message = dueDateDisplay
      ? `The due date for "${courseTitle}" has been updated to ${dueDateDisplay}.`
      : `The due date for "${courseTitle}" has been updated.`;

    await notifyAssignmentUsersForCourse(strapi, {
      type: 'due_date_changed',
      title: 'Course Due Date Updated',
      message,
      rawCourseId,
      userIds,
      meta: {
        dueDate: dueDateDisplay,
        newDueDate: dueDateDisplay,
        assignedBy: null,
      },
      targetType,
    });
  }
}

function getUserId(user) {
  if (!user) return null;
  return user.id ?? user.documentId ?? user.document_id;
}

function getCourseId(course) {
  if (course == null) return null;
  if (Array.isArray(course)) return course.length > 0 ? getCourseId(course[0]) : null;
  if (typeof course === 'number' && !Number.isNaN(course)) return course;
  if (typeof course === 'string' && course.length > 0) return course;
  return course.id ?? course.documentId ?? course.document_id ?? null;
}

function getAllCourseIds(courses) {
  if (courses == null) return [];
  if (Array.isArray(courses)) {
    return courses.map(getCourseId).filter(Boolean);
  }
  const single = getCourseId(courses);
  return single ? [single] : [];
}

function extractRelationIds(raw) {
  if (raw == null) return [];
  if (typeof raw === 'number') return [raw];
  if (typeof raw === 'string') return raw.length > 0 ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  if (typeof raw === 'object') {
    const arr = Array.isArray(raw.connect) ? raw.connect : Array.isArray(raw.set) ? raw.set : (raw.id != null ? [raw] : []);
    return arr.map((item) => (item && typeof item === 'object' ? (item.id ?? item.documentId) : item)).filter(Boolean);
  }
  return [];
}

const COURSE_UID = 'api::course.course';
async function resolveCourseIdForDb(strapi, courseId) {
  if (courseId == null) return null;
  const n = Number(courseId);
  if (!Number.isNaN(n) && n > 0) return n;
  if (typeof courseId === 'string' && courseId.length > 10) {
    const row = await strapi.db.query(COURSE_UID).findOne({ where: { documentId: courseId }, select: ['id'] });
    return row?.id ?? null;
  }
  return courseId;
}

function normalizeCompanyName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (lower === 'aia') return 'AIA';
  if (lower === 'vega') return 'Vega';
  return String(name || '').trim();
}

function extractCompanyNamesFromEntity(raw) {
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(items.map((item) => item?.name ?? item?.attributes?.name).filter(Boolean).map(normalizeCompanyName))];
}

async function resolveCompanyNames(strapi, rawCompany, fallbackCompany) {
  const relationIds = extractRelationIds(rawCompany);
  const numericIds = relationIds
    .filter((value) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(String(value))))
    .map(Number);
  const docIds = relationIds.filter((value) => typeof value === 'string' && value.length > 10);

  let companies = [];
  if (numericIds.length > 0) {
    const byId = await strapi.db.query('api::company.company').findMany({
      where: { id: { $in: numericIds } },
      select: ['name'],
    });
    companies = companies.concat(byId || []);
  }
  if (docIds.length > 0) {
    const byDocId = await strapi.db.query('api::company.company').findMany({
      where: { documentId: { $in: docIds } },
      select: ['name'],
    });
    (byDocId || []).forEach((company) => {
      if (company?.name && !companies.some((item) => item?.name === company.name)) companies.push(company);
    });
  }

  const names = companies.map((company) => normalizeCompanyName(company?.name)).filter(Boolean);
  if (names.length > 0) return [...new Set(names)];
  return extractCompanyNamesFromEntity(fallbackCompany);
}

function scopeUserWhere(where, companyNames) {
  if (!Array.isArray(companyNames) || companyNames.length === 0) return where;
  if (companyNames.length === 1) {
    return { ...where, company: companyNames[0] };
  }
  return {
    $and: [
      where,
      { $or: companyNames.map((name) => ({ company: name })) },
    ],
  };
}

async function getAssignedUserIdsFromParams(strapi, params, result) {
  const data = params?.data;
  if (!data) {
    strapi.log.debug('user-progress-automation: getAssignedUserIdsFromParams no params.data');
    return null;
  }
  const targetType = data.assignment_target_type || 'Company';
  const doc = result?.document ?? result;
  let courseId = getCourseId(data.courses) ?? getCourseId(data.course) ??
    getCourseId(doc?.courses) ?? getCourseId(doc?.course) ??
    getCourseId(result?.courses) ?? getCourseId(result?.course) ??
    doc?.course_id ?? result?.course_id;
  if (courseId == null) {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const ids = extractRelationIds(courseRaw);
      if (ids.length > 0) courseId = ids[0];
    }
  }
  let courseIds = [];
  {
    const courseRaw = data.courses ?? data.course;
    if (courseRaw != null) {
      const relIds = extractRelationIds(courseRaw);
      if (relIds.length > 0) courseIds = relIds;
    }
    if (courseIds.length === 0) {
      const fromResult = getAllCourseIds(doc?.courses) || getAllCourseIds(doc?.course) ||
        getAllCourseIds(result?.courses) || getAllCourseIds(result?.course);
      if (fromResult && fromResult.length > 0) courseIds = fromResult;
    }
    if (courseIds.length === 0 && courseId) courseIds = [courseId];
    if (!courseId && courseIds.length > 0) courseId = courseIds[0];
  }

  if (!courseId) {
    strapi.log.warn('user-progress-automation: getAssignedUserIdsFromParams no courseId', { hasCourseInData: !!data.course, hasCourseInResult: !!result?.course });
    return null;
  }

  const companyNames = await resolveCompanyNames(strapi, data.company ?? data.companies, result?.company ?? result?.companies);

  let userIds = [];
  if (targetType === 'Individual') {
    const raw = data.individual_user ?? data.individual_user_id;
    const extracted = extractRelationIds(raw);
    const numericIds = [];
    const docIds = [];
    for (const id of extracted) {
      if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(String(id)))) {
        numericIds.push(Number(id));
      } else if (typeof id === 'string' && id.length > 0) {
        docIds.push(id);
      }
    }
    if (docIds.length > 0) {
      try {
        const resolved = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { documentId: { $in: docIds } },
          select: ['id'],
        });
        (resolved || []).forEach((u) => { if (u.id) numericIds.push(u.id); });
      } catch (e) {
        strapi.log.warn('user-progress-automation: failed to resolve user documentIds', e?.message || e);
      }
    }

    if (companyNames.length > 0 && numericIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: [...new Set(numericIds)] } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    } else {
      userIds = [...new Set(numericIds)];
    }
  } else if (targetType === 'Department') {
    const ids = extractRelationIds(data.departments ?? data.departments_id);
    if (ids.length > 0) {
      const depts = await strapi.db.query('api::department.department').findMany({
        where: { id: { $in: ids.map(Number) } },
        select: ['name'],
      });
      const deptNames = (depts || []).map((d) => d.name).filter(Boolean);
      if (deptNames.length > 0) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: scopeUserWhere({ department: { $in: deptNames } }, companyNames),
          select: ['id'],
        });
        userIds = (users || []).map((u) => u.id).filter(Boolean);
      }
    }
  } else if (targetType === 'Location') {
    const ids = extractRelationIds(data.work_locations ?? data.unit_locations ?? data.work_locations_id ?? data.unit_locations_id);
    if (ids.length > 0) {
      const locs = await strapi.db.query('api::work-location.work-location').findMany({
        where: { id: { $in: ids.filter((x) => typeof x === 'number' || /^\d+$/.test(String(x))).map(Number) } },
        select: ['name'],
      });
      const locationNames = (locs || []).map((l) => l.name).filter(Boolean);
      if (locationNames.length > 0) {
        const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
        const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
        const userLists = await Promise.all([
          includeVega
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'Vega', working_location: { $in: locationNames } },
              select: ['id'],
            })
            : Promise.resolve([]),
          includeAia
            ? strapi.db.query('plugin::users-permissions.user').findMany({
              where: { company: 'AIA', branch: { $in: locationNames } },
              select: ['id'],
            })
            : Promise.resolve([]),
        ]);
        const idSet = new Set();
        userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
        userIds = [...idSet];
      }
    }
  } else if (targetType === 'Company') {
    // No target type selected (or explicitly Company): assign to all users of the selected company
    if (companyNames.length > 0) {
      for (const name of companyNames) {
        const users = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: { company: name },
          select: ['id'],
        });
        (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
      }
    } else {
      strapi.log.warn('user-progress-automation: Company fallback but no company resolved — skipping');
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIdsFromParams', { targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: data.due_date ?? result?.due_date,
    targetType,
    company: data.company ?? result?.company,
  };
}

async function loadAssignment(strapi, assignmentId) {
  if (assignmentId == null || assignmentId === '') return null;
  let assignment = null;
  const isNumeric = typeof assignmentId === 'number' || (typeof assignmentId === 'string' && /^\d+$/.test(assignmentId));
  if (isNumeric) {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { id: Number(assignmentId) },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    assignment = await strapi.db.query(COURSE_ASSIGNMENT_UID).findOne({
      where: { documentId: assignmentId },
      populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
    });
  }
  if (!assignment && typeof assignmentId === 'string') {
    try {
      const doc = await strapi.documents(COURSE_ASSIGNMENT_UID).findOne({
        documentId: assignmentId,
        populate: { courses: true, individual_user: true, departments: true, company: true, work_locations: true },
      });
      if (doc) assignment = doc;
    } catch (_) {}
  }
  return assignment;
}

async function getAssignedUserIds(strapi, assignmentId) {
  const assignment = await loadAssignment(strapi, assignmentId);
  if (!assignment) {
    strapi.log.warn('user-progress-automation: assignment not found', { assignmentId });
    return { courseId: null, userIds: [], due_date: null, targetType: null };
  }
  const coursesField = assignment.courses ?? assignment.course;
  if (!coursesField) {
    strapi.log.warn('user-progress-automation: assignment has no course', { assignmentId });
    return { courseId: null, courseIds: [], userIds: [], due_date: null, targetType: null };
  }
  const courseId = getCourseId(coursesField);
  const courseIds = getAllCourseIds(coursesField);
  if (!courseId) return { courseId: null, courseIds: [], userIds: [], due_date: assignment.due_date, targetType: assignment.assignment_target_type };

  const targetType = assignment.assignment_target_type || 'Company';
  const companyNames = await resolveCompanyNames(strapi, assignment.company ?? assignment.companies, assignment.company ?? assignment.companies);
  let userIds = [];

  if (targetType === 'Individual' && Array.isArray(assignment.individual_user)) {
    userIds = assignment.individual_user.map(getUserId).filter(Boolean);
    if (companyNames.length > 0 && userIds.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ id: { $in: userIds } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Department' && Array.isArray(assignment.departments)) {
    const deptNames = assignment.departments.map((d) => d?.name).filter(Boolean);
    if (deptNames.length > 0) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: scopeUserWhere({ department: { $in: deptNames } }, companyNames),
        select: ['id'],
      });
      userIds = (users || []).map((u) => u.id).filter(Boolean);
    }
  } else if (targetType === 'Location' && Array.isArray(assignment.work_locations ?? assignment.unit_locations) && (assignment.work_locations ?? assignment.unit_locations).length > 0) {
    const locationNames = (assignment.work_locations ?? assignment.unit_locations).map((l) => l?.name).filter(Boolean);
    if (locationNames.length > 0) {
      const includeVega = companyNames.length === 0 || companyNames.includes('Vega');
      const includeAia = companyNames.length === 0 || companyNames.includes('AIA');
      const userLists = await Promise.all([
        includeVega
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'Vega', working_location: { $in: locationNames } },
            select: ['id'],
          })
          : Promise.resolve([]),
        includeAia
          ? strapi.db.query('plugin::users-permissions.user').findMany({
            where: { company: 'AIA', branch: { $in: locationNames } },
            select: ['id'],
          })
          : Promise.resolve([]),
      ]);
      const idSet = new Set();
      userLists.flat().forEach((u) => { if (u?.id) idSet.add(u.id); });
      userIds = [...idSet];
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds', { assignmentId, targetType, userIdsCount: userIds.length });
  // --- Company / no-target-type fallback already handled by targetType defaulting to 'Company' above.
  // The Individual / Department / Location branches won't match, so we add the Company branch here. ---
  if (userIds.length === 0 && targetType === 'Company' && companyNames.length > 0) {
    for (const name of companyNames) {
      const users = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { company: name },
        select: ['id'],
      });
      (users || []).forEach((u) => { if (u.id && !userIds.includes(u.id)) userIds.push(u.id); });
    }
  }

  strapi.log.info('user-progress-automation: getAssignedUserIds (final)', { assignmentId, targetType, userIdsCount: userIds.length, courseIdsCount: courseIds.length });
  return {
    courseId,
    courseIds,
    userIds,
    due_date: assignment.due_date,
    targetType,
    company: assignment.company,
  };
}

async function createCourseAssignmentEntries(strapi, courseId, userIds, dueDate, companyRaw) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const due = dueDate instanceof Date ? dueDate : (dueDate ? new Date(dueDate) : new Date());
  const dueValue = due.toISOString().slice(0, 10);

  const existingUserKeys = new Set();
  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: { assignment_target_type: 'Individual', courses: { id: Number(courseId) } },
      populate: { individual_user: true },
      limit: 10000,
    });
    (existing || []).forEach((a) => {
      const users = Array.isArray(a?.individual_user) ? a.individual_user : (a?.individual_user ? [a.individual_user] : []);
      users.forEach((u) => {
        if (u?.id != null) existingUserKeys.add(String(u.id));
        if (u?.documentId != null) existingUserKeys.add(String(u.documentId));
      });
    });
  } catch (_) {}

  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);
  let created = 0;
  _creatingSubEntries = true;
  try {
    for (const userId of userIds) {
      // Learner already has an entry for this course: leave it (their due date lives on user-progress).
      if (existingUserKeys.has(String(userId))) continue;

      try {
        const companyId = companyRaw?.id ?? (Array.isArray(companyRaw?.connect) ? companyRaw.connect[0]?.id : null);
        await docService.create({
          data: {
            assignment_target_type: 'Individual',
            courses: { connect: [{ id: Number(courseId) }] },
            due_date: dueValue,
            individual_user: [userId],
            ...(companyId ? { company: { connect: [{ id: companyId }] } } : {}),
          },
          status: 'published',
        });
        created++;
      } catch (e) {
        strapi.log.warn('createCourseAssignmentEntries failed (userId=%s):', userId, e?.message || String(e));
      }
    }
  } finally {
    _creatingSubEntries = false;
  }
  if (created > 0) {
    strapi.log.info('user-progress-automation: created %d individual course-assignment entries', created);
  }
}

/**
 * Create user-progress (Not_started) for each user. Uses Document Service so entries appear in admin (Strapi 5).
 */
async function createUserProgressEntries(strapi, courseId, userIds, dueDate = null) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  userIds = [...new Set(userIds)]; // one user-progress per user per course
  const now = new Date();
  const docService = strapi.documents(USER_PROGRESS_UID);
  let created = 0;
  for (const userId of userIds) {
    try {
      let existing = null;
      try {
        existing = await docService.findFirst({
          filters: { user: { id: userId }, course: { id: courseId } },
          status: 'published',
        });
      } catch (_) {
        existing = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: courseId },
        });
      }
      if (existing) continue;
    } catch (_) {}
    try {
      await docService.create({
        data: {
          user: userId,
          course: courseId,
          progress_status: 'Not_started',
          progress_percentage: 0,
          completed_modules: [],
          last_accessed_at: now,
          time_spent_minutes: 0,
          certificate_issued: false,
          due_date: formatDueDateValue(dueDate) || null,
        },
        status: 'published',
      });
      created++;
    } catch (e) {
      strapi.log.warn('createUserProgressEntries failed (userId=%s):', userId, e?.message || String(e));
    }
  }
  if (created > 0) strapi.log.info('user-progress-automation: created %d user-progress entries', created);
}

/**
 * Create an offline-module-completion entry (no proof yet) per user for each offline module of the course,
 * so admins only fill in proof, remarks, completed_at and assessed_by. Courses without offline modules are skipped.
 */
async function createOfflineCompletionEntries(strapi, courseId, userIds) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  let changed = 0;
  for (const userId of [...new Set(userIds)]) {
    try {
      const progress = await loadProgress(strapi, userId, courseId);
      changed += await ensureOfflineCompletionEntries(strapi, { userId, courseId, language: progress?.selected_language });
    } catch (e) {
      strapi.log.warn('createOfflineCompletionEntries failed (userId=%s):', userId, e?.message || String(e));
    }
  }
  if (changed > 0) strapi.log.info('user-progress-automation: created/updated %d offline-module-completion entries', changed);
}

function registerUserProgressLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],

    // Strapi 5 publish (first publish and every republish) recreates the published row → afterCreate.
    async afterCreate(event) {
      try {
        const { result, params = {} } = event;

        if (!result.publishedAt && !result.published_at) return;

        if (result?.assignment_target_type === 'Individual' && _creatingSubEntries) return;

        await runSerializedForAssignment(getAssignmentLifecycleKey(result), () =>
          processPublishedAssignment(strapi, result, params)
        );
      } catch (e) {
        strapi.log.error('user-progress-automation (course-assignment afterCreate):', e?.message || e);
      }
    },

    // Direct update of the published row (API / document service with status published).
    async afterUpdate(event) {
      if (_creatingSubEntries) return;

      try {
        const { result, params = {} } = event;
        if (!result?.publishedAt && !result?.published_at) return;

        // params.data may hold only the changed fields here, so resolve learners from the saved row.
        await runSerializedForAssignment(getAssignmentLifecycleKey(result), async () => {
          const payload = result?.id != null ? await getAssignedUserIds(strapi, result.id) : null;
          await processPublishedAssignment(strapi, result, params, { payload });
        });
      } catch (e) {
        strapi.log.error('user-progress-automation (course-assignment afterUpdate):', e?.message || e);
      }
    },
  });

  strapi.db.lifecycles.subscribe({
    models: [QUIZ_SUBMISSION_UID],
    async afterCreate(event) {
      try {
        const { result } = event;
        let userId = getUserId(result.submitted_by) ?? result.submitted_by_id;
        let courseId = getCourseId(result.course) ?? result.course_id;
        if ((!userId || !courseId) && result?.id != null) {
          // The lifecycle result does not include relations; read them from the saved row.
          const row = await strapi.db.query(QUIZ_SUBMISSION_UID).findOne({
            where: { id: result.id },
            populate: { submitted_by: { select: ['id'] }, course: { select: ['id'] } },
          });
          userId = userId ?? row?.submitted_by?.id;
          courseId = courseId ?? row?.course?.id;
        }
        if (!userId || !courseId) return;

        const numCourseId = await resolveCourseIdForDb(strapi, courseId);
        if (!numCourseId) return;

        // Module quiz passed/failed → re-derive module completion, percentage and course status.
        await recomputeProgress(strapi, { userId: Number(userId), courseId: numCourseId });
      } catch (e) {
        strapi.log.error('user-progress-automation (quiz-submission afterCreate):', e?.message || e);
      }
    },
  });

  strapi.log.info('User-progress automation: course-assignment → Not_started; quiz-submission → In_progress/Failed');

  _backfillPromise = backfillLearnerDueDates(strapi).catch((e) => {
    strapi.log.error('user-progress-automation: learner due date backfill failed:', e?.message || e);
  });
}

const BACKFILL_STORE_KEY = 'learner_due_date_backfill_v1';

/**
 * One-time backfill for learners assigned before due dates were stored per learner: copies the due date of
 * their published assignment onto user-progress rows that have none. When several assignments cover the same
 * learner + course, the earliest due date wins (the rule the frontend used before).
 */
async function backfillLearnerDueDates(strapi) {
  const store = strapi.store({ type: 'core', name: 'user-progress-automation' });
  if (await store.get({ key: BACKFILL_STORE_KEY })) return;

  const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    where: { publishedAt: { $notNull: true }, due_date: { $notNull: true } },
    select: ['id'],
    limit: 100000,
  });

  const dueByLearnerCourse = new Map();
  for (const assignment of assignments || []) {
    const payload = await getAssignedUserIds(strapi, assignment.id);
    const dueValue = formatDueDateValue(payload?.due_date);
    if (!dueValue || !payload?.userIds?.length) continue;
    const courseIds = (payload.courseIds?.length ? payload.courseIds : [payload.courseId]).filter(Boolean);
    for (const rawCourseId of courseIds) {
      const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
      if (!numericCourseId) continue;
      for (const userId of payload.userIds) {
        const key = `${Number(userId)}:${Number(numericCourseId)}`;
        const current = dueByLearnerCourse.get(key);
        if (!current || dueValue < current) dueByLearnerCourse.set(key, dueValue);
      }
    }
  }

  const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
    where: { due_date: { $null: true } },
    select: ['id', 'documentId'],
    populate: { user: { select: ['id'] }, course: { select: ['id'] } },
    limit: 1000000,
  });

  const documentIdsByDue = new Map();
  for (const row of rows || []) {
    const key = `${Number(row.user?.id)}:${Number(row.course?.id)}`;
    const dueValue = dueByLearnerCourse.get(key);
    if (!dueValue || !row.documentId) continue;
    if (!documentIdsByDue.has(dueValue)) documentIdsByDue.set(dueValue, new Set());
    documentIdsByDue.get(dueValue).add(row.documentId);
  }

  let updated = 0;
  for (const [dueValue, documentIdSet] of documentIdsByDue) {
    const documentIds = [...documentIdSet];
    for (let i = 0; i < documentIds.length; i += 500) {
      const chunk = documentIds.slice(i, i + 500);
      await strapi.db.query(USER_PROGRESS_UID).updateMany({
        where: { documentId: { $in: chunk } },
        data: { due_date: dueValue },
      });
      updated += chunk.length;
    }
  }

  await store.set({ key: BACKFILL_STORE_KEY, value: { doneAt: new Date().toISOString(), updated } });
  strapi.log.info('user-progress-automation: learner due date backfill done (%d progress documents updated)', updated);
}

async function processCourseAssignmentCreate(strapi, params, result) {
  strapi.log.info('user-progress-automation: processCourseAssignmentCreate called');
  try {
    const doc = result?.document ?? result;
    const data = params?.data;
    let payload = null;
    if (data) {
      payload = await getAssignedUserIdsFromParams(strapi, { data }, doc);
    }
    if (!payload || !payload.userIds || payload.userIds.length === 0) {
      const assignmentId = doc?.id ?? doc?.documentId;
      strapi.log.info('user-progress-automation: no users from params, trying fallback load', { assignmentId, hasData: !!data });
      if (assignmentId != null) {
        await new Promise((r) => setTimeout(r, 300));
        payload = await getAssignedUserIds(strapi, assignmentId);
      }
    }
    let { courseId, userIds, due_date, targetType } = payload || {};
    if (!courseId || !userIds || userIds.length === 0) {
      strapi.log.warn('user-progress-automation: no users to create entries for', { courseId, userIdsCount: userIds?.length ?? 0, targetType });
      return;
    }
    userIds = [...new Set(userIds)]; // one user-progress per user
    courseId = await resolveCourseIdForDb(strapi, courseId);
    if (!courseId) {
      strapi.log.warn('user-progress-automation: could not resolve courseId for DB');
      return;
    }
    strapi.log.info('user-progress-automation: creating entries (%d users, courseId=%s, targetType=%s)', userIds.length, courseId, targetType);
    await createUserProgressEntries(strapi, courseId, userIds, due_date);
    await createOfflineCompletionEntries(strapi, courseId, userIds);
    if (targetType !== 'Individual') {
      await createCourseAssignmentEntries(strapi, courseId, userIds, due_date);
    }
    strapi.log.info('user-progress-automation: processCourseAssignmentCreate done');
  } catch (e) {
    strapi.log.error('user-progress-automation processCourseAssignmentCreate:', e?.message || e);
  }
}

module.exports = { registerUserProgressLifecycles, processCourseAssignmentCreate, sendDueDateChangedNotifications };
