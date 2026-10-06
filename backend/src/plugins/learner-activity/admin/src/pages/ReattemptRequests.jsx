// @ts-nocheck
/**
 * Quiz reattempt requests: learners who failed a module quiz ask to take it again;
 * the admin approves or rejects each request.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from '@strapi/strapi/admin';
import { Badge, Box, Button, Field, Flex, Searchbar, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import { Question } from '@strapi/icons';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import { api } from '../api';
import { useSummary } from '../summary';
import { COMPANIES } from '../components/CourseFilter.jsx';
import { CountLine, Empty, ErrorBox, Loading } from '../components/states.jsx';

const STATUS_OPTIONS = [
  { value: 'Pending', label: 'Waiting for a decision' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'all', label: 'All requests' },
];
const STATUS_VARIANT = { Approved: 'success', Rejected: 'danger', Pending: 'warning' };
const cell = { fontSize: '14px' };

const relation = (value) => value?.data ?? value ?? {};
const attrs = (value) => relation(value).attributes ?? relation(value);

/** Flattens a request (v4/v5 relation shapes) into what the table shows. */
function toRow(entry) {
  const a = entry.attributes || entry;
  const user = attrs(a.users_permissions_user);
  const course = attrs(a.course);
  const approver = attrs(a.approved_by);
  const company = a.company || user.company || '';
  const approverName =
    `${approver.firstname || ''} ${approver.lastname || ''}`.trim() || approver.username || approver.email || '';
  const lc = company.toLowerCase();
  return {
    key: String(entry.documentId ?? entry.id),
    documentId: entry.documentId ?? entry.id,
    employeeId: lc === 'aia' ? user.emp_code : lc === 'vega' ? user.emp_id : '',
    userName: user.username || user.email || '—',
    user,
    company,
    courseTitle: course.title || '—',
    // Version stored on the request; older requests fall back to the course's current version.
    courseVersion: a.course_version || course.course_version || '—',
    moduleTitle: a.module_title || '—',
    requestedAttempt: a.requested_for_attempt ?? '—',
    status: typeof a.request_status === 'string' ? a.request_status : 'Pending',
    decidedBy: approverName,
    requestedAt: a.createdAt,
  };
}

function matchesSearch(row, q) {
  if (!q) return true;
  const u = row.user;
  return [row.userName, u.firstname, u.lastname, u.emp_code, u.emp_id, u.id, row.documentId, row.courseTitle]
    .filter((v) => v != null)
    .some((v) => String(v).toLowerCase().includes(q));
}

export default function ReattemptRequests() {
  const { toggleNotification } = useNotification();
  const { refresh: refreshSummary } = useSummary();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.get('/reattempts');
      setList((Array.isArray(data) ? data : []).map(toRow));
    } catch (e) {
      setError(e.message);
      setList([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, next) => {
    setUpdatingId(row.key);
    try {
      await api.setReattemptStatus(row.documentId, next);
      toggleNotification({
        type: 'success',
        message:
          next === 'Approved'
            ? `${row.userName} can now retake the quiz in "${row.courseTitle}".`
            : `Request from ${row.userName} was rejected.`,
      });
      await load();
      refreshSummary();
    } catch (e) {
      toggleNotification({ type: 'danger', message: e.message });
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (list || []).filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!company || r.company.toLowerCase() === company.toLowerCase()) &&
        matchesSearch(r, q)
    );
  }, [list, search, status, company]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resetPage = (fn) => (v) => {
    fn(v);
    setPage(1);
  };

  const text = (v) => (
    <Typography variant="omega" style={cell}>
      {v || '—'}
    </Typography>
  );

  return (
    <>
      <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
        <Flex gap={4} wrap="wrap" alignItems="flex-end">
          <Box style={{ flex: '1 1 200px', maxWidth: 260 }}>
            <Field.Root name="status">
              <Field.Label>Show</Field.Label>
              <SingleSelect value={status} onChange={resetPage((v) => setStatus(String(v)))}>
                {STATUS_OPTIONS.map((o) => (
                  <SingleSelectOption key={o.value} value={o.value}>
                    {o.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Box>
          <Box style={{ flex: '1 1 160px', maxWidth: 220 }}>
            <Field.Root name="company">
              <Field.Label>Company</Field.Label>
              <SingleSelect value={company || 'all'} onChange={resetPage((v) => setCompany(v === 'all' ? '' : String(v)))}>
                <SingleSelectOption value="all">All companies</SingleSelectOption>
                {COMPANIES.map((c) => (
                  <SingleSelectOption key={c} value={c}>
                    {c}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
          </Box>
          <Box style={{ flex: '2 1 260px' }}>
            <Searchbar
              name="search"
              value={search}
              onChange={(e) => resetPage(setSearch)(e.target.value)}
              onClear={() => resetPage(setSearch)('')}
              clearLabel="Clear search"
              placeholder="Search by name, employee code / ID or course"
            >
              Search requests
            </Searchbar>
          </Box>
        </Flex>
      </Box>
      <ErrorBox message={error} />

      {list === null ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty
          icon={<Question width="64px" height="64px" />}
          content={
            list.length === 0
              ? 'No learner has asked to retake a quiz yet.'
              : status === 'Pending' && !search && !company
                ? 'No requests are waiting for a decision.'
                : 'No requests match these filters.'
          }
        />
      ) : (
        <>
          <CountLine count={filtered.length} noun="request" />
          <DataTable
            data={pageRows}
            fullData={filtered}
            paginatedData={pageRows}
            fontSize={cell.fontSize}
            columns={[
              { key: 'employeeId', label: 'Employee code / ID', render: (v) => text(v) },
              { key: 'userName', label: 'Learner', render: (v) => text(v) },
              { key: 'company', label: 'Company', render: (v) => text(v) },
              { key: 'courseTitle', label: 'Course', render: (v) => text(v) },
              { key: 'moduleTitle', label: 'Module', render: (v) => text(v) },
              { key: 'courseVersion', label: 'Version', render: (v) => text(v) },
              { key: 'requestedAttempt', label: 'Attempt asked for', render: (v) => text(String(v)) },
              { key: 'status', label: 'Status', render: (v) => <Badge variant={STATUS_VARIANT[v] || 'warning'}>{v}</Badge> },
              { key: 'decidedBy', label: 'Decided by', render: (v) => text(v || 'Not decided yet') },
              {
                key: 'actions',
                label: 'Decision',
                exportValue: () => '',
                render: (_, row) =>
                  row.status === 'Pending' ? (
                    <Flex gap={2}>
                      <Button size="S" disabled={updatingId === row.key} onClick={() => decide(row, 'Approved')}>
                        Approve
                      </Button>
                      <Button size="S" variant="danger-light" disabled={updatingId === row.key} onClick={() => decide(row, 'Rejected')}>
                        Reject
                      </Button>
                    </Flex>
                  ) : (
                    text('—')
                  ),
              },
            ]}
            pagination={{
              page: currentPage,
              pageSize,
              total: filtered.length,
              onPageChange: (p) => setPage(Number(p)),
              onPageSizeChange: (size) => {
                setPageSize(Number(size));
                setPage(1);
              },
            }}
            exportFileName={`quiz-reattempt-requests-${new Date().toISOString().slice(0, 10)}.xlsx`}
          />
        </>
      )}
    </>
  );
}
