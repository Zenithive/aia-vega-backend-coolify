// @ts-nocheck
/**
 * Course view table (one course selected): its modules, then every assigned learner,
 * with all important figures as columns.
 * Data: `courseDetail` from /api/analytics/learning/global (services/learning/learningDetail.js).
 */
import React, { useMemo, useState } from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { DataTable } from '../../../components/DataTable';
import { exportToExcel } from '../../../components/CompactTable';
import {
  CourseStatusBadge,
  ModuleTypeBadge,
  courseStatusLabel,
  formatDate,
  formatDays,
  formatMinutes,
  formatScore,
  withVersion,
} from '../../../components/learningDetailUi';

const LEARNER_GROUPS = [
  { key: 'all', label: 'All learners', test: () => true },
  { key: 'notStarted', label: 'Not started', test: (l) => l.status === 'Not_started' },
  { key: 'inProgress', label: 'In progress', test: (l) => l.status === 'In_progress' || l.status === 'Failed' },
  { key: 'completed', label: 'Completed', test: (l) => l.status === 'Completed' },
  { key: 'overdue', label: 'Overdue', test: (l) => l.overdue },
  { key: 'inactive', label: 'Inactive', test: (l, t) => l.status !== 'Completed' && l.status !== 'Not_started' && (l.inactiveDays ?? 0) >= t },
  { key: 'quizFailed', label: 'Quiz not passed', test: (l) => l.status === 'Failed' },
  { key: 'feedback', label: 'Feedback pending', test: (l) => l.feedback === 'Pending' },
];

const selectStyle = { padding: '8px 12px', border: '1px solid #dcdce4', borderRadius: 4, fontSize: 14 };
const nowrap = (text) => <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
const dash = (v) => (v == null || v === '' ? '—' : v);

/** Module columns (also used in the course "View more" popup). */
export const MODULE_COLUMNS = [
  { key: 'title', label: 'Module', render: (v, m) => `${m.index + 1}. ${v}` },
  {
    key: 'type',
    label: 'Type',
    render: (v, m) => (
      <Flex gap={1}>
        <ModuleTypeBadge type={v} />
        {m.hasQuiz && <Typography variant="pi" textColor="neutral600">+ quiz</Typography>}
      </Flex>
    ),
  },
  { key: 'completed', label: 'Completed', render: (v, m) => nowrap(`${v}/${m.learners} (${m.completionRate}%)`) },
  { key: 'inProgress', label: 'In progress', render: (v, m) => (m.type === 'Offline' ? '—' : v) },
  { key: 'notStarted', label: 'Not started', render: (v, m) => (m.type === 'Offline' ? '—' : v + m.locked) },
  { key: 'quizPass', label: 'Quiz pass rate', render: (_, m) => (m.quiz?.attempts ? `${m.quiz.passRate}%` : '—') },
  { key: 'quizScore', label: 'Avg score', render: (_, m) => (m.quiz?.attempts ? formatScore(m.quiz.avgScore) : '—') },
  { key: 'attempts', label: 'Attempts', render: (_, m) => (m.quiz ? m.quiz.attempts : '—') },
  { key: 'avgTimeMinutes', label: 'Avg time', render: (v) => formatMinutes(v) },
];

/** Excel columns matching MODULE_COLUMNS; `column` links each to the table column it belongs to. */
export const MODULE_EXPORT = [
  { label: '#', column: 'title', value: (m) => m.index + 1 },
  { label: 'Module', column: 'title', value: (m) => m.title },
  { label: 'Type', column: 'type', value: (m) => m.type },
  { label: 'Has quiz', column: 'type', value: (m) => (m.hasQuiz ? 'Yes' : 'No') },
  { label: 'Learners', column: 'completed', value: (m) => m.learners },
  { label: 'Completed', column: 'completed', value: (m) => m.completed },
  { label: 'Completion %', column: 'completed', value: (m) => m.completionRate },
  { label: 'In progress', column: 'inProgress', value: (m) => (m.type === 'Offline' ? '' : m.inProgress) },
  { label: 'Not started', column: 'notStarted', value: (m) => (m.type === 'Offline' ? '' : m.notStarted + m.locked) },
  { label: 'Quiz pass rate %', column: 'quizPass', value: (m) => m.quiz?.passRate },
  { label: 'Avg quiz score % (best per learner)', column: 'quizScore', value: (m) => m.quiz?.avgScore },
  { label: 'Quiz attempts', column: 'attempts', value: (m) => m.quiz?.attempts },
  { label: 'Avg time (min)', column: 'avgTimeMinutes', value: (m) => m.avgTimeMinutes },
];

const learnerColumns = (idLabel, threshold) => [
  { key: 'name', label: 'Learner', render: (v) => nowrap(v) },
  { key: 'empCode', label: idLabel, render: (_, l) => dash(l.empCode || l.empId) },
  { key: 'department', label: 'Department', render: dash },
  { key: 'status', label: 'Status', render: (v) => <CourseStatusBadge status={v} /> },
  { key: 'progressPercent', label: 'Progress', render: (v) => `${v}%` },
  { key: 'completedModules', label: 'Modules done', render: (v, l) => `${v}/${l.totalModules}` },
  { key: 'currentModule', label: 'Current module', render: (v) => v || 'All done' },
  { key: 'avgQuizScore', label: 'Quiz score', render: (v, l) => (l.quizAttempts ? formatScore(v) : '—') },
  { key: 'quizAttempts', label: 'Attempts', render: (v) => v || '—' },
  { key: 'feedback', label: 'Feedback', render: (v) => nowrap(v) },
  { key: 'startedAt', label: 'Started', render: (v) => nowrap(formatDate(v)) },
  { key: 'completedAt', label: 'Completed', render: (v) => nowrap(formatDate(v)) },
  {
    key: 'dueDate',
    label: 'Due',
    render: (v, l) => (
      <Typography variant="pi" textColor={l.overdue ? 'danger600' : undefined} style={{ whiteSpace: 'nowrap' }}>
        {`${formatDate(v)}${l.overdue ? ' (overdue)' : ''}`}
      </Typography>
    ),
  },
  {
    key: 'lastActivityAt',
    label: 'Last active',
    render: (v, l) => (
      <Typography
        variant="pi"
        textColor={l.status !== 'Completed' && (l.inactiveDays ?? 0) >= threshold ? 'danger600' : undefined}
        style={{ whiteSpace: 'nowrap' }}
      >
        {v ? (l.inactiveDays === 0 ? 'Today' : `${l.inactiveDays}d ago`) : '—'}
      </Typography>
    ),
  },
  { key: 'learningMinutes', label: 'Learning time', render: (v) => nowrap(formatMinutes(v)) },
];

const learnerExport = (idLabel) => [
  { label: 'Learner', value: (l) => l.name },
  { label: idLabel, value: (l) => l.empCode || l.empId },
  { label: 'Department', value: (l) => l.department },
  { label: 'Status', value: (l) => courseStatusLabel(l.status) },
  { label: 'Progress %', value: (l) => l.progressPercent },
  { label: 'Modules done', value: (l) => `${l.completedModules}/${l.totalModules}` },
  { label: 'Current module', value: (l) => l.currentModule },
  { label: 'Quiz attempts', value: (l) => l.quizAttempts },
  { label: 'Quiz score %', value: (l) => l.avgQuizScore },
  { label: 'Feedback', value: (l) => l.feedback },
  { label: 'Started', value: (l) => formatDate(l.startedAt) },
  { label: 'Completed', value: (l) => formatDate(l.completedAt) },
  { label: 'Due', value: (l) => formatDate(l.dueDate) },
  { label: 'Last activity', value: (l) => formatDate(l.lastActivityAt) },
  { label: 'Learning time (min)', value: (l) => l.learningMinutes },
];

function usePaging(total) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  return {
    slice: (list) => list.slice((current - 1) * pageSize, current * pageSize),
    reset: () => setPage(1),
    pagination: {
      page: current,
      pageSize,
      total,
      onPageChange: setPage,
      onPageSizeChange: (v) => {
        setPageSize(Number(v));
        setPage(1);
      },
    },
  };
}

export function CourseDetailView({ detail, company = '' }) {
  const [group, setGroup] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('');
  const [search, setSearch] = useState('');

  const { course, inactiveDaysThreshold, modules = [], learners = [] } = detail || {};
  const idLabel = String(company).toLowerCase() === 'vega' ? 'Employee ID' : 'Employee code';
  const threshold = inactiveDaysThreshold ?? 14;

  const shown = useMemo(() => {
    const g = LEARNER_GROUPS.find((x) => x.key === group) || LEARNER_GROUPS[0];
    const q = search.trim().toLowerCase();
    return learners
      .filter((l) => g.test(l, threshold))
      .filter((l) => moduleFilter === '' || (l.status !== 'Completed' && String(l.currentModuleIndex) === moduleFilter))
      .filter((l) => !q || [l.name, l.email, l.empCode, l.empId, l.department].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [learners, group, moduleFilter, search, threshold]);

  const modulePaging = usePaging(modules.length);
  const learnerPaging = usePaging(shown.length);

  if (!detail) {
    return (
      <Box padding={6} background="neutral0" hasRadius shadow="tableShadow">
        <Typography textColor="neutral600">No details for this course.</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box marginBottom={6}>
        <DataTable
          title={`Modules — ${withVersion(course.title, course.version)}`}
          data={modulePaging.slice(modules)}
          fontSize="14px"
          emptyMessage="This course has no modules."
          onExport={() => exportToExcel(modules, MODULE_EXPORT, `modules-${course.title}.xlsx`, 'Modules')}
          pagination={modulePaging.pagination}
          columns={MODULE_COLUMNS}
        />
      </Box>

      <Flex gap={3} wrap="wrap" alignItems="flex-end" marginBottom={3}>
        <Box>
          <Typography variant="pi" textColor="neutral600" tag="p">Show</Typography>
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              learnerPaging.reset();
            }}
            style={selectStyle}
          >
            {LEARNER_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {`${g.label} (${learners.filter((l) => g.test(l, threshold)).length})`}
              </option>
            ))}
          </select>
        </Box>
        <Box>
          <Typography variant="pi" textColor="neutral600" tag="p">Current module</Typography>
          <select
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              learnerPaging.reset();
            }}
            style={selectStyle}
          >
            <option value="">Any module</option>
            {modules.map((m) => (
              <option key={m.index} value={String(m.index)}>{`${m.index + 1}. ${m.title}`}</option>
            ))}
          </select>
        </Box>
        <Box>
          <Typography variant="pi" textColor="neutral600" tag="p">Search</Typography>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              learnerPaging.reset();
            }}
            placeholder="Name, code or department"
            style={{ ...selectStyle, width: 240 }}
          />
        </Box>
      </Flex>

      <Box marginBottom={6}>
        <DataTable
          title="Learners"
          data={learnerPaging.slice(shown)}
          fontSize="14px"
          emptyMessage="No learners in this group."
          onExport={() => exportToExcel(shown, learnerExport(idLabel), `learners-${course.title}.xlsx`, 'Learners')}
          pagination={learnerPaging.pagination}
          columns={learnerColumns(idLabel, threshold)}
        />
      </Box>
    </>
  );
}
