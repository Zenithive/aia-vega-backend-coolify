import React, { useMemo } from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { LineChart } from '../../../components/LineChart';
import { BarChart } from '../../../components/BarChart';
import { DataTable } from '../../../components/DataTable';
import { DropOffEnrollmentsModal } from '../../../components/DropOffEnrollmentsModal';

/**
 * Learning Analytics – Course (global) view.
 * Same table as Personal view but data across all users. One table only; Table/Chart toggle (right-aligned).
 */
export function LearningGlobalView({
  data,
  courseContentViewType,
  setCourseContentViewType,
  kpis,
  live,
  quiz,
  filterCourse,
  filterModule,
  courseModules = [],
  moduleDetailPage,
  moduleDetailPageSize,
  setModuleDetailPage,
  setModuleDetailPageSize,
  company = '',
}) {
  const [downloadStyle, setDownloadStyle] = React.useState('shown'); // 'shown' or 'all'
  const [showDropOffModal, setShowDropOffModal] = React.useState(false);
  const dataView = courseContentViewType === 'table' ? 'table' : 'chart';
  const setDataView = (v) => setCourseContentViewType(v === 'table' ? 'table' : 'statistics');

  const hasCourse = Boolean(filterCourse);
  const hasModule = Boolean(filterModule !== '' && filterModule != null);
  const moduleIndexSelected = hasModule ? Number(filterModule) : null;
  const liveTotals = live?.totals || {};

  const courseProgress = Array.isArray(data?.courseProgress) ? data.courseProgress : [];
  const dropOffEnrollments = Array.isArray(data?.dropOffEnrollments) ? data.dropOffEnrollments : [];

  const tableRows = useMemo(() => {
    const withoutUnknown = (courseProgress || []).filter((p) => {
      const title = String(p.courseTitle ?? p.course?.title ?? '').trim();
      if (!title) return false;
      return title.toLowerCase() !== 'unknown';
    });

    if (!hasCourse) return withoutUnknown;
    const courseIdStr = String(filterCourse).trim();
    return withoutUnknown.filter((p) => {
      const id = p.courseId ?? p.course?.id ?? p.course?.documentId ?? '';
      const title = (p.courseTitle ?? p.course?.title ?? '').trim().toLowerCase();
      const matchId = String(id) === courseIdStr || (courseIdStr.length <= 10 && Number(id) === Number(courseIdStr));
      const matchTitle = courseIdStr.length > 10 && title && (title === courseIdStr.toLowerCase() || title.includes(courseIdStr.toLowerCase()));
      return matchId || matchTitle;
    });
  }, [hasCourse, filterCourse, courseProgress]);

  const moduleColumnsForCourse = useMemo(() => {
    if (!hasCourse || !courseModules.length) return [];
    if (hasModule && moduleIndexSelected !== null && !Number.isNaN(moduleIndexSelected)) {
      const m = courseModules.find((mod) => (mod.index ?? mod.moduleIndex) === moduleIndexSelected);
      if (!m) return [];
      const label = m.title ?? `Module ${(moduleIndexSelected ?? 0) + 1}`;
      const key = `mod_${moduleIndexSelected}`;
      return [{ key, label, moduleIndex: moduleIndexSelected }];
    }
    return courseModules.map((m) => {
      const idx = m.index ?? m.moduleIndex ?? 0;
      return { key: `mod_${idx}`, label: m.title ?? `Module ${idx + 1}`, moduleIndex: idx };
    });
  }, [hasCourse, hasModule, moduleIndexSelected, courseModules]);

  const tableColumns = useMemo(() => {
    const base = [
      {
        key: 'courseTitle',
        label: 'Course',
        header: (
          <Typography variant="sigma" textColor="neutral600" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
            Course
          </Typography>
        ),
        render: (v) => (
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220, display: 'block' }} title={v}>{v}</span>
        ),
      },
      { key: 'courseCategory', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'percentage', label: 'Progress %', render: (v) => (v != null ? `${v}%` : '—') },
      { key: 'timeSpentMinutes', label: 'Time (min)' },
      {
        key: 'certificateIssued',
        label: 'Certificate',
        header: (
          <Flex direction="column" gap={0} alignItems="flex-start">
            <Typography variant="sigma" textColor="neutral600">Certificate</Typography>
            <Typography variant="pi" textColor="neutral500" style={{ fontSize: '11px', fontWeight: 'normal' }}>
              per enrollment
            </Typography>
          </Flex>
        ),
      },
      { key: 'dropOffRate', label: 'Drop Off Rate', render: (v, row) => `${v ?? 0}% (${row.dropOffCount ?? 0})` },
    ];
    const moduleColDefs = moduleColumnsForCourse.map((m) => ({
      key: m.key,
      label: m.label,
      exportLabel: `${m.label} (watched/duration min)`,
      header: (
        <Flex direction="column" gap={0} alignItems="flex-start">
          <Typography variant="sigma" textColor="neutral600">{m.label}</Typography>
          <Typography variant="pi" textColor="neutral500" style={{ fontSize: '11px', fontWeight: 'normal' }}>
            watched/duration min
          </Typography>
        </Flex>
      ),
    }));
    return [...base, ...moduleColDefs];
  }, [moduleColumnsForCourse]);

  const paginatedTableData = useMemo(() => {
    if (!tableRows.length) return [];
    const start = (moduleDetailPage - 1) * moduleDetailPageSize;
    return tableRows.slice(start, start + moduleDetailPageSize);
  }, [tableRows, moduleDetailPage, moduleDetailPageSize]);

  return (
    <>
      <Flex marginBottom={4} alignItems="center" justifyContent="flex-end" gap={2}>
        <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
          View:
        </Typography>
        <Button variant={dataView === 'table' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('table')}>
          Table
        </Button>
        <Button variant={dataView === 'chart' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('chart')}>
          Chart
        </Button>
      </Flex>

      <Flex gap={4} marginBottom={6} wrap="wrap" alignItems="stretch">
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Total Course" value={kpis.totalCourses ?? 0} colorIndex={0} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Total Enrollment" value={kpis.totalEnrollments ?? kpis.totalAssignments ?? 0} colorIndex={1} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Completion Rate" value={`${kpis.completionRate ?? 0}%`} colorIndex={2} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Avg Learning Time" value={`${kpis.avgTimeSpentMinutes ?? 0} min`} subtext="per enrollment" colorIndex={2} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Avg Quiz Score" value={kpis.avgQuizScore ?? quiz?.avgScore ?? 0} colorIndex={3} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard
            label="Drop Off Rate"
            value={`${kpis.dropOffRate ?? 0}%`}
            subtext={kpis.dropOffCount != null ? `${kpis.dropOffCount} enrollments inactive 14+ days` : undefined}
            colorIndex={4}
            action={{
              label: 'View',
              onClick: () => setShowDropOffModal(true),
              disabled: !(kpis.dropOffCount > 0),
            }}
          />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160, display: 'flex' }}>
          <StatCard label="Completed Course" value={kpis.completedCourse ?? 0} colorIndex={5} />
        </Box>
      </Flex>

      {dataView === 'chart' && (
        <>
            <Box style={{ width: '100%', marginBottom: 24 }}>
              <BarChart
                data={(() => {
                  // Global view: show all users' time spent per course
                  if (!hasCourse) {
                    return courseProgress
                      .map((cp) => {
                        const raw = String(cp.courseTitle ?? cp.course?.title ?? '').trim();
                        return {
                          name: raw,
                          value: cp.timeSpentMinutes ?? cp.timeSpent ?? 0,
                        };
                      })
                      .filter((row) => {
                        if (!row.name) return false;
                        return row.name.toLowerCase() !== 'unknown';
                      });
                  }
                  // Course selected: show all modules' time spent
                  if (hasCourse && courseModules.length > 0) {
                    // Find course progress for selected course
                    const cp = tableRows[0];
                    if (!cp) return [];
                    return courseModules.map((mod) => {
                      const modVal = cp[`mod_${mod.index}`];
                      let watched = 0, duration = null;
                      if (typeof modVal === 'string' && modVal.includes('/')) {
                        const [w, d] = modVal.split('/').map(s => s.trim());
                        watched = Number(w) || 0;
                        duration = d ? Number(d) : null;
                      } else if (!isNaN(Number(modVal))) {
                        watched = Number(modVal);
                      }
                      return {
                        name: mod.title ?? `Module ${mod.index + 1}`,
                        value: watched,
                        watched,
                        duration,
                      };
                    });
                  }
                  return [];
                })()}
                title={hasCourse ? 'Time Spent per Module' : 'Time Spent per Course'}
                dataKey="value"
                nameKey="name"
                height={320}
                layout="horizontal"
                valueLabel="Time Spent"
                valueUnit="min"
                tooltipFormatter={(value, name, props) => {
                  if (hasCourse && props?.payload) {
                    const { watched, duration } = props.payload;
                    if (watched != null && duration != null) return [`${watched}/${duration} min`];
                    if (watched != null) return [`${watched} min`];
                  }
                  return [`${value} min`];
                }}
              />
            </Box>
          <Flex gap={4} marginBottom={6} wrap="wrap">
            <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
              <DonutChart
                data={data?.statusDistribution || []}
                title="Course Status Distribution"
                height={280}
              />
            </Box>
          </Flex>
        </>
      )}

      {dataView === 'table' && (
        <Box marginBottom={6}>
          <DataTable
            data={downloadStyle === 'all' ? tableRows : paginatedTableData}
            fullData={tableRows}
            paginatedData={paginatedTableData}
            downloadStyle={downloadStyle}
            title="Course Progress"
            exportFileName="course-progress.xlsx"
            emptyMessage={hasCourse ? (hasModule ? 'No data for the selected course and module.' : 'No data for the selected course.') : 'No course progress data.'}
            pagination={tableRows.length > 0 ? {
              page: moduleDetailPage,
              pageSize: moduleDetailPageSize,
              total: tableRows.length,
              onPageChange: setModuleDetailPage,
              onPageSizeChange: (v) => {
                setModuleDetailPageSize(Number(v));
                setModuleDetailPage(1);
              },
            } : null}
            columns={tableColumns}
          />
        </Box>
      )}
      <DropOffEnrollmentsModal
        open={showDropOffModal}
        onClose={() => setShowDropOffModal(false)}
        rows={dropOffEnrollments}
        company={company}
      />
    </>
  );
}
