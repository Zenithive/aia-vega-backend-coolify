// @ts-nocheck


import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader } from '@strapi/design-system';
import * as XLSX from 'xlsx';
import { useAnalytics, isAbortError } from '../../hooks/useAnalytics';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';
import { LearningTableView } from './views/LearningTableView';
import { LearningGlobalView } from './views/LearningGlobalView';
import { LearningPersonalView } from './views/LearningPersonalView';

const dedupeList = (arr) => (Array.isArray(arr) ? arr.filter((x, i, a) => a.findIndex((y) => String(y?.id ?? y) === String(x?.id ?? x)) === i) : []);

function LearningAnalyticsLoadingOverlay({ label = 'Loading analytics…' }) {
  return (
    <Box
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255, 255, 255, 0.72)',
        borderRadius: '4px',
        pointerEvents: 'auto',
      }}
      aria-live="polite"
      aria-busy="true"
    >
      <Flex direction="column" alignItems="center" gap={3}>
        <Loader>{label}</Loader>
        <Typography variant="pi" textColor="neutral600">
          Updating results for the selected filters…
        </Typography>
      </Flex>
    </Box>
  );
}

export default function LearningAnalyticsPage() {
  const [viewMode, setViewMode] = useState('global');
  const [courseContentViewType, setCourseContentViewType] = useState('statistics');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [department, setDepartment] = useState('');
  const [company, setCompany] = useState('');
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeDetail, setEmployeeDetail] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [courseProgressPage, setCourseProgressPage] = useState(1);
  const [courseProgressPageSize, setCourseProgressPageSize] = useState(10);
  const [moduleVideoPage, setModuleVideoPage] = useState(1);
  const [moduleVideoPageSize, setModuleVideoPageSize] = useState(10);
  const [moduleDetailPage, setModuleDetailPage] = useState(1);
  const [moduleDetailPageSize, setModuleDetailPageSize] = useState(10);
  const [selectedCourseForModules, setSelectedCourseForModules] = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [courses, setCourses] = useState([]);
  const [filterCourseCategory, setFilterCourseCategory] = useState('');
  const [unitLocation, setUnitLocation] = useState('');
  const [unitLocations, setUnitLocations] = useState([]);
  const [filterQuizStatus, setFilterQuizStatus] = useState('');
  const [filterFeedbackGiven, setFilterFeedbackGiven] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [courseModules, setCourseModules] = useState([]);
  const searchTimeoutRef = useRef(null);
  const coursesFetchKeyRef = useRef('');
  const coursesFetchInFlightRef = useRef(false);
  const departmentsFetchCompanyRef = useRef(null);
  const loadRequestIdRef = useRef(0);
  const lastFetchContextRef = useRef('');
  // Personal view: full list of enrolled courses so course dropdown shows all even when one course is selected
  const [personalEnrolledCourses, setPersonalEnrolledCourses] = useState([]);
  // Employee table: full list of rows for "All rows" export (when total > pageSize)
  const [allEmployeeRows, setAllEmployeeRows] = useState([]);

  const { fetchLearningGlobal, fetchLearningPersonal, fetchLearningEmployeeTable, fetchDepartments, fetchUnitLocations, fetchCoursesByDepartment, fetchCourseModules } = useAnalytics();

  const moduleOptions = React.useMemo(() => {
    return (courseModules || []).map((m) => ({
      value: String(m.index ?? 0),
      label: m.title ?? `Module ${(m.index ?? 0) + 1}`,
      index: m.index ?? 0,
    }));
  }, [courseModules]);

  // Debounce search input for Employee Table so API is not called on every keystroke
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearchDebounced(search);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search]);

  // Clear enrolled courses list when employee or view changes so we don't show previous employee's courses
  useEffect(() => {
    if (viewMode !== 'personal' || !employeeId) setPersonalEnrolledCourses([]);
  }, [viewMode, employeeId]);

  // Merge courseProgress into enrolled list whenever we get data (so dropdown always has full list even when one course is selected)
  useEffect(() => {
    if (viewMode !== 'personal' || !employeeId) return;
    const fromData = Array.isArray(data?.courseProgress) ? data.courseProgress : [];
    if (fromData.length === 0) return;
    const byKey = new Map();
    fromData.forEach((c) => {
      const id = c.courseId ?? c.course?.id ?? c.course?.documentId;
      const title = c.courseTitle ?? c.course?.title ?? `Course ${id}`;
      const key = String(id ?? title);
      if (key) byKey.set(key, { id, title });
    });
    setPersonalEnrolledCourses((prev) => {
      const next = new Map(prev.map((c) => [String(c.id), c]));
      byKey.forEach((v, k) => next.set(k, { ...next.get(k), ...v }));
      return Array.from(next.values());
    });
  }, [viewMode, employeeId, data?.courseProgress]);

  // Personal view: course dropdown shows all enrolled courses (from merged list)
  const personalCourseOptions = React.useMemo(() => {
    if (viewMode !== 'personal') return null;
    const fromData = Array.isArray(data?.courseProgress) ? data.courseProgress : [];
    const list = personalEnrolledCourses.length > 0 ? [...personalEnrolledCourses] : fromData.map((c) => ({
      id: c.courseId ?? c.course?.id ?? c.course?.documentId,
      title: c.courseTitle ?? c.course?.title ?? `Course ${c.courseId ?? c.course?.id ?? ''}`,
    })).filter((c, i, a) => a.findIndex((x) => String(x.id) === String(c.id)) === i);
    if (filterCourse && list.length > 0 && !list.some((c) => String(c.id) === String(filterCourse))) {
      list.push({ id: filterCourse, title: `Course (${filterCourse})` });
    }
    return list.length ? list : null;
  }, [viewMode, data?.courseProgress, filterCourse, personalEnrolledCourses]);

  // Fetch all courses (for dropdown when no department/company filter). Uses analytics endpoint for consistent auth/shape.
  const fetchAllCourses = useCallback(async (extraParams = {}) => {
    try {
      const list = await fetchCoursesByDepartment('', '', extraParams);
      setCourses(Array.isArray(list) ? list : []);
    } catch (err) {
      setCourses([]);
    }
  }, [fetchCoursesByDepartment]);

  useEffect(() => {
    if (!filterCourse) {
      setCourseModules([]);
      setFilterModule('');
      return;
    }
    setFilterModule(''); // Reset module when course changes
    fetchCourseModules(filterCourse)
      .then((list) => setCourseModules(Array.isArray(list) ? list : []))
      .catch(() => setCourseModules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filterCourse changes
  }, [filterCourse]);

  // Clear course filter when context changes outside Employee Table.
  useEffect(() => {
    if (viewMode !== 'table') {
      setFilterCourse('');
    }
  }, [viewMode, company, department, unitLocation, searchDebounced]);

  // Employee Table: default selected course is the first available course.
  useEffect(() => {
    if (viewMode !== 'table') return;
    if (!Array.isArray(courses) || courses.length === 0) {
      setFilterCourse('');
      return;
    }
    const hasSelectedCourse = courses.some((c) => String(c.id) === String(filterCourse));
    if (!filterCourse || !hasSelectedCourse) {
      setFilterCourse(String(courses[0].id));
    }
  }, [viewMode, courses, filterCourse]);

  // Single effect: load courses when filter context changes. Skip only if same key (avoid refetch loop).
  useEffect(() => {
    const searchKey = viewMode === 'table' ? (searchDebounced || '') : '';
    const locationKey = viewMode === 'global' ? (unitLocation || '') : '';
    const key = `${viewMode}-${company || ''}-${department || ''}-${locationKey}-${searchKey}`;
    if (coursesFetchKeyRef.current === key) return;
    coursesFetchKeyRef.current = key;
    coursesFetchInFlightRef.current = true;

    const done = () => {
      coursesFetchInFlightRef.current = false;
    };

    if (viewMode === 'global') {
      const courseParams = unitLocation ? { unitLocation } : {};
      if (department) {
        fetchCoursesByDepartment(department, company || '', courseParams).then(setCourses).catch(() => setCourses([])).finally(done);
      } else if (company || unitLocation) {
        fetchCoursesByDepartment('', company || '', courseParams).then(setCourses).catch(() => setCourses([])).finally(done);
      } else {
        fetchAllCourses().finally(done);
      }
    } else if (viewMode === 'personal') {
      if (company) {
        fetchCoursesByDepartment('', company).then(setCourses).catch(() => setCourses([])).finally(done);
      } else {
        fetchAllCourses().finally(done);
      }
    } else if (viewMode === 'table') {
      const courseParams = searchDebounced?.trim() ? { search: searchDebounced.trim() } : {};
      if (company) {
        fetchCoursesByDepartment('', company, courseParams).then(setCourses).catch(() => setCourses([])).finally(done);
      } else {
        fetchAllCourses(courseParams).finally(done);
      }
    } else {
      done();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when filter context changes; fetchers from useAnalytics() would cause extra runs
  }, [viewMode, company, department, unitLocation, searchDebounced]);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterTimeValue, setFilterTimeValue] = useState('');

  const handleExportAllPersonalData = useCallback(() => {
    if (!data || !employeeDetail) return;
    const wb = XLSX.utils.book_new();
    const employeeData = [{
      'Employee ID': employeeDetail.id ?? employeeId ?? '',
      'Name': employeeDetail.username || employeeDetail.name || '',
      'Email': employeeDetail.email ?? '',
      'Company': employeeDetail.company ?? '',
      'Department': employeeDetail.department?.name || employeeDetail.department || '',
    }];
    const ws1 = XLSX.utils.json_to_sheet(employeeData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Employee Details');
    const courseProgressData = (data.courseProgress || []).map((c) => ({
      'Course': c.courseTitle ?? '',
      'Category': c.courseCategory ?? '',
      'Status': c.status ?? '',
      'Progress %': c.percentage ?? '',
      'Time (min)': c.timeSpentMinutes ?? '',
      'Completed At': c.completedAt ?? '',
      'Certificate': c.certificateIssued ? 'Yes' : 'No',
    }));
    const ws2 = XLSX.utils.json_to_sheet(courseProgressData);
    XLSX.utils.book_append_sheet(wb, ws2, 'My Course Progress');
    const moduleVideoData = (data.moduleVideoProgress || []).map((m) => ({
      'Course': m.courseTitle ?? '',
      'Module': m.moduleTitle ?? '',
      'Completion Type': m.videoCompletionType ?? '',
      'Time Watched (min)': m.timeWatchedMinutes ?? '',
      'Video Duration (min)': m.videoDurationMinutes ?? '',
    }));
    const ws3 = XLSX.utils.json_to_sheet(moduleVideoData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Module Video Details');
    XLSX.writeFile(wb, 'learning-personal.xlsx');
  }, [data, employeeDetail, employeeId]);

  // Load departments and unit locations when company changes. Ref guard prevents duplicate fetches even if effect runs repeatedly.
  useEffect(() => {
    const key = company || '__empty__';
    if (departmentsFetchCompanyRef.current === key) return;
    departmentsFetchCompanyRef.current = key;
    if (company) {
      fetchDepartments(company).then((data) => setDepartments(dedupeList(data || []))).catch(() => setDepartments([]));
      fetchUnitLocations(company).then((data) => setUnitLocations(dedupeList(data || []))).catch(() => setUnitLocations([]));
    } else {
      fetchDepartments().then((data) => setDepartments(dedupeList(data || []))).catch(() => setDepartments([]));
      fetchUnitLocations().then((data) => setUnitLocations(dedupeList(data || []))).catch(() => setUnitLocations([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when company changes
  }, [company]);

  useEffect(() => {
    if (viewMode === 'table') setPage(1);
  }, [viewMode, searchDebounced, company]);

  useEffect(() => {
    if (viewMode === 'global') setModuleDetailPage(1);
  }, [viewMode, filterCourse]);

  useEffect(() => {
    if (viewMode === 'personal' && employeeId) {
      setCourseProgressPage(1);
      setSelectedCourseForModules('');
    }
  }, [viewMode, employeeId]);

  // Default selected course for module video table to first enrolled course (use courseId when available)
  useEffect(() => {
    if (!data?.courseProgress?.length || viewMode !== 'personal') return;
    const first = data.courseProgress[0];
    const firstValue = first.courseId != null ? first.courseId : first.courseTitle;
    const matches = (c) => (c.courseId != null && c.courseId === selectedCourseForModules) || (c.courseTitle === selectedCourseForModules);
    if (selectedCourseForModules === '' || !data.courseProgress.some(matches)) {
      setSelectedCourseForModules(firstValue);
    }
  }, [data, viewMode, selectedCourseForModules]);

  useEffect(() => {
    const shouldLoad =
      viewMode === 'table' ||
      viewMode === 'global' ||
      (viewMode === 'personal' && employeeId);

    if (!shouldLoad) {
      loadRequestIdRef.current += 1;
      lastFetchContextRef.current = '';
      setData(null);
      setAllEmployeeRows([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const abortController = new AbortController();
    const isStale = () => loadRequestIdRef.current !== requestId;
    const fetchOptions = { signal: abortController.signal };

    const fetchContextKey = `${viewMode}:${employeeId || ''}`;
    if (lastFetchContextRef.current !== fetchContextKey) {
      setData(null);
      setAllEmployeeRows([]);
      lastFetchContextRef.current = fetchContextKey;
    }

    setLoading(true);
    setError(null);

    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (viewMode === 'global') {
      if (department) params.department = department;
      if (filterCourse) {
        params.courseId = filterCourse;
        if (filterQuizStatus) params.quizStatus = filterQuizStatus;
        if (filterFeedbackGiven) params.feedbackGiven = filterFeedbackGiven;
        if (filterModule !== '' && filterModule != null) {
          const idx = Number(filterModule);
          if (!Number.isNaN(idx) && idx >= 0) params.moduleIndex = idx;
        }
      }
      if (filterCourseCategory) params.courseCategory = filterCourseCategory;
      if (unitLocation) params.unitLocation = unitLocation;
    }
    if (viewMode === 'personal' && filterCourse) {
      params.courseId = filterCourse;
      if (filterModule !== '' && filterModule != null) {
        const idx = Number(filterModule);
        if (!Number.isNaN(idx) && idx >= 0) params.moduleIndex = idx;
      }
    }
    if (company) params.company = company;
    if (filterStatus) params.status = filterStatus;

    let tableParams = null;
    let fetchPromise;
    if (viewMode === 'table') {
      const searchVal = searchDebounced?.trim();
      tableParams = {
        ...params,
        sortBy: 'courseCompletionTimeMinutes',
        sortOrder,
        page,
        pageSize,
        ...(searchVal && { search: searchVal }),
        ...(filterCourse && { courseId: filterCourse }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterTimeValue && { filterTimeValue }),
      };
      fetchPromise = fetchLearningEmployeeTable(tableParams, fetchOptions);
    } else if (viewMode === 'personal' && employeeId) {
      fetchPromise = fetchLearningPersonal({ ...params, userId: employeeId }, fetchOptions);
    } else {
      fetchPromise = fetchLearningGlobal(params, fetchOptions);
    }

    const syncAllEmployeeRows = async (res) => {
      if (isStale() || viewMode !== 'table') {
        if (!isStale() && viewMode !== 'table') setAllEmployeeRows([]);
        return;
      }
      if (res?.rows && res?.total != null && res.total > (res.pageSize || 10)) {
        const fullParams = {
          ...tableParams,
          page: 1,
          pageSize: res.total,
        };
        try {
          const full = await fetchLearningEmployeeTable(fullParams, fetchOptions);
          if (isStale()) return;
          setAllEmployeeRows(full?.rows || []);
        } catch (err) {
          if (isAbortError(err) || isStale()) return;
          setAllEmployeeRows(res.rows || []);
        }
      } else if (res?.rows) {
        setAllEmployeeRows(res.rows || []);
      } else {
        setAllEmployeeRows([]);
      }
    };

    fetchPromise
      .then((res) => {
        if (isStale()) return;
        setData(res);
        setLoading(false);
        void syncAllEmployeeRows(res);
      })
      .catch((err) => {
        if (isStale() || isAbortError(err)) return;
        setError(err.message || 'Failed to load analytics');
        setLoading(false);
      })
      .finally(() => {
        if (!isStale()) setLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [
    viewMode,
    employeeId,
    dateFrom,
    dateTo,
    department,
    company,
    searchDebounced,
    sortOrder,
    page,
    pageSize,
    filterCourse,
    filterModule,
    filterStatus,
    filterTimeValue,
    filterCourseCategory,
    unitLocation,
    filterQuizStatus,
    filterFeedbackGiven,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchLearning* stable via useCallback; omit to avoid reload loop on setData
  ]);

  const kpis = data?.kpis || {};
  const quiz = data?.quiz || {};
  const isPersonal = viewMode === 'personal';

  return (
    <>
      <Page.Title>Learning Analytics</Page.Title>
      <Page.Main>
      <Layouts.Header
        title="Learning Analytics"
        subtitle={isPersonal ? 'Personal learning metrics' : 'Content learning metrics'}
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          <Box
            style={{
              pointerEvents: loading ? 'none' : 'auto',
              opacity: loading ? 0.72 : 1,
              transition: 'opacity 0.15s ease',
            }}
            aria-busy={loading}
          >
            <Filters
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              department={department}
              onDepartmentChange={setDepartment}
              departments={departments}
              company={company}
              onCompanyChange={setCompany}
              showEmployeeSelector
              showEmployeeTable
              search={search}
              onSearchChange={setSearch}
              filterCourse={filterCourse}
              setFilterCourse={setFilterCourse}
              filterModule={filterModule}
              setFilterModule={setFilterModule}
              moduleOptions={moduleOptions}
              courses={viewMode === 'personal' ? (employeeId && personalCourseOptions !== null ? personalCourseOptions : []) : courses}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              filterTimeValue={filterTimeValue}
              setFilterTimeValue={setFilterTimeValue}
              filterCourseCategory={filterCourseCategory}
              setFilterCourseCategory={setFilterCourseCategory}
              unitLocation={unitLocation}
              onUnitLocationChange={setUnitLocation}
              unitLocations={unitLocations}
              filterQuizStatus={filterQuizStatus}
              setFilterQuizStatus={setFilterQuizStatus}
              filterFeedbackGiven={filterFeedbackGiven}
              setFilterFeedbackGiven={setFilterFeedbackGiven}
            >
              <EmployeeSearch value={employeeId} onChange={setEmployeeId} onEmployeeFound={setEmployeeDetail} company={company} />
            </Filters>
          </Box>

          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4} marginTop={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          <Box position="relative" marginTop={4} style={{ minHeight: loading || data ? '240px' : undefined }}>
            {loading && <LearningAnalyticsLoadingOverlay />}

            {data && viewMode === 'table' && (
              <LearningTableView
                data={data}
                allRows={allEmployeeRows}
                search={search}
                filterCourse={filterCourse}
                company={company}
                sortOrder={sortOrder}
                setSortOrder={setSortOrder}
                setPage={setPage}
                setPageSize={setPageSize}
              />
            )}

            {data && viewMode !== 'table' && (
              <>
                {isPersonal && employeeDetail && (
                  <EmployeeDetailCard employee={employeeDetail} />
                )}
                {viewMode === 'global' && (
                  <LearningGlobalView
                    data={data}
                    courseContentViewType={courseContentViewType}
                    setCourseContentViewType={setCourseContentViewType}
                    kpis={kpis}
                    live={data?.live}
                    quiz={quiz}
                    filterCourse={filterCourse}
                    filterModule={filterModule}
                    courseModules={courseModules}
                    moduleDetailPage={moduleDetailPage}
                    moduleDetailPageSize={moduleDetailPageSize}
                    setModuleDetailPage={setModuleDetailPage}
                    setModuleDetailPageSize={setModuleDetailPageSize}
                    company={company}
                  />
                )}
                {viewMode === 'personal' && (
                  <LearningPersonalView
                    data={data}
                    employeeDetail={employeeDetail}
                    filterCourse={filterCourse}
                    filterModule={filterModule}
                    courseModules={courseModules}
                    kpis={kpis}
                    live={data?.live}
                    quiz={quiz}
                    courseProgressPage={courseProgressPage}
                    courseProgressPageSize={courseProgressPageSize}
                    setCourseProgressPage={setCourseProgressPage}
                    setCourseProgressPageSize={setCourseProgressPageSize}
                    onExport={handleExportAllPersonalData}
                  />
                )}
              </>
            )}

            {!loading && !data && viewMode === 'table' && (
              <Box padding={6} background="neutral100" hasRadius>
                <Typography textColor="neutral600">
                  No employees found. Try adjusting filters or search.
                </Typography>
              </Box>
            )}

            {!loading && !data && viewMode === 'personal' && !employeeId && (
              <Box padding={6} background="neutral100" hasRadius>
                <Typography textColor="neutral600">
                  Search for an employee by ID or email to view personal learning analytics.
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Layouts.Content>
    </Page.Main>
    </>
  );
}