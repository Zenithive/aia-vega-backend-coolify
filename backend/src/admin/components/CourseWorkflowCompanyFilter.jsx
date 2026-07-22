import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const COURSE_WORKFLOW_MODEL = 'api::course-workflow.course-workflow';

function addUnique(ids, value) {
  if (value == null) return;
  const normalized = String(value).trim();
  if (!normalized) return;
  if (!ids.includes(normalized)) ids.push(normalized);
}

function collectRelationIds(value, ids) {
  if (!value) return;

  if (typeof value === 'string' || typeof value === 'number') {
    addUnique(ids, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectRelationIds(item, ids));
    return;
  }

  if (typeof value === 'object') {
    addUnique(ids, value.documentId ?? value.id);

    if (value.value && typeof value.value === 'object') {
      addUnique(ids, value.value.documentId ?? value.value.id);
    }

    if (value.data) {
      collectRelationIds(value.data, ids);
    }

    const pending = value.connect ?? value.set ?? value.disconnect;
    if (pending) {
      collectRelationIds(pending, ids);
    }
  }
}

function extractSelectedWorkflowCourseIds(modules) {
  const ids = [];
  const list = Array.isArray(modules) ? modules : [];
  list.forEach((moduleItem) => {
    if (!moduleItem || String(moduleItem.module_type || '').toLowerCase() !== 'online') return;
    collectRelationIds(moduleItem.course, ids);
  });
  return ids;
}

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

export default function CourseWorkflowCompanyFilter({ slug, model }) {
  const uid = slug || model;
  if (uid !== COURSE_WORKFLOW_MODEL) return null;
  return <FilterCore />;
}

function FilterCore() {
  const values = useForm('CourseWorkflowCompanyFilter', (state) => state?.values, false);
  const companyIdRef = useRef(null);
  const selectedCourseIdsRef = useRef([]);
  const originalFetchRef = useRef(null);
  const patchedRef = useRef(false);

  companyIdRef.current = extractCompanyId(values?.company);
  selectedCourseIdsRef.current = extractSelectedWorkflowCourseIds(values?.modules);

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

        const isWorkflowRelation =
          baseUrl.includes('/content-manager/relations/api::course-workflow.course-workflow/') ||
          baseUrl.includes('/content-manager/relations/course.workflow-module/');

        if (!isWorkflowRelation) {
          return originalFetch(input, init);
        }

        const url = new URL(baseUrl, window.location.origin);
        const selectedCompanyId = companyIdRef.current;

        const targetField = (() => {
          const workflowMatch = url.pathname.match(/\/content-manager\/relations\/api::course-workflow\.course-workflow\/([^/?]+)/);
          if (workflowMatch?.[1]) return workflowMatch[1];
          const componentMatch = url.pathname.match(/\/content-manager\/relations\/course\.workflow-module\/([^/?]+)/);
          return componentMatch?.[1] || '';
        })();
        const isCourseRelation = targetField === 'course' || targetField.endsWith('.course');

        if (!selectedCompanyId) {
          return originalFetch(input, init);
        }

        // For workflow form, we need filtering on users relation and module course relation.
        url.searchParams.set('companyId', selectedCompanyId);
        if (isCourseRelation && selectedCourseIdsRef.current.length > 0) {
          url.searchParams.set('excludeCourseIds', selectedCourseIdsRef.current.join(','));
        }

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
