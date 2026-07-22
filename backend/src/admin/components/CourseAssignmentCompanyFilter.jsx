import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_ASSIGNMENT_MODEL = 'api::course-assignment.course-assignment';
const FILTERED_FIELDS = new Set(['courses', 'individual_user', 'work_locations', 'departments']);

function extractCompanyId(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    const first = value[0];
    const companyId = first?.documentId ?? first?.id ?? first?.value?.documentId ?? first?.value?.id;
    return companyId != null ? String(companyId) : null;
  }

  if (typeof value === 'object') {
    if (value.data) {
      const dataVal = value.data;
      if (Array.isArray(dataVal) && dataVal.length > 0) {
        const first = dataVal[0];
        const companyId = first?.documentId ?? first?.id ?? first?.value?.documentId ?? first?.value?.id;
        return companyId != null ? String(companyId) : null;
      }
      if (dataVal && typeof dataVal === 'object') {
        const companyId = dataVal.documentId ?? dataVal.id ?? dataVal.value?.documentId ?? dataVal.value?.id;
        return companyId != null ? String(companyId) : null;
      }
    }

    if (value.value && typeof value.value === 'object') {
      const companyId = value.value.documentId ?? value.value.id;
      if (companyId != null) return String(companyId);
    }

    const pending = value.connect ?? value.set;
    if (Array.isArray(pending) && pending.length > 0) {
      const first = pending[0];
      const companyId = first?.documentId ?? first?.id;
      return companyId != null ? String(companyId) : null;
    }

    const companyId = value.documentId ?? value.id;
    return companyId != null ? String(companyId) : null;
  }

  return null;
}

export default function CourseAssignmentCompanyFilter({ slug, model }) {
  const uid = slug || model;
  if (uid !== COURSE_ASSIGNMENT_MODEL) return null;
  return <FilterCore />;
}

function FilterCore() {
  const values = useForm('CourseAssignmentCompanyFilter', (state) => state?.values, false);
  const companyIdRef = useRef(null);
  const originalFetchRef = useRef(null);
  const patchedRef = useRef(false);

  companyIdRef.current = extractCompanyId(values?.company);

  useEffect(() => {
    if (patchedRef.current) return;
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    window.fetch = async (input, init) => {
      try {
        const baseUrl =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : input instanceof URL
                ? input.toString()
                : '';

        if (!baseUrl.includes('/content-manager/relations/api::course-assignment.course-assignment/')) {
          return originalFetch(input, init);
        }

        const url = new URL(baseUrl, window.location.origin);
        const match = url.pathname.match(/\/content-manager\/relations\/api::course-assignment\.course-assignment\/([^/?]+)/);
        const targetField = match?.[1] || '';
        const selectedCompanyId = companyIdRef.current;

        if (!selectedCompanyId || !FILTERED_FIELDS.has(targetField)) {
          return originalFetch(input, init);
        }

        url.searchParams.set('companyId', selectedCompanyId);

        if (input instanceof Request) {
          const nextRequest = new Request(url.toString(), input);
          return originalFetch(nextRequest, init);
        }

        return originalFetch(url.toString(), init);
      } catch {
        return originalFetch(input, init);
      }
    };

    patchedRef.current = true;

    return () => {
      if (originalFetchRef.current) {
        window.fetch = originalFetchRef.current;
      }
      patchedRef.current = false;
    };
  }, []);

  return null;
}
