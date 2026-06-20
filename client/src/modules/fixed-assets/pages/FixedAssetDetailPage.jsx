import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import {
  Landmark, TrendingDown, Trash2, Printer,
  FileText, Tag, MapPin, AlertCircle, BookOpen, ShoppingCart,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Barcode from '../../../shared/components/Barcode';
import DatePicker from '../../../shared/components/DatePicker';
import {
  TransactionPageLayout, TransactionHeader, FormSectionCard, SummaryCardsRow,
} from '../../../core/layout';

const fmt  = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtD = v => {
  if (!v) return '—';
  const dt = new Date(typeof v === 'string' && !v.includes('T') ? `${v}T00:00:00` : v);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--g100)', padding: '7px 0', gap: 8 }}>
      <span style={{ minWidth: 210, fontSize: 12, color: 'var(--g500)', fontWeight: 600, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontFamily: mono ? 'var(--mono)' : 'inherit' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

const TABS = [
  { key: 'summary',      label: 'Summary' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'dispose',      label: 'Dispose' },
];

export default function FixedAssetDetail() {
  const { id }   = useParams();
  const { get, post } = useApi();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isAdmin  = hasRole('admin', 'super_admin');
  
  const roleString = String(user?.role || '').trim().toLowerCase();
  const isSuperAdmin = roleString === 'super_admin' || roleString === 'superadmin' || roleString === 'super admin';
  const isAdminRole = roleString === 'admin';
  const explicitAssetEdit = user?.permissions?.find(p => ['assets', 'fixed_assets', 'fixed-assets'].includes(p.module) && p.permission_key === 'edit')?.allowed ||
                            user?.rbac_permissions?.some(p => ['assets', 'fixed_assets', 'fixed-assets'].includes(p.module) && (parseInt(p.mask) & 4) === 4);
  const canEditAsset = isSuperAdmin || (isAdminRole && explicitAssetEdit);

  const [asset,     setAsset]     = useState(null);
  const [schedule,  setSchedule]  = useState(null);
  const [txns,      setTxns]      = useState(null);
  const [tab,       setTab]       = useState('summary');
  const [loading,   setLoading]   = useState(true);
  const [dispForm,  setDispForm]  = useState({ disposal_date: '', disposal_value: '', remarks: '' });
  const [disposing, setDisposing] = useState(false);

  console.log('[DEBUG ASSET PAGE]', { roleString, isSuperAdmin, isAdminRole, explicitAssetEdit, canEditAsset, user });

  useEffect(() => {
    setLoading(true);
    setAsset(null);
    setSchedule(null);
    setTxns(null);
    get(`/api/fixed-assets/${id}`)
      .then(setAsset)
      .catch(() => toast.error('Failed to load asset'))
      .finally(() => setLoading(false));
  }, [id, get]);

  useEffect(() => {
    if (tab === 'depreciation' && !schedule) {
      get(`/api/fixed-assets/${id}/schedule?months=24`)
        .then(setSchedule)
        .catch(() => toast.error('Failed to load depreciation schedule'));
    }
    if (tab === 'transactions' && txns === null) {
      get(`/api/fixed-assets/${id}/transactions`)
        .then(r => setTxns(r.data || []))
        .catch(() => toast.error('Failed to load transactions'));
    }
  }, [tab, id, get]);

  const handleDispose = async () => {
    if (!dispForm.disposal_date) return toast.error('Disposal date required');
    if (!window.confirm('Dispose this asset? This posts a permanent JE and cannot be undone.')) return;
    setDisposing(true);
    try {
      const r = await post(`/api/fixed-assets/${id}/dispose`, dispForm);
      toast.success(`Disposed — JE ${r.je_number}. Gain/Loss: ₹${r.gain_loss.toLocaleString('en-IN')}`);
      navigate('/assets');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDisposing(false);
    }
  };

  if (loading) return <div className="empty-state"><div className="spinner" /></div>;
  if (!asset)  return <div style={{ padding: 20 }}>Asset not found.</div>;

  const wdv = parseFloat(asset.purchase_cost) - parseFloat(asset.accumulated_depreciation);
  const depreciationPct = asset.purchase_cost > 0
    ? Math.round((asset.accumulated_depreciation / asset.purchase_cost) * 100)
    : 0;

  const headerAudit = [
    asset.category_name,
    asset.serial_no ? `S/N: ${asset.serial_no}` : null,
    asset.location_name,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <div style={{ background: 'red', color: 'white', padding: 10, textAlign: 'center', fontWeight: 'bold' }}>
        DEBUG INFO: role={user?.role} | isSuperAdmin={String(isSuperAdmin)} | canEditAsset={String(canEditAsset)} | explicit={String(explicitAssetEdit)}
      </div>
      <TransactionPageLayout
        header={
        <TransactionHeader
          title={`${asset.asset_code} — ${asset.asset_name}`}
          icon={<Landmark size={18} />}
          badge={{ label: asset.status, className: `b-${asset.status === 'active' ? 'active' : 'draft'}` }}
          breadcrumbs={[
            { label: 'Fixed Assets', href: '/assets' },
            { label: 'Assets', href: '/assets' },
            { label: asset.asset_code || 'View' },
          ]}
          backTo="/assets"
          backLabel="Assets"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {canEditAsset && (
                <button
                  className="btn btn-sm btn-primary"
                  title="Edit Asset"
                  onClick={() => navigate(`/assets/${asset.id}/edit`)}
                >
                  Edit
                </button>
              )}
              <Barcode value={asset.asset_code} width={1.2} height={36} fontSize={9} />
              <button
                className="btn btn-sm"
                title="Print barcode label"
                onClick={() => window.open(`/labels/print?ids=${asset.id}&type=fixed_asset`, '_blank')}
              >
                <Printer size={12} /> Label
              </button>
            </div>
          }
          auditMeta={headerAudit || undefined}
        />
      }
    >

      {/* ── WDV summary cards ─ */}
      <SummaryCardsRow cards={[
        { label: 'Purchase Cost', value: fmt(asset.purchase_cost), variant: 'highlight' },
        { label: 'Accum Depreciation', value: fmt(asset.accumulated_depreciation), variant: 'danger' },
        { label: 'Net Book Value Today', value: fmt(wdv), variant: 'highlight' },
      ]} />

      {/* Depreciation progress bar */}
      <div style={{ padding: '10px 18px', background: 'var(--g50)', border: '1px solid var(--g200)',
                    borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--g600)', marginBottom: 6 }}>
          Depreciation Progress
        </div>
        <div style={{ height: 8, background: 'var(--g200)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(depreciationPct, 100)}%`,
                        background: depreciationPct >= 90 ? 'var(--red)' : 'var(--brand)',
                        borderRadius: 4, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: 'var(--g700)' }}>
          {depreciationPct}% depreciated
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ borderBottom: '1px solid var(--g200)', marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: 'none', background: 'transparent',
              borderBottom: tab === t.key ? '2px solid var(--brand)' : '2px solid transparent',
              color: tab === t.key ? 'var(--brand-dark)' : 'var(--g500)',
              transition: 'color 0.15s',
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════ TAB: SUMMARY ═══════ */}
      {tab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {asset.template_name && (
            <div style={{ padding: '10px 14px', background: '#EEF2FF', borderRadius: 8,
                          border: '1px solid #C7D2FE',
                          display: 'flex', alignItems: 'center', gap: 10 }}>
              <BookOpen size={16} style={{ color: '#4338CA', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#312E81' }}>
                  Asset Template: {asset.template_name}
                </div>
                <div style={{ fontSize: 11, color: '#6366F1', marginTop: 1 }}>
                  Code: {asset.template_code} — standardized asset classification
                </div>
              </div>
            </div>
          )}

          <FormSectionCard title="Asset Identification" icon={<Tag size={13} />}>
            <InfoRow label="Asset Code"        value={asset.asset_code}   mono />
            <InfoRow label="Asset Name"        value={asset.asset_name} />
            <InfoRow label="Category"          value={asset.category_name} />
            <InfoRow label="Serial No"         value={asset.serial_no}    mono />
            <InfoRow label="Model No"          value={asset.model_no} />
            <InfoRow label="Brand / Make"      value={asset.brand} />
            <InfoRow label="Manufacturer"      value={asset.manufacturer} />
            <InfoRow label="Asset Tag"         value={asset.asset_tag}    mono />
            <InfoRow label="Condition"         value={asset.condition} />
            <InfoRow label="Quantity"          value={asset.qty ? `${asset.qty} ${asset.uom_code || 'NOS'}` : '1 NOS'} />
          </FormSectionCard>

          <FormSectionCard title="Purchase & Dates" icon={<ShoppingCart size={13} />}>
            <InfoRow label="Purchase Date"     value={fmtD(asset.purchase_date)} />
            <InfoRow label="In Service Date"   value={fmtD(asset.in_service_date)} />
            <InfoRow label="Installation Date" value={fmtD(asset.installation_date)} />
            <InfoRow label="Invoice No"        value={asset.invoice_no} />
            <InfoRow label="Invoice Date"      value={fmtD(asset.invoice_date)} />
            <InfoRow label="Warranty Expiry"   value={fmtD(asset.warranty_expiry)} />
            <InfoRow label="Vendor"            value={asset.vendor_name} />
          </FormSectionCard>

          <FormSectionCard title="GST Details" icon={<FileText size={13} />}>
            <InfoRow label="Taxable Value"       value={fmt(asset.taxable_value)} />
            <InfoRow label="CGST"                value={fmt(asset.cgst_amount)} />
            <InfoRow label="SGST"                value={fmt(asset.sgst_amount)} />
            <InfoRow label="IGST"                value={fmt(asset.igst_amount)} />
            <InfoRow label="GST Treatment"       value={asset.gst_treatment?.replace('_', ' ')} />
            <InfoRow label="Claimable GST"       value={fmt(asset.gst_claimable_amount)} />
            <InfoRow label="Non-Claimable GST"   value={fmt(asset.gst_non_claimable_amount)} />
            <InfoRow label="Total Invoice Value" value={fmt(asset.total_invoice_value)} />
          </FormSectionCard>

          <FormSectionCard title="Organization & Accounting" icon={<MapPin size={13} />}>
            <InfoRow label="Location"           value={asset.location_name} />
            <InfoRow label="Department"         value={asset.department_name} />
            <InfoRow label="Custodian"          value={asset.custodian} />
            <InfoRow label="Purchase Cost"      value={fmt(asset.purchase_cost)} />
            <InfoRow label="Salvage Value"      value={fmt(asset.salvage_value)} />
            <InfoRow label="Depreciation Rate"  value={`${asset.depreciation_rate_pct}% per annum (${asset.depreciation_method})`} />
            <InfoRow label="Useful Life"        value={asset.useful_life_years ? `${asset.useful_life_years} years` : '—'} />
            <InfoRow label="GL Asset Account"   value={asset.gl_asset_name ? `${asset.gl_asset_code} — ${asset.gl_asset_name}` : '—'} />
            {asset.purchase_note_number && (
              <InfoRow
                label="Purchase Note"
                value={
                  <span
                    className="cell-link"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/purchase-notes/${asset.purchase_note_id}`)}
                  >
                    {asset.purchase_note_number}
                  </span>
                }
              />
            )}
            {asset.disposal_date && (
              <>
                <InfoRow label="Disposal Date"  value={fmtD(asset.disposal_date)} />
                <InfoRow label="Disposal Value" value={fmt(asset.disposal_value)} />
              </>
            )}
            <InfoRow label="Remarks" value={asset.remarks} />
          </FormSectionCard>
        </div>
      )}

      {/* ═══════ TAB: TRANSACTIONS ═══════ */}
      {tab === 'transactions' && (
        <FormSectionCard title="Asset Transactions" icon={<FileText size={13} />} noPad>
          {txns === null ? (
            <div className="empty-state"><div className="spinner" /></div>
          ) : txns.length === 0 ? (
            <div className="empty-state">
              <FileText size={36} />
              <p>No transactions found for this asset.</p>
            </div>
          ) : (
            <table className="dgrid" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Date</th>
                  <th style={{ width: 110 }}>JE Number</th>
                  <th>Description</th>
                  <th style={{ width: 120 }}>Event Type</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Amount</th>
                  <th style={{ width: 70 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t, i) => {
                  const eventLabel = {
                    fixed_asset_purchase: 'Purchase',
                    disposal:             'Disposal',
                    depreciation:         'Depreciation',
                  }[t.source_type] || t.source_type;

                  const badgeClass = {
                    Purchase:    'b-stock',
                    Disposal:    'b-cancelled',
                    Depreciation:'b-process',
                  }[eventLabel] || 'b-draft';

                  return (
                    <tr key={`${t.id}-${i}`}>
                      <td>{fmtD(t.date)}</td>
                      <td>
                        <Link
                          to={`/journal-entries/${t.id}`}
                          className="cell-link"
                          style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
                        >
                          {t.je_number}
                        </Link>
                      </td>
                      <td style={{ color: 'var(--g600)' }}>{t.description}</td>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ fontSize: 10 }}>
                          {eventLabel}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {fmt(t.amount)}
                      </td>
                      <td>
                        <span className={`badge b-${t.status === 'posted' ? 'active' : 'draft'}`}
                              style={{ fontSize: 10 }}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </FormSectionCard>
      )}

      {/* ═══════ TAB: DEPRECIATION ═══════ */}
      {tab === 'depreciation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {asset.depreciation_history?.length > 0 && (
            <FormSectionCard title="Posted Depreciation History" icon={<TrendingDown size={13} />} noPad>
              <table className="dgrid" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Run No</th>
                    <th style={{ width: 105 }}>Period From</th>
                    <th style={{ width: 105 }}>Period To</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Opening WDV</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Depreciation</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Closing WDV</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.depreciation_history.map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{h.run_number}</td>
                      <td>{fmtD(h.period_from)}</td>
                      <td>{fmtD(h.period_to)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(h.opening_wdv)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                        {fmt(h.depreciation_amount)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {fmt(h.closing_wdv)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FormSectionCard>
          )}

          <FormSectionCard title="Projected — Next 24 Months" icon={<TrendingDown size={13} />} noPad>
            {!schedule ? (
              <div className="empty-state"><div className="spinner" /></div>
            ) : (
              <table className="dgrid" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th style={{ width: 55, textAlign: 'right' }}>Days</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Opening WDV</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Depreciation</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Closing WDV</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Accum After</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.schedule.filter(s => !s.skipped).map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11 }}>{fmtD(s.period_from)} – {fmtD(s.period_to)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{s.days_in_period}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(s.opening_wdv)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                        {fmt(s.depreciation_amount)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                        {fmt(s.closing_wdv)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g500)' }}>
                        {fmt(s.accumulated_after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </FormSectionCard>
        </div>
      )}

      {/* ═══════ TAB: DISPOSE ═══════ */}
      {tab === 'dispose' && (
        <FormSectionCard title="Dispose Asset" icon={<Trash2 size={13} />}>
          {asset.status !== 'active' ? (
            <div style={{ padding: 16, background: 'var(--g100)', borderRadius: 8,
                          color: 'var(--g600)', fontSize: 13 }}>
              This asset has already been disposed / written off.
            </div>
          ) : !isAdmin ? (
            <div style={{ padding: 16, background: '#FFF3E0', borderRadius: 8,
                          color: '#E65100', fontSize: 13 }}>
              Admin access required to dispose assets.
            </div>
          ) : (
            <>
              <div style={{ padding: 12, background: '#FFF3E0', border: '1px solid #FFCC80',
                            borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#E65100',
                            display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <strong>Warning:</strong> Disposal posts a permanent, irrevocable JE and marks
                  the asset as disposed. Ensure depreciation is up-to-date before proceeding.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px', border: '1px solid var(--g200)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Disposal Details
                  </div>
                  <div className="fg">
                    <label>Disposal Date *</label>
                    <DatePicker value={dispForm.disposal_date}
                      onChange={v => setDispForm(p => ({ ...p, disposal_date: v }))} />
                  </div>
                  <div className="fg">
                    <label>Disposal Proceeds (₹)</label>
                    <input type="number" value={dispForm.disposal_value} placeholder="0 for write-off"
                      onChange={e => setDispForm(p => ({ ...p, disposal_value: e.target.value }))} />
                  </div>
                  <div className="fg">
                    <label>Remarks</label>
                    <input value={dispForm.remarks}
                      onChange={e => setDispForm(p => ({ ...p, remarks: e.target.value }))} />
                  </div>
                </div>
                <div style={{ flex: '0 0 250px', border: '1px solid var(--g200)', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Financial Impact
                    </div>
                    <div style={{ padding: 10, background: 'var(--g50)', borderRadius: 6, fontSize: 13, color: 'var(--g600)' }}>
                      <div>Current NBV: <strong>{fmt(wdv)}</strong></div>
                      <div>
                        Est. {(parseFloat(dispForm.disposal_value) || 0) >= wdv ? 'Gain' : 'Loss'}:{' '}
                        <strong style={{ color: (parseFloat(dispForm.disposal_value) || 0) >= wdv ? 'var(--green)' : 'var(--red)' }}>
                          {fmt(Math.abs((parseFloat(dispForm.disposal_value) || 0) - wdv))}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={handleDispose}
                    disabled={disposing}
                    style={{ background: 'var(--red)', border: 'none' }}
                  >
                    <Trash2 size={14} /> {disposing ? 'Processing...' : 'Dispose Asset & Post JE'}
                  </button>
                </div>
              </div>
            </>
          )}
        </FormSectionCard>
      )}
    </TransactionPageLayout>
    </>
  );
}
