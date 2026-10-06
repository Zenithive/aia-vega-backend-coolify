// @ts-nocheck
'use strict';

/**
 * Course assignments from the Course Management UI.
 *
 * Writes go through strapi.documents() on api::course-assignment.course-assignment and are
 * published straight away, so the existing lifecycles run unchanged: the individual-user
 * merge / validation in the content type lifecycle, and the user-progress automation
 * (progress rows, due dates, "Course Assigned" notifications, offline completion entries)
 * that runs when a published assignment row is written.
 */

const { errors } = require('@strapi/utils');

const ASSIGNMENT_UID = 'api::course-assignment.course-assignment';
const COURSE_UID = 'api::course.course';
const COMPANY_UID = 'api::company.company';
const DEPARTMENT_UID = 'api::department.department';
const WORK_LOCATION_UID = 'api::work-location.work-location';
const USER_UID = 'plugin::users-permissions.user';
const USER_PROGRESS_UID = 'api::user-progress.user-progress';

const TARGET_TYPES = ['Department', 'Location', 'Individual'];
const USER_FIELDS = ['id', 'documentId', 'username', 'email', 'emp_code', 'emp_id', 'company', 'department', 'designation'];
const USER_SEARCH_LIMIT = 20;

function str(v) {
  return v == null ? '' : String(v).trim();
}

function uniq(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(str).filter(Boolean))];
}

/** Company records are named e.g. "AIA Engineering"; users carry the short enum value. */
function userCompanyValue(companyName) {
  const value = str(companyName).toLowerCase();
  if (value.includes('vega')) return 'Vega';
  if (value.includes('aia')) return 'AIA';
  return null;
}

/** Same eligibility as the Excel import: AIA employees without an exit date, active Vega employees. */
function eligibilityFilter(company) {
  if (company === 'AIA') return { $or: [{ exit_date: { $null: true } }] };
  if (company === 'Vega') return { $or: [{ active: { $null: true } }, { active: true }] };
  return {};
}

const sameName = (a, b) => !!str(a) && str(a).toLowerCase() === str(b).toLowerCase();

/** Same matching as the learner course list (api::course getAssignedCourseIdsForUser). */
function assignmentCoversUser(a, user) {
  const type = a.assignment_target_type;
  if (type === 'Individual') return (a.individual_user || []).some((u) => u.id === user.id);
  if (type === 'Department') return (a.departments || []).some((d) => sameName(d.name, user.department));
  if (type === 'Location') {
    const location = user.company === 'AIA' ? user.branch : user.working_location;
    return (a.work_locations || []).some((l) => sameName(l.name, location));
  }
  return false;
}

const named = (list) => (Array.isArray(list) ? list : []).map((x) => ({ documentId: x.documentId, name: x.name || '' }));

function toSummary(row, publishedIds) {
  const type = row.assignment_target_type || null;
  const targets =
    type === 'Department' ? named(row.departments) : type === 'Location' ? named(row.work_locations) : [];
  return {
    documentId: row.documentId,
    targetType: type,
    targets,
    learnerCount: type === 'Individual' ? (row.individual_user || []).length : null,
    dueDate: row.due_date || null,
    company: row.company ? { documentId: row.company.documentId, name: row.company.name } : null,
    courses: (row.courses || []).map((c) => ({ documentId: c.documentId, title: c.title, course_version: c.course_version })),
    course_version: row.course_version || '',
    isLive: publishedIds.has(row.documentId),
    updatedAt: row.updatedAt,
  };
}

module.exports = ({ strapi }) => {
  const assignments = () => strapi.documents(ASSIGNMENT_UID);

  async function publishedIdSet(documentIds) {
    if (!documentIds.length) return new Set();
    const rows = await strapi.db.query(ASSIGNMENT_UID).findMany({
      where: { documentId: { $in: documentIds }, publishedAt: { $notNull: true } },
      select: ['documentId'],
    });
    return new Set(rows.map((r) => r.documentId));
  }

  async function findCompany(documentId) {
    if (!documentId) return null;
    return strapi.documents(COMPANY_UID).findOne({ documentId, fields: ['name'] });
  }

  /** Validates the form and turns it into course-assignment data. */
  async function toWriteData(input = {}, existing = null) {
    const fieldErrors = {};
    const company = await findCompany(str(input.companyDocumentId));
    if (!company) fieldErrors.company = 'Choose the company.';

    const courseIds = uniq(input.courseDocumentIds);
    const courses = courseIds.length
      ? await strapi.documents(COURSE_UID).findMany({
          filters: { documentId: { $in: courseIds } },
          fields: ['title', 'course_version'],
          populate: { company: { fields: ['name'] } },
        })
      : [];
    if (!courses.length) fieldErrors.courses = 'Choose at least one course.';
    const outsideCompany = company
      ? courses.filter((c) => (c.company || []).length && !(c.company || []).some((x) => x.documentId === company.documentId))
      : [];
    if (outsideCompany.length) {
      fieldErrors.courses = `Not available for ${company.name}: ${outsideCompany.map((c) => c.title).join(', ')}.`;
    }

    const targetType = TARGET_TYPES.includes(input.targetType) ? input.targetType : null;
    if (!targetType) fieldErrors.targetType = 'Choose who should take the course.';

    const departmentIds = uniq(input.departmentDocumentIds);
    const locationIds = uniq(input.workLocationDocumentIds);
    const userIds = [...new Set((input.userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (targetType === 'Department' && !departmentIds.length) fieldErrors.departments = 'Choose at least one department.';
    if (targetType === 'Location' && !locationIds.length) fieldErrors.workLocations = 'Choose at least one work location.';
    if (targetType === 'Individual' && !userIds.length) fieldErrors.users = 'Add at least one employee.';

    const dueDate = str(input.dueDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fieldErrors.dueDate = 'Choose a due date.';

    if (Object.keys(fieldErrors).length) {
      throw new errors.ValidationError('Some details are missing.', { errors: fieldErrors });
    }

    const data = {
      company: { set: [{ documentId: company.documentId }] },
      courses: { set: courses.map((c) => ({ documentId: c.documentId })) },
      assignment_target_type: targetType,
      due_date: dueDate,
      update_existing_learners_due_date: !!(existing && input.updateExistingDueDate),
      // A label of the assigned course version(s); learner progress is stamped from the course itself.
      course_version: uniq(courses.map((c) => c.course_version)).join(', ') || '1',
      departments: { set: targetType === 'Department' ? departmentIds.map((documentId) => ({ documentId })) : [] },
      work_locations: { set: targetType === 'Location' ? locationIds.map((documentId) => ({ documentId })) : [] },
    };

    // The content type lifecycle keeps already saved users unless they are disconnected explicitly.
    const before = (existing?.individual_user || []).map((u) => u.id);
    const keep = targetType === 'Individual' ? userIds : [];
    data.individual_user = {
      set: keep.map((id) => ({ id })),
      disconnect: before.filter((id) => !keep.includes(id)).map((id) => ({ id })),
    };
    return data;
  }

  /**
   * Each learner's User Progress for the given courses: status, % done, their own due date and
   * activity dates. One entry per user + course (published row, which the learner app uses).
   */
  async function findProgress(courseDocumentIds, userIds) {
    if (!courseDocumentIds.length || !userIds.length) return [];
    const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: {
        course: { documentId: { $in: courseDocumentIds } },
        user: { id: { $in: userIds } },
        publishedAt: { $notNull: true },
      },
      select: [
        'documentId',
        'progress_status',
        'progress_percentage',
        'due_date',
        'started_at',
        'completed_at',
        'last_accessed_at',
        'selected_language',
      ],
      populate: { user: { select: ['id'] }, course: { select: ['documentId'] } },
    });
    const seen = new Set();
    return (rows || [])
      .filter((r) => r.user?.id && r.course?.documentId)
      .filter((r) => {
        const key = `${r.user.id}:${r.course.documentId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => ({
        userId: r.user.id,
        courseDocumentId: r.course.documentId,
        status: r.progress_status || 'Not_started',
        percentage: r.progress_percentage || 0,
        dueDate: r.due_date || null,
        startedAt: r.started_at || null,
        completedAt: r.completed_at || null,
        lastAccessedAt: r.last_accessed_at || null,
        language: r.selected_language || null,
      }));
  }

  async function findDraft(documentId) {
    return assignments().findOne({
      documentId,
      status: 'draft',
      populate: {
        company: { fields: ['name'] },
        courses: { fields: ['title', 'course_version'] },
        departments: { fields: ['name'] },
        work_locations: { fields: ['name'] },
        individual_user: { fields: USER_FIELDS.filter((f) => f !== 'id' && f !== 'documentId') },
      },
    });
  }

  return {
    /** Companies, and the departments / work locations of each, for the assignment form. */
    async getOptions() {
      const [companies, departments, locations] = await Promise.all([
        strapi.documents(COMPANY_UID).findMany({ status: 'published', fields: ['name'], sort: 'name:asc' }),
        strapi.documents(DEPARTMENT_UID).findMany({
          status: 'published',
          fields: ['name'],
          populate: { company: { fields: ['name'] } },
          sort: 'name:asc',
        }),
        strapi.documents(WORK_LOCATION_UID).findMany({
          status: 'published',
          fields: ['name'],
          populate: { company: { fields: ['name'] } },
          sort: 'name:asc',
        }),
      ]);
      const withCompany = (list) =>
        (list || []).map((x) => ({ documentId: x.documentId, name: x.name, companyDocumentId: x.company?.documentId || null }));
      return {
        data: {
          companies: (companies || []).map((c) => ({ documentId: c.documentId, name: c.name })),
          departments: withCompany(departments),
          workLocations: withCompany(locations),
        },
      };
    },

    /** Published courses a company may assign (courses without a company are available to all). */
    async listCourses(companyDocumentId) {
      const rows = await strapi.documents(COURSE_UID).findMany({
        status: 'published',
        fields: ['title', 'course_version', 'course_category'],
        populate: { company: { fields: ['name'] } },
        sort: 'title:asc',
      });
      const data = (rows || [])
        .filter((c) => !companyDocumentId || !(c.company || []).length || c.company.some((x) => x.documentId === companyDocumentId))
        .map((c) => ({ documentId: c.documentId, title: c.title, course_version: c.course_version, course_category: c.course_category }));
      return { data };
    },

    async list({ courseDocumentId } = {}) {
      const rows = await assignments().findMany({
        status: 'draft',
        filters: courseDocumentId ? { courses: { documentId: str(courseDocumentId) } } : {},
        populate: {
          company: { fields: ['name'] },
          courses: { fields: ['title', 'course_version'] },
          departments: { fields: ['name'] },
          work_locations: { fields: ['name'] },
          individual_user: { fields: ['username'] },
        },
        sort: 'updatedAt:desc',
      });
      // Department / location assignments make the automation add one Individual entry per learner
      // (without a course_version, see createCourseAssignmentEntries); only show what admins created.
      const all = (rows || []).filter((r) => str(r.course_version));
      const live = await publishedIdSet(all.map((r) => r.documentId));
      return { data: all.map((r) => toSummary(r, live)) };
    },

    async get(documentId) {
      const row = await findDraft(documentId);
      if (!row) return null;
      const live = await publishedIdSet([documentId]);
      const users = (row.individual_user || []).map((u) => ({ ...u }));
      const progress = await findProgress(
        (row.courses || []).map((c) => c.documentId),
        users.map((u) => u.id)
      );
      return {
        data: {
          ...toSummary(row, live),
          users,
          progress,
        },
      };
    },

    /**
     * Deletes an assignment, so its learners lose access to the course unless another
     * assignment still gives it to them. Learner progress is kept.
     *
     * Department / Location assignments make the automation add one hidden Individual entry per
     * learner (no course_version). Those keep giving access on their own, so the ones this
     * assignment covers are removed too — unless another remaining assignment still covers
     * that learner for the course.
     */
    async remove(documentId) {
      const row = await findDraft(documentId);
      if (!row) return null;
      const courseIds = (row.courses || []).map((c) => c.documentId);
      let removedEntries = 0;

      if (['Department', 'Location'].includes(row.assignment_target_type) && courseIds.length) {
        const userFields = ['id', 'department', 'company', 'branch', 'working_location'];
        const autoEntries = await strapi.db.query(ASSIGNMENT_UID).findMany({
          where: {
            assignment_target_type: 'Individual',
            $or: [{ course_version: { $null: true } }, { course_version: '' }],
            courses: { documentId: { $in: courseIds } },
          },
          select: ['documentId'],
          populate: { individual_user: { select: userFields }, courses: { select: ['documentId'] } },
        });
        const others = await strapi.db.query(ASSIGNMENT_UID).findMany({
          where: {
            documentId: { $ne: documentId },
            publishedAt: { $notNull: true },
            course_version: { $notNull: true, $ne: '' },
            courses: { documentId: { $in: courseIds } },
          },
          select: ['documentId', 'assignment_target_type'],
          populate: {
            courses: { select: ['documentId'] },
            departments: { select: ['name'] },
            work_locations: { select: ['name'] },
            individual_user: { select: ['id'] },
          },
        });

        const toDelete = new Set();
        for (const entry of autoEntries || []) {
          const users = entry.individual_user || [];
          const entryCourses = (entry.courses || []).map((c) => c.documentId);
          const ours = users.length > 0 && users.every((u) => assignmentCoversUser(row, u));
          if (!ours) continue;
          const stillCovered = users.some((u) =>
            (others || []).some(
              (o) => (o.courses || []).some((c) => entryCourses.includes(c.documentId)) && assignmentCoversUser(o, u)
            )
          );
          if (!stillCovered) toDelete.add(entry.documentId);
        }
        for (const id of toDelete) {
          await assignments().delete({ documentId: id });
          removedEntries += 1;
        }
      }

      await assignments().delete({ documentId });
      strapi.log.info(`[course-management] assignment ${documentId} deleted (${removedEntries} per-learner entries removed)`);
      return { data: { documentId, removedEntries } };
    },

    /**
     * Changes the due date of one already-assigned learner for one course of this assignment.
     * Only that learner's User Progress rows (draft + published) are written; nobody else's.
     */
    async updateLearnerDueDate(documentId, { userId, courseDocumentId, dueDate } = {}) {
      const row = await findDraft(documentId);
      if (!row) return null;
      const uid = Number(userId);
      const courseId = str(courseDocumentId);
      const due = str(dueDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new errors.ValidationError('Choose a due date.');
      if (!(row.courses || []).some((c) => c.documentId === courseId)) {
        throw new errors.ValidationError('This course is not part of the assignment.');
      }
      if (!(row.individual_user || []).some((u) => u.id === uid)) {
        throw new errors.ValidationError('This employee is not part of the assignment.');
      }

      const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
        where: { course: { documentId: courseId }, user: { id: uid } },
        select: ['documentId', 'due_date'],
      });
      const progressIds = [...new Set((rows || []).map((r) => r.documentId).filter(Boolean))];
      if (!progressIds.length) {
        throw new errors.ApplicationError('This employee has no progress for the course yet. Save the assignment first.');
      }
      const changed = !(rows || []).some((r) => r.due_date === due);

      // updateMany covers the draft and published row of the progress document, without lifecycles.
      await strapi.db.query(USER_PROGRESS_UID).updateMany({
        where: { documentId: { $in: progressIds } },
        data: { due_date: due },
      });

      if (changed) {
        try {
          const { sendDueDateChangedNotifications } = require('../../../../lifecycles/user-progress-automation');
          await sendDueDateChangedNotifications(strapi, {}, {
            courseId: courseId,
            userIds: [uid],
            due_date: due,
            targetType: row.assignment_target_type,
          });
        } catch (err) {
          strapi.log.warn(`[course-management] due date notification failed: ${err?.message || err}`);
        }
      }

      const [progress] = await findProgress([courseId], [uid]);
      return { data: progress || null };
    },

    async create(input) {
      const data = await toWriteData(input, null);
      const created = await assignments().create({ data });
      await assignments().publish({ documentId: created.documentId });
      return this.get(created.documentId);
    },

    async update(documentId, input) {
      const existing = await findDraft(documentId);
      if (!existing) return null;
      const data = await toWriteData(input, existing);
      await assignments().update({ documentId, data });
      await assignments().publish({ documentId });
      return this.get(documentId);
    },

    /** Employees of the company matching a name, email or employee code / ID. */
    async searchUsers({ companyDocumentId, q }) {
      const company = userCompanyValue((await findCompany(str(companyDocumentId)))?.name);
      const term = str(q);
      if (!company || term.length < 2) return { data: [] };
      const users = await strapi.db.query(USER_UID).findMany({
        where: {
          $and: [
            { company },
            eligibilityFilter(company),
            {
              $or: ['username', 'email', 'emp_code', 'emp_id'].map((field) => ({ [field]: { $containsi: term } })),
            },
          ],
        },
        select: USER_FIELDS,
        orderBy: { username: 'asc' },
        limit: USER_SEARCH_LIMIT,
      });
      return { data: users || [] };
    },

    /** Full user rows for ids found by the Excel import (which only returns id / name / email). */
    async usersByIds(ids) {
      const list = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!list.length) return { data: [] };
      const users = await strapi.db.query(USER_UID).findMany({ where: { id: { $in: list } }, select: USER_FIELDS });
      return { data: users || [] };
    },
  };
};
