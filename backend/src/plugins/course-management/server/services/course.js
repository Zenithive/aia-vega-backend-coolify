// @ts-nocheck
'use strict';

/**
 * Course Management service.
 *
 * The existing api::course.course content type is the single source of truth: this service
 * only reads and writes it through strapi.documents(), so the course document middlewares
 * registered in src/index.js (group_id lineage, component id generation, assignment
 * stripping for duplicates, published-course lock) and all lifecycles keep applying.
 *
 * course_assignments are intentionally read-only here: assignments are written by the
 * assignment service (services/assignment.js), which publishes them so the user-progress
 * automation runs.
 */

const { errors } = require('@strapi/utils');
const { buildPopulate, toWriteData, getAttribute } = require('../utils/schema-transform');
const { getOrCreateGroupIdForDocument } = require('../../../../utils/course-group-id');

const COURSE_UID = 'api::course.course';
const COMPANY_UID = 'api::company.company';
const FEEDBACK_TEMPLATE_UID = 'api::feedback-template.feedback-template';
const USER_PROGRESS_UID = 'api::user-progress.user-progress';

/** Never written by the course service: assignments are saved by the assignment service, group_id by the lineage middleware. */
const READ_ONLY_FIELDS = ['course_assignments', 'group_id'];

const ASSIGNMENT_FIELDS = ['assignment_target_type', 'due_date', 'course_version'];
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function str(v) {
  return v == null ? '' : String(v).trim();
}

/** course_language is a JSON custom field; tolerate arrays, JSON strings and { value } objects. */
function parseLanguages(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw ? [raw] : [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const value = typeof item === 'object' && item != null ? item.value : item;
    if (typeof value === 'string' && value.trim() && !out.includes(value.trim())) out.push(value.trim());
  }
  return out;
}

function languagesOf(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((x) => x?.language).filter(Boolean))];
}

function dedupeByDocumentId(list) {
  const seen = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item?.documentId) continue;
    const prev = seen.get(item.documentId);
    // Prefer the published row of an assignment when both draft and published are linked.
    if (!prev || (!prev.publishedAt && item.publishedAt)) seen.set(item.documentId, item);
  }
  return [...seen.values()];
}

/** Same rule as the Content Manager: a published document whose draft was edited afterwards is "modified". */
function computeStatus(draft, published) {
  if (!published) return 'draft';
  const draftTime = new Date(draft?.updatedAt || 0).getTime();
  const publishedTime = new Date(published.updatedAt || 0).getTime();
  return draftTime - publishedTime > 1000 ? 'modified' : 'published';
}

module.exports = ({ strapi }) => {
  const documents = () => strapi.documents(COURSE_UID);

  const editPopulate = () =>
    buildPopulate(strapi, COURSE_UID, {
      course_assignments: { fields: ASSIGNMENT_FIELDS },
    });

  async function findDraft(documentId) {
    if (!documentId) return null;
    const populate = editPopulate();
    const draft = await documents().findOne({ documentId, status: 'draft', populate });
    if (draft) return draft;
    // Legacy documents that only have a published row.
    return documents().findOne({ documentId, status: 'published', populate });
  }

  async function findPublishedRows(documentIds) {
    if (!documentIds.length) return new Map();
    const rows = await strapi.db.query(COURSE_UID).findMany({
      where: { documentId: { $in: documentIds }, publishedAt: { $notNull: true } },
      select: ['id', 'documentId', 'publishedAt', 'updatedAt'],
    });
    return new Map((rows || []).map((r) => [r.documentId, r]));
  }

  async function findLineage(groupId) {
    if (!groupId) return [];
    const rows = await strapi.db.query(COURSE_UID).findMany({
      where: { group_id: groupId, publishedAt: null },
      select: ['documentId', 'title', 'course_version', 'createdAt', 'updatedAt'],
      orderBy: { createdAt: 'asc' },
    });
    const published = await findPublishedRows((rows || []).map((r) => r.documentId));
    return (rows || []).map((r) => ({
      ...r,
      status: computeStatus(r, published.get(r.documentId)),
    }));
  }

  async function assertNotPublished(documentId) {
    const published = await strapi.db.query(COURSE_UID).findOne({
      where: { documentId, publishedAt: { $notNull: true } },
      select: ['id'],
    });
    if (published) {
      throw new errors.ApplicationError(
        'This course is published, so it is locked for editing. Create a new version to make changes.'
      );
    }
  }

  /** Everyone assigned to a course document: one User Progress per learner is created on assignment. */
  async function learnerIdsOf(documentId) {
    const rows = await strapi.db.query(USER_PROGRESS_UID).findMany({
      where: { course: { documentId }, publishedAt: { $notNull: true } },
      select: ['id'],
      populate: { user: { select: ['id'] } },
    });
    return [...new Set((rows || []).map((r) => r.user?.id).filter(Boolean))];
  }

  /** course_version must be unique within a lineage (all versions sharing the same group_id). */
  async function assertVersionAvailable(groupId, version, excludeDocumentId) {
    if (!groupId || !version) return;
    const lineage = await findLineage(groupId);
    const clash = lineage.find(
      (v) => v.documentId !== excludeDocumentId && str(v.course_version).toLowerCase() === version.toLowerCase()
    );
    if (clash) {
      throw new errors.ValidationError(
        `Version "${version}" already exists for this course ("${clash.title}"). Use a different version.`
      );
    }
  }

  return {
    async get(documentId) {
      const course = await findDraft(documentId);
      if (!course) return null;
      const [published, lineage] = await Promise.all([
        findPublishedRows([documentId]),
        findLineage(course.group_id),
      ]);
      const publishedRow = published.get(documentId) || null;
      course.course_assignments = dedupeByDocumentId(course.course_assignments);
      return {
        data: course,
        meta: {
          status: computeStatus(course, publishedRow),
          publishedAt: publishedRow?.publishedAt || null,
          versions: lineage,
        },
      };
    },

    async list(query = {}) {
      const rows = await documents().findMany({
        status: 'draft',
        fields: [
          'title',
          'course_version',
          'course_category',
          'course_language',
          'active',
          'group_id',
          'createdAt',
          'updatedAt',
        ],
        populate: {
          thumbnail: { fields: ['url', 'formats', 'mime', 'name'] },
          // Quizzes live inside modules (course.module → quiz).
          modules: { fields: ['language', 'title'], populate: { quiz: { fields: ['language'] } } },
          feedback: { fields: ['language'] },
          company: { fields: ['name'] },
          course_assignments: { fields: ['assignment_target_type'] },
        },
      });
      const all = Array.isArray(rows) ? rows : [];
      const published = await findPublishedRows(all.map((r) => r.documentId));

      const lineageSize = new Map();
      for (const r of all) {
        if (r.group_id) lineageSize.set(r.group_id, (lineageSize.get(r.group_id) || 0) + 1);
      }

      let items = all.map((r) => {
        const pub = published.get(r.documentId);
        const languages = parseLanguages(r.course_language);
        const modulesPerLanguage = {};
        for (const m of r.modules || []) {
          if (m?.language) modulesPerLanguage[m.language] = (modulesPerLanguage[m.language] || 0) + 1;
        }
        const moduleCount = Object.values(modulesPerLanguage).reduce((max, n) => Math.max(max, n), 0);
        return {
          documentId: r.documentId,
          title: r.title,
          course_version: r.course_version,
          course_category: r.course_category,
          languages,
          active: r.active,
          group_id: r.group_id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          thumbnail: r.thumbnail || null,
          moduleCount,
          quizLanguages: languagesOf((r.modules || []).filter((m) => m?.quiz)),
          feedbackLanguages: languagesOf(r.feedback),
          companies: (r.company || []).map((c) => c?.name).filter(Boolean),
          assignmentCount: dedupeByDocumentId(r.course_assignments).length,
          versionCount: r.group_id ? lineageSize.get(r.group_id) || 1 : 1,
          status: computeStatus(r, pub),
          publishedAt: pub?.publishedAt || null,
        };
      });

      const search = str(query.search).toLowerCase();
      if (search) {
        items = items.filter((c) =>
          [c.title, c.course_version, c.course_category, ...c.companies]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search))
        );
      }
      if (query.status) items = items.filter((c) => c.status === query.status);
      if (query.category) items = items.filter((c) => c.course_category === query.category);
      if (query.active) items = items.filter((c) => c.active === query.active);
      if (query.language) items = items.filter((c) => c.languages.includes(query.language));
      if (query.groupId) items = items.filter((c) => c.group_id === query.groupId);

      const [sortField, sortDir] = str(query.sort || 'updatedAt:desc').split(':');
      const dir = sortDir === 'asc' ? 1 : -1;
      const allowedSort = ['title', 'updatedAt', 'createdAt', 'course_version', 'course_category'];
      const field = allowedSort.includes(sortField) ? sortField : 'updatedAt';
      items.sort((a, b) => {
        const av = a[field] ?? '';
        const bv = b[field] ?? '';
        if (field === 'updatedAt' || field === 'createdAt') {
          return (new Date(av).getTime() - new Date(bv).getTime()) * dir;
        }
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });

      const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const total = items.length;
      const pageCount = Math.max(Math.ceil(total / pageSize), 1);
      const page = Math.min(Math.max(parseInt(query.page, 10) || 1, 1), pageCount);

      return {
        data: items.slice((page - 1) * pageSize, page * pageSize),
        meta: {
          pagination: { page, pageSize, pageCount, total },
          totals: {
            all: all.length,
            draft: items.filter((c) => c.status === 'draft').length,
            published: items.filter((c) => c.status !== 'draft').length,
          },
        },
      };
    },

    async create(input) {
      if (!input || typeof input !== 'object') throw new errors.ValidationError('Missing course data');
      if (!str(input.title)) throw new errors.ValidationError('Course title is required');
      const data = toWriteData(strapi, COURSE_UID, input, {
        keepComponentIds: false,
        omit: READ_ONLY_FIELDS,
      });
      // group_id is generated by the lineage middleware for brand-new courses.
      const created = await documents().create({ data });
      return this.get(created.documentId);
    },

    async update(documentId, input) {
      if (!input || typeof input !== 'object') throw new errors.ValidationError('Missing course data');
      const existing = await findDraft(documentId);
      if (!existing) return null;
      await assertNotPublished(documentId);
      if (Object.prototype.hasOwnProperty.call(input, 'title') && !str(input.title)) {
        throw new errors.ValidationError('Course title is required');
      }
      if (input.course_version !== undefined) {
        await assertVersionAvailable(existing.group_id, str(input.course_version), documentId);
      }
      const data = toWriteData(strapi, COURSE_UID, input, {
        keepComponentIds: true,
        omit: READ_ONLY_FIELDS,
      });
      await documents().update({ documentId, data });
      return this.get(documentId);
    },

    /**
     * New version of a course: same lineage (group_id), fresh component ids (generated by the
     * create middleware), no copied assignments, and a new course_version entered by the admin.
     */
    async duplicate(documentId, { title, course_version } = {}) {
      const source = await findDraft(documentId);
      if (!source) return null;
      const version = str(course_version);
      if (!version) throw new errors.ValidationError('Enter a version for the new course');
      // A draft can still be edited directly, so new versions are only made from published courses.
      const published = await findPublishedRows([documentId]);
      if (!published.has(documentId)) {
        throw new errors.ApplicationError('Publish this course before creating a new version. A draft can be edited directly.');
      }

      const groupId = await getOrCreateGroupIdForDocument(strapi, documentId);
      await assertVersionAvailable(groupId, version);

      const data = toWriteData(strapi, COURSE_UID, source, {
        keepComponentIds: false,
        omit: READ_ONLY_FIELDS,
      });
      data.title = str(title) || source.title;
      data.course_version = version;
      data.group_id = groupId;

      const created = await documents().create({ data });
      return this.get(created.documentId);
    },

    /**
     * Earlier published versions of this course (same lineage) that have learners, with the
     * learner count — the sources offered for auto-assigning a new version on publish.
     */
    async autoAssignSources(documentId) {
      const course = await findDraft(documentId);
      if (!course) return null;
      const lineage = await findLineage(course.group_id);
      const others = lineage.filter((v) => v.documentId !== documentId && v.status !== 'draft');
      const data = [];
      for (const v of others) {
        const learnerIds = await learnerIdsOf(v.documentId);
        if (learnerIds.length) {
          data.push({
            documentId: v.documentId,
            title: v.title,
            course_version: v.course_version,
            createdAt: v.createdAt,
            learnerCount: learnerIds.length,
          });
        }
      }
      data.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { data };
    },

    /**
     * Publishes the course. With `autoAssign` ({ sourceDocumentId, dueDate }) it then assigns
     * the new version to everyone currently assigned to that earlier version, with one due date
     * for all. Their assignment and progress on the earlier version are left as they are.
     */
    async publish(documentId, { autoAssign = null } = {}) {
      const existing = await findDraft(documentId);
      if (!existing) return null;

      let plan = null;
      if (autoAssign) {
        const dueDate = str(autoAssign.dueDate);
        const sourceDocumentId = str(autoAssign.sourceDocumentId);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new errors.ValidationError('Choose a due date for the auto-assigned learners.');
        const sources = (await this.autoAssignSources(documentId))?.data || [];
        if (!sources.some((s) => s.documentId === sourceDocumentId)) {
          throw new errors.ValidationError('Choose an earlier published version of this course to take the learners from.');
        }
        plan = { dueDate, userIds: await learnerIdsOf(sourceDocumentId) };
      }

      await documents().publish({ documentId });

      let autoAssignResult = null;
      if (plan) {
        try {
          autoAssignResult = await strapi
            .plugin('course-management')
            .service('assignment')
            .assignUsersToCourse({ courseDocumentId: documentId, userIds: plan.userIds, dueDate: plan.dueDate });
        } catch (err) {
          strapi.log.error(`[course-management] auto-assign of ${documentId} failed: ${err?.stack || err}`);
          autoAssignResult = { assigned: 0, skipped: [], error: err?.message || 'Auto-assignment failed' };
        }
      }

      const res = await this.get(documentId);
      return { ...res, autoAssign: autoAssignResult };
    },

    /**
     * Published courses stay published: unpublishing deletes the published row and with it the
     * link of every learner record (progress, quiz, feedback, …). Changes go into a new version.
     */
    async unpublish(documentId) {
      const existing = await findDraft(documentId);
      if (!existing) return null;
      throw new errors.ApplicationError(
        'Published courses cannot be unpublished: learners would lose their progress on it. Create a new version to make changes.'
      );
    },

    async remove(documentId) {
      const rows = await strapi.db.query(COURSE_UID).findMany({
        where: { documentId },
        select: ['id', 'title'],
        populate: { course_assignments: { select: ['id', 'documentId'] } },
      });
      if (!rows?.length) return null;
      const assignments = dedupeByDocumentId(rows.flatMap((r) => r.course_assignments || []));
      if (assignments.length > 0) {
        throw new errors.ApplicationError(
          `This course is used by ${assignments.length} course assignment(s). Remove it from those assignments before deleting, or set the course to inactive instead.`
        );
      }
      await documents().delete({ documentId });
      return { data: { documentId } };
    },

    /** Everything the UI needs to render choices, read from the schema and related collections. */
    async getOptions() {
      const attr = (uid, key) => getAttribute(strapi, uid, key) || {};
      const languages = String(attr(COURSE_UID, 'course_language')?.options?.optionsList || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const [companies, feedbackTemplates] = await Promise.all([
        strapi.documents(COMPANY_UID).findMany({ status: 'draft', fields: ['name'], sort: 'name:asc' }),
        strapi.documents(FEEDBACK_TEMPLATE_UID).findMany({
          status: 'draft',
          fields: ['name'],
          sort: 'name:asc',
          populate: { questions: true, companies: { fields: ['name'] } },
        }),
      ]);

      return {
        data: {
          languages: languages.length ? languages : attr('course.module', 'language').enum || [],
          categories: attr(COURSE_UID, 'course_category').enum || [],
          activeValues: attr(COURSE_UID, 'active').enum || [],
          activeDefault: attr(COURSE_UID, 'active').default || null,
          moduleContentTypes: attr('course.module', 'module_content_type').enum || [],
          questionTypes: attr('quiz.question', 'question_type').enum || [],
          limits: {
            title: attr(COURSE_UID, 'title').maxLength || null,
            courseVersion: attr(COURSE_UID, 'course_version').maxLength || null,
            moduleTitle: attr('course.module', 'title').maxLength || null,
            questionText: attr('quiz.question', 'question_text').maxLength || null,
            optionLabel: attr('quiz.options', 'option_label').maxLength || null,
            instructionName: attr('quiz.quiz-instruction', 'name').maxLength || null,
            instructionDescription: attr('quiz.quiz-instruction', 'description').maxLength || null,
            checklistItem: attr('quiz.checklist', 'description').maxLength || null,
          },
          companies: (companies || []).map((c) => ({ documentId: c.documentId, name: c.name })),
          feedbackTemplates: (feedbackTemplates || []).map((t) => ({
            documentId: t.documentId,
            name: t.name,
            companies: (t.companies || []).map((c) => c?.name).filter(Boolean),
            questions: (t.questions || []).map((q) => ({
              question: q.question,
              answer_type: q.answer_type,
              mandatory: q.mandatory,
            })),
          })),
        },
      };
    },
  };
};
