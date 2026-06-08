import { useState, useEffect, useCallback, useRef } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, ChevronRight, Edit2, Plus, X,
  Phone, Mail, MapPin, FileText, CreditCard, Receipt,
  AlertCircle, Clock, CheckCircle, ChevronDown, Link2,
} from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { useTabs } from '../../../core/tabs';
import toast from 'react-hot-toast';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import AllocationModal from '../../../modules/accounting/components/AllocationModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtD   = d => {
  if (!d) return '—';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const TYPE_BADGE   = { Bill: 'b-draft', Payment: 'b-stock', 'JE Adjustment': 'b-process' };
const STATUS_BADGE = { PAID: 'b-stock', PARTIAL: 'b-process', UNPAID: 'b-draft', OVERDUE: 'b-cancelled', COMPLETED: 'b-stock' };

const isReversalJe = (t) => t.je_source_type === 'reversal' || t.je_source_type === 'edit_reversal';
const isReversedJe = (t) => t.je_is_reversed === true || t.je_is_reversed === 'true';

const CATEGORIES    = ['seed', 'gas', 'consumable', 'general'];
const PAYMENT_TERMS = ['Immediate', '7 Days', '15 Days', '30 Days', '60 Days'];

// ─── VendorDetailsPage ────────────────────────────────────────────────────────
export default function VendorDetailsPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { get, post, put, del } = useApi();
  const { canEdit } = useAuth();
  const { openTab } = useTabs();

  // Left panel state
  const [allVendors,  setAllVendors]  = useState([]);
  const [panelSearch, setPanelSearch] = useState('');

  // Main panel state
  const [vendor,      setVendor]      = useState(null);
  const [txns,        setTxns]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('transactions');

  // Allocation state
  const [allocModal,   setAllocModal]   = useState(null);  // { je_id, amount, existing }
  const [jeAllocsMap,  setJeAllocsMap]  = useState({});    // { [je_id]: AllocRow[] }

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);

  // New-transaction dropdown
  const [showTxMenu, setShowTxMenu] = useState(false);
  const txMenuRef = useRef(null);

  // ── Load left-panel vendor list once ─────────────────────────────────────
  useEffect(() => {
    get('/api/vendors?limit=500')
      .then(r => setAllVendors(r.data || []))
      .catch(() => {});
  }, [get]); // `get` is a stable useCallback ref — won't loop

  // ── Load vendor detail + transactions when id changes ─────────────────────
  const loadVendor = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setJeAllocsMap({});
    try {
      const [v, tx] = await Promise.all([
        get(`/api/vendors/${id}`),
        get(`/api/vendors/${id}/transactions?limit=100`),
      ]);
      setVendor(v);
      setTxns(tx.data || []);
      // Load je_allocations for this vendor to show allocation badges
      try {
        const allocs = await get(`/api/je-allocations?entity_type=vendor&entity_id=${id}`);
        const map = {};
        (Array.isArray(allocs) ? allocs : []).forEach(a => {
          if (!map[a.je_id]) map[a.je_id] = [];
          map[a.je_id].push(a);
        });
        setJeAllocsMap(map);
      } catch { /* non-critical */ }
    } catch {
      toast.error('Failed to load vendor details');
    } finally {
      setLoading(false);
    }
  }, [id, get]);

  // ── Allocation handlers ───────────────────────────────────────────────────
  const openAllocModal = useCallback((t) => {
    const amount   = Math.abs(parseFloat(t.net_effect) || 0);
    const existing = (jeAllocsMap[t.je_id] || []).map(a => ({
      target_type:      a.target_type,
      target_id:        a.target_id,
      doc_number:       a.target_doc_number,
      doc_date:         a.target_doc_date,
      grand_total:      a.target_grand_total,
      allocated_amount: a.allocated_amount,
    }));
    // Pass je_id as excludeJeId so the open-bills query ignores this JE's
    // existing allocations — without this, fully-allocated bills would not appear.
    setAllocModal({ je_id: t.je_id, amount, existing, excludeJeId: t.je_id });
  }, [jeAllocsMap]);

  const handleAllocSave = useCallback(async (allocations) => {
    const { je_id } = allocModal;
    try {
      // Delete all existing for this JE first, then re-create
      try { await del(`/api/je-allocations/by-je/${je_id}`); } catch { /* ok if none */ }
      if (allocations.length > 0) {
        await post('/api/je-allocations', {
          je_id,
          allocation_date: new Date().toISOString().split('T')[0],
          allocations: allocations.map(a => ({
            entity_type:      'vendor',
            entity_id:        parseInt(id),
            target_type:      a.target_type,
            target_id:        a.target_id,
            allocated_amount: a.allocated_amount,
          })),
        });
      }
      toast.success('Allocations saved');
      setAllocModal(null);
      loadVendor();
    } catch (err) {
      toast.error(err.message || 'Failed to save allocations');
    }
  }, [allocModal, del, post, id, loadVendor]);

  useEffect(() => { loadVendor(); }, [loadVendor]);

  // Close new-tx dropdown on outside click
  useEffect(() => {
    const handler = e => {
      if (txMenuRef.current && !txMenuRef.current.contains(e.target)) setShowTxMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Edit modal ────────────────────────────────────────────────────────────
  const openEdit = () => {
    if (!vendor) return;
    setForm({
      code: vendor.code || '', name: vendor.name || '', category: vendor.category || 'general',
      contact_person: vendor.contact_person || '', phone: vendor.phone || '', email: vendor.email || '',
      address: vendor.address || '', city: vendor.city || '', state: vendor.state || '',
      gstin: vendor.gstin || '', pan: vendor.pan || '', payment_term: vendor.payment_term || 'Immediate',
      bank_details: vendor.bank_details || '', status: vendor.status || 'active',
    });
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Vendor name is required');
    setSaving(true);
    try {
      await put(`/api/vendors/${id}`, form);
      toast.success('Vendor updated');
      setShowEdit(false);
      loadVendor();
      // Refresh left panel too
      get('/api/vendors?limit=500').then(r => setAllVendors(r.data || [])).catch(() => {});
    } catch (err) {
      toast.error(err.message || 'Failed to update vendor');
    } finally {
      setSaving(false);
    }
  };

  const ff = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Filtered left-panel list ──────────────────────────────────────────────
  const filteredVendors = allVendors.filter(v =>
    !panelSearch || v.name.toLowerCase().includes(panelSearch.toLowerCase())
  );

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(txns, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ═══ LEFT PANEL — vendor list ════════════════════════════════════════ */}
      <div style={{
        width: 230, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--g50)',
        overflow: 'hidden',
      }}>
        {/* Panel header */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--g400)', textTransform: 'uppercase',
                        letterSpacing: '0.08em', marginBottom: 6 }}>
            Search
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{
              position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--brand, #4f8ef7)', pointerEvents: 'none',
            }} />
            <input
              placeholder="Filter search..."
              value={panelSearch}
              onChange={e => setPanelSearch(e.target.value)}
              style={{
                paddingLeft: 30, fontSize: 12, height: 32, width: '100%',
                border: '1px solid var(--g300)', borderRadius: 6,
                outline: 'none', background: '#fff',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => {
                e.target.style.borderColor = 'var(--brand, #4f8ef7)';
                e.target.style.boxShadow = '0 0 0 2px rgba(79,142,247,0.15)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'var(--g300)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>
        </div>

        {/* Vendor list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredVendors.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--g400)', textAlign: 'center' }}>
              No vendors found
            </div>
          ) : filteredVendors.map(v => {
            const isActive = String(v.id) === String(id);
            return (
              <div
                key={v.id}
                onClick={() => {
                  openTab({ id: `/vendors/${v.id}`, name: v.name, path: `/vendors/${v.id}`, closable: true });
                  navigate(`/vendors/${v.id}`);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isActive ? 'var(--brand-50, #eff6ff)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--brand)' : '3px solid transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--g100)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: isActive ? 600 : 400 }}>{v.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--g500)', fontFamily: 'var(--mono)' }}>{v.code}</div>
                </div>
                {v.open_balance > 0 && (
                  <span style={{ fontSize: 10, color: '#C62828', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                    {fmt(v.open_balance)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Add vendor link at the bottom */}
        {canEdit() && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => navigate('/vendors')}
            >
              <Plus size={12} /> Manage Vendors
            </button>
          </div>
        )}
      </div>

      {/* ═══ MAIN PANEL ══════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : !vendor ? (
          <div className="empty-state">
            <ShoppingCart size={40} />
            <p>Vendor not found.</p>
            <button className="btn btn-primary" onClick={() => navigate('/vendors')}>
              Back to Vendors
            </button>
          </div>
        ) : (
          <>
            {/* ── Vendor header ── */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              background: '#fff', flexShrink: 0,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{vendor.name}</h2>
                  <span className={`badge b-${vendor.status}`}>{vendor.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--g500)', fontFamily: 'var(--mono)' }}>
                    {vendor.code}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {vendor.phone && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={12} /> {vendor.phone}
                    </span>
                  )}
                  {vendor.email && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Mail size={12} /> {vendor.email}
                    </span>
                  )}
                  {vendor.city && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={12} /> {vendor.city}{vendor.state ? `, ${vendor.state}` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Header actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {canEdit() && (
                  <button className="btn btn-sm" onClick={openEdit}>
                    <Edit2 size={13} /> Edit
                  </button>
                )}

                {/* New Transaction dropdown */}
                <div style={{ position: 'relative' }} ref={txMenuRef}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => setShowTxMenu(p => !p)}
                  >
                    <Plus size={13} /> New Transaction <ChevronDown size={12} />
                  </button>
                  {showTxMenu && (
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: 4,
                      background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 160,
                    }}>
                      {[
                        { label: 'Bill',    icon: <FileText size={13} />,  path: '/purchase-notes/new' },
                        { label: 'Payment', icon: <CreditCard size={13} />, path: '/payments/new',
                          state: { vendor_id: vendor.id, vendor_name: vendor.name } },
                        { label: 'Expense', icon: <Receipt size={13} />,   path: '/expenses/new' },
                      ].map(item => (
                        <div
                          key={item.label}
                          style={{
                            padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                            gap: 8, fontSize: 13, borderRadius: 4,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--g50)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}
                          onClick={() => { 
                            setShowTxMenu(false); 
                            openTab({ id: item.path, name: `New ${item.label}`, path: item.path, closable: true });
                            navigate(item.path, item.state ? { state: item.state } : {}); 
                          }}
                        >
                          {item.icon} {item.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Body: summary box + tabs content ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Summary cards row */}
              <div style={{
                display: 'flex', gap: 12, padding: '12px 20px',
                borderBottom: '1px solid var(--border)', background: 'var(--g50)', flexShrink: 0, flexWrap: 'wrap',
              }}>
                {[
                  { label: 'Bills Balance',   value: fmt(vendor.open_balance),    c: vendor.open_balance > 0 ? '#C62828' : 'var(--g700)', icon: <AlertCircle size={14} />, bg: vendor.open_balance > 0 ? '#FFEBEE' : 'var(--g100)' },
                  ...(parseFloat(vendor.je_adjustment || 0) !== 0 ? [
                    { label: 'JE Adjustments', value: `${parseFloat(vendor.je_adjustment) >= 0 ? '+' : ''}${fmt(vendor.je_adjustment)}`, c: parseFloat(vendor.je_adjustment) > 0 ? '#7B1FA2' : '#2E7D32', icon: <FileText size={14} />, bg: parseFloat(vendor.je_adjustment) > 0 ? '#F3E5F5' : '#E8F5E9' },
                    { label: 'Total Payable',  value: fmt(vendor.total_balance),  c: parseFloat(vendor.total_balance) > 0 ? '#C62828' : 'var(--g700)', icon: <CreditCard size={14} />, bg: parseFloat(vendor.total_balance) > 0 ? '#FFEBEE' : 'var(--g100)' },
                  ] : []),
                  { label: 'Overdue Balance', value: fmt(vendor.overdue_balance), c: vendor.overdue_balance > 0 ? '#E65100' : 'var(--g700)', icon: <Clock size={14} />,        bg: vendor.overdue_balance > 0 ? '#FFF3E0' : 'var(--g100)' },
                  { label: 'Last Payment',    value: fmtD(vendor.last_payment_date), c: 'var(--g700)', icon: <CheckCircle size={14} />, bg: 'var(--g100)' },
                ].map((c, i) => (
                  <div key={i} style={{
                    padding: '10px 16px', background: c.bg, borderRadius: 8,
                    border: '1px solid var(--g200)', display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ color: c.c }}>{c.icon}</span>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--g500)', fontWeight: 700, textTransform: 'uppercase' }}>
                        {c.label}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: c.c }}>
                        {c.value}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Payment term chip */}
                {vendor.payment_term && (
                  <div style={{ padding: '10px 16px', background: 'var(--g100)', borderRadius: 8, border: '1px solid var(--g200)' }}>
                    <div style={{ fontSize: 10, color: 'var(--g500)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Payment Term
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--g700)' }}>
                      {vendor.payment_term}
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div style={{
                display: 'flex', gap: 0, padding: '0 20px',
                borderBottom: '1px solid var(--border)', background: '#fff', flexShrink: 0,
              }}>
                {[
                  { key: 'transactions', label: 'Transactions' },
                  { key: 'details',      label: 'Vendor Details' },
                  { key: 'notes',        label: 'Bank & Notes' },
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      padding: '10px 16px', fontSize: 13, fontWeight: tab === t.key ? 600 : 400,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      borderBottom: tab === t.key ? '2px solid var(--brand)' : '2px solid transparent',
                      color: tab === t.key ? 'var(--brand)' : 'var(--g600)',
                      transition: 'color 0.15s',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

                {/* ── TRANSACTIONS TAB ── */}
                {tab === 'transactions' && (
                  <>
                    {txns.length === 0 ? (
                      <div className="empty-state">
                        <FileText size={36} />
                        <p>No transactions yet for this vendor.</p>
                        <button className="btn btn-primary" onClick={() => navigate('/purchase-notes/new')}>
                          <Plus size={14} /> Create First Bill
                        </button>
                      </div>
                    ) : (
                      <>
                      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <table className="dgrid" style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0, minWidth: 700 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 100, position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Date</th>
                              <th style={{ width: 70,  position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Type</th>
                              <th style={{ width: 120, position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Ref No</th>
                              <th style={{             position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Category</th>
                              <th style={{ width: 120, textAlign: 'right', position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Amount</th>
                              <th style={{ width: 120, textAlign: 'right', position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Balance Due</th>
                              <th style={{ width: 80,  position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Status</th>
                              <th style={{ width: 110, position: 'sticky', top: 0, zIndex: 2, background: 'var(--g50, #f8f9fa)', boxShadow: '0 1px 0 var(--border)' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedItems.map((t, i) => (
                              <tr key={`${t.type}-${t.id}-${i}`}>
                                <td>{fmtD(t.date)}</td>
                                <td>
                                  <span className={`badge ${TYPE_BADGE[t.status] || 'b-draft'}`}>
                                    {t.type}
                                  </span>
                                </td>
                                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                                  {t.ref_no}
                                  {t.type === 'JE Adjustment' && isReversalJe(t) && (
                                    <span className="badge b-cancelled" style={{ fontSize: 9, marginLeft: 5 }}>REVERSAL</span>
                                  )}
                                  {t.type === 'JE Adjustment' && isReversedJe(t) && (
                                    <span className="badge b-process" style={{ fontSize: 9, marginLeft: 5, opacity: 0.7 }}>REVERSED</span>
                                  )}
                                </td>
                                <td style={{ color: 'var(--g600)' }}>{t.category || '—'}</td>
                                <td style={{
                                  textAlign: 'right', fontFamily: 'var(--mono)',
                                  color: t.type === 'Payment'
                                    ? '#2E7D32'
                                    : t.type === 'JE Adjustment'
                                      ? (isReversedJe(t) || isReversalJe(t)
                                          ? 'var(--g400)'
                                          : parseFloat(t.net_effect) >= 0 ? '#7B1FA2' : '#2E7D32')
                                      : 'inherit',
                                  textDecoration: (t.type === 'JE Adjustment' && isReversedJe(t)) ? 'line-through' : 'none',
                                }}>
                                  {t.type === 'Payment'
                                    ? <>-{fmt(t.amount)}</>
                                    : t.type === 'JE Adjustment'
                                      ? <>{parseFloat(t.net_effect) >= 0 ? '+' : '-'}{fmt(Math.abs(parseFloat(t.net_effect)))}</>
                                      : fmt(t.amount)
                                  }
                                </td>
                                <td style={{
                                  textAlign: 'right', fontFamily: 'var(--mono)',
                                  fontWeight: t.balance > 0 ? 600 : 400,
                                  color: t.balance > 0 ? '#C62828' : 'var(--g500)',
                                }}>
                                  {t.type === 'Bill' ? fmt(t.balance) : '—'}
                                </td>
                                <td>
                                  {t.status && (
                                    <span className={`badge ${STATUS_BADGE[t.status] || 'b-draft'}`} style={{ fontSize: 10 }}>
                                      {t.status}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {t.type === 'Bill' ? (
                                    <span
                                      className="btn btn-sm"
                                      style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
                                      onClick={() => {
                                        openTab({ id: `/purchase-notes/${t.id}`, name: t.ref_no || `#${t.id}`, path: `/purchase-notes/${t.id}`, closable: true });
                                        navigate(`/purchase-notes/${t.id}`);
                                      }}
                                    >
                                      View
                                    </span>
                                  ) : t.type === 'JE Adjustment' && t.je_id ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                      <span
                                        className="btn btn-sm"
                                        style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer' }}
                                        onClick={() => {
                                          openTab({ id: `/journal-entries/${t.je_id}`, name: `JE #${t.je_id}`, path: `/journal-entries/${t.je_id}`, closable: true });
                                          navigate(`/journal-entries/${t.je_id}`);
                                        }}
                                      >
                                        View JE
                                      </span>
                                      {canEdit() && !isReversedJe(t) && !isReversalJe(t) && (
                                        <button
                                          className="btn btn-sm"
                                          style={{
                                            fontSize: 10, padding: '2px 6px',
                                            display: 'flex', alignItems: 'center', gap: 3,
                                            color: (jeAllocsMap[t.je_id]?.length || 0) > 0 ? '#2E7D32' : 'var(--g600)',
                                            borderColor: (jeAllocsMap[t.je_id]?.length || 0) > 0 ? '#2E7D32' : undefined,
                                          }}
                                          onClick={() => openAllocModal(t)}
                                        >
                                          <Link2 size={9} />
                                          {(jeAllocsMap[t.je_id]?.length || 0) > 0
                                            ? `${jeAllocsMap[t.je_id].length} Alloc.`
                                            : 'Allocate'}
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: 11, color: 'var(--g400)' }}>—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {txns.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                          <span>Showing {txns.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, txns.length)} of {txns.length} records</span>
                          <Paginator page={page} totalPages={totalPages} onPage={setPage} />
                        </div>
                      )}
                      </>)}
                    </>
                  )}
                
                {/* ── VENDOR DETAILS TAB ── */}
                {tab === 'details' && (
                  <div style={{ maxWidth: 560 }}>
                    <DetailGrid rows={[
                      { label: 'Vendor Code',    value: vendor.code },
                      { label: 'Category',       value: vendor.category },
                      { label: 'Contact Person', value: vendor.contact_person },
                      { label: 'Phone',          value: vendor.phone },
                      { label: 'Email',          value: vendor.email },
                      { label: 'Address',        value: vendor.address },
                      { label: 'City',           value: vendor.city },
                      { label: 'State',          value: vendor.state },
                      { label: 'GSTIN',          value: vendor.gstin, mono: true },
                      { label: 'PAN',            value: vendor.pan,   mono: true },
                      { label: 'Payment Term',   value: vendor.payment_term },
                      { label: 'Status',         value: vendor.status },
                    ]} />
                    {canEdit() && (
                      <button className="btn btn-sm" style={{ marginTop: 16 }} onClick={openEdit}>
                        <Edit2 size={12} /> Edit Vendor
                      </button>
                    )}
                  </div>
                )}

                {/* ── BANK & NOTES TAB ── */}
                {tab === 'notes' && (
                  <div style={{ maxWidth: 500 }}>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--g600)', marginBottom: 8 }}>
                        Bank Details
                      </div>
                      {vendor.bank_details ? (
                        <pre style={{
                          fontFamily: 'inherit', fontSize: 13, padding: 14,
                          background: 'var(--g50)', borderRadius: 8, border: '1px solid var(--g200)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
                        }}>
                          {vendor.bank_details}
                        </pre>
                      ) : (
                        <div style={{ color: 'var(--g400)', fontSize: 13, fontStyle: 'italic' }}>
                          No bank details recorded.
                        </div>
                      )}
                    </div>
                    {canEdit() && (
                      <button className="btn btn-sm" onClick={openEdit}>
                        <Edit2 size={12} /> Edit Bank Details
                      </button>
                    )}
                  </div>
                )}

              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ ALLOCATION MODAL ════════════════════════════════════════════════ */}
      {allocModal && (
        <AllocationModal
          isOpen={true}
          onClose={() => setAllocModal(null)}
          onSave={handleAllocSave}
          entityType="vendor"
          entityId={parseInt(id)}
          entityName={vendor?.name || ''}
          maxAmount={allocModal.amount}
          existingAllocations={allocModal.existing}
          excludeJeId={allocModal.excludeJeId}
        />
      )}

      {/* ═══ EDIT MODAL ══════════════════════════════════════════════════════ */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div
            className="modal modal-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Edit Vendor — {vendor?.name}</h3>
              <button className="icon-btn" onClick={() => setShowEdit(false)}><X size={16} /></button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="fg">
                  <label>Code</label>
                  <input value={form.code} disabled style={{ background: 'var(--g100)' }} />
                </div>
                <div className="fg w">
                  <label>Vendor Name *</label>
                  <input value={form.name} onChange={e => ff('name', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg">
                  <label>Category</label>
                  <SelectDropdown value={form.category} onChange={e => ff('category', e.target.value)}>
                    {CATEGORIES.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Payment Term</label>
                  <SelectDropdown value={form.payment_term} onChange={e => ff('payment_term', e.target.value)}>
                    {PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Status</label>
                  <SelectDropdown value={form.status} onChange={e => ff('status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </SelectDropdown>
                </div>
              </div>
              <div className="form-row">
                <div className="fg">
                  <label>Contact Person</label>
                  <input value={form.contact_person} onChange={e => ff('contact_person', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Phone</label>
                  <input value={form.phone} onChange={e => ff('phone', e.target.value)} />
                </div>
                <div className="fg">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => ff('email', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg w">
                  <label>Address</label>
                  <input value={form.address} onChange={e => ff('address', e.target.value)} />
                </div>
                <div className="fg">
                  <label>City</label>
                  <input value={form.city} onChange={e => ff('city', e.target.value)} />
                </div>
                <div className="fg">
                  <label>State</label>
                  <input value={form.state} onChange={e => ff('state', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg">
                  <label>GSTIN</label>
                  <input value={form.gstin} onChange={e => ff('gstin', e.target.value)} />
                </div>
                <div className="fg">
                  <label>PAN</label>
                  <input value={form.pan} onChange={e => ff('pan', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg w">
                  <label>Bank Details</label>
                  <textarea value={form.bank_details} onChange={e => ff('bank_details', e.target.value)} rows={3} />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowEdit(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small helper component: two-column detail grid ──────────────────────────
function DetailGrid({ rows }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10,
      padding: 16, background: 'var(--g50)', borderRadius: 10, border: '1px solid var(--g200)',
    }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div style={{ fontSize: 12, color: 'var(--g500)', fontWeight: 600, padding: '2px 0' }}>
            {r.label}
          </div>
          <div style={{
            fontSize: 13, color: r.value ? 'var(--g800)' : 'var(--g400)',
            fontFamily: r.mono ? 'var(--mono)' : 'inherit',
            fontStyle: r.value ? 'normal' : 'italic',
          }}>
            {r.value || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}
