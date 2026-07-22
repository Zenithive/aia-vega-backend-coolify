// @ts-nocheck
/**
 * ProfileEditWithBadge - Profile Edit Requests icon with pending count badge.
 */

import React, { useState, useEffect, useRef } from 'react';
import { User } from '@strapi/icons';
import { getFetchClient } from '@strapi/strapi/admin';

const POLL_INTERVAL_MS = 30_000;

const badgeStyle = {
  position: 'absolute',
  top: '-5px',
  right: '-6px',
  minWidth: '15px',
  height: '15px',
  padding: '0 3px',
  background: '#ee5e52',
  color: '#fff',
  borderRadius: '8px',
  fontSize: '9px',
  fontWeight: 700,
  lineHeight: '15px',
  textAlign: 'center',
  pointerEvents: 'none',
  boxSizing: 'border-box',
};

const wrapperStyle = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default function ProfileEditWithBadge() {
  const [count, setCount] = useState(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchCount = async () => {
    try {
      const { get } = getFetchClient();
      const { data } = await get('/profile-edit-requests/requests/count');
      if (mountedRef.current) {
        setCount(data?.count ?? 0);
      }
    } catch {
      // Ignore badge polling failures.
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchCount();
    timerRef.current = setInterval(fetchCount, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(timerRef.current);
    };
  }, []);

  return (
    <span style={wrapperStyle}>
      <User width={21} height={21} />
      {count > 0 && <span style={badgeStyle}>{count > 99 ? '99+' : count}</span>}
    </span>
  );
}
