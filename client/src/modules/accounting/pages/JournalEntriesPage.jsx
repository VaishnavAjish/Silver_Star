import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { usePagination } from '../../../shared/hooks/usePagination';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';
import FilterBar from '../../../shared/components/FilterBar';
import Paginator from '../../../shared/components/Paginator';
import { Plus, BookOpen, Eye, Edit3, RotateCcw, Printer, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const JE_PAGE_SIZE = 500;

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'reversed', label: 'Reversed' },
];

export default function JournalEntriesPage() {
  const api = useApi();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [allData, setAllData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [filters, setFilters] = usePersistedFilters('je_filters', {});
  const [colMgr, setColMgr] = useState(null);

  const sourceOptions = useMemo(() => [...new Set(allData.map(d => d.source_type).filter(Boolean))].sort(), [allData]);

  // Build filter fields reactively — sourceOptions updates once allData loads,
  // and useMemo ensures FilterBar gets a new reference so it re-renders the dropdown.
  const filterFields = useMemo(() => [
    { key: 'search',    label: 'Search',    type: 'text' },
    { key: 'source',    label: 'Source',    type: 'select',
      options: [
        { value: '', label: 'All Sources' },
        ...sourceOptions.map(s => ({ value: s, label: s })),
      ],
    },
    { key: 'status',    label: 'Status',    type: 'select', options: STATUS_OPTIONS },
    { key: 'date_from', label: 'From Date', type: 'date' },
    { key: 'date_to',   label: 'To Date',   type: 'date' },
  ], [sourceOptions]);

  const load = useCallback(async (pg, flt) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, pageSize: JE_PAGE_SIZE });
      if (flt.search) params.set('search', flt.search);
      if (flt.source) params.set('source_type', flt.source);
      if (flt.status) params.set('status', flt.status);
      if (flt.date_from) params.set('from_date', flt.date_from);
      if (flt.date_to) params.set('to_date', flt.date_to);
      const res = await api.get(`/api/journal-entries?${params}`);
      setAllData(res.data || []);
      setTotal(res.totalCount ?? res.total ?? 0);
    } catch (err) {
      toast.error('Failed to load journal entries');
    } finally {
      setLoading(false);
    }
  }, [api]);

  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const debounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const delay = filters.search ? 300 : 0;
    debounceRef.current = setTimeout(() => load(page, filters), delay);
    return () => clearTimeout(debounceRef.current);
  }, [page, filters, load]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(page, filters); } finally { setSpinning(false); }
  }, [load, page, filters]);

  const reverseEntry = useCallback(async (row) => {
    const reason = window.prompt(`Reason to reverse ${row.je_number}?`);
    if (!reason) return;
    try {
      await api.post(`/api/journal-entries/${row.id}/reverse`, { reason });
      toast.success('Journal entry reversed');
      load(page, filters);
    } catch (err) { toast.error(err.message); }
  }, [api, load, page, filters]);

  const deleteEntry = useCallback(async (row) => {
    if (!window.confirm(`Are you sure you want to delete ${row.je_number}?`)) return;
    try {
      await api.del(`/api/journal-entries/${row.id}`);
      toast.success('Journal entry deleted');
      load(page, filters);
    } catch (err) { toast.error(err.message); }
  }, [api, load, page, filters]);

  const handlePrint = useCallback(async (row) => {
    try {
      const data = await api.get(`/api/journal-entries/${row.id}`);
      const lines = data.lines || [];
      const totalDebit = lines.reduce((s, l) => s + parseFloat(l.debit || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || 0), 0);

      const fmt = v => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      const date = data.date ? new Date(data.date).toLocaleDateString('en-IN') : '';
      const rowsHtml = lines.map((l, i) => `
        <tr>
          <td style="text-align:center;padding:4px 8px;border:1px solid #ddd">${i + 1}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${l.account_name || ''} (${l.account_code || ''})</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${l.narration || ''}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(l.debit) ? fmt(l.debit) : ''}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${parseFloat(l.credit) ? fmt(l.credit) : ''}</td>
        </tr>
      `).join('');

      const win = window.open('', '_blank');
      win.document.write(`
        <html>
        <head>
          <title>Journal Entry - ${data.je_number}</title>
          <style>
            @page { margin: 10mm 15mm; }
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #222; margin: 0; padding: 20px; }
            h2 { margin: 0 0 4px; font-size: 18px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #333; }
            .meta { display: flex; gap: 24px; margin-bottom: 16px; font-size: 11px; color: #555; }
            .meta span { display: inline-flex; gap: 4px; }
            .meta strong { color: #222; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
            th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; text-align: left; }
            .total-row td { font-weight: 700; border-top: 2px solid #333; padding: 6px 8px; font-size: 12px; }
            .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #ddd; padding-top: 10px; }
            .no-print { display: none; }
            @media print { body { padding: 0; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h2>Journal Voucher</h2>
              <div style="font-size:11px;color:#666">${data.je_number}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700">${data.source_type || 'Manual Entry'}</div>
              <div style="font-size:11px;color:#666">${date}</div>
            </div>
          </div>
          <div class="meta">
            <span><strong>Reference:</strong> ${data.reference_no || '—'}</span>
            <span><strong>Status:</strong> ${data.status}</span>
            ${data.description ? `<span><strong>Description:</strong> ${data.description}</span>` : ''}
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:40px">#</th>
                <th>Account</th>
                <th>Narration</th>
                <th style="width:130px;text-align:right">Debit (₹)</th>
                <th style="width:130px;text-align:right">Credit (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              <tr class="total-row">
                <td colspan="3" style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333">Total</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${fmt(totalDebit)}</td>
                <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;border-top:2px solid #333;font-family:monospace">${fmt(totalCredit)}</td>
              </tr>
            </tbody>
          </table>
          ${data.reversal_je ? `<div style="margin-top:12px;padding:8px 12px;background:#fef3cd;border:1px solid #ffc107;border-radius:4px;font-size:11px"><strong>Reversed by:</strong> ${data.reversal_je.je_number} on ${new Date(data.reversal_je.date).toLocaleDateString('en-IN')}</div>` : ''}
          ${data.original_je ? `<div style="margin-top:12px;padding:8px 12px;background:#f0f0f0;border:1px solid #ccc;border-radius:4px;font-size:11px"><strong>Original Entry:</strong> ${data.original_je.je_number} on ${new Date(data.original_je.date).toLocaleDateString('en-IN')}</div>` : ''}
          <div class="footer">This is a computer-generated voucher. No signature required.</div>
        </body>
        </html>
      `);
      win.document.close();
      win.onload = () => { win.focus(); setTimeout(() => win.print(), 200); };
    } catch (err) {
      toast.error('Failed to load journal entry for printing');
    }
  }, [api]);

  const money = v => `Rs. ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const columns = useMemo(() => [
    { key: 'je_number', label: 'JE Number', width: 100, render: (v) => <span className="cell-link">{v}</span> },
    { key: 'date', label: 'Date', width: 100, render: v => v ? new Date(v).toLocaleDateString('en-IN') : '' },
    { key: 'description', label: 'Description' },
    { key: 'source_type', label: 'Source', width: 90, render: v => v || '-' },
    { key: 'total_debit', label: 'Debit', width: 110, numeric: true, render: money },
    { key: 'total_credit', label: 'Credit', width: 110, numeric: true, render: money },
    { key: 'status', label: 'Status', width: 80, render: v => <span className={`badge b-${v}`}>{v}</span> },
    { key: '_actions', label: 'Action', width: 160,
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button className="icon-btn" title="View" onClick={() => navigate(`/journal-entries/${row.id}`)}><Eye size={13} /></button>
          {canEdit() && <button className="icon-btn" title="Edit" onClick={() => navigate(`/journal-entries/${row.id}?mode=edit`)}><Edit3 size={13} /></button>}
          {canEdit() && row.status === 'draft' && <button className="icon-btn" title="Delete" onClick={() => deleteEntry(row)}><Trash2 size={13} /></button>}
          {canEdit() && row.status === 'posted' && <button className="icon-btn" title="Reverse" onClick={() => reverseEntry(row)}><RotateCcw size={13} /></button>}
          <button className="icon-btn" title="Print" onClick={() => handlePrint(row)}><Printer size={13} /></button>
        </div>
      ),
    },
  ], [canEdit, navigate, reverseEntry, deleteEntry, handlePrint]);

  const fromRow = total === 0 ? 0 : (page - 1) * JE_PAGE_SIZE + 1;
  const toRow = Math.min(page * JE_PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / JE_PAGE_SIZE));

  return (
    <div className="grid-page">

      <FilterBar
        filters={filters}
        onChange={(key, value) => { setPage(1); setFilters(prev => ({ ...prev, [key]: value })); }}
        onReset={() => { setPage(1); setFilters({}); }}
        fields={filterFields}
      >
        <span className="grid-count">
          {total === 0 ? 'No records' : `${fromRow}–${toRow} of ${total.toLocaleString()}`}
        </span>
        {colMgr && (
          <ColumnSettings
            columns={colMgr.columns}
            visibleColumns={colMgr.visibleColumns}
            toggleColumn={colMgr.toggleColumn}
            resetLayout={colMgr.resetLayout}
            mandatoryKeys={['_actions']}
          />
        )}
        <ExportMenu
          title="Journal Entries"
          buttonStyle={{ height: 32.73 }}
          headers={(colMgr?.getExportCols?.() || []).map(c => c.label)}
          fetchRows={async () => {
            const r = await api.get('/api/journal-entries?limit=100000');
            return (r.data || []).map(row => {
              const expCols = colMgr?.getExportCols?.() || [];
              return expCols.map(c => {
                const v = row[c.key];
                if (c.render) {
                  const rendered = c.render(v, row);
                  return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (v ?? '');
                }
                return v ?? '';
              });
            });
          }}
        />
        {canEdit() && (
          <button className="btn btn-sm btn-primary" onClick={() => navigate('/journal-entries/new')} style={{ height: 32.73 }}>
            <Plus size={13} /> New Journal Entry
          </button>
        )}
        <button className="icon-btn" onClick={handleRefresh} disabled={spinning}
          style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
          <RefreshCw size={14} />
        </button>
      </FilterBar>

      <DataGrid
        embedded
        hideSearch
        hideExport
        hideRefresh
        hideRecordCount
        hideColumnSettings
        hideExportLabel
        exportTitle="Journal Entries"
        storageKey="journal_entries_cols"
        mandatoryKeys={['_actions']}
        onColumnManagerReady={setColMgr}
        columns={columns}
        data={allData}
        loading={loading}
        page={page}
        pageSize={JE_PAGE_SIZE}
        totalPages={totalPages}
        totalRecords={total}
        onPageChange={setPage}
        onRefresh={() => load(page, filters)}
        onRowClick={row => navigate(`/journal-entries/${row.id}`)}
      />
    </div>
  );
}
