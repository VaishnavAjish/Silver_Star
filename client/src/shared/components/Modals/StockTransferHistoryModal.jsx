import { useState, useEffect, useMemo, useCallback } from 'react';
import Modal from '../Modal';
import Paginator from '../Paginator';
import { useApi } from '../../hooks/useApi';
import { exportToCSV, printTable } from '../../utils/exportUtils';
import {
  Search, X, Download, Printer, RefreshCw, Package, Send,
} from 'lucide-react';

const PAGE_SIZE = 100;

const COLUMNS = [
  { key: 'transfer_id', label: 'Transfer ID', width: 150, sortable: true },
  { key: 'created_at', label: 'Date', width: 100, sortable: true, render: (v, row) => row._date || '—' },
  { key: 'material_code', label: 'Material Code', width: 120 },
  { key: 'material_name', label: 'Material Name', sortable: true },
  { key: 'category', label: 'Category', width: 80, sortable: true, render: v => v ? <span className="badge b-stock" style={{ fontSize: 9 }}>{v}</span> : '—' },
  { key: 'qty', label: 'Qty', width: 80, num: true, sortable: true, render: v => <span className="num">{Number(v || 0).toFixed(4)}</span> },
  { key: 'unit', label: 'Unit', width: 60 },
  { key: 'source_warehouse', label: 'Source', width: 120, sortable: true },
  { key: 'destination_warehouse', label: 'Destination', width: 120, sortable: true },
  { key: 'requested_by', label: 'Requested By', width: 120 },
  { key: 'remarks', label: 'Remarks', width: 200 },
];

export default function StockTransferHistoryModal({ open, onClose }) {
  const api = useApi();

  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('created_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const fetchData = useCallback(async (p, s) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(p || 1));
      params.set('pageSize', String(PAGE_SIZE));
      if (s) params.set('search', s);
      const res = await api.get(`/api/stock-transfer/history?${params}`);
      const raw = (res.data || []).map(r => ({
        ...r,
        _date: r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—',
      }));
      setData(raw);
      setTotal(res.total || 0);
    } catch {}
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => {
    if (open) {
      setPage(1);
      setSearch('');
      fetchData(1, '');
    }
  }, [open, fetchData]);

  const handleSearch = s => {
    setSearch(s);
    setPage(1);
    fetchData(1, s);
  };

  const sortedData = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      let va = a[sortCol];
      let vb = b[sortCol];
      if (sortCol === 'qty') { va = parseFloat(va || 0); vb = parseFloat(vb || 0); }
      else if (sortCol === 'created_at') { va = a.created_at || ''; vb = b.created_at || ''; }
      else { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [data, sortCol, sortAsc]);

  const handleSort = key => {
    setSortCol(key);
    setSortAsc(prev => sortCol === key ? !prev : true);
  };

  const handleRefresh = async () => {
    setSpinning(true);
    try { await fetchData(page, search); } finally { setSpinning(false); }
  };

  const handleExport = async format => {
    setExporting(true);
    try {
      const headers = COLUMNS.map(c => c.label);
      const rows = data.map(row => COLUMNS.map(col => {
        if (col.key === 'created_at') return row._date || '';
        if (col.key === 'qty') return String(Number(row.qty || 0).toFixed(4));
        return row[col.key] != null ? String(row[col.key]) : '';
      }));
      const subtitle = `${total} records · ${new Date().toLocaleString('en-IN')}`;
      if (format === 'csv') {
        exportToCSV(`stock-transfer-history-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
      } else {
        printTable('Stock Transfer History', subtitle, headers, rows);
      }
    } catch {}
    finally { setExporting(false); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock Transfer History"
      icon={<Send size={16} />}
      large
      style={{ maxWidth: '92vw', width: '1100px' }}
    >
      <div style={{ minHeight: '65vh', display: 'flex', flexDirection: 'column' }}>
        <div className="grid-toolbar" style={{ padding: '0 0 10px 0', borderBottom: '1px solid var(--g200)', marginBottom: 0 }}>
          <div className="filter-field" style={{ width: 220 }}>
            <label className="filter-label">Search</label>
            <div className="grid-toolbar-search">
              <Search size={14} />
              <input
                placeholder="Search transfers, materials, items…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
              {search && (
                <button className="icon-btn" style={{ flexShrink: 0 }} onClick={() => handleSearch('')}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="grid-count">{total} transfer{total !== 1 ? 's' : ''}</span>
          <div className="grid-toolbar-right">
            <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('csv')} title="Export CSV">
              <Download size={13} /> CSV
            </button>
            <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('print')} title="Print / PDF">
              <Printer size={13} /> Print
            </button>
            <button className="icon-btn" title="Refresh" onClick={handleRefresh} disabled={spinning}
              style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="grid-wrap" style={{ flex: 1, border: 'none' }}>
          {loading ? (
            <div className="empty-state" style={{ padding: 60 }}>
              <div className="spinner" />
            </div>
          ) : sortedData.length === 0 ? (
            <div className="empty-state" style={{ padding: 60 }}>
              <Package size={32} />
              <p>{search ? 'No transfers match your search.' : 'No stock transfers found.'}</p>
            </div>
          ) : (
            <table className="dgrid">
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{
                        width: col.width,
                        cursor: col.sortable ? 'pointer' : undefined,
                        userSelect: 'none',
                      }}
                      className={col.num ? 'num' : ''}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      {col.label}
                      {col.sortable && sortCol === col.key && (
                        <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.6 }}>
                          {sortAsc ? '▲' : '▼'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, i) => (
                  <tr key={row.id || i}>
                    {COLUMNS.map(col => (
                      <td key={col.key} style={{ textAlign: col.num ? 'right' : undefined }}>
                        {col.render ? col.render(row[col.key], row) : (row[col.key] != null ? String(row[col.key]) : '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="grid-footer" style={{ padding: '8px 0 0 0', borderTop: '1px solid var(--g200)', marginTop: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ fontSize: 11, color: 'var(--g500)' }}>
              Showing {data.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} transfers
            </span>
            <Paginator page={page} totalPages={totalPages} onPage={p => { setPage(p); fetchData(p, search); }} />
          </div>
        </div>
      </div>
    </Modal>
  );
}