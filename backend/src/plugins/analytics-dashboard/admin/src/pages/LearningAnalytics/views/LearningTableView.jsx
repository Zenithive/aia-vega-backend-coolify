// @ts-nocheck

import React from 'react';
import { Box, Badge, Flex, Typography } from '@strapi/design-system';
import { CourseStatusBadge, ProgressBar, formatDate, formatMinutes, formatScore, plural } from '../../../components/learningDetailUi';
import { CompactTable, DetailGrid } from '../../../components/CompactTable';

/**
 * Learning Analytics – Employee Table view.
 * Receives data and filter state from parent; renders the employee learning summary table.
 */
function applyEmployeeFilters(rows, search, filterCourse) {
  const q = (search || '').toLowerCase().trim();
  let filtered = rows || [];
  if (filterCourse) {
    filtered = filtered.filter((row) => {
      if (Array.isArray(row.coursesEnrolledIds)) {
        return row.coursesEnrolledIds.includes(filterCourse);
      }
      if (Array.isArray(row.coursesEnrolled)) {
        return row.coursesEnrolled.some((c) => {
          if (typeof c === 'object') return String(c.id) === String(filterCourse);
          return String(c) === String(filterCourse);
        });
      }
      return true;
    });
  }
  if (q) {
    filtered = filtered.filter((row) => {
      const name = (row.employeeName || '').toLowerCase();
      return name.includes(q);
    });
    if (filtered.length > 1) {
      const empCodeMatch = q.match(/\b\d{3,}\b/);
      const empIdMatch = q.match(/emp\d{3,}/i);
      if (empCodeMatch) {
        filtered = filtered.filter((row) =>
          (row.emp_code || '').toLowerCase().includes(empCodeMatch[0])
        );
      } else if (empIdMatch) {
        filtered = filtered.filter((row) =>
          (row.emp_id || '').toLowerCase().includes(empIdMatch[0].toLowerCase())
        );
      }
    }
  }
  return filtered;
}

function getRowCompany(row, fallbackCompany) {
  return String(row?.company || fallbackCompany || '').toLowerCase().trim();
}

function getEmployeeIdValue(row, fallbackCompany) {
  const rowCompany = getRowCompany(row, fallbackCompany);
  return rowCompany === 'aia' ? row?.emp_code : row?.emp_id;
}

function getLocationValue(row, fallbackCompany) {
  const rowCompany = getRowCompany(row, fallbackCompany);
  return rowCompany === 'aia' ? row?.branch : row?.working_location;
}

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

export function LearningTableView({
  data,
  allRows = [],
  search,
  filterCourse,
  company,
  sortOrder,
  setSortOrder,
  setPage,
  setPageSize,
}) {
  const rows = data?.rows || [];
  const exportRows = applyEmployeeFilters(allRows.length > 0 ? allRows : rows, search, filterCourse);
  const normalizedCompany = String(company || '').toLowerCase();

  return (
    <Box marginBottom={6}>
      <CompactTable
        title="Employee learning summary"
        subtitle="Each employee in the selected course. Click a row for more."
        rows={rows}
        allRows={exportRows}
        getRowKey={(row) => row.employeeId}
        emptyMessage="No employees found. Try adjusting filters or search."
        exportFileName="employee-learning-summary.xlsx"
        pagination={{
          page: data?.page || 1,
          pageSize: data?.pageSize || 10,
          total: data?.total || 0,
          onPageChange: setPage,
          onPageSizeChange: (v) => {
            setPageSize(Number(v));
            setPage(1);
          },
        }}
        sortBy="courseCompletionTimeMinutes"
        sortOrder={sortOrder}
        onSortChange={(_, order) => {
          setSortOrder(order);
          setPage(1);
        }}
        columns={[
          {
            key: 'employeeName',
            label: 'Employee',
            width: '28%',
            render: (row) => (
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography fontWeight="semiBold">{row.employeeName}</Typography>
                <Typography variant="pi" textColor="neutral600">
                  {[getEmployeeIdValue(row, normalizedCompany), getLocationValue(row, normalizedCompany)]
                    .filter((v) => v && v !== '—')
                    .join(' · ') || '—'}
                </Typography>
                {row.accountStatus && row.accountStatus !== 'Active' && renderAccountStatusTags(row)}
              </Flex>
            ),
          },
          {
            key: 'progressPercent',
            label: 'Progress',
            width: '22%',
            render: (row) => (
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <CourseStatusBadge
                  status={row.coursesCompleted ? 'Completed' : row.coursesInProgress ? 'In_progress' : 'Not_started'}
                />
                <ProgressBar value={row.progressPercent} />
                <Typography variant="pi" textColor="neutral600">
                  {`${(row.onlineModulesCompleted ?? 0) + (row.offlineModulesCompleted ?? 0)}/${(row.onlineModulesTotal ?? 0) + (row.offlineModulesTotal ?? 0)} modules`}
                </Typography>
                {row.coursesOverdue ? (
                  <Typography variant="pi" textColor="danger600">Overdue</Typography>
                ) : null}
              </Flex>
            ),
          },
          {
            key: 'avgQuizScore',
            label: 'Quiz',
            width: '15%',
            render: (row) =>
              row.quizAttempts ? (
                <Flex direction="column" alignItems="flex-start" title="Average of the best score in each quiz">
                  <Typography variant="pi">{`Score ${formatScore(row.avgQuizScore)}`}</Typography>
                  <Typography variant="pi" textColor="neutral600">
                    {`${row.quizModulesPassed ?? 0}/${row.quizModulesTotal ?? 0} passed · ${plural(row.quizAttempts, 'attempt')}`}
                  </Typography>
                </Flex>
              ) : (
                <Typography variant="pi" textColor="neutral500">—</Typography>
              ),
          },
          {
            key: 'courseCompletionTimeMinutes',
            label: 'Learning time',
            width: '13%',
            sortable: true,
            render: (row) => formatMinutes(row.courseCompletionTimeMinutes),
          },
          {
            key: 'lastActivityAt',
            label: 'Last activity',
            width: '14%',
            render: (row) =>
              row.lastActivityAt ? (
                <Typography variant="pi" textColor={(row.inactiveDays ?? 0) >= 14 && row.coursesInProgress ? 'danger600' : undefined}>
                  {row.inactiveDays === 0 ? 'Today' : `${row.inactiveDays}d ago`}
                </Typography>
              ) : (
                <Typography variant="pi" textColor="neutral500">No activity</Typography>
              ),
          },
        ]}
        renderExpanded={(row) => (
          <DetailGrid
            items={[
              ['Email', row.email],
              ['Company', row.company],
              ['Account', row.accountStatus || 'Active'],
              ['Online modules done', `${row.onlineModulesCompleted ?? 0}/${row.onlineModulesTotal ?? 0}`],
              ['Offline modules done', row.offlineModulesTotal ? `${row.offlineModulesCompleted ?? 0}/${row.offlineModulesTotal}` : '—'],
              row.offlineProofPending > 0 && ['Waiting for offline proof', plural(row.offlineProofPending, 'module')],
              ['Quiz modules passed', row.quizModulesTotal ? `${row.quizModulesPassed ?? 0}/${row.quizModulesTotal}` : '—'],
              ['Feedback', `${row.feedbackSubmitted ?? 0} given`],
              ['Content time', formatMinutes(row.contentMinutes)],
              ['Quiz time', formatMinutes(row.quizMinutes)],
              ['Last activity', formatDate(row.lastActivityAt)],
            ]}
          />
        )}
        exportColumns={[
          { label: 'Employee', value: (r) => r.employeeName },
          { label: 'Employee ID', value: (r) => getEmployeeIdValue(r, normalizedCompany) },
          { label: 'Email', value: (r) => r.email },
          { label: 'Company', value: (r) => r.company },
          { label: 'Location', value: (r) => getLocationValue(r, normalizedCompany) },
          { label: 'Account status', value: (r) => r.accountStatus || 'Active' },
          { label: 'Status', value: (r) => (r.coursesCompleted ? 'Completed' : r.coursesInProgress ? 'In progress' : r.coursesAssigned ? 'Not started' : '') },
          { label: 'Overdue', value: (r) => (r.coursesOverdue ? 'Yes' : 'No') },
          { label: 'Avg progress %', value: (r) => r.progressPercent },
          { label: 'Online modules done', value: (r) => `${r.onlineModulesCompleted ?? 0}/${r.onlineModulesTotal ?? 0}` },
          { label: 'Offline modules done', value: (r) => `${r.offlineModulesCompleted ?? 0}/${r.offlineModulesTotal ?? 0}` },
          { label: 'Waiting for offline proof', value: (r) => r.offlineProofPending },
          { label: 'Quiz attempts', value: (r) => r.quizAttempts },
          { label: 'Avg quiz score %', value: (r) => r.avgQuizScore },
          { label: 'Quiz modules passed', value: (r) => `${r.quizModulesPassed ?? 0}/${r.quizModulesTotal ?? 0}` },
          { label: 'Feedback given', value: (r) => r.feedbackSubmitted },
          { label: 'Feedback pending', value: (r) => r.feedbackPending },
          { label: 'Learning time (min)', value: (r) => r.courseCompletionTimeMinutes },
          { label: 'Content time (min)', value: (r) => r.contentMinutes },
          { label: 'Quiz time (min)', value: (r) => r.quizMinutes },
          { label: 'Last activity', value: (r) => formatDate(r.lastActivityAt) },
        ]}
      />
    </Box>
  );
}
