import { useState, useEffect, Fragment, useRef } from 'react';
import Paginator from '../../../shared/components/Paginator';
import { useApi } from '../../../shared/hooks/useApi';
import { useNavigate } from 'react-router-dom';
import { TrendingDown, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../core/context/AuthContext';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';

const fmt     = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-IN') : '—';

export default function DepreciationRuns() {
  const api      = useApi();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'depreciation_runs');
  const [data,    setData]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [detail,   setDetail]   = useState(null);

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = async (pg = 1) => {
    setLoading(true);
    try {
      const r = await api.get(`/api/depreciation-runs?page=${pg}&pageSize=${PAGE_SIZE}`);
      setData(r.data || []);
      setTotal(r.totalCount ?? r.total ?? 0);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(page); }, [page]);

  const loadDetail = async (id) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    try {
      const r = await api.get(`/api/depreciation-runs/${id}`);
      setDetail(r);
      setExpanded(id);
    } catch { toast.error('Failed to load run detail'); }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this depreciation run? A reversal JE will be posted.')) return;
    try {
      const r = await api.post(`/api/depreciation-runs/${id}/cancel`);
      toast.success(`Run cancelled — reversal JE ${r.reversal_je_number}`);
      load();
      setExpanded(null);
    } catch (err) { toast.error(err.message); }
  };

  const statusColor = s => s === 'posted' ? 'b-active' : s === 'cancelled' ? 'b-draft' : 'b-open';

  return (
    <div className="grid-page">

      <div className="page-header">
        <div className="page-title">
          <TrendingDown size={16} /> Depreciation Runs
        </div>
        <div className="page-actions">
          {canEdit() && (
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/depreciation-runs/new')} style={{ height: 32.73 }}>
              <Plus size={13} /> New Depreciation
            </button>
          )}
        </div>
      </div>

      {loading && <div className="empty-state"><div className="spinner" /></div>}

      {!loading && (
        <>
          <div ref={tableWrapRef}>
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Run #</th>
                <th style={{ width: 110 }}>Period From</th>
                <th style={{ width: 110 }}>Period To</th>
                <th style={{ width: 80, textAlign: 'right' }}>Assets</th>
                <th style={{ width: 130, textAlign: 'right' }}>Total Depr (₹)</th>
                <th style={{ width: 110 }}>JE #</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.map(run => (
                // Fragment with key — required when mapping multiple sibling rows
                <Fragment key={run.id}>
                  <tr style={{ cursor: 'pointer' }} onDoubleClick={() => loadDetail(run.id)}>
                    <td><span className="cell-link">{run.run_number}</span></td>
                    <td>{fmtDate(run.period_from)}</td>
                    <td>{fmtDate(run.period_to)}</td>
                    <td className="num">{run.lines_count}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmt(run.total_amount)}</td>
                    <td style={{ fontSize: 11, color: 'var(--brand-dark)' }}>{run.je_number || '—'}</td>
                    <td><span className={`badge ${statusColor(run.status)}`}>{run.status}</span></td>
                    <td>
                      {run.status === 'posted' && canEdit() && (
                        <button
                          className="btn btn-sm"
                          style={{ fontSize: 10, padding: '2px 8px', background: '#FFEBEE', color: 'var(--red)', border: '1px solid #EF9A9A' }}
                          onClick={e => { e.stopPropagation(); handleCancel(run.id); }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>

                  {expanded === run.id && detail && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: 'var(--g50)' }}>
                        <div style={{ padding: 12 }}>
                          <table className="dgrid" style={{ fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>Asset Code</th>
                                <th>Asset Name</th>
                                <th>Category</th>
                                <th style={{ textAlign: 'right' }}>Opening WDV</th>
                                <th style={{ textAlign: 'right' }}>Depr Amount</th>
                                <th style={{ textAlign: 'right' }}>Closing WDV</th>
                                <th style={{ textAlign: 'right' }}>Days</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lines?.map((l, i) => (
                                <tr key={i}>
                                  <td>{l.asset_code}</td>
                                  <td>{l.asset_name}</td>
                                  <td>{l.category_name}</td>
                                  <td className="num">{fmt(l.opening_wdv)}</td>
                                  <td className="num" style={{ color: 'var(--red)' }}>{fmt(l.depreciation_amount)}</td>
                                  <td className="num" style={{ fontWeight: 600 }}>{fmt(l.closing_wdv)}</td>
                                  <td className="num">{l.days_in_period}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr style={{ background: 'var(--brand-50)', fontWeight: 700 }}>
                                <td colSpan={4} style={{ textAlign: 'right', color: 'var(--brand-dark)' }}>Total</td>
                                <td className="num" style={{ color: 'var(--red)', fontSize: 13 }}>{fmt(run.total_amount)}</td>
                                <td colSpan={2}></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {data.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--g400)', padding: 20 }}>
                    No depreciation runs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Centered Paginator in table footer */}
          {data.length > 0 && (
            <div className="grid-footer">
              <div className="grid-footer-left">
                <span>Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} records</span>
              </div>
              <div className="grid-footer-center">
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
              <div className="grid-footer-right"></div>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
