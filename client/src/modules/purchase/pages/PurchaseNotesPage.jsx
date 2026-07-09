import { useState, useEffect, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import FilterBar from '../../../shared/components/FilterBar';
import { useApi } from '../../../shared/hooks/useApi';
import { usePurchaseSync } from '../../../shared/hooks/useModuleSync';
import { useAuth } from '../../../core/context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import DataGrid from '../../../shared/components/DataGrid';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';
import { useTabs } from '../../../core/tabs';
import DatePicker from '../../../shared/components/DatePicker';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { Plus, Save, Trash2, FileText, ShoppingCart, RefreshCw, LucideEqual } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, SummaryCardsRow, NotesAttachmentsPanel,
} from '../../../core/layout';

const PN_PAGE_SIZE = 500;
const INITIAL_LINE = {
  item_id: '', item_name: '', item_code: '', description: '', batch_no: '', qty: '', unit: 'PCS',
  weight: '', rate: '', amount: '', tax_pct: 0, LucideEqual,
  dim_length: '', dim_depth: '', dim_height: '', dim_unit: 'mm'
};
const PN_FILTERS = [
  { key: 'search', label: 'Search', type: 'text' },
  {
    key: 'status', label: 'Status', type: 'select',
    options: [
      { value: 'OPEN', label: 'Open' },
      { value: 'CLOSED', label: 'Closed' },
      { value: 'CANCELLED', label: 'Cancelled' }
    ]
  },
  {
    key: 'type', label: 'Type', type: 'select',
    options: [
      { value: 'seed', label: 'Seed' },
      { value: 'gas', label: 'Gas' },
      { value: 'consumable', label: 'Consumable' },
      { value: 'rough', label: 'Rough' }
    ]
  },
  { key: 'date_from', label: 'From Date', type: 'date' },
  { key: 'date_to', label: 'To Date', type: 'date' },
];

export function PurchaseNotesPage() {
  const api = useApi();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('purchase_notes_filters', {});
  const [spinning, setSpinning] = useState(false);
  const [colMgr, setColMgr] = useState(null);
  const totalPages = Math.max(1, Math.ceil(total / PN_PAGE_SIZE));
  const debRef = useRef(null);

  const loadPNs = (pg, flt) => {
    setLoading(true);
    const params = new URLSearchParams({ page: pg, pageSize: PN_PAGE_SIZE });
    if (flt.search) params.set('search', flt.search);
    if (flt.status) params.set('status', flt.status);
    if (flt.type) params.set('type', flt.type);
    if (flt.date_from) params.set('date_from', flt.date_from);
    if (flt.date_to) params.set('date_to', flt.date_to);
    api.get(`/api/purchase-notes?${params}`)
      .then(r => { setData(r.data || []); setTotal(r.total || 0); })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  const fetchExportData = async () => {
    const params = new URLSearchParams({ limit: 100000, offset: 0 });
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.type) params.set('type', filters.type);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    const r = await api.get(`/api/purchase-notes?${params}`);
    return r.data || [];
  };

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => loadPNs(page, filters), filters.search ? 300 : 0);
    return () => clearTimeout(debRef.current);
  }, [page, filters]);

  usePurchaseSync(() => {
    loadPNs(page, filters);
  });


  const handleFilterChange = (k, v) => { setPage(1); setFilters(p => ({ ...p, [k]: v })); };
  const handleFilterReset = () => { setPage(1); setFilters({}); };

  const fromRow = total === 0 ? 0 : (page - 1) * PN_PAGE_SIZE + 1;
  const toRow = Math.min(page * PN_PAGE_SIZE, total);

  return (
    <div className="grid-page">

      <FilterBar filters={filters} onChange={handleFilterChange} onReset={handleFilterReset} fields={PN_FILTERS}>
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
          title="Purchase Notes"
          headers={(colMgr?.getExportCols?.() || []).map(c => c.label)}
          fetchRows={async () => {
            const params = new URLSearchParams({ limit: 100000, offset: 0 });
            if (filters.search) params.set('search', filters.search);
            if (filters.status) params.set('status', filters.status);
            if (filters.type) params.set('type', filters.type);
            if (filters.date_from) params.set('date_from', filters.date_from);
            if (filters.date_to) params.set('date_to', filters.date_to);
            const r = await api.get(`/api/purchase-notes?${params}`);
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
        <button className="icon-btn" title="Refresh table" onClick={async () => { setSpinning(true); try { await loadPNs(page, filters); } finally { setSpinning(false); } }}
          style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
          <RefreshCw size={14} />
        </button>
      </FilterBar>
      <DataGrid
        embedded
        hideSearch
        hideExport
        hideRefresh
        hideColumnSettings
        hideRecordCount
        hideExportLabel
        exportTitle="Purchase Notes"
        fetchExportData={fetchExportData}
        columns={[
          { key: 'doc_number', label: 'Doc ID', width: 100, render: v => <span className="cell-link">{v}</span> },
          { key: 'reference_no', label: 'Ref No', width: 120 },
          { key: 'je_number', label: 'JE ID', width: 100 },
          { key: 'doc_date', label: 'Date', width: 100, render: v => v ? new Date(v).toLocaleDateString('en-IN') : '—' },
          { key: 'vendor_name', label: 'Vendor' },
          { key: 'item_type', label: 'Type', width: 90 },
          { key: 'total_qty', label: 'Qty', width: 60, numeric: true },
          { key: 'total_amount', label: 'Amount', width: 110, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'grand_total', label: 'Grand Total', width: 110, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'payment_term', label: 'Terms', width: 80 },
          { key: 'status', label: 'Status', width: 70, render: v => <span className={`badge b-${v}`}>{v}</span> },
        ]}
        data={data}
        loading={loading}
        onRefresh={() => loadPNs(page, filters)}
        onRowClick={r => {
          const detailPath = `/purchase-notes/${r.id}`;
          openTab({
            id: detailPath,
            name: r.doc_number ? `Purchase Note #${r.doc_number}` : `Purchase Note #${r.id}`,
            icon: FileText,
            path: detailPath,
            closable: true,
          });
          navigate(detailPath);
        }}
        storageKey="purchase_notes_cols"
        mandatoryKeys={['_actions']}
        onColumnManagerReady={setColMgr}
      />
      {!loading && total > PN_PAGE_SIZE && (
        <Paginator page={page} totalPages={totalPages} onPage={setPage} />
      )}
    </div>
  );
}

export function PurchaseNoteForm() {
  const api = useApi();
  const navigate = useNavigate();
  const { id } = useParams();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('super_admin', 'admin');
  const isExisting = !!id;
  const isView = isExisting && !isAdmin;

  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [depts, setDepts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [cats, setCats] = useState([]);
  const [saving, setSaving] = useState(false);
  const [viewData, setViewData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(isExisting);

  const [form, setForm] = useState({
    doc_date: new Date().toISOString().split('T')[0],
    vendor_id: '', item_type: 'seed', department_id: '', payment_term: 'Immediate',
    currency: 'INR', reference_no: '', remark: '', cost_center_id: '',
  });
  const [lines, setLines] = useState([{ ...INITIAL_LINE }]);

  useEffect(() => {
    let ignore = false;
    // Clear previous state on ID change — prevents stale data flash
    setViewData(null);
    setForm({
      doc_date: new Date().toISOString().split('T')[0],
      vendor_id: '', vendor_name: '', item_type: 'seed', department_id: '',
      dept_name: '', payment_term: 'Immediate', currency: 'INR',
      reference_no: '', remark: '', cost_center_id: '',
    });
    setLines([{ ...INITIAL_LINE }]);
    api.get('/api/vendors?limit=2000').then(r => { if (!ignore) setVendors(r.data || []) }).catch(() => { });
    api.get('/api/items?limit=500').then(r => { if (!ignore) setItems(r.data || []) }).catch(() => { });
    api.get('/api/departments?limit=200').then(r => { if (!ignore) setDepts(r.data || []) }).catch(() => { });
    api.get('/api/cost-centers').then(r => { if (!ignore) setCostCenters(r.data || []) }).catch(() => { });
    api.get('/api/fixed-asset-categories').then(r => { if (!ignore) setCats(r.data || []) }).catch(() => { });
    if (isExisting) {
      setDetailLoading(true);
      api.get(`/api/purchase-notes/${id}`).then(data => {
        if (ignore) return;
        setViewData(data);
        setForm({
          doc_date: data.doc_date?.split('T')[0] || '',
          vendor_id: data.vendor_id ?? '',
          vendor_name: data.vendor_name ?? '',
          item_type: data.item_type ?? 'seed',
          department_id: data.department_id ?? '',
          dept_name: data.dept_name ?? '',
          payment_term: data.payment_term ?? 'Immediate',
          currency: data.currency ?? 'INR',
          reference_no: data.reference_no ?? '',
          remark: data.remark ?? '',
          cost_center_id: data.cost_center_id ?? '',
          cost_center_name: data.cost_center_name ? (data.cost_center_code ? `${data.cost_center_code} — ${data.cost_center_name}` : data.cost_center_name) : '',
        });
        setVendors(prev => {
          if (data.vendor_id && !prev.find(v => v.id === data.vendor_id)) {
            return [{ id: data.vendor_id, name: data.vendor_name, code: '' }, ...prev];
          }
          return prev;
        });
        // Inject dept into list if not already present
        setDepts(prev => {
          if (data.department_id && data.dept_name && !prev.find(d => d.id === data.department_id)) {
            return [{ id: data.department_id, name: data.dept_name }, ...prev];
          }
          return prev;
        });
        setLines((data.lines || []).map(l => ({
          _synthetic: l._synthetic || false,
          item_id: l.item_id ?? '',
          item_name: l.item_name ?? '',
          item_code: l.item_code ?? '',
          description: l.description ?? '',
          batch_no: l.batch_no ?? '',
          qty: l.qty ?? '',
          unit: l.unit ?? 'PCS',
          weight: l.weight ?? '',
          rate: l.rate ?? '',
          amount: l.amount ?? '',
          tax_pct: l.tax_pct ?? 0,
          dim_length: l.dim_length ?? '',
          dim_depth: l.dim_depth ?? '',
          dim_height: l.dim_height ?? '',
          dim_unit: l.dim_unit ?? 'mm',
          lot_number: l.lot_number ?? '',
        })));
      }).catch((err) => {
        if (!ignore) {
          toast.error(err.message === 'HTTP 404' || err.message?.includes('404') ? 'Purchase Note not found or was deleted.' : 'Failed to load purchase note.');
          navigate('/purchase-notes');
        }
      }).finally(() => { if (!ignore) setDetailLoading(false) });
    }
    return () => { ignore = true; };
  }, [id]);

  const updateLine = (idx, field, value) => setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addLine = () => setLines(prev => [...prev, { ...INITIAL_LINE }]);
  const removeLine = (idx) => { if (lines.length > 1) setLines(prev => prev.filter((_, i) => i !== idx)); };

  const calcTotalAmt = lines.reduce((s, l) => s + (parseFloat(l.amount) || ((parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0))), 0);
  const calcTotalTax = lines.reduce((s, l) => { 
    const a = parseFloat(l.amount) || ((parseFloat(l.qty) || 0) * (parseFloat(l.rate) || 0)); 
    return s + a * ((parseFloat(l.tax_pct) || 0) / 100); 
  }, 0);
  const calcGrandTotal = calcTotalAmt + calcTotalTax;
  const calcTotalWeight = lines.reduce((s, l) => s + (parseFloat(l.weight) || 0), 0);

  const totalAmt = isView ? (parseFloat(viewData?.total_amount) || calcTotalAmt) : calcTotalAmt;
  const totalTax = isView ? (parseFloat(viewData?.tax_amount) || calcTotalTax) : calcTotalTax;
  const grandTotal = isView ? (parseFloat(viewData?.grand_total) || calcGrandTotal) : calcGrandTotal;
  const totalWeight = calcTotalWeight;

  const calcTotalQty = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
  const totalQty = isView ? (parseFloat(viewData?.total_qty) || calcTotalQty) : calcTotalQty;

  const filteredItems = items.filter(i => i.is_capital_asset || !form.item_type || i.category === form.item_type);

  const handleSave = async (action = 'close') => {
    const validLines = lines.filter(l => l.item_id && l.qty && l.rate);
    if (validLines.length === 0) return toast.error('Add at least one line item');
    if (!form.vendor_id) return toast.error('Select a vendor');
    setSaving(true);
    try {
      const r = isExisting
        ? await api.put(`/api/purchase-notes/${id}`, { ...form, lines: validLines })
        : await api.post('/api/purchase-notes', { ...form, lines: validLines });
      const assetMsg = r.capital_assets_count > 0 ? ` ${r.capital_assets_count} fixed asset(s) created.` : ' Inventory updated.';
      toast.success(isExisting ? `Purchase Note updated!${assetMsg} JE reposted.` : `Purchase Note created!${assetMsg} JE posted.`);
      if (action === 'new') {
        setForm({ doc_date: new Date().toISOString().split('T')[0], vendor_id: '', reference_no: '', remark: '' });
        setLines([{ ...INITIAL_LINE }]);
        navigate('/purchase-notes/new');
      } else if (action === 'close') {
        navigate('/purchase-notes');
      } else if (action === 'save' && !isExisting) {
        navigate(`/purchase-notes/${r.id}`);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const docTitle = isExisting ? `Purchase Note: ${viewData?.doc_number || '…'}` : 'New Purchase Note';
  const badge = viewData ? { label: viewData.status, className: `b-${viewData.status}` } : undefined;

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={docTitle}
          icon={<ShoppingCart size={18} />}
          badge={badge}
          breadcrumbs={[
            { label: 'Purchase', href: '/purchase-notes' },
            { label: 'Purchase Notes', href: '/purchase-notes' },
            { label: isView ? (viewData?.doc_number || 'View') : 'New Purchase Note' },
          ]}
          backTo="/purchase-notes"
          backLabel="Purchase Notes"
          auditMeta={viewData?.doc_date ? `Dated: ${new Date(viewData.doc_date).toLocaleDateString('en-IN')}` : undefined}
        />
      }
      footer={!isView && (
        <StickyActionFooter
          left={<button className="btn" onClick={() => navigate('/purchase-notes')}>Cancel</button>}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => handleSave('save')} disabled={saving} style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn" onClick={() => handleSave('new')} disabled={saving} style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
                {saving ? 'Saving…' : 'Save & New'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={saving}>
                <Save size={13} /> {saving ? 'Saving…' : 'Save & Close'}
              </button>
            </div>
          }
        />
      )}
    >
      <div style={{ position: 'relative' }}>
        {detailLoading && (
          <div className="loading-screen" style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(255,255,255,0.8)', borderRadius: 'var(--radius)' }}>
            <div className="spinner" />
            <p>Loading purchase note…</p>
          </div>
        )}
        {/* ── Document Header ── */}
        <FormSectionCard title="Document Details" icon={<FileText size={13} />}>
          <div className="form-row">
            <div className="fg">
              <label>Date *</label>
              <DatePicker value={form.doc_date || ''} onChange={v => setForm(p => ({ ...p, doc_date: v }))} disabled={isView} />
            </div>
            <div className="fg">
              <label>Item Type *</label>
              <SelectDropdown value={form.item_type || ''} onChange={e => setForm(p => ({ ...p, item_type: e.target.value }))} disabled={isView}>
                <option value="seed">Seed</option>
                <option value="gas">Gas</option>
                <option value="consumable">Consumable</option>
              </SelectDropdown>
            </div>
            <div className="fg w">
              <label>Vendor *</label>
              {isView ? (
                <input
                  value={form.vendor_name || vendors.find(v => String(v.id) === String(form.vendor_id))?.name || (form.vendor_id ? `Vendor #${form.vendor_id}` : '— No vendor —')}
                  disabled
                />
              ) : (
                <SelectDropdown value={form.vendor_id || ''} onChange={e => setForm(p => ({ ...p, vendor_id: e.target.value }))}>
                  <option value="">— Select Vendor —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.code ? ` (${v.code})` : ''}</option>)}
                </SelectDropdown>
              )}
            </div>
          </div>
          <div className="form-row">
            <div className="fg">
              <label>Payment Term</label>
              <SelectDropdown value={form.payment_term || ''} onChange={e => setForm(p => ({ ...p, payment_term: e.target.value }))} disabled={isView}>
                <option>Immediate</option><option>7 Days</option><option>15 Days</option>
                <option>30 Days</option><option>60 Days</option>
              </SelectDropdown>
            </div>
            <div className="fg">
              <label>Department</label>
              {isView ? (
                <input
                  value={form.dept_name || depts.find(d => String(d.id) === String(form.department_id))?.name || (form.department_id ? `Dept #${form.department_id}` : '')}
                  disabled
                />
              ) : (
                <SelectDropdown value={form.department_id || ''} onChange={e => setForm(p => ({ ...p, department_id: e.target.value }))}>
                  <option value="">— Select —</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </SelectDropdown>
              )}
            </div>
            <div className="fg">
              <label>Cost Centre</label>
              {isView ? (
                <input
                  value={form.cost_center_name || (() => {
                    const c = costCenters.find(cc => String(cc.id) === String(form.cost_center_id));
                    return c ? (c.code ? `${c.code} — ${c.name}` : c.name) : (form.cost_center_id ? `Cost Centre #${form.cost_center_id}` : '');
                  })()}
                  disabled
                />
              ) : (
                <SelectDropdown value={form.cost_center_id || ''} onChange={e => setForm(p => ({ ...p, cost_center_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {costCenters.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ${c.name}` : c.name}</option>)}
                </SelectDropdown>
              )}
            </div>
            <div className="fg">
              <label>Reference No</label>
              <input value={form.reference_no || ''} onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))} disabled={isView} />
            </div>
          </div>
        </FormSectionCard>

        {/* ── Line Items ── */}
        <FormSectionCard
          title="Line Items"
          icon={<ShoppingCart size={13} />}
          noPad
          actions={!isView && (
            <button className="btn btn-sm" onClick={addLine}><Plus size={11} /> Add Line</button>
          )}
        >
          <table className="je-lines-table">
            <thead>
              <tr style={{ background: 'var(--brand-50)', color: 'var(--brand-dark)' }}>
                <th style={{ width: 30 }}>#</th>
                <th style={{ minWidth: 120 }}>Item</th>
                <th style={{ minWidth: 150 }}>Description</th>
                <th style={{ minWidth: 100 }}>Lot Name</th>
                <th style={{ minWidth: 80 }}>Qty</th>
                <th style={{ minWidth: 70 }}>Unit</th>
                <th style={{ minWidth: 100 }}>Weight (CT)</th>
                <th style={{ minWidth: 80 }}>Avg Wt</th>
                <th style={{ minWidth: 110 }}>Rate (₹)</th>
                <th style={{ minWidth: 120 }}>Amount</th>
                <th style={{ minWidth: 90 }}>Tax %</th>
                <th style={{ minWidth: 235 }}>Dimensions (seed)</th>
                {!isView && <th style={{ width: 37 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && isView && (
                <tr>
                  <td colSpan={13} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--g400)', fontStyle: 'italic', fontSize: 13 }}>
                    No line items recorded for this purchase note.
                  </td>
                </tr>
              )}
              {lines.some(l => l._synthetic) && isView && (
                <tr>
                  <td colSpan={13} style={{ background: '#FFF8E1', padding: '6px 14px', fontSize: 11, color: '#795548', fontStyle: 'italic', borderBottom: '1px solid #FFE082' }}>
                    ⚠ Individual line details are not available (inventory was reset). Showing summary totals from the purchase note header.
                  </td>
                </tr>
              )}
              {lines.map((line, idx) => {
                const amt = parseFloat(line.amount) || (parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0);
                const selItem = items.find(i => String(i.id) === String(line.item_id));
                const isCap = selItem?.is_capital_asset;
                const catName = isCap ? (cats.find(c => c.id === selItem?.fixed_asset_category_id)?.name || 'Capital Asset') : null;
                return (
                  <tr key={idx} style={{ background: line._synthetic ? '#FFFDE7' : isCap ? '#F3E5F5' : undefined }}>
                    <td style={{ textAlign: 'center', color: 'var(--g500)' }}>{idx + 1}</td>
                    <td>
                      {isView ? (
                        <input
                          value={
                            line.item_name ||
                            selItem?.name ||
                            (line.item_id ? `Item #${line.item_id}` : (line.description ? '— (Service / Misc)' : '—'))
                          }
                          disabled
                          style={{ fontWeight: 500 }}
                        />
                      ) : (
                        <>
                          <SelectDropdown value={line.item_id || ''} onChange={e => updateLine(idx, 'item_id', e.target.value)}>
                            <option value="">— Item —</option>
                            {filteredItems.map(i => <option key={i.id} value={i.id}>{i.name}{i.is_capital_asset ? ' ★' : ''} ({i.code})</option>)}
                          </SelectDropdown>
                          {isCap && (
                            <span style={{ display: 'inline-block', marginTop: 2, fontSize: 9, background: '#CE93D8', color: '#4A148C', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                              CAPITAL · {catName}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td><input value={line.description || ''} onChange={e => updateLine(idx, 'description', e.target.value)} disabled={isView} /></td>
                    <td><input value={line.lot_number || line.batch_no || ''} onChange={e => updateLine(idx, 'batch_no', e.target.value)} placeholder="Lot Name" disabled={isView} /></td>
                    <td><input type="number" value={line.qty || ''} onChange={e => updateLine(idx, 'qty', e.target.value)} style={{ textAlign: 'right' }} disabled={isView} /></td>
                    <td>
                      <SelectDropdown value={line.unit || ''} onChange={e => updateLine(idx, 'unit', e.target.value)} disabled={isView}>
                        <option>PCS</option><option>CYL</option><option>KG</option><option>LTR</option>
                      </SelectDropdown>
                    </td>
                    <td>
                      {selItem?.category === 'seed' ? (
                        <input
                          type="number" min="0" step="0.0001"
                          placeholder="0.0000"
                          value={line.weight || ''}
                          onChange={e => updateLine(idx, 'weight', e.target.value)}
                          disabled={isView}
                          style={{ textAlign: 'right', width: 72 }}
                        />
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--g400)', fontStyle: 'italic', display: 'block', textAlign: 'center' }}>—</span>
                      )}
                    </td>
                    <td className="num" style={{ fontSize: 11, color: 'var(--g600)', fontFamily: 'var(--mono)' }}>
                      {(() => {
                        if (selItem?.category !== 'seed') return <span style={{ color: 'var(--g400)', fontStyle: 'italic' }}>—</span>;
                        const w = parseFloat(line.weight);
                        const q = parseFloat(line.qty);
                        if (w > 0 && q > 0) return (w / q).toFixed(4);
                        return <span style={{ color: 'var(--g400)' }}>—</span>;
                      })()}
                    </td>
                    <td><input type="number" value={line.rate || ''} onChange={e => updateLine(idx, 'rate', e.target.value)} style={{ textAlign: 'right' }} disabled={isView} /></td>
                    <td className="num" style={{ fontWeight: 600 }}>₹{amt.toLocaleString('en-IN')}</td>
                    <td><input type="number" value={line.tax_pct || 0} onChange={e => updateLine(idx, 'tax_pct', e.target.value)} style={{ textAlign: 'right', width: 70, padding: '4px 6px' }} disabled={isView} /></td>
                    <td>
                      {selItem?.category === 'seed' ? (
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                          <input type="number" placeholder="L" value={line.dim_length || ''} min="0"
                            onChange={e => updateLine(idx, 'dim_length', e.target.value)}
                            disabled={isView}
                            style={{ width: 55, textAlign: 'right', padding: '4px 6px', fontSize: 12 }} />
                          <span style={{ fontSize: 10, color: 'var(--g400)' }}>×</span>
                          <input type="number" placeholder="D" value={line.dim_depth || ''} min="0"
                            onChange={e => updateLine(idx, 'dim_depth', e.target.value)}
                            disabled={isView}
                            style={{ width: 55, textAlign: 'right', padding: '4px 6px', fontSize: 12 }} />
                          <span style={{ fontSize: 10, color: 'var(--g400)' }}>×</span>
                          <input type="number" placeholder="H" value={line.dim_height || ''} min="0"
                            onChange={e => updateLine(idx, 'dim_height', e.target.value)}
                            disabled={isView}
                            style={{ width: 55, textAlign: 'right', padding: '4px 6px', fontSize: 12 }} />
                          <SelectDropdown value={line.dim_unit || 'mm'}
                            onChange={e => updateLine(idx, 'dim_unit', e.target.value)}
                            disabled={isView}
                            style={{ fontSize: 10, padding: '2px 3px' }}>
                            <option>mm</option><option>cm</option><option>in</option>
                          </SelectDropdown>
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--g400)', fontStyle: 'italic' }}>—</span>
                      )}
                    </td>
                    {!isView && (
                      <td>
                        {lines.length > 1 && (
                          <button className="icon-btn" onClick={() => removeLine(idx)} style={{ color: 'var(--red)' }}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals summary row */}
          <div style={{
            display: 'flex', gap: 0, padding: '10px 14px',
            background: 'var(--brand-50)', borderTop: '2px solid var(--brand)',
          }}>
            {[
              { label: 'Total Qty', value: totalQty.toLocaleString('en-IN') }
            ].map((t, i) => (
              <div key={`qty-${i}`} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-dark)', letterSpacing: '0.04em' }}>{t.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand-dark)', marginTop: 2 }}>{t.value}</div>
              </div>
            ))}
            {form.item_type === 'seed' && (
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-dark)', letterSpacing: '0.04em' }}>Total Weight</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--brand-dark)', marginTop: 2 }}>
                  {totalWeight > 0 ? `${totalWeight.toFixed(4)} CT` : '—'}
                </div>
              </div>
            )}
            {[
              { label: 'Amount', value: `₹${totalAmt.toLocaleString('en-IN')}` },
              { label: 'Tax', value: `₹${Math.round(totalTax).toLocaleString('en-IN')}` },
              { label: 'Grand Total', value: `₹${Math.round(grandTotal).toLocaleString('en-IN')}`, bold: true },
            ].map((t, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-dark)', letterSpacing: '0.04em' }}>{t.label}</div>
                <div style={{ fontSize: t.bold ? 18 : 16, fontWeight: 700, fontFamily: 'var(--mono)', color: t.bold ? 'var(--green)' : 'var(--brand-dark)', marginTop: 2 }}>{t.value}</div>
              </div>
            ))}
          </div>
        </FormSectionCard>

        {/* ── Notes / JE confirmation ── */}
        <NotesAttachmentsPanel
          value={form.remark}
          onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
          readOnly={isView}
        />

        {isView && viewData?.je_id && (
          <div style={{ padding: '10px 14px', background: '#E8F5E9', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--green)', border: '1px solid #A5D6A7' }}>
            <strong>JE Posted:</strong> Journal Entry linked to this purchase. Inventory created and accounts updated.
          </div>
        )}
      </div>
    </TransactionPageLayout>
  );
}
