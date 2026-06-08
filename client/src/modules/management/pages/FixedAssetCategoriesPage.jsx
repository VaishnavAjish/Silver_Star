import { useState, useEffect } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import Modal from '../../../shared/components/Modal';
import { Plus, Save, Pencil, Trash2, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';

const fmt = v => v != null ? `₹${Number(v).toLocaleString('en-IN')}` : '—';

const EMPTY = {
  code: '', name: '', depreciation_rate_pct: '', depreciation_method: 'SLM',
  useful_life_years: '', gl_asset_account_id: '', gl_accum_depr_account_id: '',
  gl_depr_expense_account_id: '', status: 'active',
};

export default function FixedAssetCategories() {
  const api  = useApi();
  const { canEdit, user } = useAuth();
  const [data, setData]       = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm]       = useState(EMPTY);

  const load = async () => {
    setLoading(true);
    try {
      const [cats, accts] = await Promise.all([
        api.get('/api/fixed-asset-categories'),
        api.get('/api/accounts?is_group=false&status=active'),
      ]);
      setData(cats.data || []);
      setAccounts(accts || []);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit   = (row) => {
    if (!canEdit()) return;
    setEditing(row);
    setForm({
      code: row.code, name: row.name,
      depreciation_rate_pct: row.depreciation_rate_pct,
      depreciation_method: row.depreciation_method,
      useful_life_years: row.useful_life_years || '',
      gl_asset_account_id: row.gl_asset_account_id,
      gl_accum_depr_account_id: row.gl_accum_depr_account_id,
      gl_depr_expense_account_id: row.gl_depr_expense_account_id,
      status: row.status,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await api.put(`/api/fixed-asset-categories/${editing.id}`, form);
        toast.success('Category updated');
      } else {
        await api.post('/api/fixed-asset-categories', form);
        toast.success('Category created');
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try { await api.del(`/api/fixed-asset-categories/${id}`); toast.success('Deleted'); load(); }
    catch (err) { toast.error(err.message); }
  };

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const acctOptions = accounts.map(a => (
    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
  ));

  return (
    <div className="grid-page">

      <DataGrid
        exportTitle="Fixed Asset Categories"
        storageKey="fixed_asset_categories_cols"
        hideExportLabel
        fetchExportData={async () => {
          const r = await api.get('/api/fixed-asset-categories?limit=10000');
          return r.data || r;
        }}
        columns={[
          { key: 'code',  label: 'Code', width: 100 },
          { key: 'name',  label: 'Category Name' },
          { key: 'depreciation_rate_pct', label: 'Rate %', width: 70, numeric: true,
            render: v => `${v}%` },
          { key: 'depreciation_method', label: 'Method', width: 60 },
          { key: 'useful_life_years', label: 'Life (yrs)', width: 80, numeric: true,
            render: v => v || '—' },
          { key: 'gl_asset_name',  label: 'Asset A/c' },
          { key: 'gl_accum_name',  label: 'Accum Depr A/c' },
          { key: 'gl_depr_name',   label: 'Depr Expense A/c' },
          { key: 'status', label: 'Status', width: 80,
            render: v => <span className={`badge b-${v}`}>{v}</span> },
          ...(canEdit() ? [{
            key: '_act', label: '', width: 70,
            render: (_, row) => (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); openEdit(row); }} onDoubleClick={e => e.stopPropagation()}><Pencil size={12} /></button>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); handleDelete(row.id); }} onDoubleClick={e => e.stopPropagation()} style={{ color: 'var(--red)' }}><Trash2 size={12} /></button>
              </div>
            ),
          }] : []),
        ]}
        data={data} loading={loading} onRowDoubleClick={row => setViewing(row)}
        onRefresh={load}
        toolbarActions={canEdit() && (
          <button className="btn btn-primary" onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> New Fixed Asset Category
          </button>
        )}
      />

      <Modal open={!!viewing} onClose={() => setViewing(null)}
        title="Asset Category Details"
        footer={<button className="btn" onClick={() => setViewing(null)}>Close</button>}>
        {viewing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 13 }}>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Code</label><div style={{ fontWeight: 600 }}>{viewing.code}</div></div>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Category Name</label><div>{viewing.name}</div></div>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Rate %</label><div>{viewing.depreciation_rate_pct}%</div></div>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Method</label><div>{viewing.depreciation_method}</div></div>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Life (yrs)</label><div>{viewing.useful_life_years || '—'}</div></div>
            <div><label style={{ fontSize: 11, color: 'var(--g500)' }}>Status</label><div><span className={`badge b-${viewing.status}`}>{viewing.status}</span></div></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 11, color: 'var(--g500)' }}>Asset A/c</label><div>{viewing.gl_asset_name}</div></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 11, color: 'var(--g500)' }}>Accum Depr A/c</label><div>{viewing.gl_accum_name}</div></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: 11, color: 'var(--g500)' }}>Depr Expense A/c</label><div>{viewing.gl_depr_name}</div></div>
          </div>
        )}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)}
        title={editing ? 'Edit Asset Category' : 'New Asset Category'}
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={handleSave}><Save size={14} /> Save</button></>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {[['code','Code *',true],['name','Category Name *',true,true]].map(([k,l,req,wide])=>(
            <div key={k} className={`fg${wide?' w':''}`} style={{minWidth:wide?'100%':160,display:'flex',flexDirection:'column',gap:3}}>
              <label>{l}</label>
              <input value={form[k]} onChange={e=>set(k,e.target.value)} />
            </div>
          ))}

          <div className="fg" style={{minWidth:160,display:'flex',flexDirection:'column',gap:3}}>
            <label>Depreciation Rate % *</label>
            <input type="number" step="0.01" value={form.depreciation_rate_pct} onChange={e=>set('depreciation_rate_pct',e.target.value)} />
          </div>
          <div className="fg" style={{minWidth:160,display:'flex',flexDirection:'column',gap:3}}>
            <label>Method</label>
            <SelectDropdown value={form.depreciation_method} onChange={e=>set('depreciation_method',e.target.value)}>
              <option value="SLM">SLM — Straight Line</option>
              <option value="WDV">WDV — Written Down Value</option>
            </SelectDropdown>
          </div>
          <div className="fg" style={{minWidth:120,display:'flex',flexDirection:'column',gap:3}}>
            <label>Useful Life (years)</label>
            <input type="number" value={form.useful_life_years} onChange={e=>set('useful_life_years',e.target.value)} />
          </div>
          <div className="fg" style={{minWidth:120,display:'flex',flexDirection:'column',gap:3}}>
            <label>Status</label>
            <SelectDropdown value={form.status} onChange={e=>set('status',e.target.value)}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </SelectDropdown>
          </div>

          {[
            ['gl_asset_account_id',        'Asset GL Account *'],
            ['gl_accum_depr_account_id',   'Accumulated Depr Account *'],
            ['gl_depr_expense_account_id', 'Depreciation Expense Account *'],
          ].map(([k,l])=>(
            <div key={k} className="fg w" style={{minWidth:'100%',display:'flex',flexDirection:'column',gap:3}}>
              <label>{l}</label>
              <SelectDropdown value={form[k]} onChange={e=>set(k,parseInt(e.target.value))}>
                <option value="">— Select Account —</option>
                {acctOptions}
              </SelectDropdown>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
