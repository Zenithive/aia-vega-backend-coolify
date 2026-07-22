//@ts-nocheck

import React, { useState, useEffect, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Flex, Loader, Badge, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import DateRangeInput from '../../../../analytics-dashboard/admin/src/components/DateRangeInput';
import { getFetchClient } from '@strapi/strapi/admin';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';

const TABLE_FONT_STYLE = { fontSize: '14px' };

const AuditLogPage = () => {
    const [search, setSearch] = useState('');
  const [logs, setLogs] = useState([]);
  const [allLogs, setAllLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fullDataLoading, setFullDataLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [action, setAction] = useState('');
  const contentType = 'plugin::users-permissions.user'; // Fixed to user collection
  const COMPANY_OPTIONS = [
    { value: '', label: 'All Companies' },
    { value: 'AIA', label: 'AIA' },
    { value: 'Vega', label: 'Vega' },
  ];
  const [companyFilter, setCompanyFilter] = useState('');

  const { get } = getFetchClient();
  const isMounted = useRef(true);

  const fetchLogs = async (page = 1, pageSizeArg) => {
    try {
      setLoading(true);
      setAllLogs([]);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: (pageSizeArg || pageSize).toString(),
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      if (dateRange.start) params.append('dateFrom', `${dateRange.start.getFullYear()}-${String(dateRange.start.getMonth()+1).padStart(2,'0')}-${String(dateRange.start.getDate()).padStart(2,'0')}`);
      if (dateRange.end) params.append('dateTo', `${dateRange.end.getFullYear()}-${String(dateRange.end.getMonth()+1).padStart(2,'0')}-${String(dateRange.end.getDate()).padStart(2,'0')}`);
      params.append('contentType', contentType); // Always filter by user collection
      if (action) params.append('action', action);
      if (companyFilter) params.append('company', companyFilter);
      const q = (search || '').trim();
      if (q && /^\d+$/.test(q)) params.append('search', q);

      const { data } = await get(`/audit-log/logs?${params}`);
      
      if (isMounted.current) {
        const rows = data.data || [];
        setLogs(rows);
        const tot = data.pagination?.total || 0;
        setTotal(tot);
        if (tot > 0 && tot > (pageSizeArg || pageSize)) {
          const allParams = new URLSearchParams({
            page: '1',
            pageSize: String(tot),
            sortBy: 'createdAt',
            sortOrder: 'desc',
          });
          if (dateRange.start) allParams.append('dateFrom', `${dateRange.start.getFullYear()}-${String(dateRange.start.getMonth()+1).padStart(2,'0')}-${String(dateRange.start.getDate()).padStart(2,'0')}`);
          if (dateRange.end) allParams.append('dateTo', `${dateRange.end.getFullYear()}-${String(dateRange.end.getMonth()+1).padStart(2,'0')}-${String(dateRange.end.getDate()).padStart(2,'0')}`);
          allParams.append('contentType', contentType);
          if (action) allParams.append('action', action);
          if (companyFilter) allParams.append('company', companyFilter);
          if (q && /^\d+$/.test(q)) allParams.append('search', q);
          get(`/audit-log/logs?${allParams}`)
            .then(({ data: allData }) => isMounted.current && setAllLogs(allData.data || []))
            .catch(() => setAllLogs([]));
        } else {
          setAllLogs(rows);
        }
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchLogs(page, pageSize);
  }, [page, pageSize, dateRange, action, companyFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [dateRange, action, companyFilter]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const getActionColor = (action) => {
    switch (action) {
      case 'created': return 'success';
      case 'updated': return 'warning';
      case 'deleted': return 'danger';
      default: return 'neutral';
    }
  };

  const getEmployeeIdentifier = (row) => {
    const user = row?.user || {};
    const company = String(user.company || row?.company || '').toLowerCase();

    if (company === 'aia') return user.emp_code || '—';
    if (company === 'vega') return user.emp_id || '—';
    return user.emp_code || user.emp_id || row?.userId || user.id || '—';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newSize) => {
    setPageSize(Number(newSize));
    setPage(1);
  };

  const handleDownloadStyleChange = (newStyle) => {
    // When user selects "All rows", fetch all data immediately
    if (newStyle === 'all' && allLogs.length === 0) {
      setFullDataLoading(true);
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(total),
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      if (dateRange.start) params.append('dateFrom', `${dateRange.start.getFullYear()}-${String(dateRange.start.getMonth()+1).padStart(2,'0')}-${String(dateRange.start.getDate()).padStart(2,'0')}`);
      if (dateRange.end) params.append('dateTo', `${dateRange.end.getFullYear()}-${String(dateRange.end.getMonth()+1).padStart(2,'0')}-${String(dateRange.end.getDate()).padStart(2,'0')}`);
      params.append('contentType', contentType);
      if (action) params.append('action', action);
      if (companyFilter) params.append('company', companyFilter);
      const q = (search || '').trim();
      if (q && /^\d+$/.test(q)) params.append('search', q);
      
      get(`/audit-log/logs?${params}`)
        .then(({ data: allData }) => {
          if (isMounted.current) {
            setAllLogs(allData.data || []);
            setFullDataLoading(false);
          }
        })
        .catch(() => {
          if (isMounted.current) {
            setAllLogs([]);
            setFullDataLoading(false);
          }
        });
    }
  };

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Employee Data Changes"
        subtitle="Track all changes made to user/employee accounts"
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {/* Filters */}
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
            <Flex gap={4} wrap="wrap">
                <Box style={{ minWidth: 160 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Company
                </Typography>
                <SingleSelect
                  value={companyFilter}
                  onChange={(v) => setCompanyFilter(String(v || ''))}
                >
                  {COMPANY_OPTIONS.map((opt) => (
                    <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Search
                </Typography>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={companyFilter.toLowerCase() === 'aia' ? 'Employee code (digits)' : companyFilter.toLowerCase() === 'vega' ? 'EMP ID (EMP12345)' : 'User, company, ID, etc.'}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    width: '100%',
                  }}
                />
              </Box>
              <Box style={{ minWidth: 260 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Date Range
                </Typography>
                <DateRangeInput
                  value={dateRange}
                  onChange={({ start, end }) => {
                    setDateRange({ start, end });
                  }}
                />
              </Box>
              <Box style={{ minWidth: 150 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Action
                </Typography>
                <SingleSelect
                  value={action}
                  onChange={(value) => setAction(String(value))}
                >
                  <SingleSelectOption value="">All Actions</SingleSelectOption>
                  <SingleSelectOption value="created">Created</SingleSelectOption>
                  <SingleSelectOption value="updated">Updated</SingleSelectOption>
                  <SingleSelectOption value="deleted">Deleted</SingleSelectOption>
                </SingleSelect>
              </Box>
            </Flex>
          </Box>

          {/* Audit Log Table */}
          {loading ? (
            <Flex justifyContent="center" padding={6}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : (
            <Box style={{ position: 'relative' }}>
              {fullDataLoading && (
                <Flex
                  justifyContent="center"
                  alignItems="center"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    zIndex: 10,
                    borderRadius: '4px',
                  }}
                  padding={6}
                >
                  <Flex direction="column" alignItems="center" gap={2}>
                    <Loader>Fetching all rows...</Loader>
                  </Flex>
                </Flex>
              )}
              <DataTable
                data={
                  logs.filter((log) => {
                    const q = (search || '').toLowerCase().trim();
                    const company = (log.user?.company || log.company || '').toLowerCase();
                    if (companyFilter && company !== companyFilter.toLowerCase()) return false;
                    if (!q) return true;
                    const user = log.user || {};
                    const matches = (
                      (user.username && user.username.toLowerCase().includes(q)) ||
                      (user.firstname && user.firstname.toLowerCase().includes(q)) ||
                      (user.lastname && user.lastname.toLowerCase().includes(q)) ||
                      (user.emp_code && String(user.emp_code).toLowerCase().includes(q)) ||
                      (user.emp_id && String(user.emp_id).toLowerCase().includes(q)) ||
                      (user.id && String(user.id).toLowerCase().includes(q)) ||
                      (log.userId && String(log.userId).toLowerCase().includes(q))
                    );
                    if (company === 'aia' && /^\d+$/.test(q)) return user.emp_code && String(user.emp_code).includes(q);
                    if (company === 'vega' && /^emp\d+$/i.test(q)) return user.emp_id && String(user.emp_id).toLowerCase().includes(q);
                    return matches;
                  })
                }
                fullData={allLogs.length > 0 ? allLogs : logs}
                paginatedData={logs}
                columns={[
                  { key: 'createdAt', label: 'Date & Time', render: (val) => <Typography variant="omega">{formatDate(val)}</Typography> },
                  { key: 'action', label: 'Action', render: (val) => <Badge variant={getActionColor(val)}>{val}</Badge> },
                  { key: 'userId', label: 'User ID', exportValue: (val, row) => getEmployeeIdentifier(row), render: (val, row) => {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{getEmployeeIdentifier(row)}</Typography>;
                    }
                  },
                  { key: 'userName', label: 'User Name', render: (val, row) => row.user?.username || row.userName || '—' },
                  { key: 'company', label: 'Company', render: (val, row) => row.user?.company || row.company || '—' },
                  {
                    key: 'adminUser',
                    label: 'Changed By',
                    exportValue: (val) => {
                      if (!val) return 'System';
                      const fullName = `${val.firstname || ''} ${val.lastname || ''}`.trim();
                      return fullName || val.username || val.email || 'System';
                    },
                    render: (val, row) => val ? `${val.firstname} ${val.lastname}` : 'System',
                  },
                  { key: 'changes', label: 'Changes', render: (val) => val && val.length > 0 ? val.map(c => c.field).join(', ') : '—' },
                ]}
                pagination={{
                  page,
                  pageSize,
                  total,
                  onPageChange: handlePageChange,
                  onPageSizeChange: handlePageSizeChange,
                }}
                onDownloadStyleChange={handleDownloadStyleChange}
                exportFileName={`audit-log-${new Date().toISOString().split('T')[0]}.xlsx`}
                fontSize={TABLE_FONT_STYLE.fontSize}
              />
            </Box>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
};

export default AuditLogPage;