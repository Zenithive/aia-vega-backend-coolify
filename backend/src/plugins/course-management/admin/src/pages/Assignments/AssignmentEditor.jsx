// @ts-nocheck
/**
 * Assign a course on one page: step 1 company, course(s) and due date; step 2 who takes it.
 * A summary panel beside the form says in plain words what saving will do (who is added and
 * notified, who is removed, whose due date moves).
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
  Divider,
  Field,
  Flex,
  Grid,
  IconButton,
  Loader,
  Searchbar,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextButton,
  Th,
  Thead,
  Tr,
  Typography,
  MultiSelect,
  MultiSelectOption,
} from '@strapi/design-system';
import {
  ArrowLeft,
  Bell,
  Book,
  Briefcase,
  Calendar,
  Check,
  Cross,
  File as FileIcon,
  House,
  Lock,
  Minus,
  Pencil,
  PinMap,
  Plus,
  Trash,
  Upload,
  User,
} from '@strapi/icons';
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
import { ChoiceCards, Callout, ConfirmDialog } from '../../components/ui.jsx';

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
      <Box style={{ maxHeight: 320, overflowY: 'auto' }}>
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {shown.map((item) => {
            const on = selected.has(item.value);
            return (
              <Box
                key={item.value}
                hasRadius
                paddingTop={3}
                paddingBottom={3}
                paddingLeft={3}
                paddingRight={3}
                background={on ? 'primary100' : 'neutral0'}
                borderColor={on ? 'primary200' : 'neutral200'}
                borderStyle="solid"
                borderWidth="1px"
              >
                <Checkbox checked={on} onCheckedChange={() => toggle(item.value)} disabled={disabled}>
                  <Typography fontWeight={on ? 'bold' : undefined} textColor={on ? 'primary700' : 'neutral800'}>
                    {item.label}
                  </Typography>
                </Checkbox>
              </Box>
            );
          })}
        </Box>
        {shown.length === 0 && <Typography textColor="neutral600">Nothing matches your search.</Typography>}
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
            <Typography variant="epsilon">
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
            <Typography variant="omega" textColor="neutral600">
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

const SKIP_REASONS = {
  inactive: 'Inactive',
  exited: 'Left the company',
  blocked: 'Blocked account',
  ineligible: 'Not eligible',
};

/**
 * Breaks an Excel / CSV import down for the admin. `res` is the import response, `full` the
 * found users, `beforeIds` who was in the list before the upload, `assignedIds` who is saved on
 * this assignment. addedIds = users this file put into the list (removed again with the file).
 */
function summarizeImport(res, full, beforeIds, assignedIds) {
  const addedIds = full.map((u) => u.id).filter((id) => !beforeIds.has(id));
  const skipped = Array.isArray(res.skippedInactiveOrExited) ? res.skippedInactiveOrExited : [];
  const label = (x) => (x.username && x.username !== x.identifier ? `${x.identifier} (${x.username})` : x.identifier);
  const byReason = (reason) => skipped.filter((x) => (SKIP_REASONS[x.reason] ? x.reason : 'ineligible') === reason).map(label);
  return {
    addedIds,
    totalRows: res.totalRows ?? null,
    groups: [
      { key: 'added', label: 'Added', tone: 'success', items: full.filter((u) => addedIds.includes(u.id) && !assignedIds.has(u.id)).map(employeeLabel) },
      { key: 'assigned', label: 'Already assigned', tone: 'neutral', items: full.filter((u) => assignedIds.has(u.id)).map(employeeLabel) },
      { key: 'inList', label: 'Already in the list', tone: 'neutral', items: full.filter((u) => beforeIds.has(u.id) && !assignedIds.has(u.id)).map(employeeLabel) },
      ...Object.entries(SKIP_REASONS).map(([reason, text]) => ({ key: reason, label: text, tone: 'warning', items: byReason(reason) })),
      {
        key: 'otherCompany',
        label: 'Other company',
        tone: 'warning',
        items: (res.otherCompany || []).map((x) => `${x.identifier}${x.company ? ` (${x.company})` : ''}`),
      },
      { key: 'notFound', label: 'Not found', tone: 'danger', items: res.notFound || [] },
      { key: 'duplicates', label: 'Duplicate rows', tone: 'neutral', items: [], count: res.duplicateRows || 0 },
    ].map((g) => ({ ...g, count: g.count ?? g.items.length })),
  };
}

const TONE_COLORS = {
  success: { background: 'success100', text: 'success700', border: 'success200' },
  warning: { background: 'warning100', text: 'warning700', border: 'warning200' },
  danger: { background: 'danger100', text: 'danger700', border: 'danger200' },
  neutral: { background: 'neutral100', text: 'neutral700', border: 'neutral200' },
};

/** One uploaded file: name with a remove (×) button, and a count per outcome with the rows behind it. */
function UploadSummary({ upload, onRemove, disabled }) {
  const [open, setOpen] = useState(null);
  const shown = upload.groups.filter((g) => g.count > 0 || g.key === 'added');
  const problems = upload.groups.filter((g) => g.tone === 'warning' || g.tone === 'danger').reduce((n, g) => n + g.count, 0);
  const openGroup = shown.find((g) => g.key === open && g.items.length);

  return (
    <Box hasRadius borderColor={problems ? 'warning200' : 'neutral200'} borderStyle="solid" borderWidth="1px" padding={4}>
      <Flex justifyContent="space-between" alignItems="center" gap={3}>
        <Flex gap={2} alignItems="center" style={{ minWidth: 0 }}>
          <FileIcon />
          <Typography fontWeight="bold" ellipsis>{upload.fileName}</Typography>
          {upload.totalRows != null && (
            <Typography variant="pi" textColor="neutral600" style={{ flexShrink: 0 }}>
              {`${upload.totalRows} row${upload.totalRows === 1 ? '' : 's'}`}
            </Typography>
          )}
        </Flex>
        {!disabled && (
          <IconButton
            label={`Remove ${upload.fileName} and the ${upload.addedIds.length} employee${upload.addedIds.length === 1 ? '' : 's'} it added`}
            variant="ghost"
            onClick={onRemove}
          >
            <Cross />
          </IconButton>
        )}
      </Flex>
      <Flex gap={2} wrap="wrap" marginTop={3}>
        {shown.map((g) => {
          const colors = TONE_COLORS[g.tone];
          const clickable = g.items.length > 0;
          return (
            <Box
              key={g.key}
              tag={clickable ? 'button' : 'div'}
              type={clickable ? 'button' : undefined}
              onClick={clickable ? () => setOpen((o) => (o === g.key ? null : g.key)) : undefined}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={3}
              paddingRight={3}
              hasRadius
              background={colors.background}
              borderColor={open === g.key ? colors.text : colors.border}
              borderStyle="solid"
              borderWidth="1px"
              style={{ cursor: clickable ? 'pointer' : 'default' }}
            >
              <Typography variant="pi" fontWeight="bold" textColor={colors.text}>
                {`${g.label}: ${g.count}`}
              </Typography>
            </Box>
          );
        })}
      </Flex>
      {openGroup && (
        <Box marginTop={3} padding={3} hasRadius background="neutral100" style={{ maxHeight: 160, overflowY: 'auto' }}>
          <Typography variant="pi" fontWeight="bold" textColor="neutral700" tag="p">
            {`${openGroup.label} (${openGroup.count})`}
          </Typography>
          <Typography variant="pi" textColor="neutral700" tag="p" marginTop={1}>
            {openGroup.items.join(', ')}
          </Typography>
        </Box>
      )}
      {problems > 0 && !openGroup && (
        <Typography variant="pi" textColor="neutral600" tag="p" marginTop={2}>
          Click a count to see the rows behind it.
        </Typography>
      )}
    </Box>
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
  // One entry per uploaded file: { key, fileName, addedIds, stats } (see summarizeImport).
  const [uploads, setUploads] = useState([]);
  const [tableQuery, setTableQuery] = useState('');
  const [tableFilter, setTableFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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

  // Table: search + New / Already assigned filter + pagination.
  const tableRows = useMemo(() => {
    const term = tableQuery.trim().toLowerCase();
    return sortedUsers
      .filter((u) => tableFilter === 'all' || (tableFilter === 'new') === !assignedIds.has(u.id))
      .filter(
        (u) =>
          !term ||
          [employeeLabel(u), u.email, employeeCode(u), u.department].some((v) => String(v || '').toLowerCase().includes(term))
      );
  }, [sortedUsers, tableQuery, tableFilter, assignedIds]);
  const pageCount = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = tableRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [tableQuery, tableFilter, pageSize]);
  // The New / Already assigned filter is only offered while both kinds are in the list.
  const canFilter = newCount > 0 && assignedCount > 0;
  useEffect(() => {
    if (!canFilter) setTableFilter('all');
  }, [canFilter]);

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
      const summary = summarizeImport(res, full, new Set(users.map((u) => u.id)), assignedIds);
      add(full);
      setUploads((list) => [{ key: `${Date.now()}`, fileName: file.name, ...summary }, ...list]);
    } catch (err) {
      toggleNotification({ type: 'danger', message: err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={5}>
      {!disabled && (
        <Box padding={4} hasRadius background="neutral100">
          <Flex gap={3} alignItems="flex-start" wrap="wrap">
            <Box style={{ flex: '1 1 320px', position: 'relative' }}>
              <Searchbar
                name="employee"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onClear={() => setQ('')}
                clearLabel="Clear"
                placeholder="Add an employee: type a name, email or employee code"
              >
                Search employees
              </Searchbar>
              {q.trim().length >= 2 && (
                <Box
                  marginTop={1}
                  hasRadius
                  background="neutral0"
                  shadow="popupShadow"
                  borderColor="neutral150"
                  borderStyle="solid"
                  borderWidth="1px"
                  style={{ position: 'absolute', left: 0, right: 0, zIndex: 3, maxHeight: 300, overflowY: 'auto' }}
                >
                  {searching ? (
                    <Flex justifyContent="center" padding={4}>
                      <Loader small>Searching…</Loader>
                    </Flex>
                  ) : results.length === 0 ? (
                    <Box padding={4}>
                      <Typography textColor="neutral600">No active employee of this company matches.</Typography>
                    </Box>
                  ) : (
                    results.map((u) => (
                      <Flex
                        key={u.id}
                        justifyContent="space-between"
                        alignItems="center"
                        gap={3}
                        paddingTop={3}
                        paddingBottom={3}
                        paddingLeft={4}
                        paddingRight={4}
                        style={{ borderBottom: '1px solid #f0f0f5' }}
                      >
                        <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
                          <Typography fontWeight="bold" ellipsis>{employeeLabel(u)}</Typography>
                          <Typography variant="pi" textColor="neutral600" ellipsis>
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
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={onFile} />
            <Button size="L" variant="secondary" startIcon={<Upload />} loading={importing} onClick={() => fileRef.current?.click()}>
              Upload Excel / CSV
            </Button>
          </Flex>
          <Typography variant="pi" textColor="neutral600" tag="p" marginTop={2}>
            Have a long list? Upload an Excel or CSV file with one email, employee code or employee ID per row in the first column.
          </Typography>
        </Box>
      )}

      {uploads.map((upload) => (
        <UploadSummary
          key={upload.key}
          upload={upload}
          disabled={disabled}
          onRemove={() => {
            const remove = new Set(upload.addedIds);
            onChange(users.filter((u) => !remove.has(u.id)));
            setUploads((list) => list.filter((x) => x.key !== upload.key));
          }}
        />
      ))}

      <Box>
        <Flex justifyContent="space-between" alignItems="center" marginBottom={3} gap={3} wrap="wrap">
          <Flex gap={3} alignItems="center" wrap="wrap">
            <Typography variant="omega" fontWeight="bold">{`Selected employees (${users.length})`}</Typography>
            {canFilter ? (
              <ChoiceCards
                compact
                items={[
                  { value: 'all', label: `All ${users.length}` },
                  { value: 'new', label: `New ${newCount}` },
                  { value: 'assigned', label: `Already assigned ${assignedCount}` },
                ]}
                value={tableFilter}
                onChange={setTableFilter}
              />
            ) : (
              newCount > 0 && assignedIds.size > 0 && <Badge variant="primary">{`${newCount} new`}</Badge>
            )}
          </Flex>
          {!disabled && users.length > 0 && <TextButton onClick={() => onChange([])}>Remove all</TextButton>}
        </Flex>
        {users.length > 10 && (
          <Box marginBottom={3}>
            <Searchbar
              name="selected-employee-search"
              value={tableQuery}
              onChange={(e) => setTableQuery(e.target.value)}
              onClear={() => setTableQuery('')}
              clearLabel="Clear"
              placeholder="Find in the selected employees: name, email, code or department"
            >
              Find selected employee
            </Searchbar>
          </Box>
        )}
        {users.length === 0 ? (
          <Box padding={4} hasRadius background="neutral100">
            <Typography textColor="neutral600">No employees yet. Upload a list or search above.</Typography>
          </Box>
        ) : tableRows.length === 0 ? (
          <Box padding={4} hasRadius background="neutral100">
            <Typography textColor="neutral600">No selected employee matches your search.</Typography>
          </Box>
        ) : (
          <Box>
            <Table colCount={6} rowCount={pageRows.length + 1}>
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
                {pageRows.map((u) => {
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
            <Flex justifyContent="space-between" alignItems="center" marginTop={3} gap={3} wrap="wrap">
              <Typography variant="pi" textColor="neutral600">
                {`Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, tableRows.length)} of ${tableRows.length}`}
              </Typography>
              <Flex gap={2} alignItems="center">
                <Box style={{ width: 120 }}>
                  <SingleSelect aria-label="Rows per page" size="S" value={String(pageSize)} onChange={(v) => setPageSize(Number(v))}>
                    {[10, 25, 50, 100].map((n) => (
                      <SingleSelectOption key={n} value={String(n)}>{`${n} per page`}</SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Box>
                <Button variant="tertiary" size="S" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  Previous
                </Button>
                <Typography variant="pi">{`Page ${currentPage} of ${pageCount}`}</Typography>
                <Button variant="tertiary" size="S" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                  Next
                </Button>
              </Flex>
            </Flex>
          </Box>
        )}
      </Box>
    </Flex>
  );
}

/** One step of the form: a numbered circle (a tick once the step is complete), title and help text. */
function StepCard({ number, title, description, done, children }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" marginBottom={5}>
      <Flex gap={4} alignItems="center" paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex
          justifyContent="center"
          alignItems="center"
          background={done ? 'success600' : 'primary600'}
          style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }}
        >
          {done ? (
            <Check fill="neutral0" width="14px" height="14px" />
          ) : (
            <Typography fontWeight="bold" textColor="neutral0">
              {number}
            </Typography>
          )}
        </Flex>
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <Typography variant="delta" tag="h2">
            {title}
          </Typography>
          {description && (
            <Typography variant="pi" textColor="neutral600">
              {description}
            </Typography>
          )}
        </Flex>
      </Flex>
      <Divider />
      <Box padding={6}>{children}</Box>
    </Box>
  );
}

/** Label + value line of the summary panel. */
function SummaryRow({ icon, label, children }) {
  return (
    <Flex gap={3} alignItems="flex-start">
      <Flex
        justifyContent="center"
        alignItems="center"
        background="neutral100"
        color="neutral600"
        hasRadius
        style={{ width: 32, height: 32, flexShrink: 0 }}
      >
        {icon}
      </Flex>
      <Flex direction="column" alignItems="flex-start" gap={1} style={{ minWidth: 0 }}>
        <Typography variant="sigma" textColor="neutral600">
          {label}
        </Typography>
        {children}
      </Flex>
    </Flex>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3} more` : list.join(', '));

/**
 * What saving will do, in plain words — shown in the summary panel and the confirm dialog.
 * kind: add (gets the course + notification), remove (loses it + is told), date, info.
 */
function listChanges({ isNew, form, saved, draft, courseItems, showMoveExisting }) {
  const changes = [];
  const unitWord = form.targetType === 'Location' ? 'work location' : 'department';

  if (isNew) {
    if (!form.courseDocumentIds.length || !form.targetType) return changes;
    if (form.targetType === 'Individual') {
      if (form.users.length) changes.push({ kind: 'add', text: `${plural(form.users.length, 'employee')} get the course and a notification.` });
    } else if (draft.targets.length) {
      changes.push({ kind: 'add', text: `Everyone in ${plural(draft.targets.length, unitWord)} gets the course and a notification.` });
    }
    return changes;
  }

  const label = (id) => courseItems.find((c) => c.value === id)?.label || 'A course';
  const savedCourseIds = (saved.courses || []).map((c) => c.documentId);
  const addedCourses = form.courseDocumentIds.filter((id) => !savedCourseIds.includes(id));
  const removedCourses = savedCourseIds.filter((id) => !form.courseDocumentIds.includes(id));
  if (addedCourses.length) {
    changes.push({ kind: 'add', text: `${names(addedCourses.map(label))} added: learners get it and a notification.` });
  }
  if (removedCourses.length) {
    changes.push({
      kind: 'remove',
      text: `${names(removedCourses.map((id) => saved.courses.find((c) => c.documentId === id)?.title || 'A course'))} removed: learners are told they no longer have it.`,
    });
  }

  if (form.targetType !== saved.targetType) {
    changes.push({
      kind: 'info',
      text: `Learners change from ${describeTarget(saved)} to ${describeTarget(draft)}. New learners are notified; learners no longer included are told.`,
    });
  } else if (form.targetType === 'Individual') {
    const before = new Set((saved.users || []).map((u) => u.id));
    const now = new Set(form.users.map((u) => u.id));
    const added = [...now].filter((id) => !before.has(id)).length;
    const removed = [...before].filter((id) => !now.has(id)).length;
    if (added) changes.push({ kind: 'add', text: `${plural(added, 'employee')} added: they get the course and a notification.` });
    if (removed) changes.push({ kind: 'remove', text: `${plural(removed, 'employee')} removed: they are told they no longer have the course.` });
  } else {
    const before = saved.targets || [];
    const now = draft.targets;
    const added = now.filter((t) => !before.some((b) => b.documentId === t.documentId)).map((t) => t.name);
    const removed = before.filter((b) => !now.some((t) => t.documentId === b.documentId)).map((t) => t.name);
    if (added.length) changes.push({ kind: 'add', text: `${names(added)} added: everyone there gets the course and a notification.` });
    if (removed.length) changes.push({ kind: 'remove', text: `${names(removed)} removed: those learners are told they no longer have the course.` });
  }

  if (showMoveExisting) {
    changes.push(
      form.updateExistingDueDate
        ? { kind: 'date', text: `Due date moves to ${formatDay(form.dueDate)} for everyone already assigned. They are notified.` }
        : { kind: 'date', text: `Learners added from now on get ${formatDay(form.dueDate)}. Learners already assigned keep their date.` }
    );
  }
  return changes;
}

const CHANGE_STYLE = {
  add: { icon: <Plus />, background: 'success100', color: 'success600' },
  remove: { icon: <Minus />, background: 'danger100', color: 'danger600' },
  date: { icon: <Calendar />, background: 'primary100', color: 'primary600' },
  info: { icon: <Bell />, background: 'warning100', color: 'warning600' },
};

function ChangeList({ changes, emptyText, variant = 'pi' }) {
  if (!changes.length) {
    return (
      <Typography variant={variant} textColor="neutral600">
        {emptyText}
      </Typography>
    );
  }
  return (
    <Flex direction="column" alignItems="stretch" gap={3}>
      {changes.map((c) => {
        const style = CHANGE_STYLE[c.kind];
        return (
          <Flex key={c.text} gap={3} alignItems="flex-start">
            <Flex
              justifyContent="center"
              alignItems="center"
              background={style.background}
              color={style.color}
              style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }}
            >
              {React.cloneElement(style.icon, { width: '12px', height: '12px' })}
            </Flex>
            <Typography variant={variant} textColor="neutral800">
              {c.text}
            </Typography>
          </Flex>
        );
      })}
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
  // Whenever the date changes the admin chooses: move it for learners already assigned, or only for
  // learners added later. (Department / Location learners have no per-learner pencil, so this is the only way.)
  const showMoveExisting = !isNew && !readOnly && dueChanged;

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

  const step1Done = !!form.companyDocumentId && form.courseDocumentIds.length > 0 && !!form.dueDate;
  const step2Done =
    (form.targetType === 'Individual' && form.users.length > 0) ||
    (form.targetType === 'Department' && form.departmentDocumentIds.length > 0) ||
    (form.targetType === 'Location' && form.workLocationDocumentIds.length > 0);
  const changes = listChanges({ isNew, form, saved, draft, courseItems, showMoveExisting });
  const canSave = !readOnly && (isNew || dirty);
  const companyName = company?.name || saved?.company?.name || '';
  const status = isNew ? null : saved?.isLive ? <Badge variant="success">Live</Badge> : <Badge>Not sent yet</Badge>;

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
        secondaryAction={status}
        subtitle={
          isNew
            ? 'Choose the course and deadline, then who should take it. Learners are notified as soon as you assign it.'
            : saved?.isLive
              ? 'Changes go live as soon as you save. Learners are notified about what changes for them.'
              : 'This assignment has not been sent to learners yet.'
        }
        primaryAction={
          !readOnly && (
            <Button startIcon={<Check />} onClick={askToSave} disabled={!canSave}>
              {isNew ? 'Assign course' : 'Save changes'}
            </Button>
          )
        }
      />
      <Layouts.Content>
        {readOnly && (
          <Callout variant="neutral" title="View only">
            Your role can view assignments but not change them.
          </Callout>
        )}

        <Grid.Root gap={6}>
          <Grid.Item col={8} s={12} direction="column" alignItems="stretch">
            <StepCard number={1} title="Course and deadline" description="What learners should complete, and by when." done={step1Done}>
              <Grid.Root gap={5}>
                <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                  <Field.Root name="company" error={errors.company}>
                    <Field.Label>Company</Field.Label>
                    {isNew ? (
                      <ChoiceCards
                        compact
                        items={options.companies.map((c) => ({ value: c.documentId, label: c.name, icon: <House /> }))}
                        value={form.companyDocumentId}
                        disabled={readOnly}
                        onChange={(v) => set({ companyDocumentId: v, departmentDocumentIds: [], workLocationDocumentIds: [], users: [] })}
                      />
                    ) : (
                      <Flex
                        gap={2}
                        alignItems="center"
                        hasRadius
                        background="neutral100"
                        borderColor="neutral200"
                        borderStyle="solid"
                        borderWidth="1px"
                        paddingLeft={4}
                        paddingRight={4}
                        style={{ height: 40 }}
                      >
                        <Lock width="12px" height="12px" fill="neutral500" />
                        <Typography fontWeight="bold">{companyName || '—'}</Typography>
                      </Flex>
                    )}
                    <Typography variant="pi" textColor="neutral600" tag="p" marginTop={1}>
                      {isNew ? 'Courses and employees are filtered to this company.' : 'The company stays fixed once assigned.'}
                    </Typography>
                    <ErrorText>{errors.company}</ErrorText>
                  </Field.Root>
                </Grid.Item>

                <Grid.Item col={6} s={12} direction="column" alignItems="stretch">
                  <Field.Root name="dueDate" error={errors.dueDate}>
                    <Field.Label>Complete by</Field.Label>
                    <DatePicker
                      value={toPickerDate(form.dueDate)}
                      onChange={(d) => set({ dueDate: toISODate(d) })}
                      onClear={() => set({ dueDate: '' })}
                      minDate={toPickerDate(toISODate(new Date()))}
                      disabled={readOnly}
                      clearLabel="Clear date"
                    />
                    <Typography variant="pi" textColor="neutral600" tag="p" marginTop={1}>
                      {isNew
                        ? 'Learners should finish the course by this day.'
                        : form.targetType === 'Individual' && progress.length > 0
                          ? "For learners added from now on. To change one person's date, use the pencil in the list below."
                          : 'For learners added from now on.'}
                    </Typography>
                    <Field.Error />
                  </Field.Root>
                </Grid.Item>

                <Grid.Item col={12} direction="column" alignItems="stretch">
                  <Field.Root name="courses" error={errors.courses}>
                    <Field.Label>Courses</Field.Label>
                    {!companyId ? (
                      <Box padding={4} hasRadius background="neutral100">
                        <Typography textColor="neutral600">Choose the company first.</Typography>
                      </Box>
                    ) : courses === null ? (
                      <Loader small>Loading courses…</Loader>
                    ) : courseItems.length === 0 ? (
                      <Box padding={4} hasRadius background="neutral100">
                        <Typography textColor="neutral600">
                          {`No published course is available for ${company?.name || 'this company'} yet. Publish a course first.`}
                        </Typography>
                      </Box>
                    ) : (
                      <MultiSelect
                        placeholder="Select one or more courses"
                        value={form.courseDocumentIds}
                        onChange={(values) => set({ courseDocumentIds: values })}
                        onClear={() => set({ courseDocumentIds: [] })}
                        disabled={readOnly}
                        withTags
                      >
                        {courseItems.map((item) => (
                          <MultiSelectOption key={item.value} value={item.value}>
                            {item.label} {item.hint ? `(${item.hint})` : ''}
                          </MultiSelectOption>
                        ))}
                      </MultiSelect>
                    )}
                    <Typography variant="pi" textColor="neutral600" tag="p" marginTop={1}>
                      Only published courses can be assigned. Pick more than one to assign them together.
                    </Typography>
                    <ErrorText>{errors.courses}</ErrorText>
                  </Field.Root>
                </Grid.Item>

                {showMoveExisting && (
                  <Grid.Item col={12} direction="column" alignItems="stretch">
                    <Box padding={4} hasRadius background="primary100" borderColor="primary200" borderStyle="solid" borderWidth="1px">
                      <Typography fontWeight="bold" tag="p" marginBottom={2}>
                        {`You changed the due date (it was ${formatDay(saved.dueDate)}). Who should get the new date?`}
                      </Typography>
                      <ChoiceCards
                        minWidth={220}
                        items={[
                          { value: 'new', label: 'Only learners added from now on', description: 'Everyone already assigned keeps their date.' },
                          { value: 'all', label: 'Everyone already assigned too', description: `All current learners move to ${formatDay(form.dueDate)}.` },
                        ]}
                        value={form.updateExistingDueDate ? 'all' : 'new'}
                        onChange={(v) => set({ updateExistingDueDate: v === 'all' })}
                      />
                    </Box>
                  </Grid.Item>
                )}
              </Grid.Root>
            </StepCard>

            <StepCard number={2} title="Learners" description="Choose who should take the course." done={step2Done}>
              <ChoiceCards
                minWidth={200}
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
              {!companyId && (
                <Typography variant="pi" textColor="neutral600" tag="p" marginTop={2}>
                  Choose the company first.
                </Typography>
              )}
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
            </StepCard>
          </Grid.Item>

          <Grid.Item col={4} s={12} direction="column" alignItems="stretch">
            {/* Stays in view while the learner list is scrolled. */}
            <Box background="neutral0" hasRadius shadow="tableShadow" style={{ position: 'sticky', top: 96 }}>
              <Flex justifyContent="space-between" alignItems="center" paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
                <Typography variant="delta" tag="h2">
                  Summary
                </Typography>
                {status}
              </Flex>
              <Divider />
              <Flex direction="column" alignItems="stretch" gap={4} padding={6}>
                <SummaryRow icon={<House />} label="Company">
                  <Typography>{companyName || '—'}</Typography>
                </SummaryRow>
                <SummaryRow icon={<Book />} label={chosenCourses.length > 1 ? `Courses (${chosenCourses.length})` : 'Course'}>
                  {chosenCourses.length ? (
                    chosenCourses.map((c) => <Typography key={c.value}>{c.hint ? `${c.label} (${c.hint})` : c.label}</Typography>)
                  ) : (
                    <Typography textColor="neutral500">Not chosen yet</Typography>
                  )}
                </SummaryRow>
                <SummaryRow icon={<User />} label="Learners">
                  <Typography textColor={step2Done ? 'neutral800' : 'neutral500'}>{step2Done ? describeTarget(draft) : 'Not chosen yet'}</Typography>
                </SummaryRow>
                <SummaryRow icon={<Calendar />} label="Complete by">
                  <Typography textColor={form.dueDate ? 'neutral800' : 'neutral500'}>{form.dueDate ? formatDay(form.dueDate) : 'Not set'}</Typography>
                </SummaryRow>
              </Flex>
              <Divider />
              <Box padding={6}>
                <Typography variant="sigma" textColor="neutral600" tag="p" marginBottom={3}>
                  {isNew ? 'When you assign' : 'When you save'}
                </Typography>
                <ChangeList
                  changes={changes}
                  emptyText={isNew ? 'Complete both steps to see who gets the course.' : 'Nothing has changed yet.'}
                />
                {!readOnly && (
                  <Box marginTop={5}>
                    <Button fullWidth size="L" startIcon={<Check />} onClick={askToSave} disabled={!canSave}>
                      {isNew ? 'Assign course' : 'Save changes'}
                    </Button>
                  </Box>
                )}
              </Box>
            </Box>
          </Grid.Item>
        </Grid.Root>
      </Layouts.Content>

      <Dialog.Root open={confirming} onOpenChange={(o) => !o && !saving && setConfirming(false)}>
        <Dialog.Content>
          <Dialog.Header>{isNew ? 'Assign this course?' : 'Save changes?'}</Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" alignItems="stretch" gap={4} width="100%">
              <Box padding={4} hasRadius background="neutral100">
                <Typography variant="epsilon" fontWeight="bold" tag="p">
                  {chosenCourses.map((c) => c.label).join(', ')}
                </Typography>
                <Typography variant="omega" textColor="neutral600" tag="p" marginTop={1}>
                  {`${describeTarget(draft)} at ${companyName} · complete by ${formatDay(form.dueDate)}`}
                </Typography>
              </Box>
              <ChangeList changes={changes} variant="omega" emptyText="Learners get the course and a notification." />
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
