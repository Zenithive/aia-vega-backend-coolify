// @ts-nocheck
/**
 * Helpers for the assignment list and editor.
 */

export const TARGETS = {
  Department: { label: 'Departments', description: 'Everyone in the departments you choose' },
  Location: { label: 'Work locations', description: 'Everyone at the work locations you choose' },
  Individual: { label: 'Specific employees', description: 'Upload an Excel / CSV file or search for people' },
};

/** "Departments: Production, Quality" / "12 employees" */
export function describeTarget(a) {
  if (a.targetType === 'Individual') {
    const n = a.learnerCount || 0;
    return `${n} employee${n === 1 ? '' : 's'}`;
  }
  const names = (a.targets || []).map((t) => t.name).filter(Boolean);
  const label = a.targetType === 'Location' ? 'Work locations' : 'Departments';
  if (!names.length) return label;
  return `${label}: ${names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ')}`;
}

/** Date ⇄ "YYYY-MM-DD" in local time (a due date is a calendar day, not an instant). */
export function toISODate(date) {
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/**
 * "YYYY-MM-DD" → value for the design-system DatePicker. The picker reads its `value` in UTC
 * (but returns local dates from onChange), so local midnight would show the previous day
 * east of UTC (e.g. India). Pass UTC midnight of the same calendar day instead.
 */
export function toPickerDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : undefined;
}

export function formatDay(value) {
  const d = fromISODate(value);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
  } catch {
    return value;
  }
}

export function isPastDay(value) {
  const d = fromISODate(value);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function employeeLabel(user) {
  return user?.username || user?.email || `Employee #${user?.id}`;
}

export function employeeCode(user) {
  return user?.emp_code || user?.emp_id || '';
}

/** First column of a CSV, skipping a header row such as "email" or "emp_code". */
export function parseCsvIdentifiers(text) {
  const knownHeaders = new Set(['email', 'emp_code', 'emp_id', 'username', 'user', 'identifier', 'name']);
  const lines = String(text || '').split(/\r?\n/);
  const clean = (cell) => cell.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const start = lines.length && knownHeaders.has(clean(lines[0]).toLowerCase()) ? 1 : 0;
  return lines.slice(start).map(clean).filter(Boolean);
}

export function readFile(file, as) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target.result));
    reader.onerror = () => reject(new Error('Could not read the file'));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}
