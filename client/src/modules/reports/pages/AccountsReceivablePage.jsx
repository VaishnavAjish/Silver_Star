import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { FileText, Search, File } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import Modal from '../../../shared/components/Modal';
import Paginator from '../../../shared/components/Paginator';

const fmt = v => `₹${Math.round(Number(v) || 0).toLocaleString('en-IN')}`;
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN') : '—';
const statusBadge = { Paid: 'b-stock', Partial: 'b-process', Unpaid: 'b-draft', Overdue: 'b-cancelled' };

export default function AccountsReceivable() {
  const api = useApi();
  const [customers, setCustomers] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  const [invoiceDetails, setInvoiceDetails] = useState(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 500;
  const reqId = useRef(0);

  const [filters, setFilters] = usePersistedFilters('ar_filters', {
    customer_id: '', from_date: '', to_date: '', status: '', overdue_only: false, search: '',
  });

  useEffect(() => {
    api.get('/api/customers?limit=500').then(r => setCustomers(r.data || [])).catch(() => { });
  }, []);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: page, pageSize: PAGE_SIZE });
      const ff = filters;
      if (ff.customer_id) p.set('customer_id', ff.customer_id);
      p.set('from_date', ff.from_date || '2000-01-01');
      p.set('to_date', ff.to_date || '2099-12-31');
      if (ff.status) p.set('status', ff.status);
      if (ff.search) p.set('search', ff.search);
      if (ff.overdue_only) p.set('overdue_only', 'true');
      const res = await api.get(`/api/reports/accounts-receivable?${p}`);
      if (id === reqId.current) setData(res);
    } catch (err) { } finally { if (id === reqId.current) setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const f = (k, v) => {
    setPage(1);
    setFilters(prev => ({ ...prev, [k]: v }));
  };
  const defaults = { customer_id: '', from_date: '', to_date: '', status: '', overdue_only: false, search: '' };
  const hasActiveFilters = filters.customer_id || filters.from_date || filters.to_date || filters.status || filters.overdue_only || filters.search;

  const totalPages = useMemo(() => data ? Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE)) : 1, [data]);
  const pageRows = useMemo(() => {
    if (!data) return [];
    return data.data || [];
  }, [data]);

  const openInvoice = async (id) => {
    setSelectedInvoiceId(id);
    setLoadingInvoice(true);
    setInvoiceDetails(null);
    try {
      const res = await api.get(`/api/invoices/${id}`);
      setInvoiceDetails(res);
    } catch (err) {
      // Error fetching invoice
    } finally {
      setLoadingInvoice(false);
    }
  };

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} className="animate-in">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', marginBottom: 16 }}>
      </div>

      <div className="form-row" style={{ marginBottom: 16, background: 'var(--g50)', padding: 14, borderRadius: 10, border: '1px solid var(--g200)', flexWrap: 'wrap', flexShrink: 0 }}>
        <div className="fg">
          <label>Customer</label>
          <SelectDropdown value={filters.customer_id} onChange={e => f('customer_id', e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectDropdown>
        </div>
        <div className="fg">
          <label>From Date</label>
          <DatePicker value={filters.from_date} onChange={v => f('from_date', v)} />
        </div>
        <div className="fg">
          <label>To Date</label>
          <DatePicker value={filters.to_date} onChange={v => f('to_date', v)} />
        </div>
        <div className="fg">
          <label>Status</label>
          <SelectDropdown value={filters.status} onChange={e => f('status', e.target.value)}>
            <option value="">All</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
          </SelectDropdown>
        </div>
        <div className="fg">
          <label>Invoice No</label>
          <input placeholder="Search…" value={filters.search} onChange={e => f('search', e.target.value)} />
        </div>
        <div className="fg">
          <label>&nbsp;</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, color: 'var(--g700)', textTransform: 'none', marginRight: 4 }}>
              <input type="checkbox" checked={filters.overdue_only} onChange={e => f('overdue_only', e.target.checked)} style={{ margin: 0, width: 14, height: 14 }} />
              Overdue Only
            </label>
            {hasActiveFilters ? (
              <button className="btn" onClick={() => {
                setPage(1);
                setFilters(defaults);
              }} disabled={loading}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {data && !loading && (
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', flex: 1, minHeight: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { l: 'Total Invoiced', v: fmt(data.totals?.invoice_amount || 0), bg: 'var(--brand-50)', c: 'var(--brand-dark)' },
                { l: 'Total Received', v: fmt(data.totals?.received_amount || 0), bg: '#E8F5E9', c: '#2E7D32' },
                { l: 'Outstanding', v: fmt(data.totals?.balance_amount || 0), bg: '#FFEBEE', c: '#C62828' },
                { l: 'Records', v: data.total || 0, bg: '#E3F2FD', c: '#0D47A1' },
              ].map((c, i) => (
                <div key={i} style={{ padding: '10px 16px', background: c.bg, borderRadius: 8, border: '1px solid var(--g200)' }}>
                  <div style={{ fontSize: 10, color: c.c, fontWeight: 700, textTransform: 'uppercase' }}>{c.l}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.c }}>{c.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ minHeight: 0, overflowY: 'auto', borderBottom: '1px solid var(--g200)' }}>
            <table className="dgrid" style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
              <colgroup>
                <col />
                <col style={{ width: 90 }} />
                <col />
                <col style={{ width: 90 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 82 }} />
                <col style={{ width: 70 }} />
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                <tr>
                  <th>Invoice No</th>
                  <th style={{ width: 90 }}>Date</th>
                  <th>Customer</th>
                  <th style={{ width: 90 }}>Due Date</th>
                  <th style={{ width: 110 }} className="num">Invoice Amt (₹)</th>
                  <th style={{ width: 110 }} className="num">Received (₹)</th>
                  <th style={{ width: 110 }} className="num">Balance (₹)</th>
                  <th style={{ width: 82 }}>Status</th>
                  <th style={{ width: 70 }} className="num">Age (d)</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--g500)' }}>No records found</td></tr>
                )}
                {pageRows.map((r, i) => (
                  <tr key={i}>
                    <td><span className="cell-link" onClick={() => openInvoice(r.id)} onDoubleClick={() => openInvoice(r.id)}>{r.doc_number}</span></td>
                    <td>{fmtDate(r.doc_date)}</td>
                    <td>{r.customer_name || '—'}</td>
                    <td style={{ color: r.pay_status === 'Overdue' ? '#C62828' : 'inherit' }}>{fmtDate(r.due_date)}</td>
                    <td className="num">{fmt(r.invoice_amount)}</td>
                    <td className="num" style={{ color: '#2E7D32' }}>{fmt(r.received_amount)}</td>
                    <td className="num" style={{ fontWeight: r.balance_amount > 0 ? 600 : 400, color: r.balance_amount > 0 ? '#C62828' : 'inherit' }}>
                      {fmt(r.balance_amount)}
                    </td>
                    <td><span className={`badge ${statusBadge[r.pay_status] || 'b-draft'}`}>{r.pay_status}</span></td>
                    <td className="num" style={{ color: r.ageing_days > 60 ? '#C62828' : r.ageing_days > 30 ? '#E65100' : 'inherit' }}>
                      {r.ageing_days}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ position: 'sticky', bottom: 0, zIndex: 10, boxShadow: '0 -1px 0 var(--g200)' }}>
                <tr style={{ fontWeight: 700, background: 'var(--g50)' }}>
                  <td colSpan={4} style={{ textAlign: 'right', borderTop: 'none' }}>Totals:</td>
                  <td className="num" style={{ borderTop: 'none' }}>{fmt(data.totals?.invoice_amount || 0)}</td>
                  <td className="num" style={{ color: '#2E7D32', borderTop: 'none' }}>{fmt(data.totals?.received_amount || 0)}</td>
                  <td className="num" style={{ color: '#C62828', borderTop: 'none' }}>{fmt(data.totals?.balance_amount || 0)}</td>
                  <td colSpan={2} style={{ borderTop: 'none' }}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--g200)' }}>
              <Paginator page={page} totalPages={totalPages} onPage={setPage} />
            </div>
          )}
        </div>
      )}

      <Modal open={!!selectedInvoiceId} onClose={() => setSelectedInvoiceId(null)} title={`Invoice Details`} icon={<File size={16} />} large>
        {loadingInvoice ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--g500)' }}><div className="spinner" style={{ margin: '0 auto 10px' }} /> Loading details...</div>
        ) : invoiceDetails ? (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Customer</p>
                <p style={{ margin: 0, fontWeight: 500 }}>{invoiceDetails.customer_name || 'N/A'}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Invoice No</p>
                <p style={{ margin: 0, fontWeight: 500 }}>{invoiceDetails.doc_number}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Date</p>
                <p style={{ margin: 0, fontWeight: 500 }}>{fmtDate(invoiceDetails.doc_date)}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Grand Total</p>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--brand-dark)', fontSize: 16 }}>{fmt(invoiceDetails.grand_total)}</p>
              </div>
            </div>

            <h4 style={{ fontSize: 13, marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--g200)' }}>Lines</h4>
            {invoiceDetails.lines && invoiceDetails.lines.length > 0 ? (
              <table className="dgrid" style={{ fontSize: 11, marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Item / Description</th>
                    <th className="num" style={{ width: 60 }}>Qty</th>
                    <th className="num" style={{ width: 80 }}>Weight</th>
                    <th className="num" style={{ width: 100 }}>Rate</th>
                    <th className="num" style={{ width: 100 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceDetails.lines.map(l => (
                    <tr key={l.id}>
                      <td>{l.lot_number || l.item_name || '—'}{l.description && <div style={{ fontSize: 10, color: 'var(--g500)' }}>{l.description}</div>}</td>
                      <td className="num">{l.qty || 0}</td>
                      <td className="num">{l.weight ? `${l.weight} ct` : '—'}</td>
                      <td className="num">{fmt(l.rate)}</td>
                      <td className="num" style={{ fontWeight: 500 }}>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--g500)', background: 'var(--g50)', borderRadius: 8 }}>No lines found</div>
            )}
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>Failed to load invoice details.</div>
        )}
      </Modal>
    </div>
  );
}
