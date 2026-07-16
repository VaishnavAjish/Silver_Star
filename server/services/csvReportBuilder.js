const UTF8_BOM = '\uFEFF';

function sanitizeCsvCell(value, colType) {
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
  // Date formatting can be handled before passing here, but we can do a simple one.
  if (colType === 'date' && value) {
    let d = value instanceof Date ? value : new Date(value);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const fDate = `${dd}-${mm}-${d.getFullYear()}`;
      return csvEscape(sanitizeCsvCell(fDate, colType));
    }
  }
  return csvEscape(sanitizeCsvCell(value, colType));
}

function buildCsvBuffer(model) {
  const { columns = [], rows = [], totals = null, title, meta = {} } = model;
  const lines = [];
  const pushRow = (arr) => lines.push(arr.map((v, i) => cellToCsv(v, columns[i]?.type)).join(','));

  const business = meta.business || 'Silverstar Grow';
  if (business) lines.push(csvEscape(sanitizeCsvCell(business)));
  if (title) lines.push(csvEscape(sanitizeCsvCell(title)));
  const filterLine = (meta.filters || [])
    .filter(f => f && f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `${f.label}: ${f.value}`)
    .join('  |  ');
  if (filterLine) lines.push(csvEscape(sanitizeCsvCell(filterLine)));
  if (business || title || filterLine) lines.push('');

  lines.push(columns.map(c => csvEscape(sanitizeCsvCell(c.label))).join(','));

  for (const row of rows) {
    if (row.kind === 'spacer') { lines.push(''); continue; }
    pushRow(row.cells || []);
  }

  if (totals && Array.isArray(totals.cells)) pushRow(totals.cells);

  return Buffer.from(UTF8_BOM + lines.join('\r\n'), 'utf8');
}

module.exports = {
  buildCsvBuffer
};
