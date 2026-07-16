/**
 * PrintableReportHeader — formal, print-only report header.
 *
 * Rendered at the top of each P0 report. It is hidden on screen (`print-only`
 * is displayed only inside `@media print`, per core/styles/app.css) and appears
 * when the user prints, giving the browser-print output a proper masthead:
 * business name, report title, the active filter summary, and a generated
 * timestamp. This is the dedicated print-ready layout — no fake PDF engine.
 */

import { BUSINESS_NAME } from './exportDefinitions';

export default function PrintableReportHeader({ title, filters = [], business = BUSINESS_NAME }) {
  const filterText = filters
    .filter(f => f && f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `${f.label}: ${f.value}`)
    .join('    |    ');

  return (
    <div className="print-only" style={{ display: 'none', textAlign: 'center', marginBottom: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{business}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{title}</div>
      {filterText && <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{filterText}</div>}
      <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
        Generated: {new Date().toLocaleString('en-IN')}
      </div>
    </div>
  );
}
