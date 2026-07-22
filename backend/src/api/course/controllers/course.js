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

  if (filteredCourse.quiz && Array.isArray(filteredCourse.quiz)) {
    filteredCourse.quiz = filteredCourse.quiz.filter((quiz) => {
      const quizLang = typeof quiz?.language === 'string' ? quiz.language.toLowerCase() : '';
      return quizLang === lang;
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
 * Returns course IDs (numeric) that the user is allowed to see based on active course assignments.
 * Assignment types: Individual (user in list), Department (user.department in assignment departments),
 * Company (user.company in assignment companies), Location (AIA: user.branch, Vega: user.working_location in work_locations).
 */
async function getAssignedCourseIdsForUser(strapi, user) {
  if (!user || user.id == null) return [];
  const userId = Number(user.id);
  const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['id', 'documentId', 'department', 'company', 'branch', 'working_location'],
  });
  if (!fullUser) return [];

  const assignments = await strapi.db.query(COURSE_ASSIGNMENT_UID).findMany({
    // Keep legacy rows where active may be null; only exclude explicit false.
    where: {
      $or: [
        { active: 'published' },
        { active: { $null: true } },
      ],
    },
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
  const userDocumentId = fullUser.documentId ?? null;

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
        } else if (typeof courseId === 'string' && courseId.trim()) {
          const docId = courseId.trim();
          matchedDocIds.add(docId);
          pendingCourseDocIds.add(docId);
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
        allowedIds.add(Number(row.id));
      }
    }
  }

  return Array.from(allowedIds);
}

module.exports = createCoreController('api::course.course', ({ strapi }) => ({
  async find(ctx) {
    // Require authenticated user; only return courses assigned to this user
    const user = ctx.state?.user;
    if (!user || !user.id) {
      return ctx.unauthorized('You must be logged in to view courses.');
    }

    const assignedIds = await getAssignedCourseIdsForUser(strapi, user);
    const idFilter = assignedIds.length > 0 ? assignedIds : [0]; // empty => no courses

    // Set up populate and restrict to assigned courses only
    ctx.query = {
      ...ctx.query,
      filters: {
        ...((ctx.query?.filters && typeof ctx.query.filters === 'object') ? ctx.query.filters : {}),
        id: { $in: idFilter },
        active: { $ne: false },
      },
      populate: {
        modules: { populate: '*' },
        quiz: {
          populate: {
            quiz_questions: {
              populate: {
                options: true,
                correct_multiSelect_answers: true
              }
            },
            quiz_instruction: {
              populate: {
                checklist: true
              }
            }
          }
        },
        thumbnail: true,
        prerequisite_courses: { fields: ['title'], populate: { thumbnail: true } },
        company: { fields: ['name'] },
        feedback: { populate: '*' },
      },
    };

    const { language } = ctx.query;
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
      populate: {
        modules: { populate: '*' },
        quiz: {
          populate: {
            quiz_questions: {
              populate: {
                options: true,
                correct_multiSelect_answers: true
              }
            },
            quiz_instruction: {
              populate: {
                checklist: true
              }
            }
          }
        },
        thumbnail: true,
        prerequisite_courses: { fields: ['title'], populate: { thumbnail: true } },
        company: { fields: ['name'] },
        feedback: { populate: '*' },
      },
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
