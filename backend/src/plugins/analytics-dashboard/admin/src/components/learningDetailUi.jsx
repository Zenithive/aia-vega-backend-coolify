// @ts-nocheck
/** Shared formatting and small visuals for the module-level Learning Analytics views. */
import React from 'react';
import { Badge, Box, Flex, Typography } from '@strapi/design-system';

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** 95 → "1h 35m"; null → "—". */
export function formatMinutes(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const m = Math.round(Number(value));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export function formatDays(value) {
  if (value == null) return '—';
  return `${value} day${Number(value) === 1 ? '' : 's'}`;
}

export function formatScore(value) {
  return value == null ? '—' : `${value}%`;
}

const COURSE_STATUS = {
  Completed: { label: 'Completed', variant: 'success' },
  In_progress: { label: 'In progress', variant: 'secondary' },
  Failed: { label: 'In progress (quiz not passed)', variant: 'danger' },
  Not_started: { label: 'Not started', variant: 'neutral' },
};

export const courseStatusLabel = (status) => (COURSE_STATUS[status] || COURSE_STATUS.Not_started).label;

export function CourseStatusBadge({ status }) {
  const meta = COURSE_STATUS[status] || COURSE_STATUS.Not_started;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

const MODULE_STATUS_VARIANT = {
  Completed: 'success',
  'In progress': 'secondary',
  'Quiz pending': 'warning',
  'Quiz failed': 'danger',
  'Review pending': 'warning',
  'Proof pending': 'warning',
  'Not started': 'neutral',
  Locked: 'neutral',
};

export function ModuleStatusBadge({ status }) {
  if (!status) return <Typography textColor="neutral500">—</Typography>;
  return <Badge variant={MODULE_STATUS_VARIANT[status] || 'neutral'}>{status}</Badge>;
}

export function ModuleTypeBadge({ type }) {
  return type === 'Offline' ? (
    <Badge backgroundColor="alternative100" textColor="alternative700">Offline</Badge>
  ) : (
    <Badge backgroundColor="primary100" textColor="primary700">Online</Badge>
  );
}

/**
 * One horizontal bar split into parts, e.g. completed / in progress / not started.
 * parts: [{ label, value, color }]
 */
export function StackedBar({ parts, width = 220 }) {
  const total = parts.reduce((s, p) => s + (p.value || 0), 0);
  const title = parts.filter((p) => p.value).map((p) => `${p.label}: ${p.value}`).join(' · ');
  return (
    <Box title={title} style={{ width, maxWidth: '100%' }}>
      <Flex style={{ height: 10, borderRadius: 5, overflow: 'hidden', background: '#eaeaef' }}>
        {total > 0 &&
          parts.map((p) =>
            p.value ? <Box key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color, height: '100%' }} /> : null
          )}
      </Flex>
    </Box>
  );
}

export const PART_COLORS = {
  completed: '#38A86F',
  inProgress: '#17BECF',
  waiting: '#FFC20A',
  notStarted: '#C0C0CF',
  problem: '#C9495E',
};

export function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <Flex gap={2} alignItems="center">
      <Box style={{ width: 90, height: 8, borderRadius: 4, background: '#eaeaef', overflow: 'hidden' }}>
        <Box style={{ width: `${v}%`, height: '100%', background: v === 100 ? PART_COLORS.completed : PART_COLORS.inProgress }} />
      </Box>
      <Typography variant="pi">{`${v}%`}</Typography>
    </Flex>
  );
}

/** Small "label: value" block used inside cards. */
export function Fact({ label, children }) {
  return (
    <Box>
      <Typography variant="pi" textColor="neutral600" tag="p">
        {label}
      </Typography>
      <Typography fontWeight="semiBold" tag="p">
        {children ?? '—'}
      </Typography>
    </Box>
  );
}

export function SectionTitle({ children, hint }) {
  return (
    <Box marginBottom={3} marginTop={2}>
      <Typography variant="delta" tag="h3">
        {children}
      </Typography>
      {hint && (
        <Typography variant="pi" textColor="neutral600" tag="p">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

/** Responsive row of cards. */
export function CardRow({ children }) {
  return (
    <Flex gap={4} marginBottom={6} wrap="wrap" alignItems="stretch">
      {React.Children.toArray(children)
        .filter(Boolean)
        .map((child, i) => (
          <Box key={i} style={{ flex: '1 1 190px', minWidth: 160, display: 'flex' }}>
            {child}
          </Box>
        ))}
    </Flex>
  );
}

/** plural(1, 'attempt') → "1 attempt"; plural(3, 'attempt') → "3 attempts". */
export const plural = (n, word, many = `${word}s`) => `${n} ${Number(n) === 1 ? word : many}`;

/** "Safety" + "V1.2" → "Safety (v1.2)"; the stored version may or may not start with v. */
export const withVersion = (title, version) =>
  version ? `${title} (v${String(version).replace(/^v/i, '')})` : title;
