// Usage: import DateRangeInput from './DateRangeInput';
// <DateRangeInput value={{start: ..., end: ...}} onChange={({start, end}) => ...} />
// @ts-nocheck

import React, { useState, useRef, useEffect } from 'react';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

export default function DateRangeInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pickingEnd, setPickingEnd] = useState(false);
  const ref = useRef();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setPickingEnd(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const formatDate = (date) => {
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  // Normalize a date to local start-of-day
  const toLocalStartOfDay = (date) => {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  };

  // Normalize a date to local end-of-day
  const toLocalEndOfDay = (date) => {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  };

  const handleSelect = (ranges) => {
    const rawStart = ranges.selection.startDate;
    const rawEnd = ranges.selection.endDate;
    const start = rawStart ? toLocalStartOfDay(rawStart) : null;
    const end = rawEnd ? toLocalEndOfDay(rawEnd) : null;
    onChange({ start, end });
    if (!pickingEnd) {
      // First click: user picked start date, now wait for end date
      setPickingEnd(true);
    } else {
      // Second click: close the picker
      setPickingEnd(false);
      setOpen(false);
    }
  };
  const formatted = value && value.start && value.end
    ? `${formatDate(value.start)} - ${formatDate(value.end)}`
    : '';
  return (
    <div style={{ position: 'relative', minWidth: 220 }} ref={ref}>
      <button
        type="button"
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #dcdce4',
          borderRadius: '4px',
          background: '#fff',
          padding: '0 12px',
          minWidth: '220px',
          height: '40px',
          fontSize: '16px',
          color: formatted ? '#222' : '#8e8ea9',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontWeight: 400,
          outline: open ? '2px solid #4945ff' : 'none',
          boxShadow: 'none',
          transition: 'outline 0.2s',
        }}
        onClick={() => { setOpen((v) => !v); setPickingEnd(false); }}
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" style={{marginRight:8, color:'#8e8ea9'}}><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 3v4M8 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M3 9h18" stroke="currentColor" strokeWidth="1.5"/></svg>
        {formatted || 'MM/DD/YYYY - MM/DD/YYYY'}
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 10, top: 44, left: 0, background: '#fff', border: '1px solid #dcdce4', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <DateRange
            ranges={[{
              startDate: value?.start || new Date(),
              endDate: value?.end || new Date(),
              key: 'selection',
            }]}
            onChange={handleSelect}
            moveRangeOnFirstSelection={false}
            showMonthAndYearPickers={true}
            showDateDisplay={false}
            rangeColors={["#4945ff"]}
            months={2}
            direction="horizontal"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
            <button
              type="button"
              style={{
                background: '#f6f6f9',
                color: '#4945ff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 16px',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 500,
                marginLeft: 8,
              }}
              onClick={() => {
                onChange({ start: null, end: null });
                setPickingEnd(false);
                setOpen(false);
              }}
              disabled={!value?.start && !value?.end}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
