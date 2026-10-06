// @ts-nocheck
/**
 * Assign a course: company → course(s) → who → due date, on one page.
 *
 * Saving publishes the course assignment straight away; the existing automation then
 * creates learner progress and sends the "Course Assigned" notifications.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layouts, Page, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  Searchbar,
  Table,
  Tbody,
  Td,
  TextButton,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, Check, Plus, Trash, Upload, User, PinMap, Briefcase, Pencil } from '@strapi/icons';
import { api, importEmployees } from '../../api';
import { BASE_PATH } from '../../pluginId';
import { useAssignmentPermissions } from '../../utils/usePermissions';
import {
  TARGETS,
  describeTarget,
  employeeCode,
  employeeLabel,
  formatDay,
  isPastDay,
  parseCsvIdentifiers,
  readFile,
  toISODate,
  toPickerDate,
} from '../../utils/assignment';
import { Section, ChoiceCards, Callout, ConfirmDialog } from '../../components/ui.jsx';

const EMPTY_FORM = {
  companyDocumentId: '',
  courseDocumentIds: [],
  targetType: '',
  departmentDocumentIds: [],
  workLocationDocumentIds: [],
  users: [],
  dueDate: '',
  updateExistingDueDate: false,
};

const TARGET_ICONS = { Department: <Briefcase />, Location: <PinMap />, Individual: <User /> };

function toForm(a) {
  return {
    companyDocumentId: a.company?.documentId || '',
    courseDocumentIds: a.courses.map((c) => c.documentId),
    targetType: a.targetType || '',
    departmentDocumentIds: a.targetType === 'Department' ? a.targets.map((t) => t.documentId) : [],
    workLocationDocumentIds: a.targetType === 'Location' ? a.targets.map((t) => t.documentId) : [],
    users: a.users || [],
    dueDate: a.dueDate || '',
    updateExistingDueDate: false,
  };
}

const sortedIds = (list) => [...(list || [])].map(String).sort().join(',');

/** Everything that is saved, in a comparable form (users by id) — for the unsaved-changes guard. */
function formSnapshot(form) {
  return JSON.stringify({ ...form, users: sortedIds((form.users || []).map((u) => u.id)), courseDocumentIds: sortedIds(form.courseDocumentIds) });
}

/** Who the assignment goes to: target type plus the chosen departments, locations or employees. */
function selectionKey(form) {
  return [
    form.targetType,
    sortedIds(form.departmentDocumentIds),
    sortedIds(form.workLocationDocumentIds),
    sortedIds((form.users || []).map((u) => u.id)),
  ].join('|');
}

function savedUserIds(saved) {
  return new Set((saved?.users || []).map((u) => u.id));
}

function validate(form) {
  const errors = {};
  if (!form.companyDocumentId) errors.company = 'Choose the company.';
  if (!form.courseDocumentIds.length) errors.courses = 'Choose at least one course.';
  if (!form.targetType) errors.targetType = 'Choose who should take the course.';
  if (form.targetType === 'Department' && !form.departmentDocumentIds.length) errors.departments = 'Choose at least one department.';
  if (form.targetType === 'Location' && !form.workLocationDocumentIds.length) errors.workLocations = 'Choose at least one work location.';
  if (form.targetType === 'Individual' && !form.users.length) errors.users = 'Add at least one employee.';
  if (!form.dueDate) errors.dueDate = 'Choose a due date.';
  return errors;
}

function ErrorText({ children }) {
  if (!children) return null;
  return (
    <Typography variant="pi" textColor="danger600" tag="p" marginTop={2}>
      {children}
    </Typography>
  );
}

/** Searchable list of checkboxes — easier than a dropdown when several items are picked. */
function CheckList({ items, value, onChange, disabled, searchPlaceholder, emptyText }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => !q.trim() || i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const selected = new Set(value);
  const toggle = (v) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  if (items.length === 0) return <Typography textColor="neutral600">{emptyText}</Typography>;

  return (
    <Box>
      {items.length > 8 && (
        <Box marginBottom={3}>
          <Searchbar name="filter" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} clearLabel="Clear" placeholder={searchPlaceholder}>
            {searchPlaceholder}
          </Searchbar>
        </Box>
      )}
      <Flex justifyContent="space-between" marginBottom={2}>
        <Typography variant="pi" textColor="neutral600">{`${value.length} of ${items.length} selected`}</Typography>
        {!disabled && (
          <Flex gap={3}>
            <TextButton onClick={() => onChange([...new Set([...value, ...shown.map((i) => i.value)])])}>Select all</TextButton>
            {value.length > 0 && <TextButton onClick={() => onChange([])}>Clear</TextButton>}
          </Flex>
        )}
      </Flex>
      <Box
        hasRadius
        borderColor="neutral200"
        borderStyle="solid"
        borderWidth="1px"
        padding={3}
        style={{ maxHeight: 280, overflowY: 'auto' }}
      >
        <Flex direction="column" alignItems="stretch" gap={2}>
          {shown.map((item) => (
            <Checkbox key={item.value} checked={selected.has(item.value)} onCheckedChange={() => toggle(item.value)} disabled={disabled}>
              <Flex gap={2}>
                <Typography>{item.label}</Typography>
                {item.hint && (
                  <Typography variant="pi" textColor="neutral600">
                    {item.hint}
                  </Typography>
                )}
              </Flex>
            </Checkbox>
          ))}
          {shown.length === 0 && <Typography textColor="neutral600">Nothing matches your search.</Typography>}
        </Flex>
      </Box>
    </Box>
  );
}

const PROGRESS_STATUS = {
  Not_started: { label: 'Not started', variant: 'neutral' },
  In_progress: { label: 'In progress', variant: 'secondary' },
  Completed: { label: 'Completed', variant: 'success' },
  Failed: { label: 'Failed', variant: 'danger' },
};

/** Datetime (ISO instant) → "Oct 7, 2026". */
function formatInstant(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

function activityLine(entry) {
  if (entry.status === 'Completed' && entry.completedAt) return `Completed ${formatInstant(entry.completedAt)}`;
  if (entry.status !== 'Not_started' && entry.lastAccessedAt) return `Last active ${formatInstant(entry.lastAccessedAt)}`;
  return '';
}

/** One line per course of the assignment; the course title is shown only when there are several. */
function PerCourse({ courses, children }) {
  return (
    <Flex direction="column" alignItems="flex-start" gap={2}>
      {courses.map((c) => (
        <Box key={c.value}>
          {courses.length > 1 && (
            <Typography variant="pi" textColor="neutral500" tag="p" ellipsis style={{ maxWidth: 200 }}>
              {c.label}
            </Typography>
          )}
          {children(c)}
        </Box>
      ))}
    </Flex>
  );
}

/** Change the due date of one already-assigned learner for one course. Saved straight away. */
function LearnerDueDateDialog({ target, assignmentId, onClose, onSaved }) {
  const { toggleNotification } = useNotification();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(target?.entry?.dueDate || ''), [target]);
  if (!target) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.updateLearnerDueDate(assignmentId, {
        userId: target.user.id,
        courseDocumentId: target.entry.courseDocumentId,
        dueDate: value,
      });
      onSaved(res.data);
      toggleNotification({ type: 'success', message: `Due date updated for ${employeeLabel(target.user)}.` });
      onClose();
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !saving && onClose()}>
      <Dialog.Content>
        <Dialog.Header>Change due date</Dialog.Header>
        <Dialog.Body>
          <Flex direction="column" alignItems="stretch" gap={4} width="100%">
            <Typography>
              <strong>{employeeLabel(target.user)}</strong>
              {target.courseTitle ? ` · ${target.courseTitle}` : ''}
            </Typography>
            <Field.Root name="learnerDueDate">
              <Field.Label>Complete by</Field.Label>
              <DatePicker
                value={toPickerDate(value)}
                onChange={(d) => setValue(toISODate(d))}
                onClear={() => setValue('')}
                clearLabel="Clear date"
              />
            </Field.Root>
            <Typography variant="pi" textColor="neutral600">
              Only this employee's date changes. They get a "due date updated" notification.
            </Typography>
          </Flex>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Cancel>
            <Button fullWidth variant="tertiary" disabled={saving}>
              Cancel
            </Button>
          </Dialog.Cancel>
          <Button fullWidth loading={saving} disabled={!value || value === target.entry.dueDate} onClick={save}>
            Save date
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Pick employees by Excel / CSV upload or by searching, and review the list. */
function EmployeePicker({
  companyDocumentId,
  users,
  onChange,
  disabled,
  assignedIds = new Set(),
  progress = [],
  courses = [],
  newDueDate,
  onEditDueDate,
}) {
  const { toggleNotification } = useNotification();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const selectedIds = new Set(users.map((u) => u.id));
  const progressByKey = useMemo(() => new Map(progress.map((p) => [`${p.userId}:${p.courseDocumentId}`, p])), [progress]);
  // Newly selected employees first, so what will change on save is at the top.
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => Number(assignedIds.has(a.id)) - Number(assignedIds.has(b.id))),
    [users, assignedIds]
  );
  const newCount = users.filter((u) => !assignedIds.has(u.id)).length;
  const assignedCount = users.length - newCount;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || !companyDocumentId) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api
        .searchUsers(companyDocumentId, term)
        .then((res) => !cancelled && setResults(res.data || []))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, companyDocumentId]);

  const add = (list) => {
    const byId = new Map(users.map((u) => [u.id, u]));
    list.forEach((u) => byId.set(u.id, u));
    onChange([...byId.values()]);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain';
      const payload = { companyDocumentId };
      if (isCsv) {
        payload.identifiers = parseCsvIdentifiers(await readFile(file, 'text'));
        if (!payload.identifiers.length) throw new Error('The file is empty. Put one email or employee code per row in the first column.');
      } else {
        payload.fileContent = await readFile(file, 'base64');
        payload.fileName = file.name;
      }
      const res = await importEmployees(payload);
      const found = Array.isArray(res.found) ? res.found : [];
      const full = found.length ? (await api.usersByIds(found.map((u) => u.id))).data || found : [];
      const before = users.length;
      add(full);
      setImportResult({
        fileName: file.name,
        added: new Set([...users.map((u) => u.id), ...full.map((u) => u.id)]).size - before,
        found: found.length,
        notFound: res.notFound || [],
        skipped: res.skippedInactiveOrExited || [],
      });
    } catch (err) {
      toggleNotification({ type: 'danger', message: err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={5}>
      {!disabled && (
        <Flex gap={6} wrap="wrap" alignItems="flex-start">
          <Box style={{ flex: '1 1 260px' }}>
            <Typography fontWeight="bold" tag="p">Upload a list</Typography>
            <Typography variant="pi" textColor="neutral600" tag="p" marginBottom={3}>
              Excel or CSV with one email, employee code or employee ID per row in the first column.
            </Typography>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFile} />
            <Button variant="secondary" startIcon={<Upload />} loading={importing} onClick={() => fileRef.current?.click()}>
              Upload Excel / CSV
            </Button>
          </Box>
          <Box style={{ flex: '1 1 300px' }}>
            <Typography fontWeight="bold" tag="p">Or search for an employee</Typography>
            <Typography variant="pi" textColor="neutral600" tag="p" marginBottom={3}>
              Type at least 2 letters of a name, email or employee code.
            </Typography>
            <Searchbar name="employee" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} clearLabel="Clear" placeholder="e.g. Ramesh or 10234">
              Search employees
            </Searchbar>
            {q.trim().length >= 2 && (
              <Box marginTop={2} hasRadius borderColor="neutral200" borderStyle="solid" borderWidth="1px" style={{ maxHeight: 240, overflowY: 'auto' }}>
                {searching ? (
                  <Flex justifyContent="center" padding={3}>
                    <Loader small>Searching…</Loader>
                  </Flex>
                ) : results.length === 0 ? (
                  <Box padding={3}>
                    <Typography textColor="neutral600">No active employee of this company matches.</Typography>
                  </Box>
                ) : (
                  results.map((u) => (
                    <Flex key={u.id} justifyContent="space-between" gap={3} padding={3} style={{ borderBottom: '1px solid #f0f0f5' }}>
                      <Flex direction="column" alignItems="flex-start">
                        <Typography fontWeight="bold">{employeeLabel(u)}</Typography>
                        <Typography variant="pi" textColor="neutral600">
                          {[employeeCode(u), u.department, u.email].filter(Boolean).join(' · ')}
                        </Typography>
                      </Flex>
                      {selectedIds.has(u.id) ? (
                        <Badge variant="success">Added</Badge>
                      ) : (
                        <Button size="S" variant="secondary" startIcon={<Plus />} onClick={() => add([u])}>
                          Add
                        </Button>
                      )}
                    </Flex>
                  ))
                )}
              </Box>
            )}
          </Box>
        </Flex>
      )}

      {importResult && (
        <Callout variant={importResult.notFound.length || importResult.skipped.length ? 'warning' : 'success'} title={`"${importResult.fileName}": ${importResult.added} employee${importResult.added === 1 ? '' : 's'} added`}>
          {[
            importResult.found > importResult.added && `${importResult.found - importResult.added} were already in the list.`,
            importResult.notFound.length &&
              `Not found (${importResult.notFound.length}): ${importResult.notFound.slice(0, 10).join(', ')}${importResult.notFound.length > 10 ? '…' : ''}.`,
            importResult.skipped.length && `${importResult.skipped.length} skipped because they are inactive or have left.`,
          ]
            .filter(Boolean)
            .join(' ') || 'Everyone in the file was found.'}
        </Callout>
      )}

      <Box>
        <Flex justifyContent="space-between" alignItems="center" marginBottom={2} gap={3} wrap="wrap">
          <Flex gap={3} alignItems="center" wrap="wrap">
            <Typography fontWeight="bold">{`Selected employees (${users.length})`}</Typography>
            {newCount > 0 && <Badge variant="primary">{`${newCount} new`}</Badge>}
            {assignedCount > 0 && <Badge>{`${assignedCount} already assigned`}</Badge>}
          </Flex>
          {!disabled && users.length > 0 && <TextButton onClick={() => onChange([])}>Remove all</TextButton>}
        </Flex>
        {users.length === 0 ? (
          <Box padding={4} hasRadius background="neutral100">
            <Typography textColor="neutral600">No employees yet. Upload a list or search above.</Typography>
          </Box>
        ) : (
          <Box style={{ maxHeight: 420, overflowY: 'auto' }}>
            <Table colCount={6} rowCount={users.length + 1}>
              <Thead>
                <Tr>
                  <Th><Typography variant="sigma">Employee</Typography></Th>
                  <Th><Typography variant="sigma">Code / ID</Typography></Th>
                  <Th><Typography variant="sigma">Department</Typography></Th>
                  <Th><Typography variant="sigma">Progress</Typography></Th>
                  <Th><Typography variant="sigma">Due date</Typography></Th>
                  <Th><Typography variant="sigma">Remove</Typography></Th>
                </Tr>
              </Thead>
              <Tbody>
                {sortedUsers.map((u) => {
                  const isNewUser = !assignedIds.has(u.id);
                  const entryFor = (c) => progressByKey.get(`${u.id}:${c.value}`);
                  return (
                    <Tr key={u.id} style={isNewUser ? { boxShadow: 'inset 3px 0 0 #4945ff' } : undefined}>
                      <Td>
                        <Flex direction="column" alignItems="flex-start" gap={1}>
                          <Flex gap={2} alignItems="center">
                            <Typography fontWeight={isNewUser ? 'bold' : undefined}>{employeeLabel(u)}</Typography>
                            {isNewUser && <Badge variant="primary" size="S">New</Badge>}
                          </Flex>
                          <Typography variant="pi" textColor="neutral600">{u.email || ''}</Typography>
                        </Flex>
                      </Td>
                      <Td><Typography>{employeeCode(u) || '—'}</Typography></Td>
                      <Td><Typography>{u.department || '—'}</Typography></Td>
                      <Td>
                        {isNewUser ? (
                          <Typography variant="pi" textColor="primary600">Assigned when you save</Typography>
                        ) : (
                          <PerCourse courses={courses}>
                            {(c) => {
                              const entry = entryFor(c);
                              if (!entry) return <Typography variant="pi" textColor="neutral500">No progress record</Typography>;
                              const meta = PROGRESS_STATUS[entry.status] || PROGRESS_STATUS.Not_started;
                              const line = activityLine(entry);
                              return (
                                <Flex direction="column" alignItems="flex-start" gap={1}>
                                  <Badge variant={meta.variant} size="S">
                                    {entry.status === 'In_progress' ? `${meta.label} · ${entry.percentage}%` : meta.label}
                                  </Badge>
                                  {line && <Typography variant="pi" textColor="neutral600">{line}</Typography>}
                                </Flex>
                              );
                            }}
                          </PerCourse>
                        )}
                      </Td>
                      <Td>
                        {isNewUser ? (
                          <Typography variant="pi" textColor="neutral600">{newDueDate ? formatDay(newDueDate) : '—'}</Typography>
                        ) : (
                          <PerCourse courses={courses}>
                            {(c) => {
                              const entry = entryFor(c);
                              if (!entry) return <Typography textColor="neutral500">—</Typography>;
                              const overdue = entry.dueDate && entry.status !== 'Completed' && isPastDay(entry.dueDate);
                              return (
                                <Flex gap={1} alignItems="center">
                                  <Flex direction="column" alignItems="flex-start">
                                    <Typography textColor={overdue ? 'danger600' : 'neutral800'}>
                                      {entry.dueDate ? formatDay(entry.dueDate) : 'Not set'}
                                    </Typography>
                                    {overdue && <Typography variant="pi" textColor="danger600">Overdue</Typography>}
                                  </Flex>
                                  {!disabled && onEditDueDate && (
                                    <IconButton
                                      label={`Change due date for ${employeeLabel(u)}`}
                                      variant="ghost"
                                      onClick={() => onEditDueDate({ user: u, entry, courseTitle: courses.length > 1 ? c.label : '' })}
                                    >
                                      <Pencil />
                                    </IconButton>
                                  )}
                                </Flex>
                              );
                            }}
                          </PerCourse>
                        )}
                      </Td>
                      <Td>
                        <IconButton label="Remove" variant="ghost" disabled={disabled} onClick={() => onChange(users.filter((x) => x.id !== u.id))}>
                          <Trash />
                        </IconButton>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        )}
      </Box>
    </Flex>
  );
}

export default function AssignmentEditor() {
  const { documentId } = useParams();
  const isNew = !documentId;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toggleNotification } = useNotification();
  const perms = useAssignmentPermissions();

  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [options, setOptions] = useState(null);
  const [courses, setCourses] = useState(null);
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [progress, setProgress] = useState([]);
  const [editingDue, setEditingDue] = useState(null); // { user, entry, courseTitle }
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const allowNavigationRef = useRef(false);

  const readOnly = isNew ? !perms.canAssign : !perms.canEdit;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* ------------------------------------------------------------- unsaved changes guard */

  const dirty = !!form && initialSnapshot != null && formSnapshot(form) !== initialSnapshot;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        dirtyRef.current && !allowNavigationRef.current && currentLocation.pathname !== nextLocation.pathname,
      []
    )
  );
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const loadForm = (next) => {
    setForm(next);
    setInitialSnapshot(formSnapshot(next));
  };

  useEffect(() => {
    api
      .assignmentOptions()
      .then((res) => setOptions(res.data))
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (!options) return;
    if (isNew) {
      const preselected = searchParams.get('course');
      loadForm({
        ...EMPTY_FORM,
        companyDocumentId: options.companies.length === 1 ? options.companies[0].documentId : '',
        courseDocumentIds: preselected ? [preselected] : [],
      });
      return;
    }
    api
      .getAssignment(documentId)
      .then((res) => {
        setSaved(res.data);
        setProgress(res.data.progress || []);
        loadForm(toForm(res.data));
      })
      .catch((e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, documentId, isNew]);

  const companyId = form?.companyDocumentId;
  useEffect(() => {
    if (!companyId) {
      setCourses([]);
      return;
    }
    setCourses(null);
    api
      .assignableCourses(companyId)
      .then((res) => setCourses(res.data || []))
      .catch(() => setCourses([]));
  }, [companyId]);

  const company = options?.companies.find((c) => c.documentId === companyId);
  const departments = useMemo(
    () => (options?.departments || []).filter((d) => !d.companyDocumentId || d.companyDocumentId === companyId),
    [options, companyId]
  );
  const locations = useMemo(
    () => (options?.workLocations || []).filter((l) => !l.companyDocumentId || l.companyDocumentId === companyId),
    [options, companyId]
  );

  if (perms.isLoading || (!form && !loadError)) return <Page.Loading />;
  if (!perms.canRead || (isNew && !perms.canAssign)) return <Page.NoPermissions />;
  if (loadError) return <Page.Error />;

  // Courses already on a saved assignment stay visible even if no longer published.
  const courseItems = [
    ...(courses || []).map((c) => ({ value: c.documentId, label: c.title, hint: c.course_version ? `v${c.course_version}` : '' })),
    ...(saved?.courses || [])
      .filter((c) => !(courses || []).some((x) => x.documentId === c.documentId))
      .map((c) => ({ value: c.documentId, label: c.title, hint: c.course_version ? `v${c.course_version} · not published` : 'not published' })),
  ];
  const chosenCourses = courseItems.filter((c) => form.courseDocumentIds.includes(c.value));
  const dueChanged = saved && saved.dueDate && saved.dueDate !== form.dueDate;
  // Courses saved on the assignment: the ones learner progress exists for.
  const savedCourses = (saved?.courses || []).map((c) => ({ value: c.documentId, label: c.title }));
  const assignedIds = savedUserIds(saved);
  // "Move the due date for learners already assigned" only matters when who is assigned changes.
  const selectionChanged = !!saved && selectionKey(form) !== selectionKey(toForm(saved));
  const showMoveExisting = !isNew && !readOnly && dueChanged && selectionChanged;

  const draft = {
    targetType: form.targetType,
    targets:
      form.targetType === 'Department'
        ? departments.filter((d) => form.departmentDocumentIds.includes(d.documentId))
        : locations.filter((l) => form.workLocationDocumentIds.includes(l.documentId)),
    learnerCount: form.users.length,
  };

  const askToSave = () => {
    const next = validate(form);
    setErrors(next);
    if (Object.keys(next).length) {
      toggleNotification({ type: 'warning', message: 'Some details are missing — see the highlighted sections.' });
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      companyDocumentId: form.companyDocumentId,
      courseDocumentIds: form.courseDocumentIds,
      targetType: form.targetType,
      departmentDocumentIds: form.departmentDocumentIds,
      workLocationDocumentIds: form.workLocationDocumentIds,
      userIds: form.users.map((u) => u.id),
      dueDate: form.dueDate,
      updateExistingDueDate: showMoveExisting && form.updateExistingDueDate,
    };
    try {
      if (isNew) await api.createAssignment(payload);
      else await api.updateAssignment(documentId, payload);
      toggleNotification({
        type: 'success',
        message: isNew ? 'Course assigned. Learners have been notified.' : 'Assignment updated.',
      });
      allowNavigationRef.current = true;
      navigate(`${BASE_PATH}/assignments`);
    } catch (e) {
      setConfirming(false);
      setErrors(e.details?.errors || {});
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page.Main>
      <Page.Title>{isNew ? 'Assign a course' : 'Edit assignment'}</Page.Title>
      <Layouts.Header
        navigationAction={
          <TextButton startIcon={<ArrowLeft />} onClick={() => navigate(`${BASE_PATH}/assignments`)}>
            All assignments
          </TextButton>
        }
        title={isNew ? 'Assign a course' : 'Edit assignment'}
        subtitle={
          isNew
            ? 'Four quick steps. Learners get the course and a notification as soon as you assign it.'
            : saved?.isLive
              ? 'Changes apply as soon as you save. Newly added learners are notified.'
              : 'This assignment has not been sent to learners yet.'
        }
      />
      <Layouts.Content>
        {readOnly && (
          <Callout variant="neutral" title="View only">
            Your role can view assignments but not change them.
          </Callout>
        )}

        <Section title="1. Company" subtitle="Courses, departments and employees are filtered to this company.">
          {isNew ? (
            <ChoiceCards
              items={options.companies.map((c) => ({ value: c.documentId, label: c.name }))}
              value={form.companyDocumentId}
              disabled={readOnly}
              onChange={(v) =>
                set({
                  companyDocumentId: v,
                  departmentDocumentIds: [],
                  workLocationDocumentIds: [],
                  users: [],
                })
              }
            />
          ) : (
            <Typography fontWeight="bold">{company?.name || saved?.company?.name || '—'}</Typography>
          )}
          <ErrorText>{errors.company}</ErrorText>
        </Section>

        <Section title="2. Course" subtitle="Only published courses can be assigned. Pick more than one to assign them together.">
          {!companyId ? (
            <Typography textColor="neutral600">Choose the company first.</Typography>
          ) : courses === null ? (
            <Loader small>Loading courses…</Loader>
          ) : (
            <CheckList
              items={courseItems}
              value={form.courseDocumentIds}
              onChange={(v) => set({ courseDocumentIds: v })}
              disabled={readOnly}
              searchPlaceholder="Search courses"
              emptyText={`No published course is available for ${company?.name || 'this company'} yet. Publish a course first.`}
            />
          )}
          <ErrorText>{errors.courses}</ErrorText>
        </Section>

        <Section title="3. Who should take it?">
          <ChoiceCards
            items={Object.entries(TARGETS).map(([value, t]) => ({
              value,
              label: t.label,
              description: t.description,
              icon: TARGET_ICONS[value],
            }))}
            value={form.targetType}
            disabled={readOnly || !companyId}
            onChange={(v) => set({ targetType: v })}
          />
          <ErrorText>{errors.targetType}</ErrorText>

          {form.targetType && companyId && (
            <Box marginTop={6}>
              {form.targetType === 'Department' && (
                <>
                  <CheckList
                    items={departments.map((d) => ({ value: d.documentId, label: d.name }))}
                    value={form.departmentDocumentIds}
                    onChange={(v) => set({ departmentDocumentIds: v })}
                    disabled={readOnly}
                    searchPlaceholder="Search departments"
                    emptyText="This company has no departments yet."
                  />
                  <ErrorText>{errors.departments}</ErrorText>
                </>
              )}
              {form.targetType === 'Location' && (
                <>
                  <CheckList
                    items={locations.map((l) => ({ value: l.documentId, label: l.name }))}
                    value={form.workLocationDocumentIds}
                    onChange={(v) => set({ workLocationDocumentIds: v })}
                    disabled={readOnly}
                    searchPlaceholder="Search work locations"
                    emptyText="This company has no work locations yet."
                  />
                  <ErrorText>{errors.workLocations}</ErrorText>
                </>
              )}
              {form.targetType === 'Individual' && (
                <>
                  <EmployeePicker
                    companyDocumentId={companyId}
                    users={form.users}
                    onChange={(users) => set({ users })}
                    disabled={readOnly}
                    assignedIds={assignedIds}
                    progress={progress}
                    courses={savedCourses}
                    newDueDate={form.dueDate}
                    onEditDueDate={saved?.isLive && perms.canEdit ? setEditingDue : undefined}
                  />
                  <ErrorText>{errors.users}</ErrorText>
                </>
              )}
            </Box>
          )}
        </Section>

        <Section title="4. Due date" subtitle="The day learners should finish the course by.">
          <Grid.Root gap={6}>
            <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
              <Field.Root name="dueDate" error={errors.dueDate}>
                <Field.Label>{isNew ? 'Complete by' : 'Complete by (for newly added learners)'}</Field.Label>
                <DatePicker
                  value={toPickerDate(form.dueDate)}
                  onChange={(d) => set({ dueDate: toISODate(d) })}
                  onClear={() => set({ dueDate: '' })}
                  minDate={toPickerDate(toISODate(new Date()))}
                  disabled={readOnly}
                  clearLabel="Clear date"
                />
                <Field.Error />
              </Field.Root>
            </Grid.Item>
            {!isNew && (
              <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                {showMoveExisting ? (
                  <Box paddingTop={6}>
                    <Checkbox checked={form.updateExistingDueDate} onCheckedChange={(v) => set({ updateExistingDueDate: !!v })}>
                      {`Also move the due date for learners already assigned (was ${formatDay(saved.dueDate)})`}
                    </Checkbox>
                    <Typography variant="pi" textColor="neutral600" tag="p" marginTop={1}>
                      Leave unticked to give the new date only to learners added now.
                    </Typography>
                  </Box>
                ) : (
                  form.targetType === 'Individual' &&
                  progress.length > 0 && (
                    <Box paddingTop={6}>
                      <Typography variant="pi" textColor="neutral600">
                        To change the date of someone already assigned, use the pencil in the Due date column above.
                      </Typography>
                    </Box>
                  )
                )}
              </Grid.Item>
            )}
          </Grid.Root>
        </Section>

        {!readOnly && (
          <Flex justifyContent="flex-end">
            <Button size="L" startIcon={<Check />} onClick={askToSave}>
              {isNew ? 'Assign course' : 'Save changes'}
            </Button>
          </Flex>
        )}
      </Layouts.Content>

      <Dialog.Root open={confirming} onOpenChange={(o) => !o && !saving && setConfirming(false)}>
        <Dialog.Content>
          <Dialog.Header>{isNew ? 'Assign this course?' : 'Save changes?'}</Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              <Typography>
                <strong>{chosenCourses.map((c) => c.label).join(', ')}</strong>
              </Typography>
              <Typography>{`To: ${describeTarget(draft)} at ${company?.name || saved?.company?.name || ''}`}</Typography>
              <Typography>{`Due: ${formatDay(form.dueDate)}`}</Typography>
              <Typography variant="pi" textColor="neutral600">
                {isNew
                  ? 'Learners get the course and a notification right away.'
                  : 'Learners added now get the course and a notification.'}
              </Typography>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Cancel>
              <Button fullWidth variant="tertiary" disabled={saving}>
                Go back
              </Button>
            </Dialog.Cancel>
            <Button fullWidth loading={saving} onClick={save}>
              {isNew ? 'Yes, assign' : 'Yes, save'}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>

      {editingDue && (
        <LearnerDueDateDialog
          target={editingDue}
          assignmentId={documentId}
          onClose={() => setEditingDue(null)}
          onSaved={(entry) =>
            entry &&
            setProgress((list) =>
              list.map((p) => (p.userId === entry.userId && p.courseDocumentId === entry.courseDocumentId ? entry : p))
            )
          }
        />
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        confirmLabel="Discard changes"
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      >
        You have unsaved changes to this assignment. If you leave now, they will be lost.
      </ConfirmDialog>
    </Page.Main>
  );
}
