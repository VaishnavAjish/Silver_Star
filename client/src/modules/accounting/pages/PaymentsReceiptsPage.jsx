import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import DataGrid from '../../../shared/components/DataGrid';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';
import FilterBar from '../../../shared/components/FilterBar';
import { Plus, CreditCard, HandCoins, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const MODE_OPTIONS = [
  { value: '', label: 'All Modes' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'Cash', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Debit Card', label: 'Debit Card' },
  { value: 'Other', label: 'Other' },
];

const PAGE_SIZE = 500;

function money(v) {
  return `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}
function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString('en-IN') : '';
}

function buildQuery(filters, page) {
  const params = new URLSearchParams({ page: page || 1, pageSize: PAGE_SIZE });
  if (filters.search)    params.set('search', filters.search);
  if (filters.status)    params.set('status', filters.status);
  if (filters.mode)      params.set('mode', filters.mode);
  if (filters.date_from) params.set('from_date', filters.date_from);
  if (filters.date_to)   params.set('to_date', filters.date_to);
  return params.toString();
}

// ===== PAYMENTS PAGE =====
export function PaymentsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('payments_filters', {});
  const [colMgr, setColMgr] = useState(null);
  const debounceRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterFields = useMemo(() => [
    { key: 'search',    label: 'Search',    type: 'text' },
    { key: 'status',    label: 'Status',    type: 'select', options: STATUS_OPTIONS },
    { key: 'mode',      label: 'Mode',      type: 'select', options: MODE_OPTIONS },
    { key: 'date_from', label: 'From Date', type: 'date' },
    { key: 'date_to',   label: 'To Date',   type: 'date' },
  ], []);

  const load = useCallback((flt, pg) => {
    setLoading(true);
    return api.get(`/api/payments?${buildQuery(flt, pg)}`)
      .then(r => { setData(r.data || []); setTotal(r.totalCount ?? r.total ?? 0); })
      .catch(() => toast.error('Failed to load payments'))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(filters, page), filters.search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [filters, page, load]);

  const handleFilterChange = (key, value) => { setPage(1); setFilters(p => ({ ...p, [key]: value })); };
  const handleFilterReset  = () => { setPage(1); setFilters({}); };

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    load(filters, page).finally(() => setSpinning(false));
  }, [load, filters, page]);

  const fetchExportData = async () => {
    const params = new URLSearchParams({ limit: 100000 });
    if (filters.search)    params.set('search', filters.search);
    if (filters.status)    params.set('status', filters.status);
    if (filters.mode)      params.set('mode', filters.mode);
    if (filters.date_from) params.set('from_date', filters.date_from);
    if (filters.date_to)   params.set('to_date', filters.date_to);
    const r = await api.get(`/api/payments?${params}`);
    return r.data || [];
  };

  const handleFetchExportRows = async () => {
    const rows = await fetchExportData();
    const expCols = colMgr?.getExportCols?.() || [];
    return rows.map(row =>
      expCols.map(c => {
        const v = row[c.key];
        if (c.render) {
          const rendered = c.render(v, row);
          return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (v ?? '');
        }
        return v ?? '';
      })
    );
  };

  const columns = useMemo(() => [
    { key: 'doc_number',  label: 'Pay ID',   width: 90,  render: v => <span className="cell-link">{v}</span> },
    { key: 'date',        label: 'Date',     width: 90,  render: fmtDate },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'amount',      label: 'Amount (₹)', width: 120, numeric: true, render: money },
    { key: 'payment_mode', label: 'Mode',    width: 100 },
    { key: 'bank_name',   label: 'Account',  width: 120 },
    { key: 'reference_no', label: 'Reference', width: 110 },
    { key: 'status',      label: 'Status',   width: 90,  render: v => <span className={`badge b-${(v || '').toLowerCase()}`}>{v}</span> },
  ], []);

  return (
    <div className="grid-page">

      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
        fields={filterFields}
      >
        <span className="grid-count">{(total || data?.length || 0).toLocaleString()} records</span>
        {colMgr && (
          <ColumnSettings
            columns={colMgr.columns}
            visibleColumns={colMgr.visibleColumns}
            toggleColumn={colMgr.toggleColumn}
            resetLayout={colMgr.resetLayout}
          />
        )}
        <ExportMenu
          title="Payments"
          buttonStyle={{ height: 32.73 }}
          headers={(colMgr?.getExportCols?.() || []).map(c => c.label)}
          fetchRows={handleFetchExportRows}
        />
        {canEdit('payments', 'create') && (
          <button className="btn btn-sm btn-primary" onClick={() => navigate('/payments/new')} style={{ height: 32.73 }}>
            <Plus size={13} /> New Payment
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
        exportTitle="Payments"
        fetchExportData={fetchExportData}
        storageKey="payments_cols"
        onColumnManagerReady={setColMgr}
        columns={columns}
        data={data}
        totalRecords={total}
        loading={loading}
        page={page}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        onRefresh={() => load(filters, page)}
      />
    </div>
  );
}

// ===== RECEIPTS PAGE =====
export function ReceiptsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('receipts_filters', {});
  const [colMgr, setColMgr] = useState(null);
  const debounceRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterFields = useMemo(() => [
    { key: 'search',    label: 'Search',    type: 'text' },
    { key: 'status',    label: 'Status',    type: 'select', options: STATUS_OPTIONS },
    { key: 'mode',      label: 'Mode',      type: 'select', options: MODE_OPTIONS },
    { key: 'date_from', label: 'From Date', type: 'date' },
    { key: 'date_to',   label: 'To Date',   type: 'date' },
  ], []);

  const load = useCallback((flt, pg) => {
    setLoading(true);
    return api.get(`/api/receipts?${buildQuery(flt, pg)}`)
      .then(r => { setData(r.data || []); setTotal(r.totalCount ?? r.total ?? 0); })
      .catch(() => toast.error('Failed to load receipts'))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(filters, page), filters.search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [filters, page, load]);

  const handleFilterChange = (key, value) => { setPage(1); setFilters(p => ({ ...p, [key]: value })); };
  const handleFilterReset  = () => { setPage(1); setFilters({}); };

  const handleRefresh = useCallback(() => {
    setSpinning(true);
    load(filters, page).finally(() => setSpinning(false));
  }, [load, filters, page]);

  const fetchExportData = async () => {
    const params = new URLSearchParams({ limit: 100000 });
    if (filters.search)    params.set('search', filters.search);
    if (filters.status)    params.set('status', filters.status);
    if (filters.mode)      params.set('mode', filters.mode);
    if (filters.date_from) params.set('from_date', filters.date_from);
    if (filters.date_to)   params.set('to_date', filters.date_to);
    const r = await api.get(`/api/receipts?${params}`);
    return r.data || [];
  };

  const handleFetchExportRows = async () => {
    const rows = await fetchExportData();
    const expCols = colMgr?.getExportCols?.() || [];
    return rows.map(row =>
      expCols.map(c => {
        const v = row[c.key];
        if (c.render) {
          const rendered = c.render(v, row);
          return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (v ?? '');
        }
        return v ?? '';
      })
    );
  };

  const columns = useMemo(() => [
    { key: 'doc_number',    label: 'Rct ID',    width: 90,  render: v => <span className="cell-link">{v}</span> },
    { key: 'date',          label: 'Date',       width: 90,  render: fmtDate },
    { key: 'customer_name', label: 'Customer' },
    { key: 'amount',        label: 'Amount (₹)', width: 120, numeric: true, render: money },
    { key: 'payment_mode',  label: 'Mode',       width: 100 },
    { key: 'bank_name',     label: 'Account',    width: 120 },
    { key: 'invoice_number', label: 'Invoice',   width: 90 },
    { key: 'status',        label: 'Status',     width: 90,  render: v => <span className={`badge b-${(v || '').toLowerCase()}`}>{v}</span> },
  ], []);

  return (
    <div className="grid-page">

      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
        fields={filterFields}
      >
        <span className="grid-count">{(total || data?.length || 0).toLocaleString()} records</span>
        {colMgr && (
          <ColumnSettings
            columns={colMgr.columns}
            visibleColumns={colMgr.visibleColumns}
            toggleColumn={colMgr.toggleColumn}
            resetLayout={colMgr.resetLayout}
          />
        )}
        <ExportMenu
          title="Receipts"
          buttonStyle={{ height: 32.73 }}
          headers={(colMgr?.getExportCols?.() || []).map(c => c.label)}
          fetchRows={handleFetchExportRows}
        />
        {canEdit('payments', 'create') && (
          <button className="btn btn-sm btn-primary" onClick={() => navigate('/receipts/new')} style={{ height: 32.73 }}>
            <Plus size={13} /> New Receipt
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
        exportTitle="Receipts"
        fetchExportData={fetchExportData}
        storageKey="receipts_cols"
        onColumnManagerReady={setColMgr}
        columns={columns}
        data={data}
        totalRecords={total}
        loading={loading}
        page={page}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        onRefresh={() => load(filters, page)}
      />
    </div>
  );
}
