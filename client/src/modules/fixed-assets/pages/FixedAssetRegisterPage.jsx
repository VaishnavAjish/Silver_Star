import { useState, useEffect } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { Search, Landmark } from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import Modal from '../../../shared/components/Modal';
import toast from 'react-hot-toast';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';

function AssetDetailsPopup({ assetId, onClose }) {
  const api = useApi();
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assetId) return;
    setLoading(true);
    api.get(`/api/fixed-assets/${assetId}`)
      .then(setAsset)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [assetId, api]);

  return (
    <Modal open={true} onClose={onClose} title={`Asset Details: ${asset?.asset_code || ''}`} large>
      {loading ? <div className="spinner" /> : !asset ? <div>Error loading asset</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, background: 'var(--g50)', padding: 16, borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Asset Name</div>
              <div style={{ fontWeight: 600 }}>{asset.asset_name}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Category</div>
              <div style={{ fontWeight: 600 }}>{asset.category_name}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Purchase Date</div>
              <div style={{ fontWeight: 600 }}>{fmtDate(asset.purchase_date)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>In Service Date</div>
              <div style={{ fontWeight: 600 }}>{fmtDate(asset.in_service_date)}</div>
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ background: '#E3F2FD', padding: 12, borderRadius: 6, border: '1px solid #90CAF9' }}>
              <div style={{ fontSize: 11, color: '#0D47A1', fontWeight: 700, textTransform: 'uppercase' }}>Purchase Cost</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0D47A1', fontFamily: 'var(--mono)' }}>{fmt(asset.purchase_cost)}</div>
            </div>
            <div style={{ background: '#FFEBEE', padding: 12, borderRadius: 6, border: '1px solid #EF9A9A' }}>
              <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, textTransform: 'uppercase' }}>Accum. Depreciation</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', fontFamily: 'var(--mono)' }}>{fmt(asset.accumulated_depreciation)}</div>
            </div>
            <div style={{ background: 'var(--brand-50)', padding: 12, borderRadius: 6, border: '1px solid var(--sidebar-border)' }}>
              <div style={{ fontSize: 11, color: 'var(--brand-dark)', fontWeight: 700, textTransform: 'uppercase' }}>WDV Today</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand-dark)', fontFamily: 'var(--mono)' }}>{fmt(asset.wdv_today)}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
             <div>
               <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Depreciation Method</div>
               <div>{asset.depreciation_method} @ {asset.depreciation_rate_pct}%</div>
             </div>
             <div>
               <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Useful Life</div>
               <div>{asset.useful_life_years} Years</div>
             </div>
             <div>
               <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Status</div>
               <div><span className={`badge b-${asset.status === 'active' ? 'active' : 'draft'}`}>{asset.status}</span></div>
             </div>
             <div>
               <div style={{ fontSize: 11, color: 'var(--g500)', textTransform: 'uppercase', fontWeight: 600 }}>Location</div>
               <div>{asset.location_name || '—'}</div>
             </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function FixedAssetRegister() {
  const api = useApi();
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(null);

  const load = async (date) => {
    setLoading(true);
    try {
      const params = date ? `?asOfDate=${date}` : '';
      const r = await api.get(`/api/reports/fixed-asset-register${params}`);
      setData(r);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(asOfDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 20 }} className="animate-in">
      {selectedAssetId && <AssetDetailsPopup assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} />}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Landmark size={18} style={{ color: 'var(--brand)' }} /> Fixed Asset Register
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="fg"><label>As of Date</label>
            <DatePicker value={asOfDate} onChange={v => { setAsOfDate(v); load(v); }} />
          </div>
          <button className="btn btn-primary" onClick={() => load(asOfDate)}><Search size={14} /> Generate</button>
          <button className="btn" onClick={() => setTimeout(() => window.print(), 100)}>🖨 Print</button>
        </div>
      </div>

      <div className="print-only" style={{ display: 'none', textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>SILVERSTAR DIAM PVT. LTD.</div>
        <div style={{ fontWeight: 600 }}>Fixed Asset Register — As of {data?.as_of_date}</div>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {data && !loading && (
        <>
          {/* Grand total summary */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { l: 'Total Cost', v: data.grand_total_cost, color: '#0D47A1', bg: '#E3F2FD', bc: '#90CAF9' },
              { l: 'Accumulated Depr', v: data.grand_total_accum_depr, color: 'var(--red)', bg: '#FFEBEE', bc: '#EF9A9A' },
              { l: 'Net Book Value', v: data.grand_total_wdv, color: 'var(--brand-dark)', bg: 'var(--brand-50)', bc: 'var(--sidebar-border)' },
            ].map((c, i) => (
              <div key={i} style={{ padding: '10px 18px', background: c.bg, border: `1px solid ${c.bc}`, borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: c.color }}>{c.l}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color }}>{fmt(c.v)}</div>
              </div>
            ))}
          </div>

          {data.categories.map(cat => (
            <div key={cat.category_name} style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--brand-dark)',
                            background: 'var(--brand-50)', padding: '6px 12px',
                            borderRadius: '6px 6px 0 0', borderBottom: '2px solid var(--brand)' }}>
                {cat.category_name}
              </div>
              <table className="dgrid" style={{ fontSize: 12, borderRadius: '0 0 6px 6px', marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>Asset Code</th><th>Asset Name</th>
                    <th style={{ width: 100 }}>Purchase Date</th>
                    <th style={{ width: 100 }}>In Service</th>
                    <th style={{ width: 120, textAlign: 'right' }}>Cost (₹)</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Accum Depr (₹)</th>
                    <th style={{ width: 120, textAlign: 'right' }}>WDV (₹)</th>
                    <th style={{ width: 85 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.assets.map((a, i) => (
                    <tr key={i} onDoubleClick={() => a.id && setSelectedAssetId(a.id)} style={{ cursor: a.id ? 'pointer' : 'default' }}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>{a.asset_code}</td>
                      <td style={{ fontWeight: 500 }}>{a.asset_name}</td>
                      <td>{fmtDate(a.purchase_date)}</td>
                      <td>{fmtDate(a.in_service_date)}</td>
                      <td className="num">{fmt(a.purchase_cost)}</td>
                      <td className="num" style={{ color: 'var(--red)' }}>{fmt(a.accumulated_depreciation)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{fmt(a.wdv_as_of)}</td>
                      <td><span className={`badge b-${a.status === 'active' ? 'active' : 'draft'}`}>{a.status}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                    <td colSpan={4} style={{ color: 'var(--brand-dark)', textAlign: 'right' }}>Category Total</td>
                    <td className="num" style={{ color: '#0D47A1' }}>{fmt(cat.total_cost)}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{fmt(cat.total_accum_depr)}</td>
                    <td className="num" style={{ color: 'var(--brand-dark)', fontSize: 13 }}>{fmt(cat.total_wdv)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          {/* Grand total row */}
          <table className="dgrid" style={{ fontSize: 13, background: 'var(--brand-50)', border: '2px solid var(--brand)', borderRadius: 6 }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: 800, color: 'var(--brand-dark)', width: '40%' }}>GRAND TOTAL</td>
                <td className="num" style={{ fontWeight: 700, color: '#0D47A1' }}>{fmt(data.grand_total_cost)}</td>
                <td className="num" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(data.grand_total_accum_depr)}</td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--brand-dark)', fontSize: 15 }}>{fmt(data.grand_total_wdv)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
