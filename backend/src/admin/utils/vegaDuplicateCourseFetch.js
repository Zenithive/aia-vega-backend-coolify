/**
 * Marks Content Manager saves that come from a duplicated course flow so the API can strip
 * course_assignments on create/update (second Save often sends relations only on PUT).
 */

//@ts-nocheck

export const VEGA_DUP_COURSE_ASSIGN_STORAGE = 'vega_dup_course_strip_assignments';

export function markDuplicateCourseFlowActive() {
  try {
    sessionStorage.setItem(VEGA_DUP_COURSE_ASSIGN_STORAGE, '1');
  } catch (e) {
    /* ignore */
  }
}

export function clearDuplicateCourseFlow() {
  try {
    sessionStorage.removeItem(VEGA_DUP_COURSE_ASSIGN_STORAGE);
  } catch (e) {
    /* ignore */
  }
}

function isDuplicateCourseFlowActive() {
  try {
    return sessionStorage.getItem(VEGA_DUP_COURSE_ASSIGN_STORAGE) === '1';
  } catch (e) {
    return false;
  }
}

function isCourseContentManagerUrl(url) {
  return (
    url.includes('/content-manager/') &&
    /collection-types\/api::course\.course/i.test(url)
  );
}

export function installVegaDuplicateCourseFetchInterceptor() {
  if (typeof window === 'undefined' || window.__vegaDupCourseFetchInstalled) return;
  window.__vegaDupCourseFetchInstalled = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async function vegaDupCourseFetch(input, init = {}) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || '';
    } catch (e) {
      url = '';
    }

    const method = String(
      init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : '') ||
        (typeof input !== 'string' && input?.method) ||
        'GET'
    ).toUpperCase();

    const shouldTag =
      isDuplicateCourseFlowActive() && isCourseContentManagerUrl(url) && method !== 'GET';

    let requestInput = input;
    let nextInit = init;

    if (shouldTag) {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        const headers = new Headers(input.headers);
        if (!headers.has('X-Vega-Duplicate-Course')) {
          headers.set('X-Vega-Duplicate-Course', '1');
        }
        requestInput = new Request(input, { headers });
        nextInit = undefined;
      } else {
        const headers = new Headers(init.headers || undefined);
        if (!headers.has('X-Vega-Duplicate-Course')) {
          headers.set('X-Vega-Duplicate-Course', '1');
        }
        nextInit = { ...init, headers };
      }
    }

    const res = await origFetch(requestInput, nextInit);

    try {
      if (shouldTag && res.ok && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        // Strapi often issues a follow-up save; keep tagging briefly so the next request still strips.
        setTimeout(() => clearDuplicateCourseFlow(), 8000);
      }
    } catch (e) {
      /* ignore */
    }

    return res;
  };
}

const COURSE_ASSIGNMENT_LIST_PATH_RE = /\/content-manager\/collection-types\/api::course-assignment\.course-assignment(?:\/|$)/i;

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (e) {
    return String(value || '');
  }
}

function isCourseAssignmentCollectionUrl(url) {
  const raw = String(url || '');
  const decoded = decodeSafe(raw);
  return (
    COURSE_ASSIGNMENT_LIST_PATH_RE.test(raw) ||
    COURSE_ASSIGNMENT_LIST_PATH_RE.test(decoded) ||
    raw.includes('/content-manager/collection-types/api%3A%3Acourse-assignment.course-assignment') ||
    decoded.includes('/content-manager/collection-types/api::course-assignment.course-assignment')
  );
}

function getCourseAssignmentCourseLabel(value) {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.map(getCourseAssignmentCourseLabel).filter(Boolean).join(', ') || '—';
  }
  return value.title || value.name || value.documentId || String(value.id ?? '—');
}

function setCellTextWithRowStyle(cells, targetCell, text, targetIndex) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return;

  let template = null;
  for (let i = 0; i < cells.length; i++) {
    if (i === targetIndex) continue;
    const candidate = cells[i]?.querySelector('span, p, div');
    if (!candidate) continue;
    const candidateText = String(candidate.textContent || '').trim();
    if (!candidateText) continue;
    template = candidate;
    break;
  }

  if (template) {
    const clone = template.cloneNode(false);
    clone.textContent = normalizedText;
    clone.style.whiteSpace = 'normal';
    clone.style.display = 'inline-block';
    clone.style.maxWidth = '120px';
    clone.style.wordBreak = 'break-word';
    clone.style.overflowWrap = 'anywhere';
    targetCell.replaceChildren(clone);
    return;
  }

  targetCell.textContent = normalizedText;
}

function patchCourseAssignmentCoursesTable() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!COURSE_ASSIGNMENT_LIST_PATH_RE.test(window.location.pathname)) return;

  const rowsById = window.__vegaCourseAssignmentRowsById;
  if (!rowsById || typeof rowsById !== 'object') return;

  const tables = Array.from(document.querySelectorAll('table'));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll('thead th'));
    const idIndex = headers.findIndex((header) => String(header.textContent || '').trim().toLowerCase() === 'id');
    const coursesIndex = headers.findIndex((header) => String(header.textContent || '').trim().toLowerCase() === 'courses');
    if (idIndex === -1 || coursesIndex === -1) continue;

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    if (bodyRows.length === 0) continue;

    bodyRows.forEach((tr) => {
      const cells = Array.from(tr.children);
      const idCell = cells[idIndex];
      const cell = cells[coursesIndex];
      if (!idCell || !cell) return;

      const rowIdText = String(idCell.textContent || '').replace(/,/g, '').trim();
      const rowId = Number(rowIdText);
      if (!Number.isFinite(rowId)) return;

      const row = rowsById[rowId];
      if (!row) return;

      const courseLabel = getCourseAssignmentCourseLabel(row.courses);
      const current = String(cell.textContent || '').trim();
      if (courseLabel && current !== courseLabel) {
        setCellTextWithRowStyle(cells, cell, courseLabel, coursesIndex);
      }
    });
  }
}

export function installCourseAssignmentCoursesTablePatch() {
  if (typeof window === 'undefined' || window.__vegaCourseAssignmentCoursesTablePatchInstalled) return;
  window.__vegaCourseAssignmentCoursesTablePatchInstalled = true;

  const origFetch = window.fetch.bind(window);
  let scheduled = false;

  const schedulePatch = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      patchCourseAssignmentCoursesTable();
    });
  };

  window.fetch = async function courseAssignmentCoursesTableFetch(input, init = {}) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || '';
    } catch (e) {
      url = '';
    }

    const method = String(
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : '') ||
      (typeof input !== 'string' && input?.method) ||
      'GET'
    ).toUpperCase();

    const res = await origFetch(input, init);

    try {
      if (method === 'GET' && isCourseAssignmentCollectionUrl(url) && res.ok) {
        const clone = res.clone();
        const json = await clone.json();
        const rows = Array.isArray(json?.results) ? json.results : Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) {
          const byId = {};
          rows.forEach((row) => {
            const id = Number(row?.id);
            if (Number.isFinite(id)) byId[id] = row;
          });
          window.__vegaCourseAssignmentRowsById = byId;
          schedulePatch();
        }
      }
    } catch (e) {
      /* ignore */
    }

    return res;
  };

  const observer = new MutationObserver(() => {
    schedulePatch();
  });

  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      schedulePatch();
      return true;
    }
    return false;
  };

  if (!startObserver()) {
    const readyHandler = () => {
      if (startObserver()) {
        document.removeEventListener('DOMContentLoaded', readyHandler);
      }
    };
    document.addEventListener('DOMContentLoaded', readyHandler);
  }
}
