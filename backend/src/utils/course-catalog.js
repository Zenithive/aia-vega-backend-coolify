// @ts-nocheck
'use strict';

/**
 * Shared by the Quiz Management (learner-activity) and Course Management plugins.
 *
 * Courses as admins think of them: one course (its lineage, `group_id`) with versions.
 * Submissions point at a course *row* (draft or published), so filters are resolved to the
 * set of row ids of the chosen course / version.
 */

/** "aia" → "AIA", "vega" → "Vega", anything else → "". */
function normalizeCompany(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'aia') return 'AIA';
  if (text === 'vega') return 'Vega';
  return '';
}

const COURSE_UID = 'api::course.course';

/** "1.10" sorts after "1.9". */
const compareVersions = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });

function belongsToCompany(course, company) {
  const companies = Array.isArray(course.company) ? course.company : course.company ? [course.company] : [];
  return companies.some((c) => String(c?.name || '').toLowerCase().includes(company.toLowerCase()));
}

/**
 * @returns {Promise<Array<{ key, title, versions: Array<{ documentId, course_version, rowIds: number[] }> }>>}
 */
async function courseCatalog(strapi, companyRaw) {
  const company = normalizeCompany(companyRaw);
  if (!company) return [];
  const rows = await strapi.db.query(COURSE_UID).findMany({
    select: ['id', 'documentId', 'title', 'course_version', 'group_id', 'publishedAt', 'updatedAt'],
    populate: {
      company: { select: ['name'] },
      modules: { select: ['module_id', 'title', 'language', 'module_type'], populate: { quiz: { select: ['id'] } } },
    },
    limit: 5000,
  });

  const groups = new Map();
  for (const row of rows || []) {
    if (!belongsToCompany(row, company)) continue;
    const key = row.group_id || row.documentId;
    if (!groups.has(key)) groups.set(key, { key, title: row.title, latestAt: 0, versions: new Map() });
    const group = groups.get(key);
    const at = new Date(row.updatedAt || 0).getTime();
    if (at >= group.latestAt) {
      group.latestAt = at;
      group.title = row.title || group.title;
    }
    if (!group.versions.has(row.documentId)) {
      group.versions.set(row.documentId, { documentId: row.documentId, course_version: row.course_version || '', rowIds: [], quizModules: [] });
    }
    const version = group.versions.get(row.documentId);
    version.rowIds.push(row.id);
    if (row.publishedAt && row.course_version) version.course_version = row.course_version;
    // Online modules with a quiz, in course order (published row wins), for the module filter.
    if (row.publishedAt || !version.quizModules.length) {
      version.quizModules = (row.modules || [])
        .filter((m) => m?.quiz && m.module_type !== 'Offline')
        .map((m) => ({ module_id: m.module_id, title: m.title || '', language: m.language || '' }));
    }
  }

  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      title: g.title || 'Untitled course',
      versions: [...g.versions.values()].sort((a, b) => compareVersions(b.course_version, a.course_version)),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Row ids of the chosen course (all versions) or of one version.
 * @returns {Promise<Set<number>|null>} null when no course is chosen
 */
async function resolveCourseRows(strapi, { company, course, version }) {
  if (!course) return null;
  const catalog = await courseCatalog(strapi, company);
  const group = catalog.find((g) => g.key === course);
  if (!group) return new Set();
  const versions = version ? group.versions.filter((v) => v.documentId === version) : group.versions;
  return new Set(versions.flatMap((v) => v.rowIds));
}

module.exports = { normalizeCompany, courseCatalog, resolveCourseRows, compareVersions };
