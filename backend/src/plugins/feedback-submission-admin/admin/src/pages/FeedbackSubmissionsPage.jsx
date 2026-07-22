// @ts-nocheck

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Layouts, getFetchClient } from '@strapi/strapi/admin';
import { Box, Flex, Loader, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';

const PAGE_SIZE = 10;
const COMPANIES = ['AIA', 'Vega'];

function parseCompanyFromSearch(search) {
  const p = new URLSearchParams(search);
  const raw = p.get('company');
  if (!raw) return COMPANIES[0];
  const hit = COMPANIES.find((x) => x.toLowerCase() === String(raw).trim().toLowerCase());
  return hit || COMPANIES[0];
}

function parseCourseIdFromSearch(search) {
  const p = new URLSearchParams(search);
  return String(p.get('courseId') || '').trim();
}

export default function FeedbackSubmissionsPage() {
  const { get } = getFetchClient();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [company, setCompany] = useState(() => parseCompanyFromSearch(location.search));
  const [courseId, setCourseId] = useState(() => parseCourseIdFromSearch(location.search));
  const [courses, setCourses] = useState([]);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  useLayoutEffect(() => {
    const nextCompany = parseCompanyFromSearch(location.search);
    const nextCourseId = parseCourseIdFromSearch(location.search);
    setCompany((prev) => (prev !== nextCompany ? nextCompany : prev));
    setCourseId((prev) => (prev !== nextCourseId ? nextCourseId : prev));
  }, [location.search]);

  const fetchCourses = async (nextCompany) => {
    if (!nextCompany) {
      setCourses([]);
      return;
    }
    const { data } = await get(`/feedback-submission-admin/courses?company=${encodeURIComponent(nextCompany)}`);
    const list = Array.isArray(data?.data) ? data.data : [];
    setCourses(list);
    return list;
  };

  const fetchRows = async (nextCompany, nextCourseId) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (nextCompany) params.set('company', nextCompany);
      if (nextCourseId) params.set('courseId', nextCourseId);
      const { data } = await get(`/feedback-submission-admin/submissions?${params.toString()}`);
      const payload = data?.data || {};
      setColumns(Array.isArray(payload.columns) ? payload.columns : []);
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (e) {
      setError(e?.message || 'Failed to fetch feedback submissions');
      setColumns([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setRows([]);
    setColumns([]);
    const previousCourseId = courseId;
    fetchCourses(company)
      .then((list) => {
        const matchedCourse = (list || []).find((course) => {
          const byDocId = course?.documentId ? String(course.documentId) === previousCourseId : false;
          const byId = String(course?.id || '') === previousCourseId;
          return byDocId || byId;
        });
        if (matchedCourse) {
          const resolvedId = matchedCourse.documentId
            ? String(matchedCourse.documentId)
            : String(matchedCourse.id || previousCourseId);
          setCourseId(resolvedId);
          return;
        }
        const firstCourseId = list?.[0]?.documentId
          ? String(list[0].documentId)
          : list?.[0]?.id
          ? String(list[0].id)
          : '';
        setCourseId(firstCourseId);
      })
      .catch((e) => setError(e?.message || 'Failed to fetch courses'));
  }, [company]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!courseId) return;
    setPage(1);
    fetchRows(company, courseId).catch((e) => setError(e?.message || 'Failed to fetch feedback submissions'));
  }, [company, courseId]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <Layouts.Root>
      <Layouts.Header title="Feedback Submission" subtitle={`${rows.length} submission${rows.length === 1 ? '' : 's'}`} />
      <Layouts.Content>
        <Box padding={8}>
          {error ? (
            <Box padding={4} marginBottom={4} background="danger100" hasRadius>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          ) : null}

          <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" marginBottom={4}>
            <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
              Filters
            </Typography>
            <Flex gap={4} wrap="wrap">
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" marginBottom={1}>
                  Company
                </Typography>
                <SingleSelect value={company} onChange={(val) => setCompany(String(val || ''))}>
                  {COMPANIES.map((item) => (
                    <SingleSelectOption key={item} value={item}>
                      {item}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Box style={{ minWidth: 300 }}>
                <Typography variant="pi" textColor="neutral600" marginBottom={1}>
                  Course
                </Typography>
                <SingleSelect
                  value={courseId}
                  onChange={(val) => setCourseId(String(val || ''))}
                  disabled={!company}
                  placeholder={!company ? 'Select company first' : 'Select course'}
                >
                  {courses.map((course) => (
                    <SingleSelectOption
                      key={course.documentId ? String(course.documentId) : String(course.id)}
                      value={course.documentId ? String(course.documentId) : String(course.id)}
                    >
                      {course.title}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
            </Flex>
          </Box>

          {loading ? (
            <Flex justifyContent="center" padding={6}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : (
            <DataTable
              data={pagedRows}
              fullData={rows}
              paginatedData={pagedRows}
              columns={columns
                .filter((col) => {
                  if (company === 'AIA') return col.key !== 'emp_id';
                  if (company === 'Vega') return col.key !== 'emp_code';
                  return true;
                })
                .map((col) => ({
                  ...col,
                  header: (
                    <Typography
                      variant="sigma"
                      textColor="neutral600"
                      style={{
                        whiteSpace: 'normal',
                        lineHeight: 1.2,
                        width: col.key === 'emp_name' ? 300 : col.key.startsWith('q_') ? 260 : 160,
                        maxWidth: col.key === 'emp_name' ? 300 : col.key.startsWith('q_') ? 260 : 160,
                        wordBreak: 'break-word',
                      }}
                    >
                      {col.label}
                    </Typography>
                  ),
                  render: (value) => (
                    <Typography
                      variant="omega"
                      textColor="neutral800"
                      style={{
                        whiteSpace: 'normal',
                        width: col.key === 'emp_name' ? 300 : col.key.startsWith('q_') ? 260 : 160,
                        maxWidth: col.key === 'emp_name' ? 300 : col.key.startsWith('q_') ? 260 : 160,
                        wordBreak: 'break-word',
                      }}
                    >
                      {value ?? '-'}
                    </Typography>
                  ),
                }))}
              pagination={{
                page,
                pageSize,
                total: rows.length,
                onPageChange: (next) => setPage(Number(next)),
                onPageSizeChange: (next) => {
                  setPageSize(Number(next));
                  setPage(1);
                },
              }}
              exportFileName={`feedback-submissions-${new Date().toISOString().slice(0, 10)}.xlsx`}
              emptyMessage="No feedback submissions found."
            />
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
