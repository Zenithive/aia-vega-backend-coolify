// @ts-nocheck
import * as XLSX from 'xlsx';

/** Download rows (objects with the same keys) as an .xlsx file. */
export function downloadExcel(rows, fileName, sheetName = 'Data') {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0] || {});
  ws['!cols'] = keys.map((k) => ({
    wch: Math.min(60, Math.max(k.length, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length)) + 2),
  }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
