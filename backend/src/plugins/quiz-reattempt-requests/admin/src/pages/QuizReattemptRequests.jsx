/**
 * Quiz Reattempt Requests – search, filter, pagination; Approve/Reject per row.
 */

// @ts-nocheck


import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import {
  Box,
  Typography,
  Button,
  Flex,
  Loader,
  Badge,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import { getFetchClient } from '@strapi/strapi/admin';

const DEFAULT_PAGE_SIZE = 10;
const TABLE_FONT_STYLE = { fontSize: '14px' };
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
];

export default function QuizReattemptRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  
  const { get, put } = getFetchClient();
  const isMounted = useRef(true);

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await get('/quiz-reattempt-requests/requests');
      const rows = Array.isArray(data.data) ? data.data : (data.results || data) || [];
      if (isMounted.current) {
        setList(Array.isArray(rows) ? rows : []);
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Failed to load');
        setList([]);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchList();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const updateStatus = async (documentId, newStatus) => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setError(null);
    try {
      await put(`/content-manager/collection-types/api::quiz-reattempt-request.quiz-reattempt-request/${encodeURIComponent(id)}`, {
        request_status: newStatus
      });

      if (isMounted.current) {
        setList((prev) =>
          prev.map((e) => {
            const eid = e.documentId ?? e.id ?? e._id;
            if (eid == null || String(eid) !== id) return e;
            return { ...e, request_status: newStatus };
          })
        );
        await fetchList();
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Update failed');
      }
    } finally {
      if (isMounted.current) {
        setUpdatingId(null);
      }
    }
  };

  const entryId = (entry) => entry.documentId ?? entry.id ?? entry._id;

  const getDisplayValues = (entry) => {
    const attrs = entry.attributes || entry;
    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const course = attrs.course?.data ?? attrs.course ?? {};
    const courseAttrs = course.attributes ?? course;
    const userName = userAttrs.username ?? userAttrs.email ?? '—';
    const courseTitle = courseAttrs.title ?? '—';
    const approvedBy = attrs.approved_by?.data ?? attrs.approved_by ?? {};
    const approvedByAttrs = approvedBy.attributes ?? approvedBy;
    const approvedByName = approvedByAttrs.firstname || approvedByAttrs.username || approvedByAttrs.email || approvedByAttrs.lastname
      ? `${approvedByAttrs.firstname || ''} ${approvedByAttrs.lastname || ''}`.trim() || approvedByAttrs.username || approvedByAttrs.email || 'Not reviewed'
      : 'Not reviewed';
    const statusRaw = attrs.request_status ?? entry.request_status ?? 'Pending';
    const statusVal = typeof statusRaw === 'string' ? statusRaw : 'Pending';
    return { userName, courseTitle, statusVal, attrs, approvedByName };
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const status = (statusFilter || '').trim();
    const company = (companyFilter || '').trim();
    return list.filter((entry) => {
      const { userName, courseTitle, statusVal, attrs } = getDisplayValues(entry);
      const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
      const userAttrs = user.attributes ?? user;
      const entryIdVal = entry.documentId ?? entry.id ?? entry._id;
      // Company filtering
      if (company) {
        const entryCompany = (attrs.company || userAttrs.company || '').toLowerCase();
        if (entryCompany !== company.toLowerCase()) return false;
      }
      // Enhanced search: always allow searching by name, emp_code, emp_id, user id, and request id
      if (status && statusVal !== status) return false;
      if (!q) return true;
      const matches = (
        (userName && userName.toLowerCase().includes(q)) ||
        (userAttrs.firstname && userAttrs.firstname.toLowerCase().includes(q)) ||
        (userAttrs.lastname && userAttrs.lastname.toLowerCase().includes(q)) ||
        (userAttrs.emp_code && String(userAttrs.emp_code).toLowerCase().includes(q)) ||
        (userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q)) ||
        (userAttrs.id && String(userAttrs.id).toLowerCase().includes(q)) ||
        (entryIdVal && String(entryIdVal).toLowerCase().includes(q))
      );
      // Company-specific strictness (optional: keep for digit/EMP pattern enforcement)
      if (company.toLowerCase() === 'aia' && /^\d+$/.test(q)) {
        return userAttrs.emp_code && String(userAttrs.emp_code).includes(q);
      } else if (company.toLowerCase() === 'vega' && /^emp\d+$/i.test(q)) {
        return userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q);
      }
      // Otherwise, allow match by any of the above
      return matches || (courseTitle && courseTitle.toLowerCase().includes(q));
    });
  }, [list, search, statusFilter, companyFilter]);

  const totalFiltered = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageList = filteredList.slice(start, start + pageSize);

  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Quiz Reattempt Requests"
        subtitle={
          loading
            ? 'Loading…'
            : `${list.length} request${list.length === 1 ? '' : 's'}`
        }
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          {/* Filters in card */}
          <Box
            padding={4}
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            marginBottom={6}
          >
            <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
              Filters
            </Typography>
            <Flex gap={4} wrap="wrap" alignItems="flex-end">
              <Box style={{ minWidth: 140 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Company
                </Typography>
                <SingleSelect
                  value={companyFilter}
                  onChange={(v) => {
                    setCompanyFilter(String(v || ''));
                    setPage(1);
                  }}
                >
                  <SingleSelectOption value="">All Companies</SingleSelectOption>
                  <SingleSelectOption value="AIA">AIA</SingleSelectOption>
                  <SingleSelectOption value="Vega">Vega</SingleSelectOption>
                </SingleSelect>
              </Box>
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Search
                </Typography>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={companyFilter.toLowerCase() === 'aia' ? 'Employee code (digits)' : companyFilter.toLowerCase() === 'vega' ? 'EMP ID (EMP12345)' : 'User, course, ID, etc.'}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    width: '100%',
                  }}
                />
              </Box>
              <Box style={{ minWidth: 140 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Status
                </Typography>
                <SingleSelect
                  value={statusFilter}
                  onChange={(v) => {
                    setStatusFilter(String(v || ''));
                    setPage(1);
                  }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
            </Flex>
          </Box>

          {loading ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : list.length === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">No quiz reattempt requests yet.</Typography>
            </Box>
          ) : totalFiltered === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">No requests match your search or filter.</Typography>
            </Box>
          ) : (
            <>
              {/* <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}> */}
                <DataTable
                  data={pageList}
                  fullData={filteredList}
                  paginatedData={pageList}
                  columns={[
                    { key: 'id', label: 'UserID', render: (val, row) => {
                        const attrs = row.attributes || row;
                        const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
                        const userAttrs = user.attributes ?? user;
                        const company = (attrs.company || userAttrs.company || '').toLowerCase();
                        if (company === 'aia') {
                          return <Typography variant="omega" style={TABLE_FONT_STYLE}>{userAttrs.emp_code || '—'}</Typography>;
                        } else if (company === 'vega') {
                          return <Typography variant="omega" style={TABLE_FONT_STYLE}>{userAttrs.emp_id || '—'}</Typography>;
                        } else {
                          return <Typography variant="omega" style={TABLE_FONT_STYLE}>—</Typography>;
                        }
                      }
                    },
                    { key: 'userName', label: 'User', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).userName}</Typography> },
                    { key: 'company', label: 'Company', render: (val, row) => {
                        const attrs = row.attributes || row;
                        const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
                        const userAttrs = user.attributes ?? user;
                        return <Typography variant="omega" style={TABLE_FONT_STYLE}>{attrs.company || userAttrs.company || '—'}</Typography>;
                      }
                    },
                    { key: 'courseTitle', label: 'Course', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).courseTitle}</Typography> },
                    { key: 'requested_for_attempt', label: 'Requested attempt', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).attrs.requested_for_attempt ?? '—'}</Typography> },
                    { key: 'statusVal', label: 'Status', render: (val, row) => {
                        const { statusVal } = getDisplayValues(row);
                        return <Badge
                          variant={
                            statusVal === 'Approved'
                              ? 'success'
                              : statusVal === 'Rejected'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {statusVal}
                        </Badge>;
                      }
                    },
                    { key: 'approvedByName', label: 'Approved by', render: (val, row) => {
                        const { approvedByName } = getDisplayValues(row);
                        return <Typography variant="omega" style={TABLE_FONT_STYLE}>{approvedByName}</Typography>;
                      }
                    },
                    { key: 'actions', label: 'Actions', render: (val, row) => {
                        const id = entryId(row);
                        const idStr = id != null ? String(id) : '';
                        const { statusVal } = getDisplayValues(row);
                        const isPending = statusVal === 'Pending';
                        const isUpdating = updatingId === idStr || updatingId === id;
                        return isPending ? (
                          <Flex gap={2}>
                            <Button
                              size="S"
                              variant="default"
                              disabled={isUpdating}
                              onClick={() => updateStatus(id, 'Approved')}
                            >
                              Approve
                            </Button>
                            <Button
                              size="S"
                              variant="danger"
                              disabled={isUpdating}
                              onClick={() => updateStatus(id, 'Rejected')}
                            >
                              Reject
                            </Button>
                          </Flex>
                        ) : (
                          <Typography variant="omega" textColor="neutral600" style={TABLE_FONT_STYLE}>
                            —
                          </Typography>
                        );
                      }
                    },
                  ]}
                  pagination={{
                    page: currentPage,
                    pageSize: pageSize,
                    total: totalFiltered,
                    onPageChange: (p) => setPage(Number(p)),
                    onPageSizeChange: (newSize) => {
                      setPageSize(Number(newSize));
                      setPage(1);
                    },
                  }}
                  exportFileName={`quiz-reattempt-requests-${new Date().toISOString().split('T')[0]}.xlsx`}
                  fontSize={TABLE_FONT_STYLE.fontSize}
                />
              {/* </Box> */}
            </>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
