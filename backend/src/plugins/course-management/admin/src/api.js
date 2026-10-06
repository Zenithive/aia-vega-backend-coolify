// @ts-nocheck
import { getFetchClient } from '@strapi/strapi/admin';
import { PLUGIN_ID } from './pluginId';

const base = `/${PLUGIN_ID}`;

/** Normalised error: { message, details } from a Strapi error response. */
export function toApiError(err) {
  const body = err?.response?.data?.error;
  const error = new Error(body?.message || err?.message || 'Something went wrong');
  error.details = body?.details || null;
  error.status = err?.status || err?.response?.status;
  return error;
}

async function call(method, url, body) {
  const client = getFetchClient();
  try {
    const res = method === 'get' || method === 'del' ? await client[method](url) : await client[method](url, body);
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  options: () => call('get', `${base}/options`),
  list: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return call('get', `${base}/courses${qs ? `?${qs}` : ''}`);
  },
  get: (documentId) => call('get', `${base}/courses/${documentId}`),
  create: (data) => call('post', `${base}/courses`, { data }),
  update: (documentId, data) => call('put', `${base}/courses/${documentId}`, { data }),
  remove: (documentId) => call('del', `${base}/courses/${documentId}`),
  duplicate: (documentId, body) => call('post', `${base}/courses/${documentId}/duplicate`, body),
  /** body: { autoAssign?: { sourceDocumentId, dueDate } } */
  publish: (documentId, body = {}) => call('post', `${base}/courses/${documentId}/publish`, body),
  /** Earlier published versions with learners: [{ documentId, title, course_version, learnerCount }]. */
  autoAssignSources: (documentId) => call('get', `${base}/courses/${documentId}/auto-assign-sources`),

  assignmentOptions: () => call('get', `${base}/assignment-options`),
  assignableCourses: (companyDocumentId) =>
    call('get', `${base}/assignment-courses?company=${encodeURIComponent(companyDocumentId || '')}`),
  assignments: (courseDocumentId) =>
    call('get', `${base}/assignments${courseDocumentId ? `?course=${encodeURIComponent(courseDocumentId)}` : ''}`),
  getAssignment: (documentId) => call('get', `${base}/assignments/${documentId}`),
  createAssignment: (data) => call('post', `${base}/assignments`, { data }),
  updateAssignment: (documentId, data) => call('put', `${base}/assignments/${documentId}`, { data }),
  removeAssignment: (documentId) => call('del', `${base}/assignments/${documentId}`),
  /** { userId, courseDocumentId, dueDate } → that learner's updated progress entry. */
  updateLearnerDueDate: (documentId, data) => call('put', `${base}/assignments/${documentId}/learner-due-date`, { data }),
  searchUsers: (companyDocumentId, q) =>
    call('get', `${base}/assignment-users?company=${encodeURIComponent(companyDocumentId)}&q=${encodeURIComponent(q)}`),
  usersByIds: (ids) => call('post', `${base}/assignment-users`, { ids }),

  /** [{ key, title, versions }] for the Company → Course → Version filter. */
  feedbackCourses: (company) =>
    call('get', `${base}/feedback/courses?company=${encodeURIComponent(company || '')}`).then((body) => body?.data),
  /** Feedback responses for a filter query string (company, course, version). */
  feedback: (query) => call('get', `${base}/feedback?${query}`).then((body) => body?.data),
};

/**
 * Excel / CSV employee import, shared with the Content Manager assignment screen
 * (POST /api/course-assignments/import-users-from-excel). Resolves with
 * { found: [{ id, username, email }], notFound: [], skippedInactiveOrExited: [] }.
 */
export async function importEmployees(payload) {
  const res = await fetch(`${window.strapi?.backendURL || ''}/api/course-assignments/import-users-from-excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    // keep the empty body
  }
  if (!res.ok) throw new Error(json?.error?.message || json?.message || `Import failed (${res.status})`);
  return json;
}
