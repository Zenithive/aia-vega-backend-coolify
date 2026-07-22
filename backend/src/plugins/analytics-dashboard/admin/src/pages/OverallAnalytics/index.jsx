import React, { useState, useEffect, useCallback } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader } from '@strapi/design-system';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';
import { OverallActivityTrackingView } from './views/OverallActivityTrackingView';

export default function OverallAnalyticsPage() {
  const {
    fetchDepartments,
    fetchUnitLocations,
    fetchActivityLog,
    fetchActivityTrackingKpis,
    fetchActivityPagesStats,
    fetchActivityNewsList,
  } = useAnalytics();
  const [viewMode] = useState('activityTracking');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [department, setDepartment] = useState('');
  const [company, setCompany] = useState('');
  const [unitLocation, setUnitLocation] = useState('');
  const [activityType, setActivityType] = useState('');
  const [newsId, setNewsId] = useState('');
  const [newsList, setNewsList] = useState([]);
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeDetail, setEmployeeDetail] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [unitLocations, setUnitLocations] = useState([]);
  const [activityLogData, setActivityLogData] = useState({ rows: [], total: 0, page: 1, pageSize: 10 });
  const [activityLogFullRows, setActivityLogFullRows] = useState([]);
  const [activityKpis, setActivityKpis] = useState({
    totalUser: 0,
    uniqueUser: 0,
    timeSpentMin: 0,
    avgTimeSpentMin: 0,
  });
  const [activityPagesStats, setActivityPagesStats] = useState({ topPagesByVisit: [], leastUsedPages: [] });
  const [activityLogPage, setActivityLogPage] = useState(1);
  const [activityLogPageSize, setActivityLogPageSize] = useState(10);
  const [activityLogSortBy, setActivityLogSortBy] = useState('timestamp');
  const [activityLogSortOrder, setActivityLogSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const companyParam = company || '';
    fetchDepartments(companyParam).then(setDepartments).catch(() => setDepartments([]));
    fetchUnitLocations(companyParam).then(setUnitLocations).catch(() => setUnitLocations([]));
  }, [company]);

  useEffect(() => {
    setDepartment('');
    setUnitLocation('');
  }, [company]);

  useEffect(() => {
    if (viewMode === 'activityTracking') setActivityLogPage(1);
  }, [viewMode, activityType, dateFrom, dateTo, company, department, unitLocation, employeeId]);

  useEffect(() => {
    if (activityType === 'News') {
      fetchActivityNewsList()
        .then((list) => setNewsList(Array.isArray(list) ? list : []))
        .catch(() => setNewsList([]));
    } else {
      setNewsList([]);
      setNewsId('');
    }
    // Only re-fetch when activityType changes; fetchActivityNewsList is stable from useAnalytics
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchActivityNewsList intentionally omitted to avoid infinite loop (new ref every render)
  }, [activityType]);

  const handleActivityLogSortChange = (sortBy, sortOrder) => {
    setActivityLogSortBy(sortBy);
    setActivityLogSortOrder(sortOrder);
    setActivityLogPage(1);
  };

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (company) params.company = company;
    if (department) params.department = department;
    if (unitLocation) params.unitLocation = unitLocation;
    if (activityType) params.activityType = activityType;
    if (activityType === 'News' && newsId) params.newsId = newsId;
    if (employeeId) params.userId = employeeId;

    Promise.all([
      fetchActivityLog({
        ...params,
        page: activityLogPage,
        pageSize: activityLogPageSize,
        sortBy: activityLogSortBy,
        sortOrder: activityLogSortOrder,
      }),
      fetchActivityTrackingKpis(params),
      fetchActivityPagesStats(params),
    ])
      .then(([logData, kpis, pagesStats]) => {
        const data = logData || { rows: [], total: 0, page: 1, pageSize: 10 };
        setActivityLogData(data);
        setActivityKpis(kpis || {
          totalUser: 0,
          uniqueUser: 0,
          timeSpentMin: 0,
          avgTimeSpentMin: 0,
        });
        setActivityPagesStats(pagesStats || { topPagesByVisit: [], leastUsedPages: [] });
        const total = data.total || 0;
        const pageSize = data.pageSize || 10;
        if (total > 0 && total > pageSize) {
          fetchActivityLog({
            ...params,
            page: 1,
            pageSize: total,
            sortBy: activityLogSortBy,
            sortOrder: activityLogSortOrder,
          })
            .then((full) => setActivityLogFullRows(full?.rows || []))
            .catch(() => setActivityLogFullRows([]));
        } else {
          setActivityLogFullRows(data.rows || []);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [employeeId, dateFrom, dateTo, company, department, unitLocation, activityType, newsId, activityLogPage, activityLogPageSize, activityLogSortBy, activityLogSortOrder]);

  useEffect(() => {
    loadData();
  }, [employeeId, dateFrom, dateTo, company, unitLocation, activityType, department, loadData]);

  const isActivityTracking = true;

  return (
    <>
      <Page.Title>Overall Analytics</Page.Title>
      <Page.Main>
        <Layouts.Header
          title="Overall Analytics"
          subtitle={
            employeeId
              ? 'Activity tracking for selected employee'
              : 'Activity tracking across the portal'
          }
        />
        <Layouts.Content>
          <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
            <Filters
              viewMode={viewMode}
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
              showUnitLocation
              showActivityTracking
              unitLocation={unitLocation}
              onUnitLocationChange={setUnitLocation}
              unitLocations={unitLocations}
              activityType={activityType}
              onActivityTypeChange={setActivityType}
              newsId={newsId}
              onNewsIdChange={setNewsId}
              newsList={newsList}
              activityTrackingEmployeeId={employeeId}
              hideViewFilter
              search=""
              onSearchChange={() => {}}
            >
              <EmployeeSearch value={employeeId} onChange={setEmployeeId} onEmployeeFound={setEmployeeDetail} company={company} />
            </Filters>

            {loading && (
              <Flex justifyContent="center" padding={8}>
                <Loader>Loading analytics...</Loader>
              </Flex>
            )}

            {error && (
              <Box padding={4} background="danger100" hasRadius marginBottom={4}>
                <Typography textColor="danger700">{error}</Typography>
              </Box>
            )}

            {!loading && (
              <>
                {employeeId && employeeDetail && (
                  <Box marginBottom={4}>
                    <EmployeeDetailCard employee={employeeDetail} />
                  </Box>
                )}
                <OverallActivityTrackingView
                  activityLogData={activityLogData}
                  activityLogFullRows={activityLogFullRows}
                  activityKpis={activityKpis}
                  activityPagesStats={activityPagesStats}
                  activityType={activityType}
                  newsId={newsId}
                  setActivityLogPage={setActivityLogPage}
                  setActivityLogPageSize={setActivityLogPageSize}
                  activityLogSortBy={activityLogSortBy}
                  activityLogSortOrder={activityLogSortOrder}
                  onActivityLogSortChange={handleActivityLogSortChange}
                />
              </>
            )}
          </Box>
        </Layouts.Content>
      </Page.Main>
    </>
  );
}
