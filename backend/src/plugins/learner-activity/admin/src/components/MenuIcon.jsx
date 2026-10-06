// @ts-nocheck
/**
 * Menu icon with a red badge counting the items waiting on the admin
 * (reattempt requests + answers to review, limited to what they may open).
 */
import React, { useEffect, useState } from 'react';
import { ListSearch } from '@strapi/icons';
import { api } from '../api';

const POLL_INTERVAL_MS = 30_000;

const wrapperStyle = { position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
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

export const pendingTotal = (summary) => (summary?.pendingReattempts || 0) + (summary?.pendingReviews || 0);

export default function MenuIcon() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const fetchCount = () =>
      api
        .get('/summary')
        .then((s) => mounted && setCount(pendingTotal(s)))
        .catch(() => {}); // the badge simply does not update
    fetchCount();
    const timer = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <span style={wrapperStyle}>
      <ListSearch width={21} height={21} />
      {count > 0 && <span style={badgeStyle}>{count > 99 ? '99+' : count}</span>}
    </span>
  );
}
