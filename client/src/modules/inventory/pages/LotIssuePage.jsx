import { useState, useEffect, useMemo, useCallback } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import OperatorSelect from '../../../features/operator/OperatorSelect';
import { useClipboard } from '../../../core/context/ClipboardContext';  // TASK 1
import toast from 'react-hot-toast';
import {
  Play, Search, Plus, X, Package, AlertCircle, Info, Clipboard,
  ScanLine,   // TASK 7: barcode scan trigger
  AlertTriangle,
} from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import Barcode from '../../../shared/components/Barcode';

const CANNOT_ISSUE = ['CONSUMED', 'SOLD', 'DISPOSED', 'DAMAGED', 'ARCHIVED', 'IN PROCESS'];

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

// ── TASK 2: Format dimension for display ──────────────────────────────────────
// Shows Length × Width × Height in mm when at least one value is present.
// Returns '—' when all dimension fields are null/0 so we never show empty strings.
function fmtDim(lot) {
  const l = parseFloat(lot.dim_length || 0);
  const w = parseFloat(lot.dim_depth  || lot.dim_width || 0);
  const h = parseFloat(lot.dim_height || 0);
  if (!l && !w && !h) return '—';
  const fmt = v => v ? v.toFixed(2) : '—';
  return `${fmt(l)} × ${fmt(w)} × ${fmt(h)}`;
}

// ── Machine status badge ──────────────────────────────────────────────────────
const STATUS_CFG = {
  idle:            { label: 'Idle',            color: '#757575', bg: '#F5F5F5' },
  running:         { label: 'Running',         color: '#2E7D32', bg: '#E8F5E9' },
  hold:            { label: 'Hold',            color: '#E65100', bg: '#FFF3E0' },
  maintenance:     { label: 'Maintenance',     color: '#F57F17', bg: '#FFF8E1' },
  breakdown:       { label: 'Breakdown',       color: '#C62828', bg: '#FFEBEE' },
  cleaning:        { label: 'Cleaning',        color: '#6A1B9A', bg: '#F3E5F5' },
  awaiting_output: { label: 'Awaiting Output', color: '#1565C0', bg: '#E3F2FD' },
  completed:       { label: 'Completed',       color: '#1B5E20', bg: '#E8F5E9' },
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



// ── TASK 6: Non-Idle Machine Warning Dialog ───────────────────────────────────
// Warning only — does not block selection.
function MachineWarningDialog({ machine, onContinue, onCancel }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: '24px 28px',
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', maxWidth: 420, width: '90%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <AlertTriangle size={18} color="#E65100" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#E65100' }}>
            Machine Not Idle
          </span>
        </div>
        <p style={{ fontSize: 13, color: '#424242', marginBottom: 6, lineHeight: 1.5 }}>
          Machine <strong>{machine?.code} — {machine?.name}</strong> currently has
          an active process (<MachineStatusBadge status={machine?.machine_status} />).
        </p>
        <p style={{ fontSize: 12, color: '#757575', marginBottom: 20, lineHeight: 1.5 }}>
          You can still continue, but confirm with the operator before starting a
          new process on this machine.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" style={{ fontSize: 13 }} onClick={onCancel}>
            Choose Different Machine
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 13, background: '#E65100', borderColor: '#E65100' }}
            onClick={onContinue}
          >
            Continue Anyway
          </button>
        </div>
      </div>
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

  // TASK 1: Clipboard context — read-only, never mutates clipboard
  const { items: clipboardItems } = useClipboard();

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

  // ── TASK 6: Machine warning dialog state ──────────────────────────────────
  const [pendingMachineId,   setPendingMachineId]   = useState(null);
  const [showMachineWarning, setShowMachineWarning] = useState(false);

  // ── TASK 7: Barcode search state (integration point) ─────────────────────
  // When barcodeQuery is set, the lot browser search is overridden with the
  // scanned value. The Barcode.jsx component is a CODE128 *renderer*, not a
  // scanner. A scanner integration can set this value via a keydown listener
  // attached to the search input, so the infrastructure is ready to connect.
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const activeSearch = barcodeQuery || search;

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
  let allowedCategories = selectedProcess?.input_item_category ? selectedProcess.input_item_category.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
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

  const applyProcessChange = useCallback((code, keepLots) => {
    setProcessType(code);
    const proc = processes.find(p => p.process_code === code);
    if (proc?.default_runtime_hours) {
      setTargetRuntime(String(proc.default_runtime_hours));
    } else {
      setTargetRuntime('');
    }
    // Clear machine because a new process group may require a different machine type.
    setMachineId('');
    // TASK 4: Only clear lots when the operator explicitly chose "Clear Selection"
    if (!keepLots) {
      setSelectedLots([]);
    }
  }, [processes]);

  // When process type changes, prefill default runtime if available.
  // TASK 4: Never silently clear lots — show a dialog when lots are selected.
  const handleProcessChange = useCallback((code) => {
    if (code === processType) return; // no-op

    // No warning dialog, just keep selection
    applyProcessChange(code, true);
  }, [processType, applyProcessChange]);



  // TASK 6: Machine selection — warn when machine is not idle
  const handleMachineChange = useCallback((id) => {
    const m = machines.find(m => String(m.id) === String(id));
    if (m && m.machine_status && m.machine_status.toLowerCase() !== 'idle') {
      // Non-idle machine: warn but don't block
      setPendingMachineId(id);
      setShowMachineWarning(true);
      return;
    }
    setMachineId(id);
  }, [machines]);

  const handleMachineWarnContinue = useCallback(() => {
    setShowMachineWarning(false);
    setMachineId(pendingMachineId || '');
    setPendingMachineId(null);
  }, [pendingMachineId]);

  const handleMachineWarnCancel = useCallback(() => {
    setShowMachineWarning(false);
    setPendingMachineId(null);
    // Leave machineId unchanged (operator picks a different one)
  }, []);

  // Pre-select lot from props or ?lot_id= URL param
  useEffect(() => {
    const lotId = initialLotId || searchParams.get('lot_id');
    if (!lotId || !lots.length) return;
    const found = lots.find(l => String(l.id) === String(lotId));
    if (found && !selectedLotIds.has(found.id)) {
      setSelectedLots([{ lot: found, issuedQty: '' }]);
    }
  }, [lots]); // eslint-disable-line — intentional on lots change only

  // ── TASK 1: Load Clipboard ───────────────────────────────────────────────
  // Merges clipboard inventory items into the Selected Lots panel.
  // • Only loads items with entity_type === 'inventory'.
  // • Skips items already selected (dedup by lot id).
  // • Skips items not yet loaded in the local lots array (still matches by id
  //   after lots load via useEffect above, but we also check here for safety).
  // • Does NOT modify clipboard — clipboard is preserved until the process
  //   successfully starts (no automatic clear after submit).
  const handleLoadClipboard = useCallback(() => {
    const invClipItems = clipboardItems.filter(i => i.entity_type === 'inventory');
    if (invClipItems.length === 0) {
      toast('No inventory items in clipboard', { icon: '📋' });
      return;
    }

    let added = 0;
    let skipped = 0;
    setSelectedLots(prev => {
      const currentIds = new Set(prev.map(sl => sl.lot.id));
      const toAdd = [];

      for (const clip of invClipItems) {
        const lotId = clip.entity_id;
        if (currentIds.has(lotId)) { skipped++; continue; }

        // Find the lot in our loaded lot list
        const found = lots.find(l => l.id === lotId || String(l.id) === String(lotId));
        if (!found) { skipped++; continue; }

        // Respect category filter for current process (temporarily disabled)
        // if (allowedCategories.length > 0 && !allowedCategories.includes((found.category || '').toLowerCase())) {
        //   skipped++;
        //   continue;
        // }

        if (CANNOT_ISSUE.includes(found.status)) { skipped++; continue; }

        toAdd.push({ lot: found, issuedQty: '' });
        currentIds.add(lotId);
        added++;
      }

      if (added === 0 && skipped > 0) {
        toast('All clipboard items already selected or not applicable for this process', { icon: '📋' });
      } else if (added > 0) {
        toast.success(`${added} lot${added !== 1 ? 's' : ''} loaded from clipboard${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      }

      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [clipboardItems, lots, selectedLotIds, allowedCategories]);

  // ── Filtered lot browser ──────────────────────────────────────────────────
  const filteredLots = useMemo(() => {
    let base = lots.filter(l => !selectedLotIds.has(l.id));
    // Phase 34: restrict to the process group's eligible input category
    // (temporarily disabled to allow issuing any lot to any process)
    // if (allowedCategories.length > 0) {
    //   base = base.filter(l => allowedCategories.includes((l.category || '').toLowerCase()));
    // }
    if (!activeSearch) return base;
    const s = activeSearch.toLowerCase();
    return base.filter(l =>
      l.lot_number?.toLowerCase().includes(s) ||
      l.lot_code?.toLowerCase().includes(s)   ||
      l.item_name?.toLowerCase().includes(s)
    );
  }, [lots, activeSearch, selectedLotIds, allowedCategories.join(',')]); // eslint-disable-line

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
      // TASK 1: Clipboard is NOT cleared here — operator may want to use
      // clipboard items for a subsequent process on a different machine.
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

  // ── Clipboard count for button label ─────────────────────────────────────
  const clipboardInvCount = useMemo(
    () => clipboardItems.filter(i => i.entity_type === 'inventory').length,
    [clipboardItems]
  );

  // ═════════════════════════════════════════════════════════════════════════
  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(filteredLots, []);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── TASK 4: Process Change Dialog ── */}


      {/* ── TASK 6: Machine Warning Dialog ── */}
      {showMachineWarning && (
        <MachineWarningDialog
          machine={machines.find(m => String(m.id) === String(pendingMachineId))}
          onContinue={handleMachineWarnContinue}
          onCancel={handleMachineWarnCancel}
        />
      )}

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
                {/* TASK 7: Barcode scan button (integration point).
                    When a hardware barcode scanner is connected it fires keydown
                    events into the search input, which is the standard HID-mode
                    approach. The ScanLine icon signals to the operator that
                    scanning is supported. setBarcodeQuery() is the hook point
                    for software-triggered scans or USB wedge decoders. */}
                <div className="grid-toolbar-search">
                  <Search size={14} />
                  <input
                    placeholder="Search lots or scan barcode…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setBarcodeQuery(''); setPage(1); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && search.trim()) {
                        const sq = search.trim().toLowerCase();
                        setBarcodeQuery(sq);
                        setPage(1);
                        const match = lots.find(l =>
                          l.lot_number?.toLowerCase() === sq ||
                          l.lot_code?.toLowerCase() === sq
                        );
                        if (match && !selectedLotIds.has(match.id)) {
                          addLot(match);
                          setSearch('');
                          setBarcodeQuery('');
                        }
                      }
                    }}
                  />
                  {(search || barcodeQuery) && (
                    <button
                      className="icon-btn"
                      style={{ flexShrink: 0 }}
                      onClick={() => { setSearch(''); setBarcodeQuery(''); }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                {/* TASK 7: Barcode integration point button — placeholder for
                    scanner trigger (e.g. webcam QR, Bluetooth scanner). Currently
                    shows a toast so operators know scanning is not yet available.
                    Replace the toast handler with actual scanner invocation. */}
                <button
                  className="btn btn-sm"
                  title="Scan barcode"
                  style={{ flexShrink: 0 }}
                  onClick={() => toast('Barcode scanner: connect a USB HID barcode scanner and scan directly into the search box above.', { icon: '📷', duration: 4000 })}
                >
                  <ScanLine size={13} />
                </button>

                {/* TASK 1: Load Clipboard button */}
                <button
                  className="btn btn-sm"
                  title={clipboardInvCount > 0 ? `Load ${clipboardInvCount} clipboard item${clipboardInvCount !== 1 ? 's' : ''}` : 'Clipboard is empty'}
                  style={{
                    flexShrink: 0,
                    background: clipboardInvCount > 0 ? 'var(--brand-50, #F1F8F2)' : undefined,
                    color: clipboardInvCount > 0 ? 'var(--brand-dark)' : undefined,
                    border: clipboardInvCount > 0 ? '1px solid var(--brand)' : undefined,
                  }}
                  onClick={handleLoadClipboard}
                  disabled={clipboardInvCount === 0}
                >
                  <Clipboard size={13} />
                  <span style={{ marginLeft: 4 }}>Load from Clip</span>
                  {clipboardInvCount > 0 && (
                    <span style={{
                      marginLeft: 4, background: 'var(--brand)', color: '#fff',
                      borderRadius: 10, fontSize: 9, fontWeight: 700, padding: '0 5px',
                    }}>
                      {clipboardInvCount}
                    </span>
                  )}
                </button>

                <span className="grid-count">{filteredLots.length} lots</span>
              </div>

              {/* Lot browser table */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {loading ? (
                  <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
                ) : (
                  <table className="dgrid">
                      <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
                        <tr>
                          <th style={{ width: 110, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Lot Code</th>
                          <th style={{ position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Item</th>
                          <th style={{ width: 100, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Barcode</th>
                          <th style={{ width: 62, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Cat</th>
                          <th style={{ width: 75, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Process</th>
                          <th style={{ width: 96, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Available</th>
                          <th style={{ width: 50, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Unit</th>
                          <th style={{ width: 120, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Dimension (mm)</th>
                          <th style={{ width: 34, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}></th>
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
                            <Barcode value={lot.lot_code || lot.lot_number || 'UNKNOWN'} width={1} height={20} displayValue={false} />
                          </td>
                          <td>
                            <span className="badge b-stock" style={{ fontSize: 9 }}>{lot.category}</span>
                          </td>
                          <td style={{ fontSize: 10, fontWeight: 700, color: '#E65100' }}>
                            {lot.status === 'IN PROCESS' ? 'Processing' : ''}
                          </td>
                          <td className="num">{effQty(lot).toFixed(4)}</td>
                          <td>{lot.unit}</td>
                          {/* TASK 2: Display dimensions; '—' when unavailable */}
                          <td style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--g700)' }}>
                            {fmtDim(lot)}
                          </td>
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
                          <td colSpan={9} style={{
                            textAlign: 'center', color: 'var(--g400)',
                            padding: 40, fontStyle: 'italic', fontSize: 12,
                          }}>
                            {activeSearch ? 'No lots match search' : 'No available lots'}
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
                      <thead style={{ position: 'sticky', top: 0, zIndex: 20 }}>
                        <tr>
                          <th style={{ width: 110, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Lot Code</th>
                          <th style={{ position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Item</th>
                          <th style={{ width: 90, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Barcode</th>
                          <th style={{ width: 110, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Available</th>
                          {/* TASK 2 / TASK 3: Dimension shown instead of Rate/Value */}
                          <th style={{ width: 140, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Dimension</th>
                          <th style={{ width: 130, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}>Issue Qty *</th>
                          <th style={{ width: 28, position: 'sticky', top: 0, background: 'var(--table-header, #f4f6f8)', zIndex: 21 }}></th>
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
                              <td>
                                <Barcode value={lot.lot_code || lot.lot_number || 'UNKNOWN'} width={1} height={20} displayValue={false} />
                              </td>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                                {avail.toFixed(4)} {lot.unit}
                              </td>
                              {/* TASK 2: Dimension in selected panel */}
                              <td style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--g600)' }}>
                                {fmtDim(lot)}
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
                          <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, paddingRight: 8 }}>
                            Total to issue:
                          </td>
                          {/* TASK 3: No total value / cost column */}
                          <td />
                          <td colSpan={2} style={{
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
              <SelectDropdown style={inp} value={machineId} onChange={e => handleMachineChange(e.target.value)}>
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
