/**
 * core/export/exportUtils — low-level, dependency-free client export helpers.
 *
 * These operate on the neutral report model produced by exportDefinitions:
 *   columns: [{ key, label, type: 'text'|'number'|'date', align?, total? }]
 *   rows:    [{ cells: [...], kind?: 'data'|'header'|'subtotal'|'spacer'|'total' }]
 *   totals:  { cells: [...] } | null
 *   meta:    { business, subtitle, filters: [{label,value}], generatedAt }
 *
 * CSV output is protected against spreadsheet formula injection: any text cell
 * that begins with = + - @ (or a control char) is prefixed with an apostrophe
 * so Excel/Sheets treats it as literal text. Numeric cells are emitted as raw
 * numbers (so negatives stay negative and formulas still work).
 */

const UTF8_BOM = '﻿';

/** Format a JS date-ish value as dd-mm-yyyy (Indian convention). */
export function formatDateCell(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** Guard a single non-numeric cell against CSV/Excel formula injection. */
export function sanitizeCsvCell(value, colType) {
  const s = value == null ? '' : String(value);
  // Numeric types are inherently safe from macro execution if we verified they are numbers.
  // We strictly protect strings starting with dangerous characters.
  if (colType !== 'number' && s && /^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function csvEscape(s) {
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function cellToCsv(value, colType) {
  if (value === null || value === undefined) return '';
  if (colType === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? String(n) : csvEscape(sanitizeCsvCell(value, colType));
  }
  if (colType === 'date') {
    return csvEscape(sanitizeCsvCell(formatDateCell(value), colType));
  }
  return csvEscape(sanitizeCsvCell(value, colType));
}

/** Build a CSV string (with UTF-8 BOM) from the neutral report model. */
export function buildCsvString({ columns = [], rows = [], totals = null, meta = {} }) {
  const lines = [];
  const pushRow = (arr) => lines.push(arr.map((v, i) => cellToCsv(v, columns[i]?.type)).join(','));

  if (meta.business) lines.push(csvEscape(sanitizeCsvCell(meta.business)));
  if (meta.title) lines.push(csvEscape(sanitizeCsvCell(meta.title)));
  const filterLine = (meta.filters || [])
    .filter(f => f && f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `${f.label}: ${f.value}`)
    .join('  |  ');
  if (filterLine) lines.push(csvEscape(sanitizeCsvCell(filterLine)));
  if (meta.business || meta.title || filterLine) lines.push('');

  lines.push(columns.map(c => csvEscape(sanitizeCsvCell(c.label))).join(','));

  for (const row of rows) {
    if (row.kind === 'spacer') { lines.push(''); continue; }
    pushRow(row.cells || []);
  }

  if (totals && Array.isArray(totals.cells)) pushRow(totals.cells);

  return UTF8_BOM + lines.join('\r\n');
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a text payload (CSV) as a file. */
export function downloadTextFile(text, filename, mime = 'text/csv;charset=utf-8;') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/**
 * Ask the server to generate a server-authoritative report export.
 */
export async function downloadServerExport(payload, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch('/api/reports/export', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = 'Export failed';
    try {
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
         msg = (await res.json()).error || msg; 
      } else {
         msg = await res.text() || msg;
      }
    } catch { /* ignore parsing errors */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  
  // Try to parse filename from Content-Disposition header
  let filename = `${payload.reportId}.${payload.format}`;
  const disposition = res.headers.get('Content-Disposition');
  if (disposition && disposition.indexOf('filename=') !== -1) {
    const matches = /filename="([^"]+)"/.exec(disposition);
    if (matches != null && matches[1]) {
      filename = matches[1];
    }
  }

  downloadBlob(blob, filename);
}
