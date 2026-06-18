import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePersistedFilters } from '../../../shared/hooks/usePersistedFilters';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useApi } from '../../../shared/hooks/useApi';
import { useProcessMasterSync } from '../../../shared/hooks/useModuleSync';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import toast from 'react-hot-toast';
import { Plus, Edit2, Search, X, Settings, Check, Layers } from 'lucide-react';

// ── Category config ───────────────────────────────────────────────────────────
const CATEGORY_CFG = {
  PRIMARY: { color: '#7B1FA2', bg: '#F3E5F5', label: 'Primary'  },
  SUPPORT: { color: '#1565C0', bg: '#E3F2FD', label: 'Support'  },
  QC:      { color: '#00695C', bg: '#E0F2F1', label: 'QC'       },
  OTHER:   { color: '#616161', bg: '#F5F5F5', label: 'Other'    },
};

const OUTPUT_CFG = {
  ROUGH:    { color: '#4527A0', bg: '#EDE7F6' },
  POLISHED: { color: '#1565C0', bg: '#E3F2FD' },
  NONE:     { color: '#757575', bg: '#F5F5F5' },
  CUSTOM:   { color: '#00695C', bg: '#E0F2F1' },
};

const CATEGORIES   = Object.keys(CATEGORY_CFG);
const OUTPUT_TYPES = Object.keys(OUTPUT_CFG);

const BOOL_FLAGS = [
  { key: 'requires_inventory',      label: 'Inv.',     title: 'Requires Inventory'     },
  { key: 'requires_machine',        label: 'Mach.',    title: 'Requires Machine'        },
  { key: 'requires_operator',       label: 'Op.',      title: 'Requires Operator'       },
  { key: 'requires_runtime',        label: 'RT',       title: 'Requires Runtime'        },
  { key: 'requires_expected_yield', label: 'Yield',    title: 'Requires Expected Yield' },
  { key: 'allows_consumables',      label: 'Cons.',    title: 'Allows Consumables'      },
];

// ── Reusable badge ────────────────────────────────────────────────────────────
function Badge({ color, bg, children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, background: bg, color,
    }}>
      {children}
    </span>
  );
}

function BoolBadge({ value, title }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 4,
      background: value ? '#E8F5E9' : '#F5F5F5',
      color: value ? '#2E7D32' : '#BDBDBD',
      fontSize: 10,
    }}>
      {value ? <Check size={11} /> : '—'}
    </span>
  );
}

// ── Blank form ────────────────────────────────────────────────────────────────
const BLANK = {
  process_code: '', process_name: '', category: 'PRIMARY',
  requires_inventory: true, requires_machine: true,
  requires_operator: false, requires_runtime: false,
  requires_expected_yield: false, allows_consumables: false,
  output_type: 'NONE', default_runtime_hours: '', sort_order: '0',
  active: true, process_group: 'LASER', eligible_machine_type: 'LASER'
};

// ── Edit/Create Modal ─────────────────────────────────────────────────────────
function ProcessModal({ initial, isNew, onSave, onClose }) {
  const [form,   setForm]   = useState({ ...BLANK, ...initial });
  const [saving, setSaving] = useState(false);

  const set = k => v => setForm(f => ({ ...f, [k]: v }));
  const setE = k => e => set(k)(e.target.value);

  const inp = {
    width: '100%', padding: '6px 8px', height: 34,
    borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box',
    border: '1px solid var(--g300)',
  };
  const lbl = {
    fontSize: 11, fontWeight: 600, color: 'var(--g600)',
    display: 'block', marginBottom: 4,
  };
  const chkRow = (key, label) => {
    const isChecked = !!form[key];
    return (
      <div key={key} onClick={() => setForm(f => ({ ...f, [key]: !f[key] }))} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', padding: '6px 10px',
        borderRadius: 6, background: isChecked ? '#E8F5E9' : '#FAFAFA',
        border: `1px solid ${isChecked ? '#A5D6A7' : 'var(--g200)'}`,
      }}>
        <input type="checkbox" checked={isChecked} readOnly style={{ cursor: 'pointer' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: isChecked ? '#2E7D32' : 'var(--g600)' }}>
          {BOOL_FLAGS.find(f => f.key === key)?.title || key}
        </span>
      </div>
    );
  };

  const handleSave = async () => {
    if (!form.process_code.trim() || !form.process_name.trim()) {
      toast.error('Code and Name are required'); return;
    }
    if (form.process_group === 'GROWTH' && form.eligible_machine_type !== 'CVD_REACTOR') {
      toast.error('GROWTH processes must use CVD_REACTOR machines'); return;
    }
    if (form.process_group === 'LASER' && form.eligible_machine_type !== 'LASER') {
      toast.error('LASER processes must use LASER machines'); return;
    }
    setSaving(true);
    await onSave({
      ...form,
      default_runtime_hours: form.default_runtime_hours ? parseFloat(form.default_runtime_hours) : null,
      sort_order: parseInt(form.sort_order) || 0,
    });
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
            <Settings size={15} color="var(--brand)" />
            {isNew ? 'New Process Type' : `Edit — ${initial.process_name}`}
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 130px)' }}>

          {/* Form Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div>
              <label style={lbl}>Process Code *</label>
              <input
                style={{ ...inp, fontFamily: 'var(--mono)', textTransform: 'lowercase' }}
                value={form.process_code}
                onChange={setE('process_code')}
                disabled={!isNew}
                placeholder="e.g. growth"
              />
              {!isNew && (
                <div style={{ fontSize: 10, color: 'var(--g400)', marginTop: 3 }}>
                  Code cannot be changed — existing records reference it
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>Process Name *</label>
              <input style={inp} value={form.process_name} onChange={setE('process_name')} placeholder="e.g. Growth" />
            </div>

            <div>
              <label style={lbl}>Category</label>
              <SelectDropdown value={form.category} onChange={setE('category')}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_CFG[c].label}</option>)}
              </SelectDropdown>
            </div>
            <div>
              <label style={lbl}>Output Type</label>
              <SelectDropdown value={form.output_type} onChange={setE('output_type')}>
                {OUTPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </SelectDropdown>
            </div>

            <div>
              <label style={lbl}>Process Group</label>
              <SelectDropdown value={form.process_group} onChange={setE('process_group')}>
                <option value="GROWTH">GROWTH</option>
                <option value="LASER">LASER</option>
              </SelectDropdown>
            </div>
            <div>
              <label style={lbl}>Machine Type</label>
              <SelectDropdown value={form.eligible_machine_type} onChange={setE('eligible_machine_type')}>
                <option value="CVD_REACTOR">CVD_REACTOR</option>
                <option value="LASER">LASER</option>
              </SelectDropdown>
            </div>

            <div>
              <label style={lbl}>Sort Order</label>
              <input type="number" min="0" style={inp} value={form.sort_order} onChange={setE('sort_order')} />
            </div>
            <div>
              <label style={lbl}>Default Runtime (hours)</label>
              <input
                type="number" min="0" step="0.5" style={inp}
                value={form.default_runtime_hours} onChange={setE('default_runtime_hours')}
                placeholder="Leave blank for no default"
              />
            </div>

            <div>
              <label style={lbl}>Status</label>
              <div
                onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', padding: '6px 10px',
                  borderRadius: 6, background: form.active ? '#E8F5E9' : '#FFEBEE',
                  border: `1px solid ${form.active ? '#A5D6A7' : '#EF9A9A'}`,
                  height: 34, boxSizing: 'border-box'
                }}>
                <input type="checkbox" checked={!!form.active} readOnly style={{ cursor: 'pointer', margin: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: form.active ? '#2E7D32' : '#C62828' }}>
                  {form.active ? 'Active (ON)' : 'Inactive (OFF)'}
                </span>
              </div>
            </div>
          </div>

          {/* Boolean flags */}
          <div style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '.6px', color: 'var(--brand-dark)',
            borderBottom: '1px solid var(--g200)', paddingBottom: 5, marginBottom: 10,
          }}>
            Behavior Flags
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {BOOL_FLAGS.map(f => chkRow(f.key, f.label))}
          </div>

        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Process'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Process Master Page
// ═════════════════════════════════════════════════════════════════════════════
export default function ProcessMasterPage() {
  const api = useApi();
  const tableWrapRef = useRef(null);
  useResizableColumns(tableWrapRef, 'process_master');

  const [processes,  setProcesses]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [_pmf, _setPmf] = usePersistedFilters('process_master_filters', {
    search: '', catFilter: '', showInactive: false,
  });
  const { search, catFilter, showInactive } = _pmf;
  const setSearch      = v => _setPmf(f => ({ ...f, search:      v }));
  const setCatFilter   = v => _setPmf(f => ({ ...f, catFilter:   v }));
  const setShowInactive = v => _setPmf(f => ({ ...f, showInactive: v }));
  const [modal,      setModal]      = useState(null); // null | { mode: 'new'|'edit', process }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/process-master');
      setProcesses(Array.isArray(res) ? res : (res.data || []));
    } catch { toast.error('Failed to load process master'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  
  useProcessMasterSync(() => {
    load();
  });


  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = processes;
    // When 'Show inactive' is OFF → show only active; when ON → show all (active + inactive)
    if (!showInactive) {
      rows = rows.filter(p => p.active);
    }
    if (catFilter)      rows = rows.filter(p => p.category === catFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(p =>
        p.process_code.includes(s) || p.process_name.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [processes, showInactive, catFilter, search]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = async (form) => {
    try {
      if (modal.mode === 'new') {
        await api.post('/api/process-master', form);
        toast.success(`Process '${form.process_name}' created`);
      } else {
        await api.patch(`/api/process-master/${modal.process.id}`, form);
        toast.success(`Process '${form.process_name}' updated`);
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  const toggleActive = async (process) => {
    try {
      await api.patch(`/api/process-master/${process.id}`, { ...process, active: !process.active });
      toast.success(`'${process.process_name}' ${!process.active ? 'activated' : 'deactivated'}`);
      load();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  const filterStyle = {
    padding: '5px 8px', borderRadius: 6,
    fontSize: 12, background: '#fff', minWidth: 130,
  };

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(filtered, []);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Action bar ── */}
      <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid var(--g200)' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setModal({ mode: 'new', process: null })}
        >
          <Plus size={12} /> New Process
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap',
        padding: '12px 16px', background: '#fff', borderBottom: '1px solid var(--g200)'
      }}>
        {/* Search */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--g400)' }} />
            <input
              style={{
                width: 260, height: 34, padding: '0 30px',
                border: '1px solid var(--g300)', borderRadius: 'var(--radius)',
                fontSize: 13, outline: 'none', transition: 'border-color 0.2s'
              }}
              placeholder="Search code or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--g400)', padding: 0 }}
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Category */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</label>
          <div style={{ width: 150 }}>
            <SelectDropdown placeholder="All Categories" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_CFG[c].label}</option>)}
            </SelectDropdown>
          </div>
        </div>

        {/* Show Inactive */}
        <div style={{ display: 'flex', alignItems: 'center', height: 34, marginLeft: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--g700)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>

        {/* Clear & Count */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 1 }}>
          {(search || catFilter) && (
            <button className="btn btn-sm btn-danger" onClick={() => { setSearch(''); setCatFilter(''); }}>
              <X size={11} /> Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--g500)' }}>
            {filtered.length} process{filtered.length !== 1 ? 'es' : ''}
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: 'auto' }} ref={tableWrapRef}>
        {loading ? (
          <div className="empty-state" style={{ padding: 80 }}><div className="spinner" /></div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th style={{ width: 110 }}>Code</th>
                <th>Name</th>
                <th style={{ width: 90 }}>Category</th>
                <th style={{ width: 70 }}>Group</th>
                <th style={{ width: 85 }}>Machine</th>
                {BOOL_FLAGS.map(f => (
                  <th key={f.key} style={{ width: 52, textAlign: 'center' }} title={f.title}>{f.label}</th>
                ))}
                <th style={{ width: 80 }}>Output</th>
                <th style={{ width: 76, textAlign: 'right' }}>Def. RT (h)</th>
                <th style={{ width: 56, textAlign: 'center' }}>Active</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((p, i) => {
                const catCfg = CATEGORY_CFG[p.category] || CATEGORY_CFG.OTHER;
                const outCfg = OUTPUT_CFG[p.output_type] || OUTPUT_CFG.NONE;
                return (
                  <tr
                    key={p.id}
                    style={{ opacity: p.active ? 1 : 0.5 }}
                  >
                    <td style={{ color: 'var(--g400)', fontSize: 11 }}>{i + 1}</td>

                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700 }}>
                      {p.process_code}
                    </td>

                    <td style={{ fontWeight: 600 }}>{p.process_name}</td>

                    <td>
                      <Badge color={catCfg.color} bg={catCfg.bg}>
                        {catCfg.label}
                      </Badge>
                    </td>

                    <td style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)' }}>
                      {p.process_group || '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--g600)' }}>
                      {p.eligible_machine_type || '—'}
                    </td>

                    {BOOL_FLAGS.map(f => (
                      <td key={f.key} style={{ textAlign: 'center' }}>
                        <BoolBadge value={p[f.key]} title={f.title} />
                      </td>
                    ))}

                    <td>
                      <Badge color={outCfg.color} bg={outCfg.bg}>{p.output_type}</Badge>
                    </td>

                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--g600)' }}>
                      {p.default_runtime_hours != null ? `${p.default_runtime_hours}h` : '—'}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <button
                        title={p.active ? 'Click to deactivate' : 'Click to activate'}
                        onClick={() => toggleActive(p)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 36, height: 22, borderRadius: 10, fontSize: 10, fontWeight: 700,
                          background: p.active ? '#E8F5E9' : '#FFEBEE',
                          color: p.active ? '#2E7D32' : '#C62828',
                          border: `1px solid ${p.active ? '#A5D6A7' : '#EF9A9A'}`,
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        {p.active ? 'ON' : 'OFF'}
                      </button>
                    </td>

                    <td>
                      <button
                        className="icon-btn"
                        title="Edit"
                        onClick={() => setModal({ mode: 'edit', process: p })}
                      >
                        <Edit2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} style={{
                    textAlign: 'center', color: 'var(--g400)',
                    padding: 60, fontStyle: 'italic', fontSize: 13,
                  }}>
                    No processes found
                  </td>
                </tr>
              )}
            </tbody>
          <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{filtered.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
</td></tr></tfoot>
</table>

        )}
      </div>

      {/* ── Modal ── */}
      {modal && (
        <ProcessModal
          isNew={modal.mode === 'new'}
          initial={modal.mode === 'edit' ? {
            ...modal.process,
            default_runtime_hours: modal.process.default_runtime_hours ?? '',
            sort_order: modal.process.sort_order ?? 0,
          } : BLANK}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
