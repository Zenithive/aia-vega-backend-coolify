import React from 'react';
import { Box, Flex } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { BarChart } from '../../../components/BarChart';

/**
 * Overall Analytics – Global and Personal content view (shared layout).
 * Renders KPIs and charts for portal engagement (holidays, news, events, townhalls, etc.).
 */
export function OverallContentView({ data }) {
  const kpis = data?.kpis || {};
  return (
    <>
      <Flex gap={4} marginBottom={6} wrap="wrap" alignItems="stretch">
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Total Users" value={kpis.totalUsers} colorIndex={0} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Holidays" value={kpis.totalHolidays} colorIndex={1} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="News Items" value={kpis.totalNews} colorIndex={2} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 180, display: 'flex' }}>
          <StatCard label="Townhalls" value={kpis.totalTownhalls} colorIndex={3} />
        </Box>
      </Flex>

      <Flex gap={4} marginBottom={6} wrap="wrap">
        {data?.holidayByMonth?.length > 0 && (
          <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
            <DonutChart
              data={data.holidayByMonth}
              title="Holidays by Month"
              height={260}
            />
          </Box>
        )}
        {data?.employeesByCompany?.length > 0 && (
          <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
            <DonutChart
              data={data.employeesByCompany}
              title="Employees by Company"
              height={260}
              showActiveInTooltip
            />
          </Box>
        )}
      </Flex>

      <Flex gap={4} marginBottom={6} wrap="wrap">
        {data?.newsByCategory?.length > 0 && (
          <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
            <BarChart
              data={data.newsByCategory}
              title="News by Category"
              nameKey="name"
              dataKey="value"
              height={260}
            />
          </Box>
        )}
        {data?.townhallByContentType?.length > 0 && (
          <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
            <BarChart
              data={data.townhallByContentType}
              title="Townhall Matrix (by Content Type)"
              nameKey="name"
              dataKey="value"
              height={260}
            />
          </Box>
        )}
      </Flex>
    </>
  );
}
