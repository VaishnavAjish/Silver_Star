import { useState, useEffect, useCallback, useRef } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Users, Search, Edit2, Plus, X,
  Phone, Mail, MapPin, FileText, CreditCard,
  AlertCircle, Clock, CheckCircle, ChevronDown,
} from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { useTabs } from '../../../core/tabs';
import toast from 'react-hot-toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtD = d => {
  if (!d) return '—';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const TYPE_BADGE   = { Invoice: 'b-draft', Receipt: 'b-stock', 'JE Adjustment': 'b-process' };
const STATUS_BADGE = { PAID: 'b-stock', PARTIAL: 'b-process', UNPAID: 'b-draft', OVERDUE: 'b-cancelled', COMPLETED: 'b-stock' };

const isReversalJe = (t) => t.je_source_type === 'reversal' || t.je_source_type === 'edit_reversal';
const isReversedJe = (t) => t.je_is_reversed === true || t.je_is_reversed === 'true';

const PAYMENT_TERMS = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days'];

// ─── CustomerDetailsPage ──────────────────────────────────────────────────────
export default function CustomerDetailsPage() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { get, put } = useApi();
  const { canEdit } = useAuth();
  const { openTab } = useTabs();

  const [allCustomers, setAllCustomers] = useState([]);
  const [panelSearch,  setPanelSearch]  = useState('');

  const [customer, setCustomer] = useState(null);
  const [txns,     setTxns]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('transactions');

  const [showEdit, setShowEdit] = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);

  const [showTxMenu, setShowTxMenu] = useState(false);
  const txMenuRef = useRef(null);

  // ── Left-panel customer list — load once ─────────────────────────────────
  useEffect(() => {
    get('/api/customers?limit=500')
      .then(r => setAllCustomers(r.data || []))
      .catch(() => {});
  }, [get]);

  // ── Load customer + transactions on id change ─────────────────────────────
  const loadCustomer = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [c, tx] = await Promise.all([
        get(`/api/customers/${id}`),
        get(`/api/customers/${id}/transactions?limit=100`),
      ]);
      setCustomer(c);
      setTxns(tx.data || []);
    } catch {
      toast.error('Failed to load customer details');
    } finally {
      setLoading(false);
    }
  }, [id, get]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);

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
    if (!customer) return;
    setForm({
      code: customer.code || '', name: customer.name || '',
      contact_person: customer.contact_person || '', phone: customer.phone || '', email: customer.email || '',
      address: customer.address || '', city: customer.city || '', state: customer.state || '',
      gstin: customer.gstin || '', pan: customer.pan || '',
      payment_term: customer.payment_term || '30 Days',
      credit_limit: customer.credit_limit || 0, status: customer.status || 'active',
    });
    setShowEdit(true);
  };

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Customer name is required');
    setSaving(true);
    try {
      await put(`/api/customers/${id}`, form);
      toast.success('Customer updated');
      setShowEdit(false);
      loadCustomer();
      get('/api/customers?limit=500').then(r => setAllCustomers(r.data || [])).catch(() => {});
    } catch (err) {
      toast.error(err.message || 'Failed to update customer');
    } finally {
      setSaving(false);
    }
  };

  const ff = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const filteredCustomers = allCustomers.filter(c =>
    !panelSearch || c.name.toLowerCase().includes(panelSearch.toLowerCase())
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ═══ LEFT PANEL — customer list ══════════════════════════════════════ */}
      <div style={{
        width: 230, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', background: 'var(--g50)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', marginBottom: 8 }}>
            All Customers
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--g400)', pointerEvents: 'none',
            }} />
            <input
              placeholder="Search..."
              value={panelSearch}
              onChange={e => setPanelSearch(e.target.value)}
              style={{ paddingLeft: 26, fontSize: 12, height: 28, width: '100%' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredCustomers.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--g400)', textAlign: 'center' }}>
              No customers found
            </div>
          ) : filteredCustomers.map(c => {
            const isActive = String(c.id) === String(id);
            return (
              <div
                key={c.id}
                onClick={() => {
                  openTab({ id: `/customers/${c.id}`, name: c.name, path: `/customers/${c.id}`, closable: true });
                  navigate(`/customers/${c.id}`);
                }}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: isActive ? 'var(--brand-50, #eff6ff)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--brand)' : '3px solid transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--g100)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: isActive ? 600 : 400 }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--g500)', fontFamily: 'var(--mono)' }}>{c.code}</div>
                </div>
                {c.open_balance > 0 && (
                  <span style={{ fontSize: 10, color: '#1565C0', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                    {fmt(c.open_balance)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {canEdit() && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => navigate('/customers')}
            >
              <Plus size={12} /> Manage Customers
            </button>
          </div>
        )}
      </div>

      {/* ═══ MAIN PANEL ══════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : !customer ? (
          <div className="empty-state">
            <Users size={40} />
            <p>Customer not found.</p>
            <button className="btn btn-primary" onClick={() => navigate('/customers')}>
              Back to Customers
            </button>
          </div>
        ) : (
          <>
            {/* ── Customer header ── */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              background: '#fff', flexShrink: 0,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{customer.name}</h2>
                  <span className={`badge b-${customer.status}`}>{customer.status}</span>
                  <span style={{ fontSize: 11, color: 'var(--g500)', fontFamily: 'var(--mono)' }}>
                    {customer.code}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {customer.phone && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={12} /> {customer.phone}
                    </span>
                  )}
                  {customer.email && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Mail size={12} /> {customer.email}
                    </span>
                  )}
                  {customer.city && (
                    <span style={{ fontSize: 12, color: 'var(--g600)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={12} /> {customer.city}{customer.state ? `, ${customer.state}` : ''}
                    </span>
                  )}
                </div>
              </div>

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
                      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 170,
                    }}>
                      {[
                        { label: 'New Invoice',      icon: <FileText size={13} />,  path: '/invoices/new' },
                        { label: 'Receive Payment',  icon: <CreditCard size={13} />, path: '/receipts/new',
                          state: { customer_id: customer.id, customer_name: customer.name } },
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
                            openTab({ id: item.path, name: item.label, path: item.path, closable: true });
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

            {/* ── Body: summary box + tabs ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Summary cards row */}
              <div style={{
                display: 'flex', gap: 12, padding: '12px 20px',
                borderBottom: '1px solid var(--border)', background: 'var(--g50)', flexShrink: 0, flexWrap: 'wrap',
              }}>
                {[
                  { label: 'Open Receivable',  value: fmt(customer.open_balance),    c: customer.open_balance > 0 ? '#1565C0' : 'var(--g700)', icon: <AlertCircle size={14} />, bg: customer.open_balance > 0 ? '#E3F2FD' : 'var(--g100)' },
                  { label: 'Overdue Balance',   value: fmt(customer.overdue_balance), c: customer.overdue_balance > 0 ? '#E65100' : 'var(--g700)', icon: <Clock size={14} />,        bg: customer.overdue_balance > 0 ? '#FFF3E0' : 'var(--g100)' },
                  { label: 'Last Receipt',      value: fmtD(customer.last_receipt_date), c: 'var(--g700)', icon: <CheckCircle size={14} />, bg: 'var(--g100)' },
                  ...(parseFloat(customer.je_adjustment || 0) !== 0 ? [
                    { label: 'JE Adjustments', value: `${parseFloat(customer.je_adjustment) >= 0 ? '+' : ''}${fmt(customer.je_adjustment)}`, c: parseFloat(customer.je_adjustment) > 0 ? '#1565C0' : '#2E7D32', icon: <FileText size={14} />, bg: parseFloat(customer.je_adjustment) > 0 ? '#E3F2FD' : '#E8F5E9' },
                    { label: 'Total Receivable', value: fmt(customer.total_balance), c: customer.total_balance > 0 ? '#C62828' : '#2E7D32', icon: <CreditCard size={14} />, bg: customer.total_balance > 0 ? '#FFEBEE' : '#E8F5E9' },
                  ] : []),
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
                {customer.payment_term && (
                  <div style={{ padding: '10px 16px', background: 'var(--g100)', borderRadius: 8, border: '1px solid var(--g200)' }}>
                    <div style={{ fontSize: 10, color: 'var(--g500)', fontWeight: 700, textTransform: 'uppercase' }}>
                      Payment Term
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--g700)' }}>
                      {customer.payment_term}
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
                  { key: 'details',      label: 'Customer Details' },
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
                        <p>No transactions yet for this customer.</p>
                        <button className="btn btn-primary" onClick={() => navigate('/invoices/new')}>
                          <Plus size={14} /> Create First Invoice
                        </button>
                      </div>
                    ) : (
                      <table className="dgrid" style={{ fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 100 }}>Date</th>
                            <th style={{ width: 80 }}>Type</th>
                            <th style={{ width: 130 }}>Ref No</th>
                            <th>Category</th>
                            <th style={{ width: 120, textAlign: 'right' }}>Amount</th>
                            <th style={{ width: 120, textAlign: 'right' }}>Balance Due</th>
                            <th style={{ width: 80 }}>Status</th>
                            <th style={{ width: 70 }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {txns.map((t, i) => (
                            <tr key={`${t.type}-${t.id}-${i}`}>
                              <td>{fmtD(t.date)}</td>
                              <td>
                                <span className={`badge ${TYPE_BADGE[t.type] || 'b-draft'}`}>
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
                                color: t.type === 'Receipt'
                                  ? '#2E7D32'
                                  : t.type === 'JE Adjustment'
                                    ? (isReversedJe(t) || isReversalJe(t)
                                        ? 'var(--g400)'
                                        : parseFloat(t.net_effect) >= 0 ? '#1565C0' : '#2E7D32')
                                    : 'inherit',
                                textDecoration: (t.type === 'JE Adjustment' && isReversedJe(t)) ? 'line-through' : 'none',
                              }}>
                                {t.type === 'Receipt'
                                  ? <>+{fmt(t.amount)}</>
                                  : t.type === 'JE Adjustment'
                                    ? <>{parseFloat(t.net_effect) >= 0 ? '+' : '-'}{fmt(Math.abs(parseFloat(t.net_effect)))}</>
                                    : fmt(t.amount)
                                }
                              </td>
                              <td style={{
                                textAlign: 'right', fontFamily: 'var(--mono)',
                                fontWeight: t.balance > 0 ? 600 : 400,
                                color: t.balance > 0 ? '#1565C0' : 'var(--g500)',
                              }}>
                                {t.type === 'Invoice' ? fmt(t.balance) : '—'}
                              </td>
                              <td>
                                {t.status && (
                                  <span className={`badge ${STATUS_BADGE[t.status] || 'b-draft'}`} style={{ fontSize: 10 }}>
                                    {t.status}
                                  </span>
                                )}
                              </td>
                              <td>
                                {t.type === 'Invoice' ? (
                                  <span
                                    className="btn btn-sm"
                                    style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
                                    onClick={() => {
                                      openTab({ id: `/invoices/${t.id}`, name: `Invoice ${t.ref_no || t.id}`, path: `/invoices/${t.id}`, closable: true });
                                      navigate(`/invoices/${t.id}`);
                                    }}
                                  >
                                    View
                                  </span>
                                ) : t.type === 'JE Adjustment' && t.je_id ? (
                                  <span
                                    className="btn btn-sm"
                                    style={{
                                      fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                                      opacity: isReversedJe(t) ? 0.6 : 1,
                                    }}
                                    onClick={() => {
                                      openTab({ id: `/journal-entries/${t.je_id}`, name: `JE ${t.je_id}`, path: `/journal-entries/${t.je_id}`, closable: true });
                                      navigate(`/journal-entries/${t.je_id}`);
                                    }}
                                  >
                                    View JE
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, color: 'var(--g400)' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{txns.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>{txns.length} records</span>
              </div>
            )}
</td></tr></tfoot>
</table>

                    )}
                  </>
                )}

                {/* ── CUSTOMER DETAILS TAB ── */}
                {tab === 'details' && (
                  <div style={{ maxWidth: 560 }}>
                    <DetailGrid rows={[
                      { label: 'Customer Code',  value: customer.code },
                      { label: 'Contact Person', value: customer.contact_person },
                      { label: 'Phone',          value: customer.phone },
                      { label: 'Email',          value: customer.email },
                      { label: 'Address',        value: customer.address },
                      { label: 'City',           value: customer.city },
                      { label: 'State',          value: customer.state },
                      { label: 'GSTIN',          value: customer.gstin, mono: true },
                      { label: 'PAN',            value: customer.pan,   mono: true },
                      { label: 'Payment Term',   value: customer.payment_term },
                      { label: 'Credit Limit',   value: customer.credit_limit ? fmt(customer.credit_limit) : '—' },
                      { label: 'Status',         value: customer.status },
                    ]} />
                    {canEdit() && (
                      <button className="btn btn-sm" style={{ marginTop: 16 }} onClick={openEdit}>
                        <Edit2 size={12} /> Edit Customer
                      </button>
                    )}
                  </div>
                )}

              </div>
            </div>
          </>
        )}
      </div>

      {/* ═══ EDIT MODAL ══════════════════════════════════════════════════════ */}
      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div
            className="modal modal-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Edit Customer — {customer?.name}</h3>
              <button className="icon-btn" onClick={() => setShowEdit(false)}><X size={16} /></button>
            </div>

            <div className="modal-body">
              <div className="form-row">
                <div className="fg">
                  <label>Code</label>
                  <input value={form.code} disabled style={{ background: 'var(--g100)' }} />
                </div>
                <div className="fg w">
                  <label>Customer Name *</label>
                  <input value={form.name} onChange={e => ff('name', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="fg">
                  <label>Payment Term</label>
                  <SelectDropdown value={form.payment_term} onChange={e => ff('payment_term', e.target.value)}>
                    {PAYMENT_TERMS.map(o => <option key={o} value={o}>{o}</option>)}
                  </SelectDropdown>
                </div>
                <div className="fg">
                  <label>Credit Limit (₹)</label>
                  <input
                    type="number" min="0"
                    value={form.credit_limit}
                    onChange={e => ff('credit_limit', e.target.value)}
                  />
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

// ─── Detail grid helper ───────────────────────────────────────────────────────
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
