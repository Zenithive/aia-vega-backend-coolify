// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_ASSIGNMENT_MODEL = 'api::course-assignment.course-assignment';
const IMPORT_API_PATH = '/api/course-assignments/import-users-from-excel';
const INLINE_MOUNT_ID = 'course-assignment-excel-upload-inline-mount';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a CSV text and return identifier strings from the first column.
 * Skips the header row if the first cell is a known label.
 */
function parseCSVIdentifiers(text) {
  const knownHeaders = new Set(['email', 'emp_code', 'emp_id', 'username', 'user', 'identifier', 'name']);
  const lines = String(text || '').split(/\r?\n/);
  let startLine = 0;

  if (lines.length > 0) {
    const firstCell = lines[0].split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (knownHeaders.has(firstCell)) startLine = 1;
  }

  const identifiers = [];
  for (let i = startLine; i < lines.length; i++) {
    const cell = lines[i].split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (cell) identifiers.push(cell);
  }
  return identifiers;
}

/** Read a File and resolve with its data URL (base64). */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** Read a File and resolve with its text content. */
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/**
 * Extract an array of { id, documentId } objects from whatever shape
 * a Strapi v5 relation field stores in the form state.
 */
function extractCurrentRelationIds(raw) {
  const toEntry = (u) => (u && u.id != null ? { id: u.id, documentId: u.documentId || null } : null);
  const fromArray = (arr) => (Array.isArray(arr) ? arr.map(toEntry).filter(Boolean) : []);

  if (Array.isArray(raw)) return fromArray(raw);
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.set))        return fromArray(raw.set);
    if (Array.isArray(raw.data))       return fromArray(raw.data);
    if (Array.isArray(raw.results))    return fromArray(raw.results);
    if (Array.isArray(raw.connect))    return fromArray(raw.connect);
  }
  return [];
}

/** True when content-manager is editing an existing entry (not /create). */
function isCourseAssignmentEditEntry() {
  if (typeof window === 'undefined') return false;
  try {
    const path = decodeURIComponent(window.location.pathname || '');
    if (!path.includes('course-assignment.course-assignment')) return false;
    if (path.endsWith('/create')) return false;
    return /course-assignment\.course-assignment\/[^/]+/.test(path);
  } catch {
    return false;
  }
}

function extractCompanySelection(raw) {
  const first = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null);

  if (!raw) return { id: null, documentId: null };

  if (typeof raw === 'string' || typeof raw === 'number') {
    return { id: raw, documentId: null };
  }

  if (Array.isArray(raw)) {
    const item = first(raw);
    if (!item) return { id: null, documentId: null };
    return {
      id: item.id ?? item.value?.id ?? null,
      documentId: item.documentId ?? item.value?.documentId ?? null,
    };
  }

  if (typeof raw === 'object') {
    if (raw.data) {
      const dataVal = raw.data;
      if (Array.isArray(dataVal)) {
        const item = first(dataVal);
        return {
          id: item?.id ?? item?.value?.id ?? null,
          documentId: item?.documentId ?? item?.value?.documentId ?? null,
        };
      }
      return {
        id: dataVal?.id ?? dataVal?.value?.id ?? null,
        documentId: dataVal?.documentId ?? dataVal?.value?.documentId ?? null,
      };
    }

    const pending = first(raw.connect) || first(raw.set);
    if (pending) {
      return {
        id: pending.id ?? null,
        documentId: pending.documentId ?? null,
      };
    }

    return {
      id: raw.id ?? raw.value?.id ?? null,
      documentId: raw.documentId ?? raw.value?.documentId ?? null,
    };
  }

  return { id: null, documentId: null };
}

function isPublishButton(element) {
  const button = element?.closest?.('button');
  if (!button) return false;
  const text = String(button.textContent || '').trim().toLowerCase();
  if (!text) return false;
  return text === 'publish' || text === 'publish & continue';
}

/** POST JSON to Strapi API with no-auth (route uses policies: []). */
async function apiPost(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let json;
  try { json = await res.json(); } catch { json = {}; }

  if (!res.ok) {
    throw new Error(
      json?.error?.message || json?.message || `Request failed (${res.status})`
    );
  }
  return json;
}

function getFieldContainer(el) {
  if (!el || typeof el.closest !== 'function') return null;

  return (
    el.closest('[data-strapi-field]') ||
    el.closest('[class*="Field"]') ||
    el.closest('[role="group"]') ||
    el.closest('section') ||
    el.closest('div')
  );
}

function findAssignmentTargetFieldContainer() {
  const byName = document.querySelector('[name="assignment_target_type"], [name$=".assignment_target_type"], [id*="assignment_target_type"]');
  const byNameContainer = getFieldContainer(byName);
  if (byNameContainer) return byNameContainer;

  const labelCandidates = Array.from(document.querySelectorAll('label, span, p, h1, h2, h3, h4, h5, h6'));
  for (const el of labelCandidates) {
    const txt = String(el.textContent || '').trim().toLowerCase();
    if (!txt) continue;
    if (!/^assignment[_\s-]*target[_\s-]*type$/.test(txt)) continue;
    const container = getFieldContainer(el);
    if (container) return container;
  }

  return null;
}

function ensureInlineMountNode() {
  const existing = document.getElementById(INLINE_MOUNT_ID);
  if (existing) return existing;

  const targetField = findAssignmentTargetFieldContainer();
  if (!targetField || !targetField.parentElement) return null;

  const mount = document.createElement('div');
  mount.id = INLINE_MOUNT_ID;
  mount.style.width = '100%';
  mount.style.marginTop = '8px';
  targetField.insertAdjacentElement('afterend', mount);

  return mount;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  wrap: {
    padding: '10px 0',
    fontFamily: 'inherit',
  },
  hint: {
    fontSize: '11px',
    color: '#9ea5b2',
    marginTop: '5px',
  },
  fileName: {
    fontSize: '12px',
    color: '#4a4f5d',
    marginTop: '6px',
    wordBreak: 'break-word',
  },
  panel: {
    background: '#f6f6f9',
    border: '1px solid #e0e0e9',
    borderRadius: '6px',
    padding: '10px 12px',
    marginTop: '4px',
    fontSize: '13px',
  },
  row: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' },
  btnImport: {
    width: '100%',
    background: '#4945ff',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '7px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  btnGreen: {
    background: '#328048',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  btnBlue: {
    background: '#0c75af',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  btnGrey: {
    background: '#9ea5b2',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  found:    { color: '#328048', fontWeight: 600 },
  notFound: { color: '#c4162a', fontWeight: 600 },
  skipped: { color: '#b26a00', fontWeight: 600 },
  notFoundList: {
    marginTop: '4px',
    fontSize: '11px',
    color: '#666',
    maxHeight: '72px',
    overflowY: 'auto',
    lineHeight: '1.5',
  },
  error: { color: '#c4162a', fontSize: '13px' },
  loading: { color: '#666', fontSize: '13px' },
  btnView: {
    background: '#0c75af',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 10px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  // Modal
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#fff',
    color: '#2b2f36',
    borderRadius: '8px',
    width: '520px',
    maxWidth: '92vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    overflow: 'hidden',
  },
  modalHeader: {
    padding: '14px 18px',
    borderBottom: '1px solid #e0e0e9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#2b2f36',
    fontWeight: 600,
    fontSize: '14px',
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#666',
    lineHeight: 1,
    padding: '0 4px',
  },
  modalBody: {
    padding: '14px 18px',
    overflowY: 'auto',
    flex: 1,
    color: '#2b2f36',
    fontSize: '13px',
  },
  modalSection: {
    marginBottom: '14px',
  },
  modalSectionTitle: {
    fontWeight: 600,
    marginBottom: '6px',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#666',
  },
  modalTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  modalTh: {
    textAlign: 'left',
    padding: '5px 8px',
    background: '#f0f0f6',
    borderBottom: '1px solid #e0e0e9',
    color: '#3a3f4b',
    fontWeight: 600,
  },
  modalTd: {
    padding: '5px 8px',
    borderBottom: '1px solid #f0f0f6',
    color: '#2b2f36',
    wordBreak: 'break-all',
  },
};

// ── Core Component ────────────────────────────────────────────────────────────

function UploadCore() {
  const values   = useForm('CAExcelUpload.values',    (s) => s?.values,    false);
  const setValues = useForm('CAExcelUpload.setValues', (s) => s?.setValues, false);

  const fileInputRef = useRef(null);
  const [status,   setStatus]   = useState('idle');   // idle | loading | done | error
  const [result,   setResult]   = useState(null);      // { found, notFound, skippedInactiveOrExited }
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [publishValidationMsg, setPublishValidationMsg] = useState('');

  const isIndividual = String(values?.assignment_target_type || '').toLowerCase() === 'individual';
  const isEditEntry = isCourseAssignmentEditEntry() || Boolean(values?.documentId);
  const selectedUsers = extractCurrentRelationIds(values?.individual_user);
  const hasImportedUsers = selectedUsers.length > 0;

  useEffect(() => {
    if (!isIndividual) {
      if (publishValidationMsg) setPublishValidationMsg('');
      return;
    }
    if (hasImportedUsers && publishValidationMsg) {
      setPublishValidationMsg('');
    }
  }, [isIndividual, hasImportedUsers, publishValidationMsg]);

  useEffect(() => {
    const handlePublishAttempt = (event) => {
      if (!isIndividual || isEditEntry || hasImportedUsers) return;
      if (!isPublishButton(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setPublishValidationMsg('Import an Excel file and load at least one user before publishing an Individual course assignment.');
    };

    document.addEventListener('click', handlePublishAttempt, true);
    return () => {
      document.removeEventListener('click', handlePublishAttempt, true);
    };
  }, [isIndividual, isEditEntry, hasImportedUsers]);

  // ── Process selected file ──
  async function processFile(file) {
    const selectedCompany = extractCompanySelection(values?.company);
    if (!selectedCompany.id && !selectedCompany.documentId) {
      setStatus('error');
      setErrorMsg('Select a company before importing users.');
      return;
    }

    setSelectedFileName(file?.name || '');
    setStatus('loading');
    setResult(null);
    setErrorMsg('');

    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const payload = {
        companyId: selectedCompany.id ?? undefined,
        companyDocumentId: selectedCompany.documentId ?? undefined,
      };

      if (ext === 'csv' || file.type === 'text/csv' || file.type === 'text/plain') {
        const text = await readAsText(file);
        const identifiers = parseCSVIdentifiers(text);
        if (identifiers.length === 0) {
          setStatus('error');
          setErrorMsg('No identifiers found in the CSV file. Ensure column 1 contains email / emp_code / username.');
          return;
        }
        payload.identifiers = identifiers;
      } else {
        // xlsx / xls → send raw bytes to backend, parsed with the xlsx package server-side
        const fileContent = await readAsBase64(file);
        payload.fileContent = fileContent;
        payload.fileName = file.name;
      }

      const data = await apiPost(IMPORT_API_PATH, payload);

      // Client flow: importing a file should directly set Individual users from that file.
      const foundUsers = Array.isArray(data?.found) ? data.found : [];
      if (typeof setValues === 'function') {
        const existing = extractCurrentRelationIds(values?.individual_user);
        const incoming = foundUsers.map((u) => ({ id: u.id, documentId: u.documentId }));

        // Merge existing manual selection + imported users; dedupe by numeric id.
        const mergedById = new Map();
        for (const user of [...existing, ...incoming]) {
          if (!user || user.id == null) continue;
          mergedById.set(Number(user.id), {
            id: Number(user.id),
            documentId: user.documentId || null,
          });
        }

        // Use Strapi relation `set` shape for stable form serialization.
        setValues({
          ...values,
          individual_user: {
            set: [...mergedById.values()].map((u) => ({
              id: u.id,
              ...(u.documentId ? { documentId: u.documentId } : {}),
            })),
          },
        });
      }

      setStatus('done');
      setResult({
        found: foundUsers,
        notFound: data.notFound || [],
        skippedInactiveOrExited: data.skippedInactiveOrExited || [],
      });
    } catch (e) {
      setStatus('error');
      setErrorMsg(e?.message || 'An unexpected error occurred while importing');
    }
  }

  function handleFileChange(e) {
    // Always use only one file even if browser/OS provides multiple.
    const file = e.target.files && e.target.files.length > 0 ? e.target.files[0] : null;
    if (file) processFile(file);
    e.target.value = '';   // reset so the same file can be re-selected
  }

  function dismiss() {
    setStatus('idle');
    setResult(null);
    setErrorMsg('');
    setSelectedFileName('');
    setShowPreview(false);
  }

  if (!isIndividual) return null;

  // Edit entry: due date updates only — hide CSV/Excel import to avoid overwriting users.
  if (isEditEntry) return null;

  // ── Render ──
  return (
    <div style={S.wrap}>
      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {status === 'idle' && (
        <>
          <button
            type="button"
            style={S.btnImport}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            📊 Import Users from Excel
          </button>
          <div style={S.hint}>
            .xlsx / .xls / .csv — column 1: email, emp_code, emp_id or username. Max 2000 rows.
          </div>
          {selectedFileName ? (
            <div style={S.fileName}>Selected file: {selectedFileName}</div>
          ) : null}
          {publishValidationMsg ? (
            <div style={{ ...S.error, marginTop: '8px' }}>{publishValidationMsg}</div>
          ) : null}
        </>
      )}

      {status === 'loading' && (
        <div style={{ ...S.panel, ...S.loading }}>
          <div>⏳ Processing file…</div>
          {selectedFileName ? <div style={S.fileName}>Selected file: {selectedFileName}</div> : null}
        </div>
      )}

      {status === 'done' && result && (
        <div style={S.panel}>
          {selectedFileName ? <div style={S.fileName}>Selected file: {selectedFileName}</div> : null}
          <div>
            <span style={S.found}>
              ✓ {result.found.length} user{result.found.length !== 1 ? 's' : ''} found
            </span>
            {result.notFound.length > 0 && (
              <span style={{ ...S.notFound, marginLeft: '10px' }}>
                ✗ {result.notFound.length} not found
              </span>
            )}
            {Array.isArray(result.skippedInactiveOrExited) && result.skippedInactiveOrExited.length > 0 && (
              <span style={{ ...S.skipped, marginLeft: '10px' }}>
                ⚠ {result.skippedInactiveOrExited.length} inactive/exited skipped
              </span>
            )}
          </div>

          {result.notFound.length > 0 && (
            <div style={S.notFoundList}>
              Not found:{' '}
              {result.notFound.slice(0, 15).join(', ')}
              {result.notFound.length > 15 ? ` … +${result.notFound.length - 15} more` : ''}
            </div>
          )}

          {Array.isArray(result.skippedInactiveOrExited) && result.skippedInactiveOrExited.length > 0 && (
            <div style={S.notFoundList}>
              Skipped (inactive/exited):{' '}
              {result.skippedInactiveOrExited.slice(0, 10).map((item) => item.identifier).join(', ')}
              {result.skippedInactiveOrExited.length > 10 ? ` … +${result.skippedInactiveOrExited.length - 10} more` : ''}
            </div>
          )}

          <div style={S.row}>
            <button type="button" style={S.btnView} onClick={() => setShowPreview(true)}>
              👁 View
            </button>
            <button type="button" style={S.btnGrey} onClick={dismiss}>
              Cancel
            </button>
          </div>
          {publishValidationMsg ? (
            <div style={{ ...S.error, marginTop: '8px' }}>{publishValidationMsg}</div>
          ) : null}
        </div>
      )}

      {/* ── Preview Modal ── */}
      {showPreview && result && createPortal(
        <div style={S.overlay} onClick={() => setShowPreview(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <span>📊 Import Preview — {selectedFileName}</span>
              <button type="button" style={S.modalClose} onClick={() => setShowPreview(false)}>✕</button>
            </div>
            <div style={S.modalBody}>
              {/* Found users */}
              <div style={S.modalSection}>
                <div style={{ ...S.modalSectionTitle, color: '#328048' }}>
                  ✓ {result.found.length} user{result.found.length !== 1 ? 's' : ''} found
                </div>
                {result.found.length > 0 ? (
                  <table style={S.modalTable}>
                    <thead>
                      <tr>
                        <th style={S.modalTh}>#</th>
                        <th style={S.modalTh}>Username</th>
                        <th style={S.modalTh}>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.found.map((u, i) => (
                        <tr key={u.id || i}>
                          <td style={{ ...S.modalTd, color: '#999', width: '32px' }}>{i + 1}</td>
                          <td style={S.modalTd}>{u.username || '—'}</td>
                          <td style={S.modalTd}>{u.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: '#999', fontSize: '12px' }}>No users found.</div>
                )}
              </div>

              {/* Not found */}
              {result.notFound.length > 0 && (
                <div style={S.modalSection}>
                  <div style={{ ...S.modalSectionTitle, color: '#c4162a' }}>
                    ✗ {result.notFound.length} identifier{result.notFound.length !== 1 ? 's' : ''} not found
                  </div>
                  <table style={S.modalTable}>
                    <thead>
                      <tr>
                        <th style={S.modalTh}>#</th>
                        <th style={S.modalTh}>Identifier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.notFound.map((id, i) => (
                        <tr key={i}>
                          <td style={{ ...S.modalTd, color: '#999', width: '32px' }}>{i + 1}</td>
                          <td style={{ ...S.modalTd, color: '#c4162a' }}>{id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {Array.isArray(result.skippedInactiveOrExited) && result.skippedInactiveOrExited.length > 0 && (
                <div style={S.modalSection}>
                  <div style={{ ...S.modalSectionTitle, color: '#b26a00' }}>
                    ⚠ {result.skippedInactiveOrExited.length} user{result.skippedInactiveOrExited.length !== 1 ? 's' : ''} skipped (inactive/exited)
                  </div>
                  <table style={S.modalTable}>
                    <thead>
                      <tr>
                        <th style={S.modalTh}>#</th>
                        <th style={S.modalTh}>Identifier</th>
                        <th style={S.modalTh}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.skippedInactiveOrExited.map((item, i) => (
                        <tr key={`${item.identifier || 'id'}-${i}`}>
                          <td style={{ ...S.modalTd, color: '#999', width: '32px' }}>{i + 1}</td>
                          <td style={S.modalTd}>{item.identifier || '—'}</td>
                          <td style={{ ...S.modalTd, color: '#b26a00' }}>{item.reason || 'ineligible'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {status === 'error' && (
        <div style={{ ...S.panel, ...S.error }}>
          ✗ {errorMsg}
          <div style={S.row}>
            <button type="button" style={S.btnGrey} onClick={dismiss}>Dismiss</button>
          </div>
        </div>
      )}

      {status !== 'idle' && status !== 'done' && publishValidationMsg ? (
        <div style={{ ...S.error, marginTop: '8px' }}>{publishValidationMsg}</div>
      ) : null}
    </div>
  );
}

// ── Public Component ──────────────────────────────────────────────────────────

/** Guard wrapper — only active on the Course Assignment create view (import hidden on edit). */
export default function CourseAssignmentExcelUserUpload({ slug, model }) {
  const uid = slug || model;
  if (uid !== COURSE_ASSIGNMENT_MODEL) return null;

  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    let observer = null;

    const tryAttach = () => {
      const mountNode = ensureInlineMountNode();
      if (!mountNode) return false;
      setPortalTarget(mountNode);
      return true;
    };

    if (!tryAttach()) {
      observer = new MutationObserver(() => {
        if (tryAttach() && observer) {
          observer.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      if (observer) observer.disconnect();
    };
  }, []);

  if (portalTarget) {
    return createPortal(<UploadCore />, portalTarget);
  }

  // Fallback: keep rendering in current injection zone until field target is mounted.
  return <UploadCore />;
}
