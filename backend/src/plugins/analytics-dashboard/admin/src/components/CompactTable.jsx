// @ts-nocheck
/**
 * Table that always fits the page width (no horizontal scrolling).
 *
 * Columns get a share of the width and their content wraps. Optional `tableMinWidth` enables a
 * horizontally scrollable table when all fields need their own column; `renderExpanded` remains
 * available for tables that intentionally group secondary details.
 *
 * columns: [{ key, label, width?: '25%', render?: (row) => node, sortable?: boolean, align?: 'right' }]
 * exportColumns: [{ label, value: (row) => string|number }] — Excel export of all rows (incl. hidden details)
 * pagination: optional controlled paging { page, pageSize, total, onPageChange, onPageSizeChange } (server side);
 *             without it the table pages `rows` itself.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { useTheme } from 'styled-components';
import * as XLSX from 'xlsx';

const PAGE_SIZES = [10, 20, 50, 100];

const css = {
  table: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
    verticalAlign: 'bottom',
  },
  td: {
    padding: '10px 12px',
    fontSize: 14,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  expanded: { padding: '12px 16px 16px 44px' },
};

export function exportToExcel(rows, exportColumns, fileName, sheet) {
  const data = rows.map((row) => {
    const out = {};
    exportColumns.forEach((c) => {
      const v = c.value(row);
      out[c.label] = v == null || v === '' ? '—' : v;
    });
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = exportColumns.map((c) => ({
    wch: Math.min(50, Math.max(c.label.length, ...data.map((r) => String(r[c.label] ?? '').length)) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheet || 'Data').slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

export function CompactTable({
  title,
  subtitle,
  rows = [],
  allRows = null,
  columns,
  getRowKey = (row, i) => row.id ?? i,
  renderExpanded = null,
  onRowClick = null,
  exportColumns = null,
  exportFileName = 'export.xlsx',
  emptyMessage = 'Nothing to show.',
  pagination = null,
  sortBy = null,
  sortOrder = 'desc',
  onSortChange = null,
  toolbar = null,
  defaultPageSize = 10,
  tableMinWidth,
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Client-side paging when the parent does not page.
  useEffect(() => setPage(1), [rows.length]);
  const localPageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const paging = pagination || {
    page: Math.min(page, localPageCount),
    pageSize,
    total: rows.length,
    onPageChange: setPage,
    onPageSizeChange: (n) => {
      setPageSize(n);
      setPage(1);
    },
  };
  const visible = useMemo(
    () => (pagination ? rows : rows.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize)),
    [pagination, rows, paging.page, paging.pageSize]
  );
  const pageCount = Math.max(1, Math.ceil((paging.total || 0) / paging.pageSize));
  const from = paging.total ? (paging.page - 1) * paging.pageSize + 1 : 0;
  const to = Math.min(paging.page * paging.pageSize, paging.total || 0);

  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandable = typeof renderExpanded === 'function';
  const colCount = columns.length + (expandable ? 1 : 0);
  const themedHeader = {
    ...css.th,
    color: colors.neutral600,
    borderBottom: `1px solid ${colors.neutral200}`,
    background: colors.neutral100,
  };
  const themedCell = {
    ...css.td,
    color: colors.neutral800,
    borderBottom: `1px solid ${colors.neutral200}`,
  };

  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={2} padding={4}>
        <Box>
          {title && (
            <Typography variant="delta" tag="h3">
              {title}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="pi" textColor="neutral600" tag="p">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Flex gap={2} alignItems="center" wrap="wrap">
          {toolbar}
          {exportColumns && (
            <Button
              variant="secondary"
              size="S"
              disabled={!(allRows || rows).length}
              onClick={() => exportToExcel(allRows || rows, exportColumns, exportFileName, title)}
            >
              Download Excel
            </Button>
          )}
        </Flex>
      </Flex>

      {!rows.length ? (
        <Box padding={6} paddingTop={2}>
          <Typography textColor="neutral600">{emptyMessage}</Typography>
        </Box>
      ) : (
        <div style={{ overflowX: tableMinWidth ? 'auto' : undefined }}>
          <table style={{ ...css.table, minWidth: tableMinWidth }}>
            <colgroup>
              {expandable && <col style={{ width: 32 }} />}
              {columns.map((c) => (
                <col key={c.key} style={c.width ? { width: c.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {expandable &&                 <th style={themedHeader} aria-label="Details" />}
                {columns.map((c) => {
                  const sortable = c.sortable && onSortChange;
                  const active = sortable && sortBy === c.key;
                  return (
                    <th
                      key={c.key}
                      style={{ ...themedHeader, textAlign: c.align || 'left', cursor: sortable ? 'pointer' : 'default' }}
                      onClick={sortable ? () => onSortChange(c.key, active && sortOrder === 'desc' ? 'asc' : 'desc') : undefined}
                      title={sortable ? 'Click to sort' : undefined}
                    >
                      {c.label}
                      {sortable && <span style={{ marginLeft: 4, color: active ? colors.primary600 : colors.neutral500 }}>{active ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, i) => {
                const key = String(getRowKey(row, i));
                const isOpen = open.has(key);
                const clickable = expandable || onRowClick;
                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={clickable ? () => (onRowClick ? onRowClick(row) : toggle(key)) : undefined}
                      style={{ cursor: clickable ? 'pointer' : 'default', background: isOpen ? colors.neutral100 : undefined }}
                    >
                      {expandable && (
                        <td
                          style={{ ...themedCell, color: colors.neutral500, paddingRight: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(key);
                          }}
                        >
                          {isOpen ? '▾' : '▸'}
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.key} style={{ ...themedCell, textAlign: c.align || 'left' }}>
                          {c.render ? c.render(row) : row[c.key] ?? '—'}
                        </td>
                      ))}
                    </tr>
                    {expandable && isOpen && (
                      <tr>
                        <td
                          colSpan={colCount}
                          style={{
                            ...css.expanded,
                            color: colors.neutral800,
                            background: colors.neutral100,
                            borderBottom: `1px solid ${colors.neutral200}`,
                          }}
                        >
                          {renderExpanded(row)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap={2} padding={3} paddingLeft={4} paddingRight={4}>
          <Typography variant="pi" textColor="neutral600">
            {`${from}–${to} of ${paging.total}`}
            {expandable ? ' · click a row for details' : ''}
          </Typography>
          <Flex gap={2} alignItems="center">
            <Typography variant="pi" textColor="neutral600">Rows</Typography>
            <select
              value={paging.pageSize}
              onChange={(e) => paging.onPageSizeChange(Number(e.target.value))}
              style={{
                padding: '4px 6px',
                border: `1px solid ${colors.neutral200}`,
                borderRadius: 4,
                fontSize: 13,
                color: colors.neutral800,
                background: colors.neutral0,
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button variant="tertiary" size="S" disabled={paging.page <= 1} onClick={() => paging.onPageChange(paging.page - 1)}>
              Previous
            </Button>
            <Typography variant="pi">{`${paging.page} / ${pageCount}`}</Typography>
            <Button variant="tertiary" size="S" disabled={paging.page >= pageCount} onClick={() => paging.onPageChange(paging.page + 1)}>
              Next
            </Button>
          </Flex>
        </Flex>
      )}
    </Box>
  );
}

/** Label/value grid used inside expanded rows. */
export function DetailGrid({ items }) {
  return (
    <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px 20px' }}>
      {items
        .filter(Boolean)
        .map(([label, value]) => (
          <Box key={label}>
            <Typography variant="pi" textColor="neutral600" tag="p">
              {label}
            </Typography>
            <Typography variant="omega" tag="p">
              {value == null || value === '' ? '—' : value}
            </Typography>
          </Box>
        ))}
    </Box>
  );
}
