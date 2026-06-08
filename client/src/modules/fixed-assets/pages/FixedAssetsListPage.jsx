import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import { useApi } from '../../../shared/hooks/useApi';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import { useNavigate } from 'react-router-dom';
import { Landmark, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../core/context/AuthContext';
import Paginator from '../../../shared/components/Paginator';
import {
  TransactionPageLayout, TransactionHeader, SummaryCardsRow,
} from '../../../core/layout';

const fmt  = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtD = v => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const TH_STYLE = {
  background: 'var(--table-header)',
  borderBottom: '2px solid var(--g200)',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};

const TD_BORDER = { borderBottom: '1px solid var(--g200)' };
const FOOT_STYLE = { background: 'var(--g100)', borderTop: '2px solid var(--g200)', position: 'sticky', bottom: 0, zIndex: 10 };

export default function FixedAssetsList() {
  const { get }  = useApi();
  const navigate = useNavigate();
  const { user } = useAuth();
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'fixed_assets');

  const [data,    setData]    = useState([]);
  const [cats,    setCats]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);

  const [_faf, _setFaf] = usePersistedFilters('fixed_assets_filters', {
    filterStatus: '', filterCat: '', search: '',
  });
  const { filterStatus, filterCat, search } = _faf;
  const setFilterStatus = v => _setFaf(f => ({ ...f, filterStatus: v }));
  const setFilterCat    = v => _setFaf(f => ({ ...f, filterCat:    v }));
  const setSearch       = v => _setFaf(f => ({ ...f, search:       v }));

  const totalCost  = data.reduce((s, r) => s + parseFloat(r.purchase_cost           || 0), 0);
  const totalAccum = data.reduce((s, r) => s + parseFloat(r.accumulated_depreciation || 0), 0);
  const totalWdv   = data.reduce((s, r) => s + parseFloat(r.wdv_today               || 0), 0);

  const load = useCallback(async (q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 5000 });
      if (filterStatus) params.set('status',      filterStatus);
      if (filterCat)    params.set('category_id', filterCat);
      if (q)            params.set('search',       q);

      const [res, catsRes] = await Promise.all([
        get(`/api/fixed-assets?${params}`),
        get('/api/fixed-asset-categories'),
      ]);
      setData(res.data   || []);
      setTotal(res.total || 0);
      setCats(catsRes.data || []);
    } catch {
      toast.error('Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCat, get]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, filterStatus, filterCat, load]);

  const statusBadge = s =>
    s === 'active'   ? 'b-active'  :
    s === 'disposed' ? 'b-draft'   : 'b-cancelled';

  const { page, setPage, paginatedItems, totalPages } = usePagination(data, [], 50);

  return (
    <TransactionPageLayout
      header={
        <TransactionHeader
          title="Fixed Asset Register"
          icon={<Landmark size={18} />}
          subtitle={`${total} assets`}
          breadcrumbs={[
            { label: 'Fixed Assets', href: '/assets' },
            { label: 'Register' },
          ]}
          actions={
            ['admin', 'super_admin'].includes(user?.role) && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => navigate('/asset-templates')}>
                  Asset Templates
                </button>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/assets/new')}>
                  <Plus size={14} /> New Asset
                </button>
              </div>
            )
          }
        />
      }
    >
      {/* Summary cards */}
      {!loading && data.length > 0 && (
        <SummaryCardsRow cards={[
          { label: 'Total Cost',          value: fmt(totalCost),  variant: 'highlight' },
          { label: 'Accum Depreciation',  value: fmt(totalAccum), variant: 'danger'    },
          { label: 'Net Book Value',       value: fmt(totalWdv),  variant: 'highlight' },
        ]} />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
          <Search size={13} style={{
            position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--g400)', pointerEvents: 'none',
          }} />
          <input
            placeholder="Search name, code, serial, tag..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 28, width: '100%', fontSize: 12 }}
          />
        </div>
        <SelectDropdown value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Categories</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectDropdown>
        <SelectDropdown value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="disposed">Disposed</option>
          <option value="written_off">Written Off</option>
        </SelectDropdown>
        {(search || filterCat || filterStatus) && (
          <button
            type="button"
            className="btn btn-danger"
            style={{ padding: '6px 12px', height: 31 }}
            onClick={() => { setSearch(''); setFilterCat(''); setFilterStatus(''); }}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="empty-state"><div className="spinner" /></div>
      ) : data.length === 0 ? (
        <div className="empty-state">
          <Landmark size={40} />
          <p>No assets found{search ? ` for "${search}"` : ''}.</p>
          {['admin', 'super_admin'].includes(user?.role) && !search && (
            <button className="btn btn-primary" onClick={() => navigate('/assets/new')}>
              <Plus size={14} /> Add First Asset
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            ref={tableWrapRef}
            style={{
              flex: 1, minHeight: 0, overflowY: 'auto',
              border: '1px solid var(--g200)', borderRadius: 8,
            }}
          >
            <table
              className="dgrid"
              style={{ fontSize: 12, margin: 0, width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}
            >
              <thead>
                <tr>
                  <th style={{ ...TH_STYLE, width: 130 }}>Asset Code</th>
                  <th style={{ ...TH_STYLE }}>Asset / Template</th>
                  <th style={{ ...TH_STYLE, width: 140 }}>Category</th>
                  <th style={{ ...TH_STYLE, width: 110 }}>Serial No</th>
                  <th style={{ ...TH_STYLE, width: 95  }}>Purchase Date</th>
                  <th style={{ ...TH_STYLE, width: 115, textAlign: 'right' }}>Cost</th>
                  <th style={{ ...TH_STYLE, width: 115, textAlign: 'right' }}>Accum Depr</th>
                  <th style={{ ...TH_STYLE, width: 115, textAlign: 'right' }}>WDV</th>
                  <th style={{ ...TH_STYLE, width: 110 }}>Location</th>
                  <th style={{ ...TH_STYLE, width: 80  }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((row, idx) => (
                  <tr
                    key={row.id}
                    style={{
                      cursor: 'pointer',
                      background: idx % 2 === 1 ? 'var(--table-alt)' : '#fff',
                    }}
                    onClick={() => navigate(`/assets/${row.id}`)}
                  >
                    <td style={{ ...TD_BORDER, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--brand)' }}>
                      {row.asset_code}
                    </td>
                    <td style={TD_BORDER}>
                      {row.template_name ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{row.template_name}</div>
                          {row.asset_name !== row.template_name && (
                            <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 1 }}>
                              {row.asset_name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontWeight: 500 }}>
                          {row.asset_name}
                          {row.brand && (
                            <span style={{ fontSize: 10, color: 'var(--g500)', marginLeft: 6 }}>
                              {row.brand}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ ...TD_BORDER, color: 'var(--g600)' }}>{row.category_name || '—'}</td>
                    <td style={{ ...TD_BORDER, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g500)' }}>
                      {row.serial_no || '—'}
                    </td>
                    <td style={TD_BORDER}>{fmtD(row.purchase_date)}</td>
                    <td style={{ ...TD_BORDER, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                      {fmt(row.purchase_cost)}
                    </td>
                    <td style={{ ...TD_BORDER, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                      {fmt(row.accumulated_depreciation)}
                    </td>
                    <td style={{ ...TD_BORDER, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--brand-dark)' }}>
                      {fmt(row.wdv_today)}
                    </td>
                    <td style={{ ...TD_BORDER, fontSize: 11, color: 'var(--g500)' }}>
                      {row.location_name || '—'}
                    </td>
                    <td style={TD_BORDER}>
                      <span className={`badge ${statusBadge(row.status)}`} style={{ fontSize: 10 }}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals footer */}
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={5} style={{ ...FOOT_STYLE, textAlign: 'right', fontSize: 12, color: 'var(--g600)', paddingRight: 12 }}>
                    Total ({data.length} asset{data.length !== 1 ? 's' : ''})
                  </td>
                  <td style={{ ...FOOT_STYLE, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                    {fmt(totalCost)}
                  </td>
                  <td style={{ ...FOOT_STYLE, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)' }}>
                    {fmt(totalAccum)}
                  </td>
                  <td style={{ ...FOOT_STYLE, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--brand-dark)', fontWeight: 700 }}>
                    {fmt(totalWdv)}
                  </td>
                  <td colSpan={2} style={FOOT_STYLE} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'flex-start', background: '#fff' }}>
            <Paginator page={page} totalPages={totalPages} onPage={setPage} />
          </div>
        </>
      )}
    </TransactionPageLayout>
  );
}
