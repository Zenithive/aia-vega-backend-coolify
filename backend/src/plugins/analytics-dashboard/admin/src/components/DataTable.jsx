//@ts-nocheck

import React from 'react';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Button, Flex } from '@strapi/design-system';
import * as XLSX from 'xlsx';

const DEFAULT_FONT_SIZE = '16px';

export function DataTable({
  data = [],
  columns = [],
  title,
  pagination = null,
  sortBy = null,
  sortOrder = 'asc',
  onSortChange = null,
  fontSize = DEFAULT_FONT_SIZE,
  exportFileName = null,
  emptyMessage = 'No data available',
  downloadStyle: propDownloadStyle = 'shown',
  fullData = [],
  paginatedData = [],
  onDownloadStyleChange = null,
}) {
  const [downloadStyle, setDownloadStyle] = React.useState(propDownloadStyle);

  const handleDownloadStyleChange = (value) => {
    setDownloadStyle(value);
    if (onDownloadStyleChange) {
      onDownloadStyleChange(value);
    }
  };
  const handleExportToExcel = () => {
    // Choose data based on downloadStyle
    let exportSource = data;
    if (downloadStyle === 'all') {
      exportSource = fullData && fullData.length ? fullData : data;
    } else {
      exportSource = paginatedData && paginatedData.length ? paginatedData : data;
    }
    if (!exportSource || exportSource.length === 0) return;

    // Prepare data for Excel export
    const exportLabel = (col) => col.exportLabel ?? col.label;
    const exportData = exportSource.map((row) => {
      const exportRow = {};
      columns.forEach((col) => {
        let value = typeof col.exportValue === 'function'
          ? col.exportValue(row[col.key], row)
          : row[col.key];
        // If no exportValue is provided, fall back to render output and strip JSX.
        if (value === undefined && col.render) {
          const rendered = col.render(value, row);
          // If rendered is a React element, try to extract text content
          if (rendered && typeof rendered === 'object' && rendered.props) {
            value = rendered.props.children || value;
          } else if (typeof rendered === 'string' || typeof rendered === 'number') {
            value = rendered;
          }
        }
        exportRow[exportLabel(col)] = value ?? '—';
      });
      return exportRow;
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Auto-size columns
    const maxWidth = 50;
    const wscols = columns.map((col) => {
      const lbl = exportLabel(col);
      const maxLen = Math.max(
        lbl.length,
        ...exportData.map((row) => String(row[lbl] || '').length)
      );
      return { wch: Math.min(maxLen + 2, maxWidth) };
    });
    ws['!cols'] = wscols;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, title || 'Data');

    // Generate file name
    const fileName = exportFileName || `${title || 'data'}_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Download file
    XLSX.writeFile(wb, fileName);
  };
  if (!data || data.length === 0) {
    return (
      <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
        {title && (
          <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
            {title}
          </Typography>
        )}
        <Typography variant="pi" textColor="neutral500">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  const { page = 1, pageSize = 10, total = 0, onPageChange, onPageSizeChange } = pagination || {};
  const totalPages = Math.ceil(total / pageSize) || 1;
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, total);

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Flex justifyContent="space-between" alignItems="center" marginBottom={4} wrap="wrap" gap={2}>
        <Flex gap={2} alignItems="center">
          {title && (
            <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
              {title}
            </Typography>
          )}
          {data?.length > 0 && (
            <Button
              variant="secondary"
              size="S"
              onClick={handleExportToExcel}
              title="Download as Excel file"
            >
              Download Excel
            </Button>
          )}
          {/* Dropdown for download style, right of Download Excel button */}
          {data?.length > 0 && (
            <Box style={{ minWidth: 180 }}>
              <label htmlFor="download-style-select" style={{ fontSize: '14px', marginRight: 8 }}>Download:</label>
              <select
                id="download-style-select"
                value={downloadStyle}
                onChange={e => handleDownloadStyleChange(e.target.value)}
                style={{ padding: '4px 8px', fontSize: '14px', borderRadius: 4 }}
              >
                <option value="shown">Current rows</option>
                <option value="all">All rows</option>
              </select>
            </Box>
          )}
        </Flex>
        {pagination && total > 0 && (
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="pi" textColor="neutral600">
              Rows per page:
            </Typography>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(e.target.value)}
              style={{
                padding: '4px 8px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              {[5, 10, 20, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Typography variant="pi" textColor="neutral600">
              {startRow}-{endRow} of {total}
            </Typography>
            <Button
              variant="tertiary"
              size="S"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              Previous
            </Button>
            <Typography variant="pi" textColor="neutral600">
              Page {page} of {totalPages}
            </Typography>
            <Button
              variant="tertiary"
              size="S"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
            >
              Next
            </Button>
          </Flex>
        )}
      </Flex>
      <Box style={{ fontSize, overflowX: 'auto' }}>
        <Table colCount={columns.length} rowCount={data.length} style={{ tableLayout: 'auto', width: 'fit-content', minWidth: '100%' }}>
          <Thead>
            <Tr>
              {columns.map((col) => {
                const sortKey = col.sortKey ?? col.key;
                const isSortable = col.sortable && onSortChange;
                const isActive = sortBy === sortKey;
                const handleSort = () => {
                  if (!isSortable) return;
                  const nextOrder = isActive && sortOrder === 'desc' ? 'asc' : 'desc';
                  onSortChange(sortKey, nextOrder);
                };
                const sortLabel = isActive
                  ? sortOrder === 'asc'
                    ? 'Sorted ascending (click to sort descending)'
                    : 'Sorted descending (click to sort ascending)'
                  : 'Click to sort by this column';
                const headerContent = col.header != null ? col.header : <Typography variant="sigma" textColor="neutral600">{col.label}</Typography>;
                return (
                  <Th key={col.key} style={col.thStyle || undefined}>
                    <Flex
                      alignItems="center"
                      gap={1}
                      style={{ cursor: isSortable ? 'pointer' : 'default' }}
                      onClick={handleSort}
                      title={isSortable ? sortLabel : undefined}
                    >
                      {headerContent}
                      {isSortable && (
                        <span
                          style={{ fontSize: 13, fontWeight: 'bold', color: isActive ? '#2563eb' : '#3b82f6' }}
                          title={sortLabel}
                        >
                          {isActive ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '↕'}
                        </span>
                      )}
                    </Flex>
                  </Th>
                );
              })}
            </Tr>
          </Thead>
          <Tbody>
            {data.map((row, i) => (
              <Tr key={i}>
                {columns.map((col) => (
                  <Td key={col.key} style={col.tdStyle || undefined}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Box>
  );
}

export default DataTable;
