/**
 * useReportExport — shared hook that drives export for a P0 accounting report.
 *
 * Given a report definition, the LIVE report data and the page's active
 * filters, it exposes a single `exportAs(format)` action for the ExportMenu.
 * It reuses the report-VIEW permission (no new export permission this release),
 * builds the neutral model once, and dispatches to CSV / server-xlsx / print.
 *
 * "Export" always covers every record matching the active filters, because the
 * P0 reports load their full result set into `data` (no pagination) and the
 * model is built from that same in-memory data.
 */

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../../shared/hooks/usePermission';
import { downloadServerExport } from './exportUtils';

const ORIENTATION_STYLE_ID = 'report-print-orientation';

function printWithOrientation(orientation) {
  if (orientation === 'landscape') {
    let styleEl = document.getElementById(ORIENTATION_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = ORIENTATION_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = '@media print { @page { size: landscape; } }';
  }
  const cleanup = () => {
    const el = document.getElementById(ORIENTATION_STYLE_ID);
    if (el) el.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Small delay lets the print-only header/layout settle before the dialog.
  setTimeout(() => window.print(), 50);
}

export function useReportExport(def, data, filters) {
  const { token } = useAuth();
  const { can } = usePermission();
  const [exporting, setExporting] = useState(null);

  const canExport = !!def && can(def.permission.module, 'view', def.permission.submodule);
  const hasData = !!data;

  const exportAs = useCallback(async (format) => {
    if (!def) return;
    if (!data) { toast.error('Generate the report first, then export.'); return; }
    if (exporting) return;
    setExporting(format);
    try {
      if (format === 'print') {
        printWithOrientation(def.orientation);
        return;
      }
      
      // Server-authoritative export request
      const payload = {
        reportId: def.id,
        format,
        filters
      };
      
      await downloadServerExport(payload, token);
      toast.success(`${format.toUpperCase()} downloaded`);
      
    } catch (err) {
      toast.error(err?.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  }, [def, data, filters, token, exporting]);

  return { canExport, hasData, exporting, exportAs, formats: def?.formats || [] };
}


export default useReportExport;
