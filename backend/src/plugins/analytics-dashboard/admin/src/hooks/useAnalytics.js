import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';

const getBaseUrl = () => window.strapi?.backendURL || 'http://localhost:1337';

const getToken = (state) => state?.admin_app?.token;

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

export function useAnalytics() {
  const token = useSelector(getToken);
  const baseUrl = getBaseUrl();

  const fetchApi = useCallback(
    async (path, params = {}, options = {}) => {
      const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      const qs = new URLSearchParams(cleanParams).toString();
      const url = `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: options.signal,
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
    [baseUrl, token]
  );

  const exportLearningEmployeeTable = useCallback(
    async (params = {}) => {
      const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      const qs = new URLSearchParams(cleanParams).toString();
      const url = `${baseUrl}/api/analytics/learning/employee-table/export${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'employee-learning-summary.xlsx';
      a.click();
      URL.revokeObjectURL(downloadUrl);
    },
    [baseUrl, token]
  );

  const fetchLearningGlobal = useCallback(
    (params, options) => fetchApi('/api/analytics/learning/global', params, options),
    [fetchApi]
  );
  const fetchLearningPersonal = useCallback(
    (params, options) => fetchApi('/api/analytics/learning/personal', params, options),
    [fetchApi]
  );
  const fetchLearningEmployeeTable = useCallback(
    (params, options) => fetchApi('/api/analytics/learning/employee-table', params, options),
    [fetchApi]
  );

  return {
    fetchLearningGlobal,
    fetchLearningPersonal,
    fetchLearningEmployeeTable,
    exportLearningEmployeeTable,
    fetchOverallGlobal: (params) => fetchApi('/api/analytics/overall/global', params),
    fetchOverallPersonal: (params) => fetchApi('/api/analytics/overall/personal', params),
    fetchEmployees: (params) => fetchApi('/api/analytics/employees', params),
    fetchDepartments: (company) => fetchApi('/api/analytics/departments', company ? { company } : {}),
    fetchUnitLocations: (company) => fetchApi('/api/analytics/unit-locations', company ? { company } : {}),
    fetchCoursesByDepartment: (departmentId, company, extraParams = {}) => fetchApi('/api/analytics/courses-by-department', {
      ...(departmentId ? { departmentId } : {}),
      ...(company ? { company } : {}),
      ...extraParams,
    }),
    fetchCourseModules: (courseId) => fetchApi('/api/analytics/course-modules', { courseId }),
    fetchActivityTimeByTypeAndDay: (params) => fetchApi('/api/analytics/activity/time-by-type-and-day', params),
    fetchActivityLog: (params) => fetchApi('/api/analytics/activity/log', params),
    fetchActivityTrackingKpis: (params) => fetchApi('/api/analytics/activity/kpis', params),
    fetchActivityPagesStats: (params) => fetchApi('/api/analytics/activity/pages-stats', params),
    fetchActivityNewsList: () => fetchApi('/api/analytics/activity/news-list'),
    ingestAnalyticsEvents: async (events) => {
      const payload = Array.isArray(events) ? { events } : events;
      const res = await fetch(`${baseUrl}/api/analytics/events/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    },
    fetchEventPageStats: (params) => fetchApi('/api/analytics/events/page-stats', params),
    fetchEventPageTrend: (params) => fetchApi('/api/analytics/events/page-trend', params),
    fetchEventLearningStats: (params) => fetchApi('/api/analytics/events/learning-stats', params),
    fetchEventAggregationStatus: () => fetchApi('/api/analytics/events/aggregation-status'),
  };
}

export function useAnalyticsData(fetcher, params, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const abortController = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = fetcher(params, { signal: abortController.signal });
    Promise.resolve(run)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [JSON.stringify(params), enabled]);

  return { data, loading, error };
}
