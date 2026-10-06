// @ts-nocheck
/**
 * Company → Course → Version picker for the Feedback tab (same picker as in Quiz Management).
 *
 * A "course" is one course with all its versions (they share a lineage); a version is one
 * course document. The choice lives in the URL (?company=&course=&version=) so it survives
 * switching tabs. Older links (notifications) carry ?courseId=<documentId or id>; that is
 * translated to the matching course + version.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Field, Flex, SingleSelect, SingleSelectOption } from '@strapi/design-system';

export const COMPANIES = ['AIA', 'Vega'];
const ALL = '__all';

function normalizeCompany(raw) {
  const hit = COMPANIES.find((c) => c.toLowerCase() === String(raw || '').trim().toLowerCase());
  return hit || COMPANIES[0];
}

/**
 * @param {(company: string) => Promise<Array>} loadCourses resolves with [{ key, title, versions: [{ documentId, course_version, rowIds }] }];
 *   must be a stable (module-level) function
 * @param {{ allowAllCourses?: boolean }} options allowAllCourses: "All courses" is offered and is the default
 */
export function useCourseFilter(loadCourses, { allowAllCourses = false } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const company = normalizeCompany(searchParams.get('company'));
  const requestedCourse = searchParams.get('course') || '';
  const requestedVersion = searchParams.get('version') || '';
  const legacyCourseId = searchParams.get('courseId') || '';
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');

  const update = useCallback(
    (patch) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
          return next;
        },
        { replace: true }
      ),
    [setSearchParams]
  );

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError('');
    loadCourses(company)
      .then((list) => !cancelled && setCatalog(Array.isArray(list) ? list : []))
      .catch((e) => {
        if (cancelled) return;
        setCatalog([]);
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCourses, company]);

  // Translate an old ?courseId= link into course + version once the catalog is known.
  useEffect(() => {
    if (!catalog || !legacyCourseId) return;
    for (const group of catalog) {
      const version = group.versions.find(
        (v) => v.documentId === legacyCourseId || (v.rowIds || []).map(String).includes(legacyCourseId)
      );
      if (version) {
        update({ course: group.key, version: version.documentId, courseId: '' });
        return;
      }
    }
    update({ courseId: '' });
  }, [catalog, legacyCourseId, update]);

  const course = useMemo(() => {
    if (!catalog?.length) return null;
    return catalog.find((g) => g.key === requestedCourse) || (allowAllCourses ? null : catalog[0]);
  }, [catalog, requestedCourse, allowAllCourses]);
  const version = course?.versions.find((v) => v.documentId === requestedVersion) || null;

  return {
    company,
    catalog: catalog || [],
    loading: catalog === null || !!legacyCourseId,
    error,
    allowAllCourses,
    course,
    version,
    /** Query string for the plugin endpoints. */
    query: new URLSearchParams({
      company,
      ...(course ? { course: course.key } : {}),
      ...(version ? { version: version.documentId } : {}),
    }).toString(),
    setCompany: (value) => update({ company: value, course: '', version: '' }),
    setCourse: (value) => update({ course: value === ALL ? '' : value, version: '' }),
    setVersion: (value) => update({ version: value === ALL ? '' : value }),
  };
}

export default function CourseFilter({ filter, children }) {
  const { company, catalog, loading, allowAllCourses, course, version, setCompany, setCourse, setVersion } = filter;
  const versions = course?.versions || [];
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
      <Flex gap={4} wrap="wrap" alignItems="flex-end">
        <Box style={{ flex: '1 1 150px', maxWidth: 200 }}>
          <Field.Root name="company">
            <Field.Label>Company</Field.Label>
            <SingleSelect value={company} onChange={(v) => setCompany(String(v || ''))}>
              {COMPANIES.map((c) => (
                <SingleSelectOption key={c} value={c}>
                  {c}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
        <Box style={{ flex: '2 1 280px', maxWidth: 440 }}>
          <Field.Root name="course">
            <Field.Label>Course</Field.Label>
            <SingleSelect
              value={course?.key || (allowAllCourses && catalog.length ? ALL : '')}
              onChange={(v) => setCourse(String(v || ''))}
              disabled={loading || catalog.length === 0}
              placeholder={loading ? 'Loading courses…' : catalog.length ? 'Choose a course' : 'No courses for this company'}
            >
              {allowAllCourses && catalog.length > 0 && <SingleSelectOption value={ALL}>All courses</SingleSelectOption>}
              {catalog.map((g) => (
                <SingleSelectOption key={g.key} value={g.key}>
                  {g.title}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
        <Box style={{ flex: '1 1 160px', maxWidth: 220 }}>
          <Field.Root name="version">
            <Field.Label>Version</Field.Label>
            <SingleSelect value={version?.documentId || ALL} onChange={(v) => setVersion(String(v || ''))} disabled={!course}>
              <SingleSelectOption value={ALL}>{versions.length > 1 ? 'All versions' : 'All'}</SingleSelectOption>
              {versions.map((v) => (
                <SingleSelectOption key={v.documentId} value={v.documentId}>
                  {v.course_version ? `Version ${v.course_version}` : 'No version number'}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Field.Root>
        </Box>
        {children}
      </Flex>
    </Box>
  );
}
