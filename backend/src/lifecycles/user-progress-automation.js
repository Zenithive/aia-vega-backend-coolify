'use strict';

const USER_PROGRESS_UID = 'api::user-progress.user-progress';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const QUIZ_SUBMISSION_UID = 'api::quiz-submission.quiz-submission';

let _creatingSubEntries = false;
const _prevDueDateByAssignmentKey = new Map();
const _pendingDueDateChangeDocumentIds = new Set();
const _dueDateNotificationSentDocumentIds = new Set();

function hasDueDateChangePending(documentId) {
  return _pendingDueDateChangeDocumentIds.has(String(documentId || ''));
}

function consumeDueDateChangeForDocument(documentId) {
  const key = String(documentId || '');
  if (!_pendingDueDateChangeDocumentIds.has(key)) return false;
  _pendingDueDateChangeDocumentIds.delete(key);
  return true;
}

async function captureCourseAssignmentDueDateChange(strapi, data, where) {
  if (_creatingSubEntries || !data || data.due_date === undefined) return;

  const existing = await loadAssignmentFromWhere(strapi, where);
  if (!existing) return;

  const key = getAssignmentLifecycleKey(existing);
  if (!key) return;

  const previousDueDate = formatDueDateValue(existing.due_date);
  const nextDueDate = formatDueDateValue(data.due_date);
  _prevDueDateByAssignmentKey.set(key, previousDueDate);

  if (nextDueDate !== previousDueDate && existing.documentId) {
    _pendingDueDateChangeDocumentIds.add(String(existing.documentId));
    strapi.log.info(
      'user-progress-automation: due_date change captured for documentId=%s (%s -> %s)',
      existing.documentId,
      previousDueDate || 'n/a',
      nextDueDate || 'n/a'
    );
  }
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

async function getPreviousPublishedDueDate(strapi, result) {
  const documentId = result?.documentId;
  const rowId = result?.id;
  if (!documentId || rowId == null) return null;

  try {
    const siblings = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: {
        documentId: String(documentId),
        id: { $ne: Number(rowId) },
        publishedAt: { $notNull: true },
      },
      select: ['due_date'],
      orderBy: { updatedAt: 'desc' },
      limit: 1,
    });
    return siblings[0]?.due_date ?? null;
  } catch {
    return null;
  }
}


async function isRepublicationAfterEdit(strapi, result) {
  const documentId = result?.documentId;
  const rowId = result?.id;
  if (!documentId || rowId == null) return false;

  if (hasDueDateChangePending(documentId)) return true;

  try {
    const siblings = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: {
        documentId: String(documentId),
        id: { $ne: Number(rowId) },
      },
      select: ['id', 'publishedAt'],
    });
    if (!Array.isArray(siblings) || siblings.length === 0) return false;

    // First publish: published row + single draft sibling only.
    if (siblings.length === 1 && !siblings[0].publishedAt) return false;

    if (siblings.some((row) => row.publishedAt)) return true;
    return siblings.length > 1;
  } catch {
    return false;
  }
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

async function sendDueDateChangedForAssignment(strapi, result, params = {}) {
  const documentId = String(result?.documentId || '');
  if (documentId && _dueDateNotificationSentDocumentIds.has(documentId)) {
    strapi.log.info(
      'user-progress-automation: skip duplicate due_date_changed for documentId=%s',
      documentId
    );
    return false;
  }

  const payload = await resolveAssignmentNotificationPayload(strapi, result, params);
  if (!payload?.courseId || !payload?.userIds?.length) return false;

  payload.userIds = [...new Set(payload.userIds)];
  payload.due_date = params?.data?.due_date ?? result?.due_date;
  await sendDueDateChangedNotifications(strapi, result, payload);

  if (documentId) {
    _dueDateNotificationSentDocumentIds.add(documentId);
    setTimeout(() => _dueDateNotificationSentDocumentIds.delete(documentId), 10000);
  }
  return true;
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

async function loadAssignmentFromWhere(strapi, where) {
  if (!where || typeof where !== 'object') return null;
  if (where.id != null) return loadAssignment(strapi, where.id);
  if (where.documentId != null) return loadAssignment(strapi, where.documentId);
  return null;
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
    active: data.active !== false,
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
    return { courseId: null, userIds: [], due_date: null, active: true, targetType: null };
  }
  const coursesField = assignment.courses ?? assignment.course;
  if (!coursesField) {
    strapi.log.warn('user-progress-automation: assignment has no course', { assignmentId });
    return { courseId: null, courseIds: [], userIds: [], due_date: null, active: true, targetType: null };
  }
  const courseId = getCourseId(coursesField);
  const courseIds = getAllCourseIds(coursesField);
  if (!courseId) return { courseId: null, courseIds: [], userIds: [], due_date: assignment.due_date, active: assignment.active, targetType: assignment.assignment_target_type };

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
    active: assignment.active,
    targetType,
    company: assignment.company,
  };
}

async function createCourseAssignmentEntries(strapi, courseId, userIds, dueDate, active, companyRaw) {
  if (!courseId || !Array.isArray(userIds) || userIds.length === 0) return;
  const due = dueDate instanceof Date ? dueDate : (dueDate ? new Date(dueDate) : new Date());
  const dueValue = due.toISOString().slice(0, 10);
  const activeValue = active === 'unpublished' ? 'unpublished' : 'published';
  
  const existingByUserId = new Map();
  try {
    const existing = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: { assignment_target_type: 'Individual', courses: { id: Number(courseId) } },
      populate: { individual_user: true },
      limit: 10000,
    });
    (existing || []).forEach((a) => {
      const users = Array.isArray(a?.individual_user) ? a.individual_user : (a?.individual_user ? [a.individual_user] : []);
      users.forEach((u) => {
        const keys = [];
        if (u?.id != null) keys.push(String(u.id));
        if (u?.documentId != null) keys.push(String(u.documentId));

        keys.forEach((key) => {
          const bucket = existingByUserId.get(key);
          if (bucket) {
            bucket.push(a);
          } else {
            existingByUserId.set(key, [a]);
          }
        });
      });
    });
  } catch (_) {}
  
  const docService = strapi.documents(COURSE_ASSIGNMENT_UID);
  let created = 0;
  let updated = 0;
  _creatingSubEntries = true;
  try {
    for (const userId of userIds) {
      const existingAssignments = existingByUserId.get(String(userId)) || [];
      
      if (existingAssignments.length > 0) {
        // Update due_date instead of skipping
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
                data: { due_date: dueValue, active: activeValue },
                status: 'published',
              });
            } else if (existingAssignment?.id != null) {
              await strapi.db.query(COURSE_ASSIGNMENT_UID).update({
                where: { id: existingAssignment.id },
                data: { due_date: dueValue, active: activeValue },
              });
            }
          }
          updated++;
          strapi.log.info('Updated due_date for existing course-assignment (userId=%s, courseId=%s, newDueDate=%s)', userId, courseId, due.toISOString());
        } catch (e) {
          strapi.log.warn('Failed to update due_date for course-assignment (userId=%s):', userId, e?.message || String(e));
        }
        continue;
      }
      
      // Create new entry if user doesn't have this course yet
      try {
        const companyId = companyRaw?.id ?? (Array.isArray(companyRaw?.connect) ? companyRaw.connect[0]?.id : null);
        await docService.create({
          data: {
            assignment_target_type: 'Individual',
            courses: { connect: [{ id: Number(courseId) }] },
            due_date: dueValue,
            active: activeValue,
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
  if (created > 0 || updated > 0) {
    strapi.log.info('user-progress-automation: created %d individual course-assignment entries, updated %d entries with new due_date', created, updated);
  }
}

/**
 * Create user-progress (Not_started) for each user. Uses Document Service so entries appear in admin (Strapi 5).
 */
async function createUserProgressEntries(strapi, courseId, userIds) {
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
 * When a new course-assignment is created for a course:
 *  1. Find all OTHER published assignments for that same course (excluding the new one).
 *  2. Mark them active='unpublished'.
 *  3. Collect users covered by those OLD assignments who are NOT in the new assignment's user list.
 *  4. Send those removed users a professional notification.
 */
async function autoUnpublishOldAssignmentsForCourse(strapi, numericCourseId, newAssignmentId, newAssignmentDocumentId, newUserIds, notifUtil) {
  const LOG = '[course-assignment-unpublish]';

  // Build the exclusion condition.
  // In Strapi v5 draftAndPublish, one "document" has TWO db rows (draft + published)
  // with different numeric ids but the same documentId.
  // We must exclude ALL rows belonging to the new document, not just the one row
  // returned in result.id — otherwise the draft row gets matched and unpublished too.
  //
  // Strategy: use documentId exclusion if available, plus exclude by id as fallback.
  // Also exclude any row with id >= newAssignmentId to avoid race conditions where
  // the new row is still being processed.
  let excludeWhere;
  if (newAssignmentDocumentId) {
    // Get ALL row ids that belong to this new document (draft + published)
    let allRowsOfNewDoc = [];
    try {
      allRowsOfNewDoc = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
        where: { documentId: newAssignmentDocumentId },
        select: ['id'],
      });
    } catch (_) {}
    const idsToExclude = [...new Set([
      newAssignmentId,
      ...allRowsOfNewDoc.map((r) => r.id).filter(Boolean),
    ])];
    excludeWhere = { id: { $notIn: idsToExclude } };
  } else {
    excludeWhere = { id: { $ne: newAssignmentId } };
  }

  // Find all OTHER published Individual assignments for this course
  let oldAssignments = [];
  try {
    // Build where clause with all exclusions combined
    const oldWhere = Object.assign(
      {},
      excludeWhere,
      { active: 'published', courses: { id: numericCourseId } },
      newAssignmentDocumentId ? { documentId: { $ne: newAssignmentDocumentId } } : {}
    );
    oldAssignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
      where: oldWhere,
      populate: {
        individual_user: { select: ['id', 'email'] },
        departments:     { select: ['name'] },
        work_locations:  { select: ['name'] },
        company:         { select: ['name'] },
      },
      limit: 1000,
    });
  } catch (e) {
    strapi.log.warn(`${LOG} failed fetching old assignments courseId=${numericCourseId}: ${e?.message || e}`);
    return;
  }

  if (oldAssignments.length === 0) {
    strapi.log.info(`${LOG} no old published assignments found for courseId=${numericCourseId} (newAssignmentId=${newAssignmentId})`);
    return;
  }

  strapi.log.info(`${LOG} found ${oldAssignments.length} old assignment rows for courseId=${numericCourseId}`);

  // Deduplicate by documentId — db.query returns both draft and published rows
  // for the same Strapi v5 document. We only need to process each document once.
  const seenDocIds = new Set();
  const uniqueOldAssignments = [];
  for (const a of oldAssignments) {
    const key = a.documentId ? `doc:${a.documentId}` : `id:${a.id}`;
    if (seenDocIds.has(key)) continue;
    seenDocIds.add(key);
    uniqueOldAssignments.push(a);
  }

  strapi.log.info(`${LOG} unique old assignments: ${uniqueOldAssignments.length}`);

  // Build set of user IDs in the NEW assignment for fast lookup
  const newUserIdSet = new Set(newUserIds.map((id) => Number(id)));
  strapi.log.info(`${LOG} new assignment has ${newUserIdSet.size} users: [${[...newUserIdSet].join(',')}]`);

  // STEP 1: Collect removed users BEFORE marking assignments unpublished
  const removedUserMap = new Map(); // userId → { id, email }
  const removedUserIds = [];
  for (const oldAssignment of uniqueOldAssignments) {
    strapi.log.info(`${LOG} checking old assignment id=${oldAssignment.id} type=${oldAssignment.assignment_target_type} users=${JSON.stringify((oldAssignment.individual_user || []).map(u => u?.id))}`);
    if (oldAssignment.assignment_target_type === 'Individual') {
      const users = Array.isArray(oldAssignment.individual_user) ? oldAssignment.individual_user : [];
      for (const u of users) {
        const uid = Number(u?.id);
        if (!uid) continue;
        if (!newUserIdSet.has(uid) && !removedUserMap.has(uid)) {
          removedUserMap.set(uid, { id: uid, email: u.email || null });
          removedUserIds.push(uid);
        }
      }
    }
  }

  strapi.log.info(`${LOG} removed users before DB fetch: ${removedUserIds.length} ids=[${removedUserIds.join(',')}]`);

  // Fetch full user details (id + email) directly — relation populate may not return email
  if (removedUserIds.length > 0) {
    try {
      const fullUsers = await strapi.db.query('plugin::users-permissions.user').findMany({
        where: { id: { $in: removedUserIds } },
        select: ['id', 'email', 'username'],
      });
      strapi.log.info(`${LOG} fetched ${fullUsers.length} full user records for removed users`);
      for (const u of (fullUsers || [])) {
        if (u?.id) {
          removedUserMap.set(Number(u.id), { id: Number(u.id), email: u.email || null });
        }
      }
    } catch (e) {
      strapi.log.warn(`${LOG} failed fetching removed user details: ${e?.message || e}`);
    }
  }

  // STEP 2: Send notification to removed users BEFORE marking assignments unpublished
  if (removedUserMap.size > 0) {
    let courseTitle = 'a course';
    try {
      const course = await strapi.db.query(COURSE_UID).findOne({
        where: { id: numericCourseId },
        select: ['title'],
      });
      if (course?.title) courseTitle = course.title;
    } catch (_) {}

    if (notifUtil) {
      try {
        const removedUsersForNotif = [...removedUserMap.values()];
        strapi.log.info(`${LOG} sending unenrollment notification to ${removedUsersForNotif.length} user(s): ${JSON.stringify(removedUsersForNotif.map(u => u.id))}`);
        await notifUtil.sendNotification(
          'course_unassigned',
          'Course Enrollment Update',
          `You are no longer eligible for "${courseTitle}". Your enrollment has been updated. Please contact your administrator if you have any questions.`,
          removedUsersForNotif,
          { courseId: numericCourseId },
          []
        );
        strapi.log.info(`${LOG} unenrollment notification sent to ${removedUsersForNotif.length} user(s) for courseId=${numericCourseId}`);
      } catch (notifErr) {
        strapi.log.warn(`${LOG} notification failed: ${notifErr?.message || notifErr}`);
      }
    } else {
      strapi.log.warn(`${LOG} notifUtil not available — skipping notification`);
    }
  } else {
    strapi.log.info(`${LOG} no removed users to notify for courseId=${numericCourseId}`);
  }

  // STEP 3: Mark all old assignments as unpublished AFTER notification is sent
  for (const oldAssignment of uniqueOldAssignments) {
    try {
      if (oldAssignment.documentId) {
        await strapi.db.query(COURSE_ASSIGNMENT_UID).updateMany({
          where: { documentId: oldAssignment.documentId },
          data: { active: 'unpublished' },
        });
      } else {
        await strapi.db.query(COURSE_ASSIGNMENT_UID).updateMany({
          where: { id: oldAssignment.id },
          data: { active: 'unpublished' },
        });
      }
      strapi.log.info(`${LOG} marked assignment documentId=${oldAssignment.documentId ?? oldAssignment.id} as unpublished`);
    } catch (e) {
      strapi.log.warn(`${LOG} failed unpublishing assignment id=${oldAssignment.id}: ${e?.message || e}`);
    }
  }
}

function registerUserProgressLifecycles(strapi) {
  strapi.db.lifecycles.subscribe({
    models: [COURSE_ASSIGNMENT_UID],

    async beforeUpdate(event) {
      if (_creatingSubEntries) return;
      try {
        await captureCourseAssignmentDueDateChange(strapi, event.params?.data, event.params?.where);
      } catch (e) {
        strapi.log.warn('user-progress-automation (course-assignment beforeUpdate):', e?.message || e);
      }
    },

    async afterCreate(event) {
      try {
        const { result, params = {} } = event;

        if (!result.publishedAt && !result.published_at) return;

        if (result?.assignment_target_type === 'Individual' && _creatingSubEntries) return;

        const isDueDateEdit = await isRepublicationAfterEdit(strapi, result);
        if (isDueDateEdit) {
          const hadPendingDueDateChange = hasDueDateChangePending(result?.documentId);
          consumeDueDateChangeForDocument(result?.documentId);

          const newDueDate = formatDueDateValue(params.data?.due_date ?? result?.due_date);
          const previousDueDate = formatDueDateValue(await getPreviousPublishedDueDate(strapi, result));
          if (previousDueDate && previousDueDate === newDueDate && !hadPendingDueDateChange) {
            strapi.log.info(
              'user-progress-automation: existing assignment republish with unchanged due_date — skip notification (documentId=%s)',
              result?.documentId ?? 'n/a'
            );
            return;
          }

          strapi.log.info(
            'user-progress-automation: existing assignment update detected — sending due_date_changed only (documentId=%s)',
            result?.documentId ?? 'n/a'
          );
          await sendDueDateChangedForAssignment(strapi, result, params);
          return;
        }

        const assignmentId = result.id ?? result.documentId;
        let payload = null;
        if (params.data) {
          payload = await getAssignedUserIdsFromParams(strapi, params, result);
        }
        if (!payload || !payload.userIds || payload.userIds.length === 0) {
          if (assignmentId != null) {
            await new Promise((r) => setTimeout(r, 200));
            payload = await getAssignedUserIds(strapi, assignmentId);
          }
        }
        let { courseId, courseIds, userIds, due_date, active, targetType } = payload || {};
        if (!courseId || !userIds || userIds.length === 0) {
          if (assignmentId == null) strapi.log.warn('user-progress-automation: afterCreate no id/documentId', result);
          return;
        }
        userIds = [...new Set(userIds)];

        const allCourseIds = (Array.isArray(courseIds) && courseIds.length > 0) ? [...new Set(courseIds)] : [courseId];
        const notifUtil = strapi.utils?.notification;
        const levelMap = { Individual: 'individual', Department: 'department', Company: 'company', Location: 'work_location' };

        for (const rawCourseId of allCourseIds) {
          const courseTitle = await resolveCourseTitleForNotification(strapi, rawCourseId);
          await notifyAssignmentUsersForCourse(strapi, {
            type: 'course_assigned',
            title: 'Course Assigned',
            message: `"${courseTitle}" has been assigned to you.`,
            rawCourseId,
            userIds,
            meta: { assignedBy: null, level: levelMap[targetType] || targetType },
            targetType,
            excludeCompletedUsers: false,
          });

          const numericCourseId = await resolveCourseIdForDb(strapi, rawCourseId);
          if (!numericCourseId) continue;
          await createUserProgressEntries(strapi, numericCourseId, userIds);
          if (targetType !== 'Individual') {
            await createCourseAssignmentEntries(strapi, numericCourseId, userIds, due_date, active, payload?.company);
          }

          try {
            await new Promise((r) => setTimeout(r, 300));
            await autoUnpublishOldAssignmentsForCourse(
              strapi,
              numericCourseId,
              result.id,
              result.documentId,
              userIds,
              notifUtil
            );
          } catch (unpubErr) {
            strapi.log.error(
              'user-progress-automation: autoUnpublishOldAssignments failed courseId=%s: %s',
              numericCourseId, unpubErr?.message || unpubErr
            );
          }
        }
      } catch (e) {
        strapi.log.error('user-progress-automation (course-assignment afterCreate):', e?.message || e);
      }
    },

    async afterUpdate(event) {
      if (_creatingSubEntries) return;

      try {
        const { result, params = {} } = event;
        if (!result?.publishedAt && !result?.published_at) return;

        const key = getAssignmentLifecycleKey(result);
        const previousDueDate = key ? _prevDueDateByAssignmentKey.get(key) : undefined;
        if (key) _prevDueDateByAssignmentKey.delete(key);

        const pendingDueDateEdit = hasDueDateChangePending(result?.documentId);
        const newDueDate = formatDueDateValue(params.data?.due_date ?? result?.due_date);
        const dueDateChanged = pendingDueDateEdit
          || (previousDueDate !== undefined && previousDueDate !== newDueDate);

        if (!dueDateChanged) return;

        consumeDueDateChangeForDocument(result?.documentId);

        strapi.log.info(
          'user-progress-automation: due_date changed on published entry (documentId=%s, %s -> %s)',
          result?.documentId ?? 'n/a',
          previousDueDate || 'n/a',
          newDueDate || 'n/a'
        );

        await sendDueDateChangedForAssignment(strapi, result, params);
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
        const userId = getUserId(result.submitted_by) ?? result.submitted_by_id;
        const courseId = getCourseId(result.course) ?? result.course_id;
        const passed = result.passed === true;
        if (!userId || !courseId) return;

        const numCourseId = await resolveCourseIdForDb(strapi, courseId);
        if (!numCourseId) return;

        const progress = await strapi.db.query(USER_PROGRESS_UID).findOne({
          where: { user: userId, course: numCourseId },
        });
        if (!progress) return;

        // Fetch course for module count + feedback compulsory flag
        const course = await strapi.db.query(COURSE_UID).findOne({
          where: { id: numCourseId },
          populate: { modules: true, feedback: true },
        });
        // Filter modules by the user's selected language
        const effectiveLang = progress.selected_language ?? null;
        const allModules = Array.isArray(course?.modules) ? course.modules : [];
        const langNorm = effectiveLang ? effectiveLang.trim().toLowerCase() : null;
        const langModules = langNorm
          ? allModules.filter((m) => (m.language || '').trim().toLowerCase() === langNorm)
          : allModules;
        const totalModules = (langModules.length > 0 ? langModules : allModules).length;
        const completedModules = Array.isArray(progress.completed_modules) ? progress.completed_modules : [];
        const modulePct = totalModules > 0 ? Math.round((completedModules.length / totalModules) * 90) : 0;
        // Quiz = 10% always; feedback has no weight → passing quiz completes the course
        const quizPct = 10;
        const now = new Date();

        let updateData;
        if (passed) {
          // Quiz passed → course complete at modulePct + 10%
          updateData = {
            progress_status: 'Completed',
            progress_percentage: modulePct + quizPct,
            completed_at: now,
            last_accessed_at: now,
            certificate_issued: true,
          };
        } else {
          // Failed: keep module-only percentage
          updateData = {
            progress_status: 'Failed',
            progress_percentage: modulePct,
            completed_at: null,
            last_accessed_at: now,
          };
        }

        await strapi.db.query(USER_PROGRESS_UID).update({
          where: { id: progress.id },
          data: updateData,
        });
      } catch (e) {
        strapi.log.error('user-progress-automation (quiz-submission afterCreate):', e?.message || e);
      }
    },
  });

  strapi.log.info('User-progress automation: course-assignment → Not_started; quiz-submission → In_progress/Failed');
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
    let { courseId, userIds, due_date, active, targetType } = payload || {};
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
    await createUserProgressEntries(strapi, courseId, userIds);
    if (targetType !== 'Individual') {
      await createCourseAssignmentEntries(strapi, courseId, userIds, due_date, active);
    }
    strapi.log.info('user-progress-automation: processCourseAssignmentCreate done');
  } catch (e) {
    strapi.log.error('user-progress-automation processCourseAssignmentCreate:', e?.message || e);
  }
}

module.exports = { registerUserProgressLifecycles, processCourseAssignmentCreate, captureCourseAssignmentDueDateChange };
