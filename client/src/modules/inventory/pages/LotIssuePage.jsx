import { useState, useEffect, useMemo, useCallback } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import OperatorSelect from '../../../features/operator/OperatorSelect';
import toast from 'react-hot-toast';
import {
  Play, Search, Plus, X, Package, AlertCircle, Info,
} from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';

const CANNOT_ISSUE = ['CONSUMED', 'SOLD', 'DISPOSED', 'DAMAGED', 'ARCHIVED'];

// Category color for process type badge in section header
const CATEGORY_COLORS = {
  PRIMARY: { color: '#7B1FA2', bg: '#F3E5F5' },
  SUPPORT: { color: '#1565C0', bg: '#E3F2FD' },
  QC:      { color: '#00695C', bg: '#E0F2F1' },
  OTHER:   { color: '#616161', bg: '#F5F5F5' },
};

function effQty(l) {
  return l.unit === 'CT' ? parseFloat(l.weight || 0) : parseFloat(l.qty || 0);
}

// ── Machine status badge ──────────────────────────────────────────────────────
const STATUS_CFG = {
  idle:        { label: 'Idle',        color: '#757575', bg: '#F5F5F5' },
  running:     { label: 'Running',     color: '#2E7D32', bg: '#E8F5E9' },
  hold:        { label: 'Hold',        color: '#E65100', bg: '#FFF3E0' },
  maintenance: { label: 'Maintenance', color: '#F57F17', bg: '#FFF8E1' },
  breakdown:   { label: 'Breakdown',   color: '#C62828', bg: '#FFEBEE' },
  cleaning:    { label: 'Cleaning',    color: '#6A1B9A', bg: '#F3E5F5' },
};

function MachineStatusBadge({ status }) {
  const cfg = STATUS_CFG[status?.toLowerCase()] || { label: status || '?', color: '#616161', bg: '#F5F5F5' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.7px',
      color: 'var(--brand-dark)', borderBottom: '1px solid var(--g200)',
      paddingBottom: 5, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Start Process Page
// ═════════════════════════════════════════════════════════════════════════════
export default function LotIssuePage({ initialLotId, onComplete, onCancel, isModal }) {
  const navigate       = useNavigate();
  const api            = useApi();
  const [searchParams] = useSearchParams();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [lots,      setLots]      = useState([]);
  const [machines,  setMachines]  = useState([]);
  const [operators, setOperators] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading,   setLoading]   = useState(true);

  // ── Lot selection ─────────────────────────────────────────────────────────
  const [search,       setSearch]      = useState('');
  const [selectedLots, setSelectedLots] = useState([]);  // [{lot, issuedQty}]

  // ── Process config ────────────────────────────────────────────────────────
  const [machineId,     setMachineId]     = useState('');
  const [operatorId,    setOperatorId]    = useState('');
  const [processType,   setProcessType]   = useState('');
  const [targetRuntime, setTargetRuntime] = useState('');
  const [expectedYield, setExpectedYield] = useState('');
  const [issueDate,     setIssueDate]     = useState(() => new Date().toISOString().split('T')[0]);
  const [expectedRet,   setExpectedRet]   = useState('');
  const [remarks,       setRemarks]       = useState('');
  const [saving,        setSaving]        = useState(false);

  // ── Derived from selected process rules ───────────────────────────────────
  const selectedProcess = useMemo(
    () => processes.find(p => p.process_code === processType) || null,
    [processes, processType]
  );

  const processGroup = selectedProcess?.process_group || 'OTHER';
  const isGrowth = processGroup === 'GROWTH';
  const isLaser  = processGroup === 'LASER';

  // Boolean visibility flags — default to permissive (true) while loading
  const showInventory = selectedProcess ? !!selectedProcess.requires_inventory      : true;
  const showOperator  = selectedProcess ? !!selectedProcess.requires_operator       : false;
  
  // Phase 35: Enforce GROWTH / LASER overrides
  const showRuntime   = isGrowth || isLaser || (selectedProcess ? !!selectedProcess.requires_runtime : false);
  const reqRuntime    = isGrowth; // Enforced required if GROWTH
  const showYield     = isGrowth || (selectedProcess ? !!selectedProcess.requires_expected_yield : false);
  const showConsumables = isGrowth || (selectedProcess ? !!selectedProcess.allows_consumables : false);

  // Phase 35: Enforce inventory filtering and machine type filtering based on process group
  let allowedCategories = selectedProcess?.input_item_category ? [selectedProcess.input_item_category.trim()] : [];
  let eligType = (selectedProcess?.eligible_machine_type || '').trim().toLowerCase();

  if (isGrowth) {
    allowedCategories = ['seed', 'growth_run'];
    eligType = 'cvd_reactor';
  } else if (isLaser) {
    allowedCategories = ['seed', 'growth_run'];
    eligType = 'laser';
  } else if (processGroup === 'GROWTH_OUTPUT') {
    allowedCategories = ['growth_run'];
  }

  // Machines filtered by the eligible machine type.
  const filteredMachines = useMemo(() => {
    if (!eligType) return machines;
    
    const searchStr = eligType.replace(/[_ -]/g, '').toLowerCase();
    
    return machines.filter(m => {
      const typeStr = (m.machine_type || '').replace(/[_ -]/g, '').toLowerCase();
      if (!typeStr) return true; // Fallback: include machines with no assigned type
      
      if (searchStr.includes('cvd') && typeStr.includes('cvd')) return true;
      if (searchStr.includes('laser') && typeStr.includes('laser')) return true;
      if (searchStr.includes('polish') && typeStr.includes('polish')) return true;
      
      return typeStr.includes(searchStr) || searchStr.includes(typeStr);
    });
  }, [machines, eligType]);

  // ── Derived: selected machine ─────────────────────────────────────────────
  const selectedMachine = useMemo(
    () => machines.find(m => String(m.id) === String(machineId)) || null,
    [machines, machineId]
  );
  const selectedLotIds = useMemo(
    () => new Set(selectedLots.map(sl => sl.lot.id)),
    [selectedLots]
  );

  // ── Load all data ─────────────────────────────────────────────────────────
  // Uses Promise.allSettled so one failing endpoint doesn't block all others.
  // The `cancelled` flag prevents state updates and toasts if the component
  // unmounts before the fetch completes (guards against React Strict Mode
  // double-mount producing duplicate toasts in development).
  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.get('/api/process-master?active=true'),           // [0] process types
      api.get('/api/lot-process-issues/lookup/machines'),   // [1] active machines
      api.get('/api/manufacturing/lookup/operators'),       // [2] operators
      api.get('/api/inventory?limit=500'),                  // [3] lots
    ]).then(([procsRes, machRes, opsRes, invRes]) => {
      if (cancelled) return;

      // ── Process master ───────────────────────────────────────────────────
      if (procsRes.status === 'fulfilled') {
        const val = procsRes.value;
        const procList = Array.isArray(val) ? val : (val?.data || []);
        setProcesses(procList);
        if (procList.length) {
          setProcessType(procList[0].process_code);
          const defRT = procList[0].default_runtime_hours;
          if (defRT) setTargetRuntime(String(defRT));
        }
      }

      // ── Machines (active = not maintenance/breakdown) ────────────────────
      if (machRes.status === 'fulfilled') {
        setMachines(machRes.value || []);
      }

      // ── Operators ────────────────────────────────────────────────────────
      if (opsRes.status === 'fulfilled') {
        setOperators(opsRes.value || []);
      }

      // ── Inventory lots (conditional — failure shown if it rejects) ───────
      if (invRes.status === 'fulfilled') {
        setLots((invRes.value?.data || []).filter(l => !CANNOT_ISSUE.includes(l.status)));
      }

      // One combined toast for any critical failures — operators omitted
      const failed = [
        procsRes.status === 'rejected' && 'process types',
        machRes.status  === 'rejected' && 'machines',
        invRes.status   === 'rejected' && 'inventory',
      ].filter(Boolean);

      if (failed.length) {
        toast.error(`Failed to load: ${failed.join(', ')}. Refresh to retry.`, { id: 'load-err' });
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []); // intentional empty deps — one-time load on mount

  // When process type changes, prefill default runtime if available
  const handleProcessChange = useCallback((code) => {
    setProcessType(code);
    const proc = processes.find(p => p.process_code === code);
    if (proc?.default_runtime_hours) {
      setTargetRuntime(String(proc.default_runtime_hours));
    } else {
      setTargetRuntime('');
    }
    // Phase 34: a new process may belong to a different group (GROWTH vs LASER)
    // with a different eligible inventory category and machine type. Clear the
    // lot + machine selections so nothing from the previous group carries over.
    setSelectedLots([]);
    setMachineId('');
  }, [processes]);

  // Pre-select lot from props or ?lot_id= URL param
  useEffect(() => {
    const lotId = initialLotId || searchParams.get('lot_id');
    if (!lotId || !lots.length) return;
    const found = lots.find(l => String(l.id) === lotId);
    if (found && !selectedLotIds.has(found.id)) {
      setSelectedLots([{ lot: found, issuedQty: '' }]);
    }
  }, [lots]);

  // ── Filtered lot browser ──────────────────────────────────────────────────
  const filteredLots = useMemo(() => {
    let base = lots.filter(l => !selectedLotIds.has(l.id));
    // Phase 34: restrict to the process group's eligible input category
    if (allowedCategories.length > 0) {
      base = base.filter(l => allowedCategories.includes(l.category));
    }
    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter(l =>
      l.lot_number?.toLowerCase().includes(s) ||
      l.lot_code?.toLowerCase().includes(s)   ||
      l.item_name?.toLowerCase().includes(s)
    );
  }, [lots, search, selectedLotIds, allowedCategories.join(',')]);

  // ── Lot selection handlers ────────────────────────────────────────────────
  const addLot = useCallback((lot) => {
    if (selectedLotIds.has(lot.id)) return;
    setSelectedLots(prev => [...prev, { lot, issuedQty: '' }]);
  }, [selectedLotIds]);

  const removeLot = useCallback(idx => setSelectedLots(prev => prev.filter((_, i) => i !== idx)), []);
  const updateQty = useCallback((idx, val) => setSelectedLots(prev =>
    prev.map((sl, i) => i === idx ? { ...sl, issuedQty: val } : sl)
  ), []);

  // ── Validation ────────────────────────────────────────────────────────────
  const qtyErrors = selectedLots.map(sl => {
    const q = parseFloat(sl.issuedQty) || 0;
    const a = effQty(sl.lot);
    if (q > 0 && q > a + 0.0001) return `Exceeds available (${a.toFixed(4)} ${sl.lot.unit})`;
    return null;
  });
  const hasQtyError = qtyErrors.some(Boolean);
  const filledLots  = selectedLots.filter(sl => (parseFloat(sl.issuedQty) || 0) > 0);

  const valid = !!machineId && !!processType && !hasQtyError && (
    showInventory ? filledLots.length > 0 : true
  ) && (!reqRuntime || !!targetRuntime);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const body = {
        machine_id:   parseInt(machineId),
        operator_id:  operatorId    ? parseInt(operatorId)       : undefined,
        process_type: processType,
        issue_date:   issueDate,
        expected_return: expectedRet || undefined,
        remarks:      remarks        || undefined,
      };
      if (showRuntime && targetRuntime)
        body.target_runtime_hours = parseFloat(targetRuntime);
      if (showYield && expectedYield)
        body.expected_rough_qty = parseFloat(expectedYield);
      if (showInventory && filledLots.length > 0) {
        body.lots = filledLots.map(sl => ({
          source_lot_id: sl.lot.id,
          issued_qty:    parseFloat(sl.issuedQty),
        }));
      }

      const res = await api.post('/api/lot-process-issues', body);
      const procName = selectedProcess?.process_name || processType;
      toast.success(
        `Process ${res.process_number} (${procName}) started on ${res.machine_code}` +
        (res.issue_count > 0 ? ` — ${res.issue_count} lot${res.issue_count !== 1 ? 's' : ''} issued` : '')
      );
      if (isModal && onComplete) {
        onComplete();
      } else {
        navigate('/inventory/process-issues');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to start process');
    } finally {
      setSaving(false);
    }
  };

  // ── Style helpers ─────────────────────────────────────────────────────────
  const inp = {
    width: '100%', padding: '6px 8px',
    borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box',
  };
  const lbl = { fontSize: 11, fontWeight: 600, color: 'var(--g600)', display: 'block', marginBottom: 4 };

  const totalIssuedQty = filledLots.reduce((s, sl) => s + (parseFloat(sl.issuedQty) || 0), 0);

  const procCatCfg = selectedProcess
    ? (CATEGORY_COLORS[selectedProcess.category] || CATEGORY_COLORS.OTHER)
    : null;

  // ═════════════════════════════════════════════════════════════════════════
  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(filteredLots, []);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>



      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── LEFT: Lot browser + selected lots ── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          overflow: 'hidden', borderRight: '1px solid var(--g200)',
        }}>
          {showInventory ? (
            <>
              {/* Lot browser toolbar */}
              <div className="grid-toolbar">
                <div className="grid-toolbar-search">
                  <Search size={14} />
                  <input
                    placeholder="Search lots…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <span className="grid-count">{filteredLots.length} lots</span>
              </div>

              {/* Lot browser table */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {loading ? (
                  <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
                ) : (
                  <table className="dgrid">
                    <thead>
                      <tr>
                        <th>Lot Code</th>
                        <th>Item</th>
                        <th style={{ width: 62 }}>Cat</th>
                        <th style={{ width: 75 }}>Process</th>
                        <th style={{ width: 96 }}>Available</th>
                        <th style={{ width: 50 }}>Unit</th>
                        <th style={{ width: 80 }}>Rate (₹)</th>
                        <th style={{ width: 34 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedItems.map(lot => (
                        <tr key={lot.id} style={{ cursor: 'pointer' }} onClick={() => addLot(lot)}>
                          <td>
                            <span className="cell-link">{lot.lot_code || lot.lot_number}</span>
                          </td>
                          <td style={{ fontSize: 11 }}>{lot.item_name}</td>
                          <td>
                            <span className="badge b-stock" style={{ fontSize: 9 }}>{lot.category}</span>
                          </td>
                          <td style={{ fontSize: 10, fontWeight: 700, color: '#E65100' }}>
                            {lot.status === 'IN PROCESS' ? 'Processing' : ''}
                          </td>
                          <td className="num">{effQty(lot).toFixed(4)}</td>
                          <td>{lot.unit}</td>
                          <td className="num">₹{Number(lot.rate || 0).toLocaleString('en-IN')}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="icon-btn"
                              style={{ color: 'var(--brand)', width: 22, height: 22 }}
                              title="Add to process"
                              onClick={e => { e.stopPropagation(); addLot(lot); }}
                            >
                              <Plus size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filteredLots.length === 0 && !loading && (
                        <tr>
                          <td colSpan={8} style={{
                            textAlign: 'center', color: 'var(--g400)',
                            padding: 40, fontStyle: 'italic', fontSize: 12,
                          }}>
                            {search ? 'No lots match search' : 'No available lots'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  <tfoot><tr><td colSpan="100" style={{ padding: 0 }}>
{filteredLots.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {filteredLots.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredLots.length)} of {filteredLots.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}
</td></tr></tfoot>
</table>

                )}
              </div>

              {/* Selected lots panel */}
              <div style={{
                borderTop: `2px solid var(--brand)`,
                background: 'var(--brand-50, #F1F8F2)',
                flexShrink: 0,
              }}>
                <div style={{
                  padding: '7px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '.5px', color: 'var(--brand-dark)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Package size={13} />
                    Selected for Process
                    {selectedLots.length > 0 && (
                      <span style={{
                        background: 'var(--brand)', color: '#fff', borderRadius: 10,
                        fontSize: 9, fontWeight: 700, padding: '1px 6px',
                      }}>{selectedLots.length}</span>
                    )}
                  </span>
                  {selectedLots.length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--g400)', fontStyle: 'italic' }}>
                      Click a row above to add a lot
                    </span>
                  )}
                </div>

                {selectedLots.length > 0 && (
                  <div style={{ overflow: 'auto', maxHeight: 230, padding: '0 12px 10px' }}>
                    <table className="je-lines-table">
                      <thead>
                        <tr>
                          <th>Lot Code</th>
                          <th>Item</th>
                          <th style={{ width: 110 }}>Available</th>
                          <th style={{ width: 130 }}>Issue Qty *</th>
                          <th style={{ width: 28 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLots.map(({ lot, issuedQty }, i) => {
                          const avail = effQty(lot);
                          const err   = qtyErrors[i];
                          return (
                            <tr key={lot.id}>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700 }}>
                                {lot.lot_code || lot.lot_number}
                              </td>
                              <td style={{ fontSize: 11 }}>{lot.item_name}</td>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                                {avail.toFixed(4)} {lot.unit}
                              </td>
                              <td>
                                <input
                                  type="number" step="0.0001" min="0.0001" max={avail}
                                  value={issuedQty}
                                  onChange={e => updateQty(i, e.target.value)}
                                  style={{ textAlign: 'right', fontWeight: 600 }}
                                  placeholder={`Max ${avail.toFixed(4)}`}
                                />
                                {err && (
                                  <div style={{ fontSize: 9, color: '#C62828', marginTop: 1 }}>{err}</div>
                                )}
                              </td>
                              <td>
                                <button
                                  className="icon-btn"
                                  onClick={() => removeLot(i)}
                                  style={{ color: '#C62828', width: 22, height: 22 }}
                                >
                                  <X size={11} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, paddingRight: 8 }}>
                            Total to issue:
                          </td>
                          <td colSpan={3} style={{
                            fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12,
                            color: hasQtyError ? '#C62828' : 'var(--brand-dark)',
                          }}>
                            {totalIssuedQty.toFixed(4)} units
                            {hasQtyError && <span style={{ marginLeft: 6, fontSize: 10 }}>⚠ qty error</span>}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* No-inventory notice */
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12, padding: 40, color: 'var(--g400)',
            }}>
              <Info size={36} style={{ opacity: .35 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--g500)' }}>
                No inventory required
              </div>
              <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
                The selected process type <strong style={{ color: 'var(--g700)' }}>
                  {selectedProcess?.process_name || processType}
                </strong> does not involve inventory lot issuance.
                Complete the process configuration on the right and start.
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Process configuration panel ── */}
        <div style={{
          width: 380, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: 'var(--g50)', overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

            {/* ── PROCESS TYPE ── */}
            <SectionHeader>Process Type</SectionHeader>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Process *</label>
              <SelectDropdown style={inp} value={processType} onChange={e => handleProcessChange(e.target.value)}>
                <option value="">— select process —</option>
                {processes.map(p => (
                  <option key={p.process_code} value={p.process_code}>{p.process_name}</option>
                ))}
              </SelectDropdown>
              {selectedProcess && (
                <div style={{
                  marginTop: 6, padding: '5px 8px', borderRadius: 6,
                  background: procCatCfg?.bg || '#F5F5F5',
                  fontSize: 10, color: procCatCfg?.color || '#616161',
                  display: 'flex', gap: 8,
                }}>
                  <span>{selectedProcess.category}</span>
                  <span>·</span>
                  <span>Output: {selectedProcess.output_type}</span>
                  {selectedProcess.default_runtime_hours && (
                    <><span>·</span><span>Def. RT: {selectedProcess.default_runtime_hours}h</span></>
                  )}
                </div>
              )}
            </div>

            {/* ── MACHINE ── */}
            <SectionHeader>Machine</SectionHeader>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>
                Machine *
                {filteredMachines.length === 0 && !loading && (
                  <span style={{ color: '#E65100', fontWeight: 400, marginLeft: 6 }}>— no active machines</span>
                )}
              </label>
              <SelectDropdown style={inp} value={machineId} onChange={e => setMachineId(e.target.value)}>
                <option value="">— select machine —</option>
                {filteredMachines.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.machine_status && m.machine_status !== 'idle' ? ` (${m.machine_status})` : ''}
                  </option>
                ))}
              </SelectDropdown>
            </div>

            {/* Machine info card — shown only when a machine is selected */}
            {selectedMachine && (
              <div style={{
                background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
                padding: '10px 12px', marginBottom: 16,
                display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr', gap: 8,
              }}>
                {[
                  { label: 'Code',       value: selectedMachine.code,            mono: true },
                  { label: 'Department', value: selectedMachine.department_name || '—' },
                  { label: 'Type',       value: selectedMachine.machine_type     || '—' },
                ].map(({ label, value, mono }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: mono ? 11 : 12, fontWeight: 600, color: 'var(--g800)', fontFamily: mono ? 'var(--mono)' : undefined }}>{value}</div>
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 9, color: 'var(--g500)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 2 }}>Status</div>
                  <MachineStatusBadge status={selectedMachine.machine_status} />
                </div>
              </div>
            )}

            {/* ── PROCESS DETAILS ── */}
            <SectionHeader>Process Details</SectionHeader>

            {/* Required operator when process demands it */}
            {showOperator && (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Operator *</label>
                <OperatorSelect
                  value={operatorId}
                  onChange={setOperatorId}
                  operators={operators}
                  style={inp}
                />
              </div>
            )}

            {/* Optional operator when process doesn't require it */}
            {!showOperator && (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>
                  Operator
                  <span style={{ color: 'var(--g400)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
                </label>
                <OperatorSelect
                  value={operatorId}
                  onChange={setOperatorId}
                  operators={operators}
                  style={inp}
                />
              </div>
            )}

            {showRuntime && (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Target Runtime (hours) {reqRuntime && <span style={{ color: 'red' }}>*</span>}</label>
                <input
                  type="number" min="0" step="0.5" style={inp}
                  value={targetRuntime} onChange={e => setTargetRuntime(e.target.value)}
                  placeholder={reqRuntime ? 'Required' : 'Optional default hours'}
                />
              </div>
            )}

            {showYield && (
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Expected Yield (ct)</label>
                <input
                  type="number" min="0" step="0.001" style={inp}
                  value={expectedYield}
                  onChange={e => setExpectedYield(e.target.value)}
                  placeholder="0.000"
                />
              </div>
            )}

            {/* ── SCHEDULE ── */}
            <SectionHeader>Schedule</SectionHeader>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={lbl}>Issue Date *</label>
                <DatePicker value={issueDate} onChange={v => setIssueDate(v)} />
              </div>
              <div>
                <label style={lbl}>
                  Return Date
                  <span style={{ color: 'var(--g400)', fontWeight: 400, marginLeft: 4 }}>(optional)</span>
                </label>
                <DatePicker value={expectedRet} onChange={v => setExpectedRet(v)} />
              </div>
            </div>

            <div style={{ marginBottom: 4 }}>
              <label style={lbl}>Remarks</label>
              <textarea
                rows={2} style={{ ...inp, resize: 'vertical' }}
                value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder="Optional process notes…"
              />
            </div>
          </div>

          {/* ── Submit area ── */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--g200)',
            background: '#fff', flexShrink: 0,
          }}>
            {!processType && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#E65100', marginBottom: 8 }}>
                <AlertCircle size={12} /> Select a process type to continue
              </div>
            )}
            {processType && !machineId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#E65100', marginBottom: 8 }}>
                <AlertCircle size={12} /> Select a machine to continue
              </div>
            )}
            {machineId && showInventory && filledLots.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#E65100', marginBottom: 8 }}>
                <AlertCircle size={12} /> Add at least one lot with a quantity
              </div>
            )}
            {hasQtyError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#C62828', marginBottom: 8 }}>
                <AlertCircle size={12} /> Fix quantity errors in selected lots
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {isModal && (
                <button
                  className="btn"
                  style={{ flex: 1, padding: '8px 16px', fontSize: 13 }}
                  disabled={saving}
                  onClick={() => onCancel && onCancel()}
                >
                  Cancel
                </button>
              )}
              <button
                className="btn btn-primary"
                style={{ flex: 2, padding: '8px 16px', fontSize: 13, fontWeight: 700 }}
                disabled={!valid || saving}
                onClick={handleSubmit}
              >
                {saving ? 'Starting…' : <><Play size={14} /> Start Process</>}
              </button>
            </div>

            {valid && selectedMachine && (
              <div style={{
                fontSize: 10, color: 'var(--g500)', marginTop: 6,
                textAlign: 'center', fontFamily: 'var(--mono)',
              }}>
                {selectedMachine.code} · {selectedProcess?.process_name || processType}
                {showInventory && filledLots.length > 0
                  ? ` · ${filledLots.length} lot${filledLots.length !== 1 ? 's' : ''} · ${totalIssuedQty.toFixed(4)} units`
                  : ' · no inventory'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
