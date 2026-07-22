// @ts-nocheck

import React, { useState } from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { BarChart } from '../../../components/BarChart';
import { DataTable } from '../../../components/DataTable';

const COUNT_OPTIONS = [
  { value: '5', label: '5' },
  { value: '7', label: '7' },
  { value: '10', label: '10' },
  { value: 'all', label: 'All' },
];

/**
 * Overall Analytics – Activity Tracking view.
 * KPIs: total user (visit count), unique user, time spent (min), avg time spent.
 * Charts: horizontal bar (top pages by time), bar (least used pages), activity log table.
 * Dropdowns to limit chart items: 5, 7, 10, or All.
 */
export function OverallActivityTrackingView({
  activityLogData,
  activityLogFullRows = [],
  activityKpis = {},
  activityPagesStats = {},
  activityType = '',
  newsId = '',
  setActivityLogPage,
  setActivityLogPageSize,
  activityLogSortBy = 'timestamp',
  activityLogSortOrder = 'desc',
  onActivityLogSortChange,
}) {
  const [topPagesCount, setTopPagesCount] = useState('5');
  const [leastPagesCount, setLeastPagesCount] = useState('5');
  const [dataView, setDataView] = useState('table'); // 'table' | 'chart'

  const kpis = activityKpis || {};
  const topPagesRaw = activityPagesStats?.topPagesByVisit || [];
  const leastUsedRaw = activityPagesStats?.leastUsedPages || [];

  const topLimit = topPagesCount === 'all' ? topPagesRaw.length : Math.min(Number(topPagesCount) || 10, topPagesRaw.length);
  const leastLimit = leastPagesCount === 'all' ? leastUsedRaw.length : Math.min(Number(leastPagesCount) || 10, leastUsedRaw.length);

  const topPages = topPagesRaw.slice(0, topLimit);
  const leastUsed = leastUsedRaw.slice(0, leastLimit);

  return (
    <>
      <Flex gap={4} marginBottom={6} wrap="wrap" alignItems="stretch">
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Total User" value={kpis.totalUser ?? 0} subtext="Total page visits" colorIndex={0} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Unique User" value={kpis.uniqueUser ?? 0} subtext="Distinct users who visited" colorIndex={1} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Time Spent (min)" value={kpis.timeSpentMin ?? 0} subtext="Total minutes across all visits" colorIndex={2} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Avg Time Spent" value={kpis.avgTimeSpentMin != null ? `${kpis.avgTimeSpentMin} min` : '0 min'} subtext="Per unique user" colorIndex={3} />
        </Box>
      </Flex>

      <Flex marginBottom={4} gap={1} alignItems="center" justifyContent="flex-end">
        <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
          View:
        </Typography>
        <Button variant={dataView === 'table' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('table')}>
          Table
        </Button>
        <Button variant={dataView === 'chart' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('chart')}>
          Chart
        </Button>
      </Flex>

      {dataView === 'chart' && (
        <Flex gap={4} marginBottom={6} wrap="wrap">
          <Box style={{ flex: '1 1 400px', minWidth: 320 }}>
            <Flex justifyContent="space-between" alignItems="center" marginBottom={2}>
              <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
                Top Pages by Time
              </Typography>
            <select
              value={topPagesCount}
              onChange={(e) => setTopPagesCount(e.target.value)}
              style={{
                padding: '4px 8px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '12px',
                minWidth: 70,
              }}
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Flex>
          <BarChart
            data={topPages}
            title=""
            nameKey="name"
            dataKey="value"
            valueLabel="Time"
            valueUnit="min"
            height={280}
            layout="horizontal"
            tooltipFormatter={(value, name, props) => {
              const payload = props?.payload;
              const count = payload?.count != null ? payload.count : '';
              if (count !== '') return [`${value} min · ${count} visit(s)`, 'Time'];
              return [`${value} min`, 'Time'];
            }}
          />
        </Box>
        <Box style={{ flex: '1 1 400px', minWidth: 320 }}>
          <Flex justifyContent="space-between" alignItems="center" marginBottom={2}>
            <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
              Least Used Pages
            </Typography>
            <select
              value={leastPagesCount}
              onChange={(e) => setLeastPagesCount(e.target.value)}
              style={{
                padding: '4px 8px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '12px',
                minWidth: 70,
              }}
            >
              {COUNT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Flex>
          <BarChart
            data={leastUsed}
            title=""
            nameKey="name"
            dataKey="value"
            valueLabel="Time"
            valueUnit="min"
            height={280}
            layout="horizontal"
            tooltipFormatter={(value, name, props) => {
              const payload = props?.payload;
              const count = payload?.count != null ? payload.count : '';
              if (count !== '') return [`${value} min · ${count} visit(s)`, 'Time'];
              return [`${value} min`, 'Time'];
            }}
          />
        </Box>
        </Flex>
      )}

      {dataView === 'table' && (
        <Box>
          <DataTable
            data={activityLogData.rows}
            fullData={activityLogFullRows.length > 0 ? activityLogFullRows : activityLogData.rows}
            paginatedData={activityLogData.rows}
            columns={[
              { key: 'userName', label: 'USER' },
              { key: 'company', label: 'COMPANY' },
              { key: 'activity', label: 'PAGE', sortable: true, sortKey: 'activity' },
              ...(activityType === 'News'
                ? [
                    {
                      key: 'likesDisplay',
                      label: 'LIKES',
                      render: (val) => (val != null && val !== '' ? String(val) : '—'),
                    },
                  ]
                : []),
              { key: 'duration', label: 'DURATION', sortable: true, sortKey: 'duration' },
              {
                key: 'timestamp',
                label: 'DATE',
                sortable: true,
                sortKey: 'timestamp',
                render: (val) => (val ? new Date(val).toLocaleString() : '—'),
              },
            ]}
            title="Recent Activity Log"
            exportFileName="activity-log.xlsx"
            sortBy={activityLogSortBy}
            sortOrder={activityLogSortOrder}
            onSortChange={onActivityLogSortChange}
            pagination={{
              page: activityLogData.page,
              pageSize: activityLogData.pageSize,
              total: activityLogData.total,
              onPageChange: setActivityLogPage,
              onPageSizeChange: (v) => setActivityLogPageSize(Number(v)),
            }}
          />
        </Box>
      )}
    </>
  );
}
