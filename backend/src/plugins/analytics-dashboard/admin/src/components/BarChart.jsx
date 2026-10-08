import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { BarChart as RechartsBar, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
// @ts-ignore: Suppress type error for layout prop
import { getBarColor } from './chartColors';

/**
 * @param {Object} props
 * @param {Array} props.data
 * @param {string} props.title
 * @param {string} [props.dataKey]
 * @param {string} [props.nameKey]
 * @param {number} [props.height]
 * @param {string} [props.valueLabel]
 * @param {string} [props.valueUnit]
 * @param {'horizontal'|'vertical'} [props.layout] - 'horizontal' = bars extend right (categories on Y); 'vertical' = bars extend up (categories on X)
 * @param {(value: any, name?: string, props?: any) => React.ReactNode} [props.tooltipFormatter]
 */
export function BarChart({ data = [], title, dataKey = 'value', nameKey = 'name', height = 280, valueLabel = 'Value', valueUnit = '', layout = 'vertical', tooltipFormatter }) {
  if (!data || data.length === 0) {
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

  // Horizontal bars = categories on Y-axis, values on X-axis → Recharts uses layout="vertical" (category axis is vertical)
  const isHorizontalBars = layout === 'horizontal';
  const rechartsLayout = isHorizontalBars ? 'vertical' : 'horizontal';
  const barCategoryGap = isHorizontalBars && data.length > 0 ? `${Math.max(10, 40 - data.length * 2)}%` : undefined;
  const minBarSize = isHorizontalBars ? 24 : undefined;
  const fixedBarSize = isHorizontalBars ? 34 : undefined;
  // Minimal left margin so bars use more of the width; YAxis width only for labels
  const margin = isHorizontalBars ? { left: 8, right: 16, top: 8, bottom: 28 } : { top: 20, bottom: 20, left: 5, right: 5 };
  // Height for horizontal chart: fit all bars and labels (roughly 28px per category)
  // Room for the longest category label (about 6px per character at font size 11), within limits.
  const longestLabel = Math.max(0, ...data.map((d) => String(d?.[nameKey] ?? '').length));
  const labelWidth = Math.min(260, Math.max(88, Math.round(longestLabel * 6.2)));
  const chartHeight = isHorizontalBars ? Math.min(700, 90 + data.length * 48) : height;

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <RechartsBar data={data} layout={rechartsLayout} margin={margin} barCategoryGap={barCategoryGap}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          {isHorizontalBars ? (
            <>
              <XAxis type="number" label={{ value: valueLabel + (valueUnit ? ` (${valueUnit})` : ''), position: 'insideBottomRight', offset: 0 }} tickFormatter={v => valueUnit ? `${v} ${valueUnit}` : v} />
              <YAxis type="category" dataKey={nameKey} width={labelWidth} tick={{ fontSize: 11 }} interval={0} />
            </>
          ) : (
            <>
              <XAxis type="category" dataKey={nameKey} tick={{ fontSize: 12 }} interval={0} angle={-30} dy={10} />
              <YAxis type="number" label={{ value: valueLabel + (valueUnit ? ` (${valueUnit})` : ''), angle: -90, position: 'insideLeft' }} tickFormatter={v => valueUnit ? `${v} ${valueUnit}` : v} />
            </>
          )}
          <Tooltip formatter={tooltipFormatter ? tooltipFormatter : (v => valueUnit ? `${v} ${valueUnit}` : v)} labelFormatter={l => l} />
          <Legend />
          <Bar dataKey={dataKey} name={valueLabel} radius={[4, 4, 0, 0]} minPointSize={minBarSize} barSize={fixedBarSize}>
            {data.map((_, i) => (
              <Cell key={i} fill={getBarColor(i)} />
            ))}
          </Bar>
        </RechartsBar>
      </ResponsiveContainer>
    </Box>
  );
}
