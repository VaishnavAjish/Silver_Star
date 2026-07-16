/**
 * Export utilities — CSV/Excel, PDF (print window), Word (.doc).
 * No external dependencies. UTF-8 BOM ensures Excel reads CJK/₹ correctly.
 */

export function exportToCSV(filename, headers, rows) {
  const BOM = '﻿';
  const escape = v => {
    let s = v == null ? '' : String(v);
    // Formula-injection guard: neutralise cells that a spreadsheet would treat
    // as a formula, without mangling genuine numbers (e.g. -500 stays a number).
    if (typeof v === 'number') return s;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportToWord(filename, title, headers, rows) {
  const tableRows = rows.map(r =>
    `<tr>${r.map(c => `<td style="border:1px solid #ccc;padding:5px 8px;font-size:11pt">${c == null ? '' : c}</td>`).join('')}</tr>`
  ).join('');
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11pt; }
      h2   { font-size: 14pt; margin-bottom: 4pt; }
      table{ border-collapse: collapse; width: 100%; }
      th   { background:#EDF6F2; border:1px solid #ccc; padding:5px 8px; font-size:11pt; text-align:left; }
    </style></head>
    <body>
      <h2>${title}</h2>
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `${filename}.doc` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function printTable(title, subtitle, headers, rows) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; color: #212121; margin: 16px; }
      h2 { font-size: 15px; margin: 0 0 2px; }
      .sub { font-size: 11px; color: #757575; margin: 0 0 12px; }
      table { border-collapse: collapse; width: 100%; }
      th { background: #EDF6F2; border: 1px solid #ccc; padding: 5px 8px; font-weight: 600; text-align: left; font-size: 11px; }
      td { border: 1px solid #eee; padding: 4px 8px; vertical-align: top; }
      tr:nth-child(even) td { background: #F8FCFA; }
      .actions { margin-bottom: 10px; }
      button { padding: 6px 14px; background: #0D7C5F; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 8px; }
      @media print { .actions { display: none; } }
    </style>
  </head><body>
  <div class="actions">
    <button onclick="window.print()">Print / Save PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <h2>${title}</h2>
  ${subtitle ? `<p class="sub">${subtitle}</p>` : ''}
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c == null ? '' : c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
  </body></html>`);
  w.document.close();
}
