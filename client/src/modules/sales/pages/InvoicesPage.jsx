import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { useTabs } from '../../../core/tabs';
import DataGrid from '../../../shared/components/DataGrid';
import FilterBar from '../../../shared/components/FilterBar';
import DatePicker from '../../../shared/components/DatePicker';
import { Plus, Save, Trash2, FileText, Receipt, RefreshCw } from 'lucide-react';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';
import toast from 'react-hot-toast';
import CostCenterSelect from '../../../features/cost-center/CostCenterSelect';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard, NotesAttachmentsPanel,
} from '../../../core/layout';

// ── Blank line template ─────────────────────────────────────────────────────
const blankLine = () => ({
  inventory_id: null,
  lot_number: '',
  lot_name: '',
  qty: 1,
  weight: '',
  color: 'D-E',
  clarity: 'VS Est.',
  rate_per_carat: '',
  cost_value: '',
});

const INVOICE_FILTERS = [
  { key: 'search',        label: 'Search',  type: 'text' },
  { key: 'payment_status', label: 'Payment', type: 'select',
    options: [
      { value: 'UNPAID',   label: 'Unpaid' },
      { value: 'PARTIAL',  label: 'Partial' },
      { value: 'PAID',     label: 'Paid' },
    ] },
  { key: 'status',        label: 'Status',  type: 'select',
    options: [
      { value: 'open',     label: 'Open' },
      { value: 'closed',   label: 'Closed' },
      { value: 'cancelled', label: 'Cancelled' },
    ] },
  { key: 'from_date',     label: 'From Date', type: 'date' },
  { key: 'to_date',       label: 'To Date',   type: 'date' },
];

// ── Invoices list page ──────────────────────────────────────────────────────
export function InvoicesPage() {
  const api = useApi();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = usePersistedFilters('invoices_filters', {});
  const [colMgr, setColMgr] = useState(null);
  const debounceRef = useRef(null);
  const totalPages = Math.max(1, Math.ceil(total / 500));

  const buildQuery = useCallback((flt, pg) => {
    const params = new URLSearchParams({ page: pg || 1, pageSize: 500 });
    if (flt.search)         params.set('search', flt.search);
    if (flt.payment_status) params.set('payment_status', flt.payment_status);
    if (flt.status)         params.set('status', flt.status);
    if (flt.from_date)      params.set('from_date', flt.from_date);
    if (flt.to_date)        params.set('to_date', flt.to_date);
    return params.toString();
  }, []);

  const [spinning, setSpinning] = useState(false);

  const load = useCallback((flt, pg) => {
    setLoading(true);
    return api.get(`/api/invoices?${buildQuery(flt, pg)}`)
      .then(r => { setData(r.data || []); setTotal(r.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [buildQuery]);

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
    const r = await api.get(`/api/invoices?${buildQuery(filters)}`);
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

  return (
    <div className="grid-page">
      
      <FilterBar filters={filters} onChange={handleFilterChange} onReset={handleFilterReset} fields={INVOICE_FILTERS}>
        <span className="grid-count" style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--g500)' }}>{(total || data?.length || 0).toLocaleString()} records</span>
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
          title="Invoices"
          headers={(colMgr?.getExportCols?.() || []).map(c => c.label)}
          fetchRows={handleFetchExportRows}
        />
        <button className="icon-btn" title="Refresh table" onClick={handleRefresh} disabled={spinning}
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
        hideExportLabel
        hideRecordCount
        exportTitle="Invoices"
        fetchExportData={fetchExportData}
        storageKey="invoices_cols"
        mandatoryKeys={['_actions']}
        onColumnManagerReady={setColMgr}
        columns={[
          { key: 'doc_number',     label: 'Invoice',     width: 80,  sticky: true, render: v => <span className="cell-link">{v}</span> },
          { key: 'doc_date',       label: 'Date',        width: 90,  render: v => v ? new Date(v).toLocaleDateString('en-IN') : '' },
          { key: 'customer_name',  label: 'Customer' },
          { key: 'total_qty',      label: 'Qty',         width: 50,  numeric: true },
          { key: 'total_weight',   label: 'Weight',      width: 70,  numeric: true, render: v => `${v || 0} ct` },
          { key: 'sub_total',      label: 'Amount',      width: 100, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'tax_amount',     label: 'Tax',         width: 80,  numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'grand_total',    label: 'Grand Total', width: 110, numeric: true, render: v => `₹${Number(v || 0).toLocaleString('en-IN')}` },
          { key: 'payment_status', label: 'Payment',     width: 80,  render: v => <span className={`badge ${v === 'PAID' ? 'b-stock' : v === 'PARTIAL' ? 'b-draft' : 'b-cancelled'}`}>{v}</span> },
          { key: 'status',         label: 'Status',      width: 70,  render: v => <span className={`badge b-${v}`}>{v}</span> },
        ]}
        data={data}
        totalRecords={total}
        loading={loading}
        page={page}
        pageSize={500}
        totalPages={totalPages}
        onPageChange={setPage}
        onRefresh={() => load(filters, page)}
        onRowClick={r => navigate(`/invoices/${r.id}`)}
      />
    </div>
  );
}

// ── Invoice create / view form ──────────────────────────────────────────────
export function InvoiceForm() {
  const api      = useApi();
  const navigate = useNavigate();
  const { id }   = useParams();
  const { closeTab, activeTabId } = useTabs();
  const isView   = !!id;

  const [customers,   setCustomers]   = useState([]);
  const [roughStock,  setRoughStock]  = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [viewData,    setViewData]    = useState(null);

  const [form, setForm] = useState({
    doc_date:     new Date().toISOString().split('T')[0],
    customer_id:  '',
    payment_term: '30 Days',
    currency:     'INR',
    reference_no: '',
    remark:       '',
    tax_pct:      5,
    cost_center_id: '',
  });
  const [lines, setLines] = useState([blankLine()]);

  useEffect(() => {
    api.get('/api/customers?limit=300').then(r => setCustomers(r.data || [])).catch(() => {});
    api.get('/api/inventory?category=rough&status=IN STOCK&limit=500').then(r => setRoughStock(r.data || [])).catch(() => {});
    api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {});
    if (isView) {
      api.get(`/api/invoices/${id}`).then(data => {
        setViewData(data);
        setForm({
          doc_date:       data.doc_date?.split('T')[0],
          customer_id:    data.customer_id,
          payment_term:   data.payment_term,
          currency:       data.currency,
          reference_no:   data.reference_no,
          remark:         data.remark,
          tax_pct:        data.tax_pct,
          cost_center_id: data.cost_center_id,
        });
        setLines(data.lines?.length ? data.lines : [blankLine()]);
      }).catch(() => toast.error('Failed to load invoice'));
    }
  }, [id]);

  // ── Line item helpers ───────────────────────────────────────────────────
  const addBlankLine = () => setLines(prev => [...prev, blankLine()]);

  const addFromStock = (inv) => {
    if (lines.find(l => l.inventory_id === inv.id)) {
      return toast.error('Lot already added');
    }
    setLines(prev => [...prev, {
      inventory_id:   inv.id,
      lot_number:     inv.lot_number || inv.lot_code || '',
      lot_name:       inv.lot_name || inv.item_name || '',
      qty:            1,
      weight:         parseFloat(inv.weight) || 0,
      color:          inv.remarks?.match(/[D-M]-[D-M]|Fancy/)?.[0] || 'D-E',
      clarity:        inv.remarks?.match(/V?V?S\d?\s?Est\.|SI\s?Est\.|I\s?Est\./)?.[0] || 'VS Est.',
      rate_per_carat: '',
      cost_value:     parseFloat(inv.total_value) || 0,
    }]);
  };

  const removeLine  = idx => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine  = (idx, field, value) =>
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  // ── Totals ──────────────────────────────────────────────────────────────
  const subTotal    = lines.reduce((s, l) => s + (parseFloat(l.weight) || 0) * (parseFloat(l.rate_per_carat) || 0), 0);
  const taxAmount   = Math.round(subTotal * ((parseFloat(form.tax_pct) || 0) / 100) * 100) / 100;
  const grandTotal  = subTotal + taxAmount;
  const totalCogs   = lines.reduce((s, l) => s + (parseFloat(l.cost_value) || 0), 0);
  const grossProfit = subTotal - totalCogs;

  // ── Save ────────────────────────────────────────────────────────────────
  const handleSave = async (action = 'close') => {
    if (!form.customer_id) return toast.error('Select a customer');
    const validLines = lines.filter(l => parseFloat(l.weight) > 0 && parseFloat(l.rate_per_carat) > 0);
    if (validLines.length === 0) {
      return toast.error('At least one line needs Weight and Rate/ct filled in');
    }
    setSaving(true);
    try {
      await api.post('/api/invoices', { ...form, lines: validLines });
      toast.success('Invoice created! Revenue + COGS journal entries posted.');
      if (action === 'new') window.location.href = window.location.pathname.replace(/\/[^/]+(\/edit)?$/, '/new');
      else navigate('/invoices');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const availableRough = roughStock.filter(r => !lines.find(l => l.inventory_id === r.id));

  const docTitle = isView ? `Invoice: ${viewData?.doc_number || '…'}` : 'New Rough Invoice';
  const badge    = viewData ? { label: viewData.status, className: `b-${viewData.status}` } : undefined;
  const payBadge =
    viewData?.payment_status === 'PAID'    ? { label: 'PAID',    className: 'b-stock'     } :
    viewData?.payment_status === 'PARTIAL' ? { label: 'PARTIAL', className: 'b-draft'     } :
    viewData                               ? { label: viewData.payment_status || 'UNPAID', className: 'b-cancelled' }
                                           : undefined;

  // Inline input style used in the editable table cells
  const cellInput = (extra = {}) => ({
    width: '100%', border: '1px solid var(--g300)', borderRadius: 4,
    padding: '3px 6px', fontSize: 12, outline: 'none',
    background: '#fff', fontFamily: 'inherit', ...extra,
  });

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title={docTitle}
          subtitle={isView && viewData?.customer_name ? `Customer: ${viewData.customer_name}` : undefined}
          icon={<Receipt size={18} />}
          badge={badge}
          breadcrumbs={[
            { label: 'Sales',    href: '/invoices' },
            { label: 'Invoices', href: '/invoices' },
            { label: isView ? (viewData?.doc_number || 'View') : 'New Invoice' },
          ]}
          backTo="/invoices"
          backLabel="Invoices"
          actions={payBadge && <span className={`badge ${payBadge.className}`}>{payBadge.label}</span>}
          auditMeta={viewData?.doc_date ? `Dated: ${new Date(viewData.doc_date).toLocaleDateString('en-IN')}` : undefined}
        />
      }
      footer={!isView && (
        <StickyActionFooter
          left={<button className="btn" onClick={() => { if (activeTabId) closeTab(activeTabId); navigate('/invoices'); }}>Cancel</button>}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => handleSave('new')} disabled={saving} style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)' }}>
                {saving ? 'Creating…' : 'Save & New'}
              </button>
              <button className="btn btn-primary" onClick={() => handleSave('close')} disabled={saving}>
                <Save size={13} /> {saving ? 'Creating…' : 'Save & Post Revenue + COGS'}
              </button>
            </div>
          }
        />
      )}
    >
      {/* ── Invoice Details ── */}
      <FormSectionCard title="Invoice Details" icon={<FileText size={13} />}>
        <div className="form-row">
          <div className="fg">
            <label>Date *</label>
            <DatePicker value={form.doc_date} onChange={v => setForm(p => ({ ...p, doc_date: v }))} disabled={isView} />
          </div>
          <div className="fg w">
            <label>Customer *</label>
            <SelectDropdown value={form.customer_id}
              onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))}
              disabled={isView}>
              <option value="">— Select Customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </SelectDropdown>
          </div>
          <div className="fg">
            <label>Payment Term</label>
            <SelectDropdown value={form.payment_term}
              onChange={e => setForm(p => ({ ...p, payment_term: e.target.value }))}
              disabled={isView}>
              <option>Immediate</option><option>15 Days</option><option>30 Days</option>
              <option>45 Days</option><option>60 Days</option>
            </SelectDropdown>
          </div>
        </div>
        <div className="form-row">
          <div className="fg">
            <label>Tax %</label>
            <input type="number" value={form.tax_pct}
              onChange={e => setForm(p => ({ ...p, tax_pct: e.target.value }))}
              disabled={isView} />
          </div>
          <div className="fg">
            <label>Reference No</label>
            <input value={form.reference_no}
              onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))}
              disabled={isView} />
          </div>
          <div className="fg">
            <label>Cost Center</label>
            <CostCenterSelect
              value={form.cost_center_id}
              onChange={v => setForm(p => ({ ...p, cost_center_id: v }))}
              costCenters={costCenters}
              onRefresh={() => api.get('/api/cost-centers').then(r => setCostCenters(r.data || [])).catch(() => {})}
              disabled={isView}
            />
          </div>
        </div>
      </FormSectionCard>

      {/* ── Quick-add from stock (create mode) ── */}
      {!isView && availableRough.length > 0 && (
        <FormSectionCard title="Available Rough Diamonds — Click to Add" icon={<Plus size={13} />} collapsible>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {availableRough.map(r => (
              <button key={r.id} className="btn btn-sm" onClick={() => addFromStock(r)}
                style={{ borderColor: 'var(--sidebar-border)' }}>
                <Plus size={10} /> {r.lot_number || r.lot_code} ({r.weight} ct)
              </button>
            ))}
          </div>
        </FormSectionCard>
      )}

      {/* ── Lot Line Items ── */}
      <FormSectionCard
        title="Lot Line Items"
        icon={<Receipt size={13} />}
        noPad
        actions={!isView && (
          <button className="btn btn-sm btn-primary" onClick={addBlankLine}
            style={{ fontSize: 11, padding: '3px 10px' }}>
            <Plus size={11} /> Add Row
          </button>
        )}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="je-lines-table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 32, textAlign: 'center' }}>#</th>
                <th style={{ width: 110 }}>Lot ID</th>
                <th style={{ minWidth: 140 }}>Name</th>
                <th style={{ width: 80 }}>Wt (ct)</th>
                <th style={{ width: 90 }}>Color</th>
                <th style={{ width: 110 }}>Clarity</th>
                <th style={{ width: 100 }}>Rate/ct (₹)</th>
                <th style={{ width: 100 }}>Amount (₹)</th>
                <th style={{ width: 90 }}>Cost (₹)</th>
                {!isView && <th style={{ width: 36 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--g400)' }}>
                    Click <strong>+ Add Row</strong> to add a line item, or pick a lot from the panel above.
                  </td>
                </tr>
              ) : (
                lines.map((l, i) => {
                  const amt = (parseFloat(l.weight) || 0) * (parseFloat(l.rate_per_carat) || 0);
                  return (
                    <tr key={i}>
                      <td style={{ textAlign: 'center', color: 'var(--g500)', fontSize: 11 }}>{i + 1}</td>

                      {/* Lot ID */}
                      <td>
                        {isView
                          ? <span className="cell-link">{l.lot_number}</span>
                          : <input style={cellInput()} value={l.lot_number}
                              onChange={e => updateLine(i, 'lot_number', e.target.value)}
                              placeholder="LOT-001" />
                        }
                      </td>

                      {/* Name */}
                      <td>
                        {isView
                          ? l.lot_name
                          : <input style={cellInput()} value={l.lot_name}
                              onChange={e => updateLine(i, 'lot_name', e.target.value)}
                              placeholder="Description" />
                        }
                      </td>

                      {/* Weight */}
                      <td>
                        {isView
                          ? <span className="num">{l.weight}</span>
                          : <input type="number" style={cellInput({ textAlign: 'right' })}
                              value={l.weight}
                              onChange={e => updateLine(i, 'weight', e.target.value)}
                              placeholder="0.00" />
                        }
                      </td>

                      {/* Color */}
                      <td>
                        {isView
                          ? l.color
                          : <input style={cellInput()} value={l.color}
                              onChange={e => updateLine(i, 'color', e.target.value)}
                              placeholder="D-E" />
                        }
                      </td>

                      {/* Clarity */}
                      <td>
                        {isView
                          ? l.clarity
                          : <input style={cellInput()} value={l.clarity}
                              onChange={e => updateLine(i, 'clarity', e.target.value)}
                              placeholder="VS Est." />
                        }
                      </td>

                      {/* Rate/ct */}
                      <td>
                        {isView
                          ? <span className="num">₹{Number(l.rate_per_carat || 0).toLocaleString('en-IN')}</span>
                          : <input type="number" style={cellInput({ textAlign: 'right' })}
                              value={l.rate_per_carat}
                              onChange={e => updateLine(i, 'rate_per_carat', e.target.value)}
                              placeholder="0" />
                        }
                      </td>

                      {/* Amount (calculated) */}
                      <td className="num" style={{ fontWeight: 600 }}>
                        ₹{Math.round(amt).toLocaleString('en-IN')}
                      </td>

                      {/* Cost */}
                      <td>
                        {isView
                          ? <span className="num" style={{ color: 'var(--g500)', fontSize: 11 }}>
                              ₹{Number(l.cost_value || 0).toLocaleString('en-IN')}
                            </span>
                          : <input type="number" style={cellInput({ textAlign: 'right' })}
                              value={l.cost_value}
                              onChange={e => updateLine(i, 'cost_value', e.target.value)}
                              placeholder="0" />
                        }
                      </td>

                      {/* Delete */}
                      {!isView && (
                        <td style={{ textAlign: 'center' }}>
                          <button className="icon-btn" onClick={() => removeLine(i)}
                            style={{ color: 'var(--red)' }}
                            title="Remove row">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Totals bar ── */}
        <div style={{
          display: 'flex', padding: '10px 14px',
          background: 'var(--brand-50)', borderTop: '2px solid var(--brand)',
          flexWrap: 'wrap', gap: 8,
        }}>
          {[
            { label: 'Sub Total',          value: `₹${Math.round(subTotal).toLocaleString('en-IN')}` },
            { label: `Tax (${form.tax_pct}%)`, value: `₹${Math.round(taxAmount).toLocaleString('en-IN')}` },
            { label: 'Grand Total',        value: `₹${Math.round(grandTotal).toLocaleString('en-IN')}`, color: 'var(--green)' },
            { label: 'COGS',               value: `₹${Math.round(totalCogs).toLocaleString('en-IN')}`,  color: 'var(--red)' },
            { label: 'Gross Profit',       value: `₹${Math.round(grossProfit).toLocaleString('en-IN')}`, color: grossProfit >= 0 ? 'var(--green)' : 'var(--red)' },
          ].map((t, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-dark)', letterSpacing: '0.05em' }}>
                {t.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: t.color || 'var(--brand-dark)', marginTop: 2 }}>
                {t.value}
              </div>
            </div>
          ))}
        </div>
      </FormSectionCard>

      {/* ── Notes / Memo ── */}
      <NotesAttachmentsPanel
        value={form.remark}
        onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
        readOnly={isView}
      />
    </TransactionPageLayout>
  );
}
