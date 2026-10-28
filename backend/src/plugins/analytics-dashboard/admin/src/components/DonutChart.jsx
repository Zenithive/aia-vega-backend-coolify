import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { useTheme } from 'styled-components';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { CHART_COLORS } from './chartColors';

export function DonutChart({ data = [], title, height = 280, showActiveInTooltip = false }) {
  const { colors } = useTheme();
  // Filter out 0-value segments to avoid overlapping labels (e.g. personal view: one status 100%, others 0%)
  const chartData = (data || []).filter((d) => (d.value || 0) > 0);
  const total = chartData.reduce((sum, d) => sum + (d.value || 0), 0);
  if (chartData.length === 0 || total === 0) {
    return (
      <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
        <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
          {title}
        </Typography>
        <Typography variant="pi" textColor="neutral500">
          No data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={
              showActiveInTooltip
                ? ({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const p = payload[0].payload;
                    if (p.activeValue === undefined) return null;
                    return (
                      <Box padding={2} background="neutral0" hasRadius style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.25)', border: `1px solid ${colors.neutral200}` }}>
                        <Typography variant="pi" fontWeight="semiBold">{p.name}</Typography>
                        <Typography variant="pi" textColor="neutral600">Count: {p.value}</Typography>
                        <Typography variant="pi" textColor="neutral600">Active: {p.activeValue}</Typography>
                      </Box>
                    );
                  }
                : undefined
            }
            formatter={!showActiveInTooltip ? (v) => [v, 'Count'] : undefined}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}
