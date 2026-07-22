/**
 * BellWithBadge — Bell icon with a red badge showing unread notification count.
 * Used as the icon for the "My Notifications" sidebar menu link.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bell } from '@strapi/icons';
import { getFetchClient } from '@strapi/strapi/admin';

const POLL_INTERVAL_MS = 30_000; // re-check every 30 seconds

/** @type {React.CSSProperties} */
const badgeStyle = /** @type {React.CSSProperties} */ ({
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
});

/** @type {React.CSSProperties} */
const wrapperStyle = /** @type {React.CSSProperties} */ ({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export default function BellWithBadge() {
  const [count, setCount] = useState(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchCount = async () => {
    try {
      const { get } = getFetchClient();
      // Pass the last-visit timestamp so the backend counts only newer notifications.
      // Falls back to epoch (all notifications) if the page was never visited.
      const since = localStorage.getItem('aia_notif_last_visit') || new Date(0).toISOString();
      const { data } = await get(`/modules-sidebar/admin-notifications/count?since=${encodeURIComponent(since)}`);
      if (mountedRef.current) {
        setCount(data?.count ?? 0);
      }
    } catch {
      // silently ignore — badge just won't update
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
      <Bell width={21} height={21} />
      {count > 0 && (
        <span style={badgeStyle}>{count > 99 ? '99+' : count}</span>
      )}
    </span>
  );
}
