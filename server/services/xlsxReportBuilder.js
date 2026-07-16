/**
 * xlsxReportBuilder — shared, calculation-agnostic Excel workbook builder.
 *
 * This service is a PURE FORMATTER. It never runs a report query and never
 * derives accounting figures; it turns an already-computed report model
 * (columns + rows + totals, produced client-side from the live report view)
 * into a styled .xlsx buffer. Keeping it dumb guarantees the export always
 * matches exactly what the user saw on screen and preserves the single
 * reporting engine.
 *
 * Model shape (validated by the route before it reaches here):
 *   {
 *     title, business, subtitle, orientation: 'portrait'|'landscape',
 *     generatedAt: ISO string,
 *     filters: [{ label, value }],
 *     columns: [{ label, type: 'text'|'number'|'date', align?, width?, numFmt? }],
 *     rows:    [{ cells: [...], kind?: 'data'|'header'|'subtotal'|'spacer'|'total' }],
 *     totals:  { cells: [...] } | null
 *   }
 */

const ExcelJS = require('exceljs');

const DEFAULT_NUM_FMT = '#,##0.00';
const DEFAULT_DATE_FMT = 'dd-mm-yyyy';
const BRAND_FILL = 'FF0D7C5F';
const HEADER_FILL = 'FFEDF6F2';
const GROUP_FILL = 'FFEEF1F8';
const TOTAL_FILL = 'FFE8F5E9';

function colLetter(index) {
  // 0-based index -> Excel column letter (A, B, ... Z, AA ...)
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function setCellValue(cell, value, colType, colNumFmt) {
  if (value === null || value === undefined || value === '') {
    cell.value = null;
    return;
  }
  if (colType === 'number') {
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    cell.value = Number.isFinite(num) ? num : null;
    cell.numFmt = colNumFmt || DEFAULT_NUM_FMT;
    return;
  }
  if (colType === 'date') {
    const d = value instanceof Date ? value : new Date(value);
    if (!isNaN(d.getTime())) {
      cell.value = d;
      cell.numFmt = colNumFmt || DEFAULT_DATE_FMT;
      return;
    }
  }
  cell.value = String(value);
}

/**
 * @param {object} model
 * @returns {Promise<Buffer>}
 */
async function buildWorkbookBuffer(model) {
  const {
    title = 'Report',
    business = '',
    subtitle = '',
    orientation = 'portrait',
    generatedAt,
    filters = [],
    columns = [],
    rows = [],
    totals = null,
  } = model;

  const wb = new ExcelJS.Workbook();
  wb.creator = business || 'SilverStar Grow ERP';
  wb.created = new Date();

  const ws = wb.addWorksheet(title.slice(0, 31) || 'Report', {
    pageSetup: {
      orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  const colCount = columns.length || 1;
  const lastCol = colLetter(colCount - 1);

  // ── Title block ────────────────────────────────────────────────────────
  let r = 1;
  if (business) {
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = business;
    c.font = { bold: true, size: 15, color: { argb: BRAND_FILL } };
    c.alignment = { horizontal: 'center' };
    r += 1;
  }
  ws.mergeCells(`A${r}:${lastCol}${r}`);
  const titleCell = ws.getCell(`A${r}`);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center' };
  r += 1;

  if (subtitle) {
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = subtitle;
    c.font = { size: 10, color: { argb: 'FF757575' } };
    c.alignment = { horizontal: 'center' };
    r += 1;
  }

  const filterLine = filters
    .filter(f => f && f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `${f.label}: ${f.value}`)
    .join('    |    ');
  if (filterLine) {
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = filterLine;
    c.font = { size: 10, color: { argb: 'FF424242' } };
    c.alignment = { horizontal: 'center' };
    r += 1;
  }

  if (generatedAt) {
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const c = ws.getCell(`A${r}`);
    let stamp = generatedAt;
    try { stamp = new Date(generatedAt).toLocaleString('en-IN'); } catch { /* keep raw */ }
    c.value = `Generated: ${stamp}`;
    c.font = { size: 9, italic: true, color: { argb: 'FF9E9E9E' } };
    c.alignment = { horizontal: 'center' };
    r += 1;
  }

  r += 1; // spacer row

  // ── Column header row ──────────────────────────────────────────────────
  const headerRowNumber = r;
  const headerRow = ws.getRow(headerRowNumber);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: col.align || (col.type === 'number' ? 'right' : 'left'), vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });
  headerRow.height = 18;
  r += 1;

  // ── Data rows ──────────────────────────────────────────────────────────
  for (const row of rows) {
    const kind = row.kind || 'data';
    if (kind === 'spacer') { r += 1; continue; }
    const xlRow = ws.getRow(r);
    const cells = row.cells || [];
    columns.forEach((col, i) => {
      const cell = xlRow.getCell(i + 1);
      setCellValue(cell, cells[i], col.type, col.numFmt);
      cell.alignment = { horizontal: col.align || (col.type === 'number' ? 'right' : 'left') };
      if (kind === 'header' || kind === 'subtotal') {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL } };
      }
    });
    r += 1;
  }

  // ── Totals row ─────────────────────────────────────────────────────────
  if (totals && Array.isArray(totals.cells)) {
    const xlRow = ws.getRow(r);
    columns.forEach((col, i) => {
      const cell = xlRow.getCell(i + 1);
      setCellValue(cell, totals.cells[i], col.type, col.numFmt);
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.alignment = { horizontal: col.align || (col.type === 'number' ? 'right' : 'left') };
      cell.border = { top: { style: 'double', color: { argb: 'FF999999' } } };
    });
    r += 1;
  }

  // ── Column widths, freeze header, auto-filter ──────────────────────────
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width || (col.type === 'number' ? 16 : col.type === 'date' ? 13 : 28);
  });

  ws.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  ws.autoFilter = { from: `A${headerRowNumber}`, to: `${lastCol}${headerRowNumber}` };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { buildWorkbookBuffer };
