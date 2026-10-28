
// @ts-nocheck

import React from 'react';
import { Box, Flex, Typography, SingleSelect, SingleSelectOption, Button } from '@strapi/design-system';
import { useTheme } from 'styled-components';
import DateRangeInput from './DateRangeInput';
import { withVersion } from './learningDetailUi';

/** Course versions are separate courses: show the version next to the title. */
const courseLabel = (c) => withVersion(c.title, c.version);
const EMPTY_FILTER_VALUE = '__all__';

function FilterSelect({ value, onChange, options }) {
  return (
    <SingleSelect
      value={value == null || value === '' ? EMPTY_FILTER_VALUE : String(value)}
      onChange={(nextValue) => onChange(nextValue === EMPTY_FILTER_VALUE ? '' : nextValue)}
    >
      {options.map((option) => (
        <SingleSelectOption
          key={String(option.value)}
          value={option.value == null || option.value === '' ? EMPTY_FILTER_VALUE : String(option.value)}
        >
          {option.label}
        </SingleSelectOption>
      ))}
    </SingleSelect>
  );
}

// Parse YYYY-MM-DD string as local date (not UTC)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
};

export function Filters({
  viewMode,
  onViewModeChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  department,
  onDepartmentChange,
  departments = [],
  company,
  onCompanyChange,
  showEmployeeSelector,
  children,
  showUnitLocation = false,
  unitLocation = '',
  onUnitLocationChange = null,
  unitLocations = [],
  showEmployeeTable = false,
  showActivityTracking = false,
  activityType = '',
  onActivityTypeChange = null,
  activityTrackingEmployeeId = null,
  hideViewFilter = false,
  search,
  onSearchChange,
  filterCourse,
  setFilterCourse,
  filterStatus,
  setFilterStatus,
  filterTimeValue,
  setFilterTimeValue,
  courses = [],
  // course view (global) filters – order: Company, Date range, Department, Course, Course type, Location, Quiz status, Feedback given
  filterCourseCategory = '',
  setFilterCourseCategory = null,
  filterQuizStatus = '',
  setFilterQuizStatus = null,
  filterFeedbackGiven = '',
  setFilterFeedbackGiven = null,
  filterModule = '',
  setFilterModule = null,
  moduleOptions = [],
  newsId = '',
  onNewsIdChange = null,
  newsList = [],
}) {
  const { colors } = useTheme();
  const activityTypeOptions = [
    { value: '', label: 'All Pages' },
    { value: 'News', label: 'News' },
    { value: 'Location', label: 'Location' },
    { value: 'Routes', label: 'Routes' },
    { value: 'People', label: 'People' },
    { value: 'Gallery', label: 'Gallery' },
    { value: 'Home', label: 'Home' },
    { value: 'Company policy', label: 'Company policy' },
    { value: 'Form & Templates', label: 'Form & Templates' },
    { value: 'Calendar', label: 'Calendar' },
  ];
  const companies = [
    { value: '', label: 'All Companies' },
    { value: 'AIA', label: 'AIA' },
    { value: 'Vega', label: 'Vega' },
  ];

  return (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      marginBottom={4}
    >
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        Filters
      </Typography>
      <Flex gap={4} wrap="wrap" alignItems="end">
        {/* 1. Company */}
        <Box style={{ minWidth: 140 }}>
          <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
            Company
          </Typography>
          <FilterSelect value={company} onChange={(value) => onCompanyChange(value || '')} options={companies} />
        </Box>
        {!hideViewFilter && (
          <Box style={{ minWidth: 140 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              View
            </Typography>
            <SingleSelect value={viewMode} onChange={onViewModeChange}>
              {showActivityTracking && (
                <SingleSelectOption value="activityTracking">Activity Tracking</SingleSelectOption>
              )}
              <SingleSelectOption value="global">Course</SingleSelectOption>
              {showEmployeeTable && (
                <>
                  <SingleSelectOption value="personal">Personal</SingleSelectOption>
                  <SingleSelectOption value="table">Employee Table</SingleSelectOption>
                </>
              )}
            </SingleSelect>
          </Box>
        )}
        {showEmployeeSelector && (viewMode === 'activityTracking' || viewMode === 'personal') && children}
        {/* Course view (global): 1.Company already above, 2.Date range, 3.Department, 4.Course, 5.Course type, 6.Location, 7.Quiz status, 8.Feedback given */}
        {viewMode === 'global' && (
          <>
            <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={{ start: parseLocalDate(dateFrom), end: parseLocalDate(dateTo) }}
                onChange={({ start, end }) => {
                  if (!start && !end) {
                    onDateFromChange(null);
                    onDateToChange(null);
                  } else if (start && end) {
                    onDateFromChange(start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null);
                    onDateToChange(end ? `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}` : null);
                  }
                }}
              />
            </Box>
            {departments.length > 0 && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Department
                </Typography>
                <FilterSelect
                  value={department}
                  onChange={(value) => onDepartmentChange(value || '')}
                  options={[
                    { value: '', label: 'All Departments' },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course
              </Typography>
              <FilterSelect
                value={filterCourse}
                onChange={(v) => {
                  setFilterCourse(v);
                  if (setFilterModule) setFilterModule('');
                  if (!v) {
                    if (setFilterQuizStatus) setFilterQuizStatus('');
                    if (setFilterFeedbackGiven) setFilterFeedbackGiven('');
                  }
                }}
                options={[
                  { value: '', label: 'All Courses' },
                  ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
                ]}
              />
            </Box>
            {filterCourse && setFilterModule && moduleOptions && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Module
                </Typography>
                <FilterSelect
                  value={filterModule}
                  onChange={setFilterModule}
                  options={[
                    { value: '', label: 'All Modules' },
                    ...moduleOptions.map((m) => ({
                      value: m.value ?? m.title ?? m,
                      label: m.label ?? m.title ?? m.value ?? m,
                    })),
                  ]}
                />
              </Box>
            )}
            {!filterCourse && (
              <Box style={{ minWidth: 160 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Course Type
                </Typography>
                <FilterSelect
                  value={filterCourseCategory}
                  onChange={(value) => setFilterCourseCategory?.(value || '')}
                  options={[
                    { value: '', label: 'All Types' },
                    { value: 'Mandatory', label: 'Mandatory' },
                    { value: 'Orientation', label: 'Orientation' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Location
              </Typography>
              <FilterSelect
                value={unitLocation}
                onChange={(value) => onUnitLocationChange?.(value || '')}
                options={[
                  { value: '', label: 'All Locations' },
                  ...unitLocations.map((l) => ({ value: l.id, label: l.name })),
                ]}
              />
            </Box>
            {/* Quiz Status and Feedback Given filters hidden as requested */}
          </>
        )}
        {viewMode === 'table' && (
          <>
            <Box style={{ minWidth: 200 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Search Employee
              </Typography>
              <input
                type="text"
                value={search || ''}
                onChange={(e) => onSearchChange?.(e.target.value || '')}
                placeholder="name"
                style={{
                  padding: '8px 12px',
                  border: `1px solid ${colors.neutral200}`,
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                  color: colors.neutral800,
                  background: colors.neutral0,
                }}
              />
            </Box>
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course
              </Typography>
              <FilterSelect
                value={filterCourse}
                onChange={setFilterCourse}
                options={courses.map((c) => ({ value: c.id, label: courseLabel(c) }))}
              />
            </Box>
            <Box style={{ minWidth: 160 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course Status
              </Typography>
              <FilterSelect
                value={filterStatus}
                onChange={setFilterStatus}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'Not_started', label: 'Not Started' },
                  { value: 'In_progress', label: 'In Progress' },
                  { value: 'Completed', label: 'Completed' },
                  { value: 'Failed', label: 'Failed' },
                ]}
              />
            </Box>
            <Box style={{ minWidth: 200, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course Completion Time (min)
              </Typography>
              <input
                type="number"
                min="0"
                value={filterTimeValue}
                onChange={e => setFilterTimeValue(e.target.value)}
                placeholder="e.g. 5"
                style={{
                  width: 120,
                  height: 36,
                  padding: '8px 12px',
                  border: `1px solid ${colors.neutral200}`,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  color: colors.neutral800,
                  background: colors.neutral0,
                }}
              />
            </Box>
            <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={{ start: parseLocalDate(dateFrom), end: parseLocalDate(dateTo) }}
                onChange={({ start, end }) => {
                  if (!start && !end) {
                    onDateFromChange(null);
                    onDateToChange(null);
                  } else if (start && end) {
                    onDateFromChange(start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null);
                    onDateToChange(end ? `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}` : null);
                  }
                }}
              />
            </Box>
          </>
        )}
        {/* Date Range and Course/Module for personal view */}
        {viewMode === 'personal' && (
          <>
            <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={{ start: parseLocalDate(dateFrom), end: parseLocalDate(dateTo) }}
                onChange={({ start, end }) => {
                  if (!start && !end) {
                    onDateFromChange(null);
                    onDateToChange(null);
                  } else if (start && end) {
                    onDateFromChange(start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null);
                    onDateToChange(end ? `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}` : null);
                  }
                }}
              />
            </Box>
            {courses && courses.length > 0 && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Course
                </Typography>
                <FilterSelect
                  value={filterCourse}
                  onChange={(value) => {
                    setFilterCourse?.(value);
                    if (setFilterModule) setFilterModule('');
                  }}
                  options={[
                    { value: '', label: 'All Courses' },
                    ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
                  ]}
                />
              </Box>
            )}
            {viewMode === 'personal' && filterCourse && setFilterModule && moduleOptions && moduleOptions.length > 0 && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Module
                </Typography>
                <FilterSelect
                  value={filterModule}
                  onChange={setFilterModule}
                  options={[
                    { value: '', label: 'All Modules' },
                    ...moduleOptions.map((m) => ({
                      value: m.value ?? m.title ?? m,
                      label: m.label ?? m.title ?? m.value ?? m,
                    })),
                  ]}
                />
              </Box>
            )}
          </>
        )}
        {/* Activity Tracking: Employee search, Date range, Unit location (when no employee), Pages, Department (when no employee) */}
        {showActivityTracking && viewMode === 'activityTracking' && (
          <>
            <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={{ start: parseLocalDate(dateFrom), end: parseLocalDate(dateTo) }}
                onChange={({ start, end }) => {
                  if (!start && !end) {
                    onDateFromChange(null);
                    onDateToChange(null);
                  } else if (start && end) {
                    onDateFromChange(start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null);
                    onDateToChange(end ? `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}` : null);
                  }
                }}
              />
            </Box>
            {showUnitLocation && !activityTrackingEmployeeId && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Unit Location
                </Typography>
                <FilterSelect
                  value={unitLocation}
                  onChange={(value) => onUnitLocationChange?.(value || '')}
                  options={[
                    { value: '', label: 'All Unit Locations' },
                    ...unitLocations.map((l) => ({ value: l.id, label: l.name })),
                  ]}
                />
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Pages
              </Typography>
              <FilterSelect
                value={activityType}
                onChange={(value) => onActivityTypeChange?.(value || '')}
                options={activityTypeOptions}
              />
            </Box>
            {activityType === 'News' && onNewsIdChange && (
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  News
                </Typography>
                <FilterSelect
                  value={newsId}
                  onChange={(value) => onNewsIdChange(value || '')}
                  options={[
                    { value: '', label: 'All News' },
                    ...newsList.map((n) => ({
                      value: n.documentId ?? n.id,
                      label: `${n.title} ${n.likesCount != null ? `(${n.likesCount} likes)` : ''}`,
                    })),
                  ]}
                />
              </Box>
            )}
            {departments.length > 0 && !activityTrackingEmployeeId && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Department
                </Typography>
                <FilterSelect
                  value={department}
                  onChange={(value) => onDepartmentChange(value || '')}
                  options={[
                    { value: '', label: 'All Departments' },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </Box>
            )}
          </>
        )}
        {showUnitLocation && viewMode !== 'personal' && viewMode !== 'global' && viewMode !== 'activityTracking' && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Unit Location
            </Typography>
            <FilterSelect
              value={unitLocation}
              onChange={(value) => onUnitLocationChange?.(value || '')}
              options={[
                { value: '', label: 'All Unit Locations' },
                ...unitLocations.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
          </Box>
        )}
      </Flex>
    </Box>
  );
}