import { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown } from 'lucide-react';
import { exportToCSV, exportToWord, printTable } from '../utils/exportUtils';

/**
 * ExportMenu — three-option export dropdown (PDF · Excel · Word).
 *
 * Props:
 *   title      {string}   used as filename base and document heading
 *   headers    {string[]} column labels
 *   fetchRows  {fn}       async function returning 2-D array of cell values
 */
export default function ExportMenu({ title = 'Export', headers = [], fetchRows, buttonStyle }) {
  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const safe = title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'export';

  const handleExport = async (actionFn, ...args) => {
    try {
      setIsExporting(true);
      const dataRows = typeof fetchRows === 'function' ? await fetchRows() : [];
      actionFn(...args, dataRows);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setOpen(false);
    }
  };

  const actions = [
    {
      label: 'Export PDF',
      icon: <FileText size={13} />,
      onClick: () => handleExport(printTable, title, `${new Date().toLocaleDateString('en-IN')}`, headers),
    },
    {
      label: 'Export Excel',
      icon: <FileSpreadsheet size={13} />,
      onClick: () => handleExport(exportToCSV, `${safe}.csv`, headers),
    },
    {
      label: 'Export Word',
      icon: <FileText size={13} style={{ color: '#1565C0' }} />,
      onClick: () => handleExport(exportToWord, safe, title, headers),
    },
  ];

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn"
        onClick={() => setOpen(o => !o)}
        title="Export"
        style={{ display: 'flex', alignItems: 'center', gap: 5, ...buttonStyle }}
        disabled={isExporting}
      >
        <Download size={13} />
        {isExporting ? 'Exporting...' : 'Export'}
        <ChevronDown size={11} style={{ opacity: 0.6, marginLeft: 1 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 3000,
          marginTop: 4, background: '#fff',
          border: '1px solid var(--g200)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 160, overflow: 'hidden',
        }}>
          {actions.map(a => (
            <button
              key={a.label}
              onClick={a.onClick}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                width: '100%', padding: '9px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 500, color: 'var(--g700)',
                textAlign: 'left', transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
