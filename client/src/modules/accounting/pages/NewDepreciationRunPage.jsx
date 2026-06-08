import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import DatePicker from '../../../shared/components/DatePicker';
import { ArrowLeft, Search, Save, TrendingDown } from 'lucide-react';
import toast from 'react-hot-toast';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';

function prevMonth() {
  const d    = new Date();
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const to   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 86400000);
  return {
    from: from.toISOString().split('T')[0],
    to:   to.toISOString().split('T')[0],
  };
}

export default function NewDepreciationRun() {
  const api      = useApi();
  const navigate = useNavigate();
  const def      = prevMonth();

  const [periodFrom, setPeriodFrom] = useState(def.from);
  const [periodTo,   setPeriodTo]   = useState(def.to);
  const [remarks,    setRemarks]    = useState('');
  const [preview,    setPreview]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [posting,    setPosting]    = useState(false);

  const handlePreview = async () => {
    if (!periodFrom || !periodTo) return toast.error('Select period');
    setLoading(true);
    setPreview(null);
    try {
      const r = await api.post('/api/depreciation-runs/preview', { period_from: periodFrom, period_to: periodTo });
      setPreview(r);
      if (r.lines.length === 0) toast('No assets with depreciable amount for this period', { icon: 'ℹ️' });
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const handlePost = async () => {
    if (!preview?.lines?.length) return toast.error('Run preview first');
    if (!window.confirm(`Post depreciation run for ${preview.lines.length} assets totalling ${fmt(preview.total)}? This will update asset WDVs and post a JE.`)) return;
    setPosting(true);
    try {
      const r = await api.post('/api/depreciation-runs', { period_from: periodFrom, period_to: periodTo, remarks });
      toast.success(`Run ${r.run_number} posted — JE ${r.je_number}`);
      navigate('/depreciation-runs');
    } catch (err) { toast.error(err.message); }
    finally { setPosting(false); }
  };

  return (
    <div style={{ padding: 20, maxWidth: 900 }} className="animate-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-sm" onClick={() => navigate('/depreciation-runs')}><ArrowLeft size={14} /> Back</button>
        <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingDown size={16} /> New Depreciation Run
        </h2>
      </div>

      {/* Period selector */}
      <div style={{ background: 'var(--g50)', border: '1px solid var(--g200)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div className="form-row">
          <div className="fg"><label>Period From *</label>
            <DatePicker value={periodFrom} onChange={v => { setPeriodFrom(v); setPreview(null); }} />
          </div>
          <div className="fg"><label>Period To *</label>
            <DatePicker value={periodTo} onChange={v => { setPeriodTo(v); setPreview(null); }} />
          </div>
          <div className="fg w"><label>Remarks</label>
            <input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Monthly depreciation run" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={handlePreview} disabled={loading}>
            <Search size={14} /> {loading ? 'Calculating...' : 'Preview'}
          </button>
        </div>
      </div>

      {/* Preview table */}
      {preview && (
        <>
          {preview.lines.length === 0 ? (
            <div style={{ padding: 16, background: 'var(--g100)', borderRadius: 8, color: 'var(--g600)', textAlign: 'center' }}>
              No active assets have depreciable amount for this period.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--g700)' }}>
                  Preview — {preview.lines.length} assets
                </span>
                <div style={{ padding: '6px 14px', background: 'var(--brand-50)', borderRadius: 6,
                              fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)' }}>
                  Total: {fmt(preview.total)}
                </div>
              </div>

              <table className="dgrid" style={{ fontSize: 12, marginBottom: 16 }}>
                <thead><tr>
                  <th>Asset Code</th><th>Asset Name</th><th>Category</th>
                  <th style={{ textAlign: 'right' }}>Opening WDV</th>
                  <th style={{ textAlign: 'right' }}>Days</th>
                  <th style={{ textAlign: 'right' }}>Depreciation</th>
                  <th style={{ textAlign: 'right' }}>Closing WDV</th>
                </tr></thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.asset_code}</td>
                      <td>{l.asset_name}</td>
                      <td>{l.category_name}</td>
                      <td className="num">{fmt(l.opening_wdv)}</td>
                      <td className="num">{l.days_in_period}</td>
                      <td className="num" style={{ color: 'var(--red)', fontWeight: 600 }}>{fmt(l.depreciation_amount)}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{fmt(l.closing_wdv)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                    <td colSpan={5} style={{ textAlign: 'right', color: 'var(--brand-dark)' }}>Total Depreciation</td>
                    <td className="num" style={{ color: 'var(--red)', fontSize: 13 }}>{fmt(preview.total)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>

              <div style={{ padding: 10, background: '#E8F5E9', border: '1px solid #A5D6A7', borderRadius: 8, fontSize: 12, color: '#2E7D32', marginBottom: 12 }}>
                <strong>JE that will be posted:</strong> Dr Depreciation Expense {fmt(preview.total)} / Cr Accumulated Depreciation {fmt(preview.total)}
              </div>

              <button className="btn btn-primary" onClick={handlePost} disabled={posting}
                style={{ background: 'var(--brand)' }}>
                <Save size={14} /> {posting ? 'Posting...' : `Post Run — ${fmt(preview.total)}`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
