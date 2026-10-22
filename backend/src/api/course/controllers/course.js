//@ts-nocheck
'use strict';

/**
 * course controller
 * List (find) and detail (findOne) are restricted to courses assigned to the logged-in user
 * via course-assignment (Individual, Department, Company, Location).
 * Location: AIA users use branch; Vega users use working_location.
 */

const { createCoreController } = require('@strapi/strapi').factories;

const COURSE_UID = 'api::course.course';
const COURSE_ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const { MODULE_QUIZ_POPULATE } = require('../../../utils/course-modules');

const COURSE_MODULE_POPULATE = {
  video_file: true,
  pdf_file: true,
  ...MODULE_QUIZ_POPULATE,
};

const LEARNER_COURSE_POPULATE = {
  modules: { populate: COURSE_MODULE_POPULATE },
  thumbnail: true,
  company: { fields: ['name'] },
  course_group_label: { fields: ['name'] },
  feedback: { populate: { feedback_template: { populate: { questions: true } } } },
};

function eqFilter(node) {
  if (node == null) return null;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && node.$eq != null) return String(node.$eq);
  return null;
}

function valueToText(value, depth = 0) {
  if (value == null || depth > 8) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => valueToText(item, depth + 1)).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return [value.text, value.children, value.question_text]
      .map((item) => valueToText(item, depth + 1))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function foldSearch(value) {
  return valueToText(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFC')
    .toLocaleLowerCase();
}

function readSearchTerm(query) {
  const direct = String(query?.search || query?.q || '').trim();
  if (direct) return direct;
  const title = query?.filters?.title;
  if (title && typeof title === 'object' && title.$containsi != null) {
    return String(title.$containsi).trim();
  }
  return '';
}

function dueDateSortDirection(query) {
  const sortBy = String(query?.sortBy || '').trim().toLowerCase();
  if (sortBy === 'due_date' || sortBy === 'due_date:asc' || sortBy === 'duedate') return 'asc';
  if (sortBy === 'due_date:desc') return 'desc';
  const sort = query?.sort;
  const values = Array.isArray(sort) ? sort : [sort];
  for (const value of values) {
    const text = String(value || '').trim().toLowerCase();
    if (text.startsWith('due_date') || text.startsWith('deadline')) {
      return text.endsWith(':desc') ? 'desc' : 'asc';
    }
  }
  return null;
}

function pageParams(query) {
  const pagination = query?.pagination && typeof query.pagination === 'object' ? query.pagination : {};
  const page = Math.max(1, Number(pagination.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(pagination.pageSize) || 25));
  return { page, pageSize };
}

function matchesListFilters(row, filters) {
  if (String(row?.active || '').toLowerCase() === 'unpublished') return false;
  const category = eqFilter(filters?.course_category);
  if (category && String(row.course_category || '') !== category) return false;
  const groupDoc = eqFilter(filters?.course_group_label?.documentId);
  if (groupDoc && String(row.course_group_label?.documentId || '') !== groupDoc) return false;
  return true;
}

function rowMatchesSearch(row, rawQuery) {
  const needle = foldSearch(rawQuery).trim();
  if (!needle) return true;
  const needleNfd = needle.normalize('NFD');
  const parts = [row?.title, row?.course_group_label?.name];
  const modules = Array.isArray(row?.modules) ? row.modules : [];
  for (const mod of modules) {
    parts.push(mod?.title, mod?.language, mod?.text_content, mod?.video_description);
    const questions = mod?.quiz?.quiz_questions;
    if (Array.isArray(questions)) {
      for (const question of questions) parts.push(question?.question_text);
    }
  }
  return parts.some((part) => {
    const hay = foldSearch(part);
    return hay.includes(needle) || hay.normalize('NFD').includes(needleNfd);
  });
}

function orderedCourseIds(rows, dueByCourse, direction) {
  const desc = direction === 'desc';
  return [...rows]
    .sort((a, b) => {
      if (direction) {
        const aDue = dueByCourse[Number(a.id)] || '';
        const bDue = dueByCourse[Number(b.id)] || '';
        if (aDue && bDue && aDue !== bDue) {
          const cmp = aDue < bDue ? -1 : 1;
          return desc ? -cmp : cmp;
        }
        if (aDue !== bDue) return aDue ? -1 : 1;
      }
      const aCreated = String(a.createdAt || '');
      const bCreated = String(b.createdAt || '');
      if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
      return Number(a.id) - Number(b.id);
    })
    .map((row) => Number(row.id));
}

async function learnerDueDates(strapi, userId, assignmentDueByCourse) {
  const merged = { ...assignmentDueByCourse };
  if (!userId) return merged;
  const rows = await strapi.db.query('api::user-progress.user-progress').findMany({
    where: { user: Number(userId), publishedAt: { $notNull: true } },
    select: ['due_date'],
    populate: { course: { select: ['id'] } },
    limit: 1000,
  });
  for (const row of rows || []) {
    const courseId = Number(row?.course?.id);
    if (!Number.isFinite(courseId) || !row?.due_date) continue;
    const next = String(row.due_date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) merged[courseId] = next;
  }
  return merged;
}

async function loadCourseSortRows(strapi, assignedIds, withContent) {
  const where = {
    id: { $in: assignedIds.length ? assignedIds : [0] },
    publishedAt: { $notNull: true },
  };
  const populate = {
    course_group_label: { select: ['name', 'documentId'] },
  };
  if (withContent) {
    populate.modules = {
      select: ['title', 'language', 'text_content', 'video_description'],
      populate: { quiz: { populate: { quiz_questions: { select: ['question_text'] } } } },
    };
  }
  try {
    return await strapi.db.query(COURSE_UID).findMany({
      where,
      select: ['id', 'title', 'course_category', 'active', 'createdAt'],
      populate,
      limit: 1000,
    });
  } catch (error) {
    if (!withContent) throw error;
    strapi.log.warn('course search populate fallback:', error?.message);
    return strapi.db.query(COURSE_UID).findMany({
      where,
      select: ['id', 'title', 'course_category', 'active', 'createdAt'],
      populate: { course_group_label: true, modules: true },
      limit: 1000,
    });
  }
}

function filterCourseByLanguage(course, language) {
  if (!language || !course) return course;

  const lang = String(language).toLowerCase();
  const filteredCourse = { ...course };

  if (filteredCourse.modules && Array.isArray(filteredCourse.modules)) {
    filteredCourse.modules = filteredCourse.modules.filter((module) => {
      const moduleLang = typeof module?.language === 'string' ? module.language.toLowerCase() : '';
      return moduleLang === lang;
    });
  }

  if (filteredCourse.feedback && Array.isArray(filteredCourse.feedback)) {
    filteredCourse.feedback = filteredCourse.feedback.filter((feedback) => {
      const feedbackLang = typeof feedback?.language === 'string' ? feedback.language.toLowerCase() : '';
      return feedbackLang === lang;
    });
  }

  return filteredCourse;
}

/**
 * Returns course IDs (numeric) that the user is allowed to see based on published course assignments.
 * Assignment types: Individual (user in list), Department (user.department in assignment departments),
 * Company (user.company in assignment companies), Location (AIA: user.branch, Vega: user.working_location in work_locations).
 */
async function getLearnerCourseAccess(strapi, user) {
  if (!user || user.id == null) return { ids: [], dueByCourse: {} };
  const userId = Number(user.id);
  const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'documentId', 'department', 'company', 'branch', 'working_location'],
  });
  if (!fullUser) return { ids: [], dueByCourse: {} };

  const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    // Published rows only; a draft-only edit must not change what the learner can see.
    where: { publishedAt: { $notNull: true } },
    populate: {
      courses: true,
      // Backward compatibility for older entries/customizations that used singular relation.
      course: true,
      departments: { select: ['name'] },
      companies: { select: ['name'] },
      work_locations: { select: ['name'] },
      individual_user: { select: ['id'] },
    },
  });
  const list = Array.isArray(assignments) ? assignments : [];
  const allowedIds = new Set();
  const dueByCourse = {};
  const dueByDocId = {};
  const userDocumentId = fullUser.documentId ?? null;

  const rememberDue = (bucket, key, dueDate) => {
    if (key == null || !dueDate) return;
    const next = String(dueDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    const current = bucket[key];
    if (!current || next < current) bucket[key] = next;
  };

  // Collect unresolved course documentIds once and resolve in a single query.
  const pendingCourseDocIds = new Set();
  const matchedDocIds = new Set();

  for (const a of list) {
    const assignmentCourseIds = [];

    // New schema: many-to-many relation `courses`.
    if (Array.isArray(a.courses)) {
      for (const c of a.courses) {
        const cid = c?.id ?? c?.documentId;
        if (cid != null) assignmentCourseIds.push(cid);
      }
    }

    // Legacy compatibility: older schema/custom code may still expose `course`.
    const legacyCourseId = a.course && (a.course.id ?? a.course.documentId);
    if (legacyCourseId != null) assignmentCourseIds.push(legacyCourseId);

    if (assignmentCourseIds.length === 0) continue;

    const targetType = a.assignment_target_type;
    let match = false;

    if (targetType === 'Individual' && Array.isArray(a.individual_user)) {
      match = a.individual_user.some((u) => {
        const relId = u?.id;
        const relDocId = u?.documentId ?? u?.document_id;
        if (relId != null && Number(relId) === userId) return true;
        if (userDocumentId && relDocId && String(relDocId) === String(userDocumentId)) return true;
        return false;
      });
    } else if (targetType === 'Department' && fullUser.department && Array.isArray(a.departments)) {
      const deptNames = (a.departments || []).map((d) => d?.name).filter(Boolean);
      match = deptNames.some((n) => String(n).trim().toLowerCase() === String(fullUser.department).trim().toLowerCase());
    } else if (targetType === 'Company' && fullUser.company && Array.isArray(a.companies)) {
      const companyNames = (a.companies || []).map((c) => c?.name).filter(Boolean);
      match = companyNames.some((n) => String(n).trim().toLowerCase() === String(fullUser.company).trim().toLowerCase());
    } else if (targetType === 'Location' && Array.isArray(a.work_locations)) {
      const locationNames = (a.work_locations || []).map((l) => l?.name).filter(Boolean);
      const userLocation = fullUser.company === 'AIA' ? fullUser.branch : fullUser.working_location;
      if (userLocation && locationNames.length > 0) {
        const uLoc = String(userLocation).trim().toLowerCase();
        match = locationNames.some((n) => String(n).trim().toLowerCase() === uLoc);
      }
    }

    if (match) {
      for (const courseId of assignmentCourseIds) {
        const numId = Number(courseId);
        if (Number.isFinite(numId)) {
          allowedIds.add(numId);
          rememberDue(dueByCourse, numId, a.due_date);
        } else if (typeof courseId === 'string' && courseId.trim()) {
          const docId = courseId.trim();
          matchedDocIds.add(docId);
          pendingCourseDocIds.add(docId);
          rememberDue(dueByDocId, docId, a.due_date);
        }
      }
    }
  }

  if (pendingCourseDocIds.size > 0) {
    const rows = await strapi.db.query(COURSE_UID).findMany({
      where: { documentId: { $in: Array.from(pendingCourseDocIds) } },
      select: ['id', 'documentId'],
      limit: 1000,
    });
    for (const row of rows || []) {
      if (row?.documentId && matchedDocIds.has(String(row.documentId)) && row?.id != null) {
        const numId = Number(row.id);
        allowedIds.add(numId);
        rememberDue(dueByCourse, numId, dueByDocId[String(row.documentId)]);
      }
    }
  }

  return { ids: Array.from(allowedIds), dueByCourse };
}

async function getAssignedCourseIdsForUser(strapi, user) {
  const { ids } = await getLearnerCourseAccess(strapi, user);
  return ids;
}

const controller = createCoreController('api::course.course', ({ strapi }) => ({
  async find(ctx) {
    // Require authenticated user; only return courses assigned to this user
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view courses.');
    }

    const searchTerm = readSearchTerm(ctx.query);
    const dueDirection = dueDateSortDirection(ctx.query);
    const incomingFilters = (ctx.query?.filters && typeof ctx.query.filters === 'object') ? ctx.query.filters : {};
    const { language } = ctx.query;
    const originalQuery = { ...ctx.query, filters: incomingFilters };

    if (searchTerm || dueDirection) {
      try {
        const { ids: assignedIds, dueByCourse } = await getLearnerCourseAccess(strapi, user);
        const dueDates = dueDirection
          ? await learnerDueDates(strapi, user.id, dueByCourse)
          : dueByCourse;
        const rows = await loadCourseSortRows(strapi, assignedIds, Boolean(searchTerm));
        const matched = rows.filter((row) => matchesListFilters(row, incomingFilters) && rowMatchesSearch(row, searchTerm));
        const orderedIds = orderedCourseIds(matched, dueDates, dueDirection);
        const { page, pageSize } = pageParams(ctx.query);
        const start = (page - 1) * pageSize;
        const pageIds = orderedIds.slice(start, start + pageSize);
        const total = orderedIds.length;
        const pagination = {
          page,
          pageSize,
          pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
          total,
        };

        if (pageIds.length === 0) {
          return { data: [], meta: { pagination } };
        }

        ctx.query = {
          ...ctx.query,
          sort: 'id:asc',
          pagination: { page: 1, pageSize: pageIds.length },
          filters: { id: { $in: pageIds } },
          populate: LEARNER_COURSE_POPULATE,
        };
        delete ctx.query.search;
        delete ctx.query.q;
        delete ctx.query.sortBy;

        const result = await super.find(ctx);
        const list = Array.isArray(result?.data) ? result.data : [];
        const byId = new Map();
        for (const course of list) {
          if (course?.id != null) byId.set(Number(course.id), course);
          if (course?.documentId) byId.set(String(course.documentId), course);
        }
        let data = pageIds.map((id) => byId.get(id) || byId.get(String(id))).filter(Boolean);
        if (data.length === 0 && list.length > 0) data = list;
        if (language) data = data.map((course) => filterCourseByLanguage(course, language));
        return { data, meta: { pagination } };
      } catch (error) {
        strapi.log.error('course list due-date sort/search failed:', error);
        ctx.query = { ...originalQuery, filters: incomingFilters };
      }
    }

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const idFilter = assignedIds.length > 0 ? assignedIds : [0]; // empty => no courses

    // Set up populate and restrict to assigned courses only
    ctx.query = {
      ...ctx.query,
      filters: {
        ...incomingFilters,
        id: { $in: idFilter },
        active: { $ne: false },
      },
      populate: LEARNER_COURSE_POPULATE,
    };
    delete ctx.query.search;
    delete ctx.query.q;
    delete ctx.query.sortBy;

    const { data, meta } = await super.find(ctx);

    if (language && data) {
      const filteredData = Array.isArray(data)
        ? data.map((course) => filterCourseByLanguage(course, language))
        : filterCourseByLanguage(data, language);
      return { data: filteredData, meta };
    }

    return { data, meta };
  },

  async findOne(ctx) {
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view a course.');
    }

    // Set up populate for all relations and components
    ctx.query = {
      ...ctx.query,
      populate: LEARNER_COURSE_POPULATE,
    };

    const { data, meta } = await super.findOne(ctx);
    if (!data) return { data: null, meta };

    if (data.active === 'unpublished') {
      return ctx.notFound('Course not found');
    }

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const courseId = data.id ?? data.documentId;
    if (courseId == null || !assignedIds.includes(Number(courseId))) {
      return ctx.forbidden('You do not have access to this course.');
    }

    const { language } = ctx.query;
    if (language && data) {
      const filteredData = filterCourseByLanguage(data, language);
      return { data: filteredData, meta };
    }

    return { data, meta };
  },
}));

controller.getAssignedCourseIdsForUser = getAssignedCourseIdsForUser;
module.exports = controller;
