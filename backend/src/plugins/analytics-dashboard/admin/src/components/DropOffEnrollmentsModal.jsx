// @ts-nocheck

import React, { useMemo, useState } from 'react';
import { Modal, Box, Typography, Button, Badge, Flex } from '@strapi/design-system';
import { DataTable } from './DataTable';

function getAccountStatusBadgeVariant(tag) {
  if (tag === 'Blocked') return 'danger';
  if (tag === 'Inactive') return 'warning';
  return 'success';
}

function renderAccountStatusTags(row) {
  const tags = Array.isArray(row?.accountStatusTags) && row.accountStatusTags.length > 0
    ? row.accountStatusTags
    : [row?.accountStatus || 'Active'];
  return (
    <Flex gap={1} wrap="wrap">
      {tags.map((tag) => (
        <Badge key={tag} variant={getAccountStatusBadgeVariant(tag)}>
          {tag}
        </Badge>
      ))}
    </Flex>
  );
}

function getRowCompany(row, fallbackCompany) {
  return String(row?.company || fallbackCompany || '').toLowerCase().trim();
}

function getEmployeeIdValue(row, fallbackCompany) {
  const rowCompany = getRowCompany(row, fallbackCompany);
  return rowCompany === 'aia' ? row?.emp_code : row?.emp_id;
}

export function DropOffEnrollmentsModal({ open, onClose, rows = [], company = '' }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const normalizedCompany = String(company || '').toLowerCase();

  const enrollments = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return enrollments.slice(start, start + pageSize);
  }, [enrollments, page, pageSize]);

  const columns = useMemo(() => [
    { key: 'employeeName', label: 'Employee Name' },
    {
      key: 'accountStatus',
      label: 'Account Status',
      render: (_, row) => renderAccountStatusTags(row),
      exportValue: (_, row) => row.accountStatus || 'Active',
    },
    {
      key: 'employeeIdValue',
      label: 'Employee ID',
      render: (_, row) => getEmployeeIdValue(row, normalizedCompany) || '—',
      exportValue: (_, row) => getEmployeeIdValue(row, normalizedCompany) || '—',
    },
    { key: 'email', label: 'Email' },
    { key: 'company', label: 'Company' },
    { key: 'courseTitle', label: 'Course' },
    {
      key: 'status',
      label: 'Status',
      render: (v) => String(v || '—').replace(/_/g, ' '),
    },
    { key: 'progressPercent', label: 'Progress %', render: (v) => `${v ?? 0}%` },
    { key: 'lastAccessedAt', label: 'Last Access' },
    {
      key: 'inactiveDays',
      label: 'Inactive Days',
      render: (v) => (v == null ? '—' : `${v} days`),
    },
  ], [normalizedCompany]);

  if (!open) return null;

  return (
    <Modal.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose?.()}>
      <Modal.Content style={{ maxWidth: '1100px', width: 'min(1100px, 96vw)' }}>
        <Modal.Header>
          <Modal.Title>Drop-off Enrollments</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Box paddingBottom={4}>
            <Typography variant="pi" textColor="neutral600">
              Employees who started a course, have not completed it, and have had no activity for 14+ days.
              Respects the current company, department, date, and course filters.
            </Typography>
          </Box>
          <DataTable
            data={paginatedRows}
            fullData={enrollments}
            paginatedData={paginatedRows}
            downloadStyle="all"
            title="Drop-off enrollments"
            exportFileName="drop-off-enrollments.xlsx"
            emptyMessage="No drop-off enrollments for the selected filters."
            pagination={enrollments.length > 0 ? {
              page,
              pageSize,
              total: enrollments.length,
              onPageChange: setPage,
              onPageSizeChange: (value) => {
                setPageSize(Number(value));
                setPage(1);
              },
            } : null}
            columns={columns}
          />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Close</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
