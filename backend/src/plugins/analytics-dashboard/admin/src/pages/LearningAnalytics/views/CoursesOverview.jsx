// @ts-nocheck
/**
 * Course view table (no course selected): one row per course with the main figures;
 * "View more" opens every other detail of that course.
 * Data: `coursesOverview` from /api/analytics/learning/global (services/learning/learningDetail.js).
 */
import React, { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { DataTable } from '../../../components/DataTable';
import { DetailsModal } from '../../../components/DetailsModal';
import { exportToExcel } from '../../../components/CompactTable';
import { formatMinutes, formatScore, plural, withVersion } from '../../../components/learningDetailUi';
import { MODULE_COLUMNS, MODULE_EXPORT } from './CourseDetailView';

const courseName = (c) => withVersion(c.title, c.version);
const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

/** Thin progress bar shown under the average progress figure. */
function Bar({ value }) {
  return (
    <Box style={{ height: 6, borderRadius: 3, background: '#dcdce4', overflow: 'hidden', marginTop: 4 }}>
      <Box style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: '#38A86F' }} />
    </Box>
  );
}

/** Excel of the course list: the table columns plus everything in the "View more" popup. */
const EXPORT_COLUMNS = [
  { label: 'Course', value: (c) => c.title },
  { label: 'Version', value: (c) => c.version },
  { label: 'Category', value: (c) => c.category },
  { label: 'Modules', value: (c) => c.totalModules },
  { label: 'Online modules', value: (c) => c.onlineModules },
  { label: 'Offline modules', value: (c) => c.offlineModules },
  { label: 'Quizzes', value: (c) => c.quizModules },
  { label: 'Pass mark %', value: (c) => (c.quizModules ? c.passMark : '') },
  { label: 'Feedback form', value: (c) => (c.feedbackEnabled ? 'Yes' : 'No') },
  { label: 'Assigned', value: (c) => c.assigned },
  { label: 'Completed', value: (c) => c.completed },
  { label: 'Completion %', value: (c) => c.completionRate },
  { label: 'In progress', value: (c) => c.inProgress },
  { label: 'Not started', value: (c) => c.notStarted },
  { label: 'Avg progress %', value: (c) => c.avgProgress },
  { label: 'Drop-off rate %', value: (c) => c.dropOffRate },
  { label: 'Avg learning time (min)', value: (c) => c.avgLearningMinutes },
  { label: 'Avg quiz time (min)', value: (c) => (c.quizModules ? c.avgQuizMinutes : '') },
  { label: 'Most learners on module', value: (c) => c.biggestDropModule?.title },
  { label: 'Quiz pass rate %', value: (c) => (c.quizModules ? c.quizPassRate : '') },
  { label: 'Avg quiz score %', value: (c) => c.avgQuizScore },
  { label: 'Feedback given', value: (c) => (c.feedbackEnabled ? c.feedbackSubmitted : '') },
  { label: 'Feedback pending', value: (c) => (c.feedbackEnabled ? c.feedbackPending : '') },
];

// The popup's module table leaves out the quiz pass rate (shown for the whole course above it),
// and its Excel also leaves out the completion %.
const POPUP_HIDDEN_COLUMNS = new Set(['quizPass']);
const POPUP_MODULE_COLUMNS = MODULE_COLUMNS.filter((c) => !POPUP_HIDDEN_COLUMNS.has(c.key));
const POPUP_MODULE_EXPORT = MODULE_EXPORT.filter((c) => !POPUP_HIDDEN_COLUMNS.has(c.column) && c.label !== 'Completion %');

export function CoursesOverview({ overview, onOpenCourse }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(null);

  if (!overview) {
    return (
      <Box padding={6} background="neutral0" hasRadius shadow="tableShadow">
        <Typography textColor="neutral600">Could not load the course list.</Typography>
      </Box>
    );
  }
  const { courses, inactiveDaysThreshold } = overview;
  const rows = courses.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <DataTable
        title="Course Progress"
        data={rows}
        fontSize="14px"
        emptyMessage="No course has learners assigned for these filters."
        onExport={() => exportToExcel(courses, EXPORT_COLUMNS, 'course-progress.xlsx', 'Courses')}
        pagination={{
          page,
          pageSize,
          total: courses.length,
          onPageChange: setPage,
          onPageSizeChange: (v) => {
            setPageSize(Number(v));
            setPage(1);
          },
        }}
        columns={[
          { key: 'title', label: 'Course', render: (_, c) => courseName(c) },
          { key: 'assigned', label: 'Assigned' },
          { key: 'completed', label: 'Completed', render: (v, c) => `${v} (${c.completionRate}%)` },
          { key: 'inProgress', label: 'In progress' },
          { key: 'notStarted', label: 'Not started' },
          { key: 'avgProgress', label: 'Avg progress', render: (v) => `${v}%` },
          {
            key: 'actions',
            label: '',
            render: (_, c) => (
              <Flex gap={2}>
                <Button size="S" variant="tertiary" onClick={() => setOpen(c)}>
                  View more
                </Button>
                <Button size="S" variant="secondary" onClick={() => onOpenCourse?.(c)}>
                  Open
                </Button>
              </Flex>
            ),
          },
        ]}
      />

      {open && (
        <DetailsModal
          maxWidth={1180}
          title={courseName(open)}
          tags={[
            open.category,
            `${plural(open.totalModules, 'module')} (${open.onlineModules} online, ${open.offlineModules} offline)`,
            open.quizModules ? `${plural(open.quizModules, 'quiz', 'quizzes')} · pass mark ${open.passMark}%` : 'No quiz',
            open.feedbackEnabled ? 'Feedback form' : 'No feedback form',
          ]}
          onClose={() => setOpen(null)}
          sections={[
            {
              title: 'Learners',
              items: [
                ['Assigned', open.assigned, 'learners on this course'],
                ['Completed', open.completed, `${open.completionRate}% of assigned`],
                ['In progress', open.inProgress, `${pctOf(open.inProgress, open.assigned)}% of assigned`],
                ['Not started', open.notStarted, `${pctOf(open.notStarted, open.assigned)}% of assigned`],
                ['Average progress', `${open.avgProgress}%`, <Bar key="bar" value={open.avgProgress} />],
                ['Drop-off rate', `${open.dropOffRate}%`, `started, no activity ${inactiveDaysThreshold}+ days`],
                ['Content time', formatMinutes(open.avgLearningMinutes - open.avgQuizMinutes), 'average per learner'],
                open.quizModules > 0 && ['Quiz time', formatMinutes(open.avgQuizMinutes), 'average per learner'],
                [
                  'Most learners are on',
                  open.biggestDropModule ? open.biggestDropModule.title : '—',
                  open.biggestDropModule ? plural(open.biggestDropModule.learners, 'learner') : null,
                ],
              ],
            },
            {
              title: open.quizModules > 0 ? 'Quiz and feedback' : 'Feedback',
              items: [
                open.quizModules > 0 && ['Quiz pass rate', open.quizAttempts ? `${open.quizPassRate}%` : '—', `pass mark ${open.passMark}%`],
                open.quizModules > 0 && ['Average quiz score', formatScore(open.avgQuizScore), 'best score in each quiz'],
                ...(open.feedbackEnabled
                  ? [
                      ['Feedback given', open.feedbackSubmitted, 'learners'],
                      ['Feedback pending', open.feedbackPending, 'finished all modules, not given yet'],
                    ]
                  : [['Feedback', 'No feedback form']]),
              ],
            },
          ]}
        >
          <Box marginBottom={5}>
            <DataTable
              title="Modules"
              data={open.modules || []}
              fontSize="13px"
              emptyMessage="This course has no modules."
              onExport={() => exportToExcel(open.modules || [], POPUP_MODULE_EXPORT, `modules-${open.title}.xlsx`, 'Modules')}
              columns={POPUP_MODULE_COLUMNS}
            />
          </Box>
          <Button
            onClick={() => {
              setOpen(null);
              onOpenCourse?.(open);
            }}
          >
            Open this course
          </Button>
        </DetailsModal>
      )}
    </>
  );
}
