
// @ts-nocheck

import React, { useCallback } from 'react';
import { Box, Flex, Typography, SingleSelect, SingleSelectOption, Button } from '@strapi/design-system';
import DateRangeInput from './DateRangeInput';

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
          <select
            value={company || ''}
            onChange={(e) => onCompanyChange(e.target.value || '')}
            style={{
              padding: '8px 12px',
              border: '1px solid #dcdce4',
              borderRadius: '4px',
              fontSize: '14px',
              minWidth: '100%',
            }}
          >
            {companies.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
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
                <select
                  value={department || ''}
                  onChange={(e) => onDepartmentChange(e.target.value || '')}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course
              </Typography>
              <select
                value={filterCourse || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setFilterCourse(v);
                  if (setFilterModule) setFilterModule('');
                  if (!v) {
                    if (setFilterQuizStatus) setFilterQuizStatus('');
                    if (setFilterFeedbackGiven) setFilterFeedbackGiven('');
                  }
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                <option value="">All Courses</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </Box>
            {filterCourse && setFilterModule && moduleOptions && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Module
                </Typography>
                <select
                  value={filterModule || ''}
                  onChange={(e) => setFilterModule(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Modules</option>
                  {moduleOptions.map((m) => (
                    <option key={m.value || m.title || m} value={m.value ?? m.title ?? m}>
                      {m.label ?? m.title ?? m.value ?? m}
                    </option>
                  ))}
                </select>
              </Box>
            )}
            {!filterCourse && (
              <Box style={{ minWidth: 160 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Course Type
                </Typography>
                <select
                  value={filterCourseCategory || ''}
                  onChange={(e) => setFilterCourseCategory?.(e.target.value || '')}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Types</option>
                  <option value="Mandatory">Mandatory</option>
                  <option value="Orientation">Orientation</option>
                  <option value="Other">Other</option>
                </select>
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Location
              </Typography>
              <select
                value={unitLocation || ''}
                onChange={(e) => onUnitLocationChange?.(e.target.value || '')}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                <option value="">All Locations</option>
                {unitLocations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
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
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              />
            </Box>
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course
              </Typography>
              <select
                value={filterCourse || ''}
                onChange={e => setFilterCourse(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </Box>
            <Box style={{ minWidth: 160 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course Status
              </Typography>
              <select
                value={filterStatus || ''}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                <option value="">All Statuses</option>
                <option value="Not_started">Not Started</option>
                <option value="In_progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Failed">Failed</option>
              </select>
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
                  border: '1px solid #dcdce4',
                  borderRadius: 4,
                  boxSizing: 'border-box',
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
                <select
                  value={filterCourse || ''}
                  onChange={(e) => {
                    setFilterCourse?.(e.target.value);
                    if (setFilterModule) setFilterModule('');
                  }}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Courses</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </Box>
            )}
            {viewMode === 'personal' && filterCourse && setFilterModule && moduleOptions && moduleOptions.length > 0 && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Module
                </Typography>
                <select
                  value={filterModule || ''}
                  onChange={(e) => setFilterModule(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Modules</option>
                  {moduleOptions.map((m) => (
                    <option key={m.value || m.title || m} value={m.value ?? m.title ?? m}>
                      {m.label ?? m.title ?? m.value ?? m}
                    </option>
                  ))}
                </select>
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
                <select
                  value={unitLocation || ''}
                  onChange={(e) => onUnitLocationChange?.(e.target.value || '')}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Unit Locations</option>
                  {unitLocations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Box>
            )}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Pages
              </Typography>
              <select
                value={activityType || ''}
                onChange={(e) => onActivityTypeChange?.(e.target.value || '')}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                {activityTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Box>
            {activityType === 'News' && onNewsIdChange && (
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  News
                </Typography>
                <select
                  value={newsId || ''}
                  onChange={(e) => onNewsIdChange(e.target.value || '')}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All News</option>
                  {newsList.map((n) => (
                    <option key={n.id} value={String(n.documentId ?? n.id)}>
                      {n.title} {n.likesCount != null ? `(${n.likesCount} likes)` : ''}
                    </option>
                  ))}
                </select>
              </Box>
            )}
            {departments.length > 0 && !activityTrackingEmployeeId && (
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Department
                </Typography>
                <select
                  value={department || ''}
                  onChange={(e) => onDepartmentChange(e.target.value || '')}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    minWidth: '100%',
                  }}
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Box>
            )}
          </>
        )}
        {showUnitLocation && viewMode !== 'personal' && viewMode !== 'global' && viewMode !== 'activityTracking' && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Unit Location
            </Typography>
            <select
              value={unitLocation || ''}
              onChange={(e) => onUnitLocationChange?.(e.target.value || '')}
              style={{
                padding: '8px 12px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
                minWidth: '100%',
              }}
            >
              <option value="">All Unit Locations</option>
              {unitLocations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name}
                </option>
              ))}
            </select>
          </Box>
        )}
      </Flex>
    </Box>
  );
}