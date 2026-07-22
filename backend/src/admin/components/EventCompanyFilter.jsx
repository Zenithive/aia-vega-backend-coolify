// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { useForm } from '@strapi/admin/strapi-admin';

const EVENT_MODEL = 'api::event.event';
const FILTERED_FIELDS = new Set(['work_locations']);

function extractCompanyIds(value) {
  if (!value) return [];

  const ids = [];
  const pushId = (idValue) => {
    if (idValue == null) return;
    const normalized = String(idValue).trim();
    if (!normalized) return;
    if (!ids.includes(normalized)) ids.push(normalized);
  };

  if (typeof value === 'string' || typeof value === 'number') {
    pushId(value);
    return ids;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => {
      pushId(item?.documentId ?? item?.id ?? item?.value?.documentId ?? item?.value?.id);
    });
    return ids;
  }

  if (typeof value === 'object') {
    if (value.data) {
      const dataVal = value.data;
      if (Array.isArray(dataVal) && dataVal.length > 0) {
        dataVal.forEach((item) => {
          pushId(item?.documentId ?? item?.id ?? item?.value?.documentId ?? item?.value?.id);
        });
      }
      if (dataVal && typeof dataVal === 'object') {
        pushId(dataVal.documentId ?? dataVal.id ?? dataVal.value?.documentId ?? dataVal.value?.id);
      }
    }

    if (value.value && typeof value.value === 'object') {
      pushId(value.value.documentId ?? value.value.id);
    }

    const pending = value.connect ?? value.set;
    if (Array.isArray(pending) && pending.length > 0) {
      pending.forEach((item) => {
        pushId(item?.documentId ?? item?.id);
      });
    }

    pushId(value.documentId ?? value.id);
    return ids;
  }

  return ids;
}

export default function EventCompanyFilter({ slug, model }) {
  const uid = slug || model;
  if (uid !== EVENT_MODEL) return null;
  return <FilterCore />;
}

function FilterCore() {
  const values = useForm('EventCompanyFilter', (state) => state?.values, false);
  const companyIdsRef = useRef([]);
  const originalFetchRef = useRef(null);
  const patchedRef = useRef(false);
  
  // Extract company IDs only when event_created_for is "Location"
  const shouldFilter = values?.event_created_for === 'Location';
  companyIdsRef.current = shouldFilter ? extractCompanyIds(values?.company) : [];

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

        if (!baseUrl.includes('/content-manager/relations/api::event.event/')) {
          return originalFetch(input, init);
        }

        const url = new URL(baseUrl, window.location.origin);
        const match = url.pathname.match(/\/content-manager\/relations\/api::event\.event\/([^/?]+)/);
        const targetField = match?.[1] || '';
        const selectedCompanyIds = companyIdsRef.current;

        if (!Array.isArray(selectedCompanyIds) || selectedCompanyIds.length === 0 || !FILTERED_FIELDS.has(targetField)) {
          return originalFetch(input, init);
        }

        url.searchParams.delete('companyId');
        selectedCompanyIds.forEach((companyId) => {
          url.searchParams.append('companyId', companyId);
        });

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
