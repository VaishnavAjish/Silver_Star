/**
 * core/export/ExportMenu — the one export dropdown for P0 accounting reports.
 *
 * Definition-driven: give it a reportId (key into REPORT_EXPORTS), the live
 * report `data`, and the page's active `filters`. It offers exactly the formats
 * declared by that report's definition (Excel .xlsx · CSV · Print) and defers
 * all work to useReportExport. There is no per-report export code and no
 * duplicate menu — every P0 report mounts this same component.
 */

import { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown } from 'lucide-react';
import { REPORT_EXPORTS } from './exportDefinitions';
import { useReportExport } from './useReportExport';

const FORMAT_META = {
  xlsx: { label: 'Export Excel (.xlsx)', icon: <FileSpreadsheet size={13} style={{ color: '#1D6F42' }} /> },
  csv: { label: 'Export CSV', icon: <FileText size={13} style={{ color: '#616161' }} /> },
  print: { label: 'Print / PDF', icon: <Printer size={13} style={{ color: '#1565C0' }} /> },
};

export default function ReportExportMenu({ reportId, data, filters = {}, buttonStyle }) {
  const def = REPORT_EXPORTS[reportId];
  const { canExport, hasData, exporting, exportAs, formats } = useReportExport(def, data, filters);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!def || !canExport) return null;

  const busy = exporting !== null;

  const onPick = (format) => {
    setOpen(false);
    exportAs(format);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }} className="no-print">
      <button
        className="btn"
        onClick={() => setOpen(o => !o)}
        title={hasData ? 'Export' : 'Generate the report first'}
        style={{ display: 'flex', alignItems: 'center', gap: 5, ...buttonStyle }}
        disabled={busy || !hasData}
      >
        <Download size={13} />
        {busy ? 'Exporting…' : 'Export'}
        <ChevronDown size={11} style={{ opacity: 0.6, marginLeft: 1 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 3000,
          marginTop: 4, background: '#fff',
          border: '1px solid var(--g200)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 190, overflow: 'hidden',
        }}>
          {formats.map((fmt) => {
            const meta = FORMAT_META[fmt];
            if (!meta) return null;
            return (
              <button
                key={fmt}
                onClick={() => onPick(fmt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  width: '100%', padding: '9px 14px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 500, color: 'var(--g700)',
                  textAlign: 'left', transition: 'background .1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--g100)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                {meta.icon}
                {meta.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
