import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import PortalDropdown from '../../../shared/components/PortalDropdown';
import DatePicker from '../../../shared/components/DatePicker';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import CostCenterSelect from '../../../features/cost-center/CostCenterSelect';
import AllocationModal from '../components/AllocationModal';
import {
  Plus, Trash2, Save, Check, Edit3, RotateCcw,
  ChevronDown, Copy, Printer, BookOpen, AlertCircle, RefreshCw, Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  TransactionPageLayout, TransactionHeader, StickyActionFooter,
  FormSectionCard,
} from '../../../core/layout';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt = v => `Rs. ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const emptyLine = () => ({
  _key:        Math.random().toString(36).slice(2),
  accountId:   '',
  accountName: '',
  entityType:  '',
  entityId:    '',
  entityName:  '',
  narration:   '',
  debit:       '',
  credit:      '',
  costCenterId:'',
  referenceNo: '',
  allocations: [],   // [{target_type, target_id, doc_number, allocated_amount}]
});

// ─── AccountSearch typeahead ───────────────────────────────────────────────────
function AccountSearch({ value, displayName, accounts, onChange, disabled, onEnter }) {
  const [input,  setInput]  = useState(displayName || '');
  const [open,   setOpen]   = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // Sync display when external value or accounts change
  useEffect(() => {
    if (!value) { setInput(''); return; }
    if (displayName) { setInput(displayName); return; }
    const acc = accounts.find(a => String(a.id) === String(value));
    if (acc) setInput(`${acc.name} (${acc.code})`);
  }, [value, displayName, accounts]); // eslint-disable-line

  const filtered = useMemo(() => {
    if (!input.trim()) return accounts.slice(0, 25);
    const q = input.toLowerCase();
    return accounts
      .filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q))
      .slice(0, 25);
  }, [input, accounts]);

  const select = useCallback((acc) => {
    setInput(`${acc.name} (${acc.code})`);
    setOpen(false);
    setCursor(-1);
    onChange(String(acc.id), acc);
  }, [onChange]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setCursor(c => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && cursor >= 0 && filtered[cursor]) {
        e.preventDefault();
        select(filtered[cursor]);
      } else if (open && filtered.length === 1) {
        e.preventDefault();
        select(filtered[0]);
      } else if (!open && onEnter) {
        e.preventDefault();
        onEnter();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  // Scroll cursor item into view
  useEffect(() => {
    if (cursor >= 0 && listRef.current) {
      const item = listRef.current.children[cursor];
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [cursor]);

  return (
    <div className="je-typeahead-wrap">
      <input
        ref={inputRef}
        className="je-cell-input"
        value={input}
        onChange={e => { setInput(e.target.value); onChange('', null); setOpen(true); setCursor(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Search account…"
        autoComplete="off"
        spellCheck={false}
      />
      <PortalDropdown anchorRef={inputRef} open={open && !disabled && filtered.length > 0} minWidth={280}>
        <div ref={listRef}>
          {filtered.map((acc, i) => (
            <div
              key={acc.id}
              className={`je-dropdown-item${i === cursor ? ' active' : ''}`}
              onMouseDown={() => select(acc)}
            >
              <span className="jd-name">{acc.name}</span>
              <span className="jd-code">{acc.code}</span>
              {acc.type && <span className={`jd-type jd-type-${acc.type}`}>{acc.type}</span>}
            </div>
          ))}
        </div>
      </PortalDropdown>
    </div>
  );
}

// ─── EntitySearch (party lookup: vendor / customer) ────────────────────────────
function EntitySearch({ value, displayName, entities, entityTypeFilter, onChange, disabled }) {
  const [input, setInput] = useState(displayName || '');
  const [open,  setOpen]  = useState(false);

  useEffect(() => {
    if (!value) { setInput(''); return; }
    if (displayName) { setInput(displayName); return; }
    const ent = entities.find(e => String(e.id) === String(value) && (!entityTypeFilter || e.etype === entityTypeFilter));
    if (ent) setInput(ent.name);
  }, [value, displayName, entityTypeFilter, entities]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = input.toLowerCase();
    return entities
      .filter(e =>
        (!entityTypeFilter || e.etype === entityTypeFilter) &&
        (!q || e.name.toLowerCase().includes(q) || (e.code && e.code.toLowerCase().includes(q)))
      )
      .slice(0, 20);
  }, [input, entityTypeFilter, entities]);

  const select = (ent) => {
    setInput(ent.name);
    setOpen(false);
    onChange(String(ent.id), ent.etype, ent);
  };

  const entityInputRef = useRef(null);

  return (
    <div className="je-typeahead-wrap">
      <input
        ref={entityInputRef}
        className="je-cell-input"
        value={input}
        onChange={e => { setInput(e.target.value); onChange('', '', null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        disabled={disabled}
        placeholder="Party…"
        autoComplete="off"
      />
      <PortalDropdown anchorRef={entityInputRef} open={open && !disabled && filtered.length > 0} minWidth={220}>
        <div>
          {filtered.map(ent => (
            <div
              key={`${ent.etype}-${ent.id}`}
              className="je-dropdown-item"
              onMouseDown={() => select(ent)}
            >
              <span className="jd-name">{ent.name}</span>
              <span className={`jd-type jd-type-${ent.etype}`}>{ent.etype}</span>
            </div>
          ))}
        </div>
      </PortalDropdown>
    </div>
  );
}

// ─── MoreMenu ─────────────────────────────────────────────────────────────────
function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen(o => !o)}>
        More <ChevronDown size={12} />
      </button>
      {open && (
        <div className="je-more-menu">
          {items.map((item, i) => item ? (
            <button
              key={i}
              className={`je-more-item${item.danger ? ' danger' : ''}`}
              onClick={() => { setOpen(false); item.onClick(); }}
              disabled={item.disabled}
            >
              {item.icon && <span className="je-more-icon">{item.icon}</span>}
              {item.label}
            </button>
          ) : <div key={i} className="je-more-sep" />)}
        </div>
      )}
    </div>
  );
}

// ─── Inline balance indicator ──────────────────────────────────────────────────
function BalanceTag({ balanced, diff }) {
  if (balanced) return (
    <span className="je-bal-tag balanced">
      <Check size={12} /> Balanced
    </span>
  );
  return (
    <span className="je-bal-tag unbalanced">
      <AlertCircle size={12} /> Off by {fmt(diff)}
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function JournalEntryForm() {
  const { id }   = useParams();
  const [searchParams] = useSearchParams();
  const isExisting = !!id;
  const isEdit     = !isExisting || searchParams.get('mode') === 'edit';
  const readOnly   = isExisting && !isEdit;
  const api        = useApi();
  const { canEdit } = useAuth();
  const navigate   = useNavigate();

  // ── master data ──────────────────────────────────────────────────────────────
  const [accounts,    setAccounts]    = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [entities,    setEntities]    = useState([]);  // vendors + customers combined

  // ── header meta ──────────────────────────────────────────────────────────────
  const [date,        setDate]        = useState(new Date().toISOString().split('T')[0]);
  const [jeNumber,    setJeNumber]    = useState('Auto-generated');
  const [referenceNo, setReferenceNo] = useState('');
  const [memo,        setMemo]        = useState('');
  const [sourceType,  setSourceType]  = useState('manual');
  const [autoReverse, setAutoReverse] = useState(false);
  const [reverseDate, setReverseDate] = useState('');

  // ── lines ─────────────────────────────────────────────────────────────────────
  const [lines,   setLines]   = useState([emptyLine(), emptyLine()]);
  const { page, setPage, paginatedItems: paginatedLines, totalPages, pageSize } = usePagination(lines, []);
  const [saving,  setSaving]  = useState(false);
  const [viewData,setViewData]= useState(null);
  const [reason,  setReason]  = useState('');  // edit-correction reason

  // ── allocation state ───────────────────────────────────────────────────────
  const [jeAllocations, setJeAllocations] = useState([]);  // existing allocs on a posted JE
  const [allocModal, setAllocModal]       = useState(null); // { lineKey, entityType, entityId, entityName, maxAmount }

  // ── load master data ─────────────────────────────────────────────────────────
  const loadAccounts = useCallback(() =>
    api.get('/api/accounts?is_group=false&status=active')
      .then(data => {
        const sorted = (Array.isArray(data) ? data : [])
          .sort((a, b) => a.name.localeCompare(b.name));
        setAccounts(sorted);
      })
      .catch(() => {}), [api]);

  const loadCostCenters = useCallback(() =>
    api.get('/api/cost-centers')
      .then(r => setCostCenters(r.data || []))
      .catch(() => {}), [api]);

  const loadEntities = useCallback(async () => {
    try {
      const [vRes, cRes] = await Promise.allSettled([
        api.get('/api/vendors?limit=500&status=active'),
        api.get('/api/customers?limit=500'),
      ]);
      const vendors   = (vRes.status   === 'fulfilled' ? (vRes.value?.data   || []) : []).map(v => ({ ...v, etype: 'vendor' }));
      const customers = (cRes.status   === 'fulfilled' ? (cRes.value?.data   || []) : []).map(c => ({ ...c, etype: 'customer' }));
      setEntities([...vendors, ...customers].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (_) {}
  }, [api]);

  // ── initial data load ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadAccounts();
    loadCostCenters();
    loadEntities();
  }, []);  // eslint-disable-line

  // ── load existing allocations (view mode) ────────────────────────────────────
  useEffect(() => {
    if (!isExisting || !id) return;
    api.get(`/api/je-allocations?je_id=${id}`)
      .then(data => setJeAllocations(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [id, isExisting]); // eslint-disable-line

  // ── load existing entry ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isExisting) return;
    api.get(`/api/journal-entries/${id}`)
      .then(data => {
        setViewData(data);
        setDate(data.date?.split('T')[0] || '');
        setJeNumber(data.je_number || '');
        setReferenceNo(data.reference_no || '');
        setMemo(data.description || '');
        setSourceType(data.source_type || 'manual');
        setLines(
          (data.lines || []).map(l => ({
            _key:        Math.random().toString(36).slice(2),
            accountId:   String(l.account_id),
            accountName: `${l.account_name} (${l.account_code})`,
            entityType:  l.entity_type  || '',
            entityId:    l.entity_id    ? String(l.entity_id) : '',
            entityName:  '',  // resolved below once entities load
            narration:   l.narration    || '',
            debit:       parseFloat(l.debit)  || '',
            credit:      parseFloat(l.credit) || '',
            costCenterId:l.cost_center_id ? String(l.cost_center_id) : '',
            referenceNo: l.reference_no  || '',
          }))
        );
      })
      .catch(() => toast.error('Failed to load journal entry'));
  }, [id, isExisting]); // eslint-disable-line

  // Resolve entity names after entities load
  useEffect(() => {
    if (!entities.length) return;
    setLines(prev => prev.map(l => {
      if (!l.entityId || l.entityName) return l;
      const ent = entities.find(e => String(e.id) === l.entityId && e.etype === l.entityType);
      return ent ? { ...l, entityName: ent.name } : l;
    }));
  }, [entities]);

  // ── line operations ───────────────────────────────────────────────────────────
  const updateLine = useCallback((key, field, value, extra = {}) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const updated = { ...l, [field]: value, ...extra };
      if (field === 'debit'  && value) updated.credit = '';
      if (field === 'credit' && value) updated.debit  = '';
      return updated;
    }));
  }, []);

  const addLine = useCallback(() =>
    setLines(prev => [...prev, emptyLine()]), []);

  const removeLine = useCallback((key) => {
    setLines(prev => {
      if (prev.length <= 2) return prev;
      return prev.filter(l => l._key !== key);
    });
  }, []);

  const duplicateLine = useCallback((key) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l._key === key);
      if (idx < 0) return prev;
      const clone = { ...prev[idx], _key: Math.random().toString(36).slice(2) };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  }, []);

  // ── totals (live balance engine) ──────────────────────────────────────────────
  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
    const cr = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    const d  = Math.round(dr * 100) / 100;
    const c  = Math.round(cr * 100) / 100;
    return { debit: d, credit: c, diff: Math.abs(d - c), balanced: d === c && d > 0 };
  }, [lines]);

  // ── validations ───────────────────────────────────────────────────────────────
  const validate = () => {
    if (!date)            { toast.error('Journal date is required'); return false; }
    const valid = lines.filter(l => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)));
    if (valid.length < 2) { toast.error('At least 2 lines with accounts and amounts required'); return false; }
    if (!totals.balanced) { toast.error('Entry must be balanced (Debit = Credit)'); return false; }
    if (totals.debit === 0){ toast.error('Entry value cannot be zero'); return false; }
    for (const l of valid) {
      if (parseFloat(l.debit) < 0 || parseFloat(l.credit) < 0) {
        toast.error('Debit and Credit values must be non-negative'); return false;
      }
      if (parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0) {
        toast.error('A line cannot have both Debit and Credit'); return false;
      }
    }
    if (isExisting && !reason.trim()) { toast.error('Edit reason is required'); return false; }
    return true;
  };

  // ── payload builder ───────────────────────────────────────────────────────────
  const buildLines = () => lines
    .filter(l => l.accountId && (parseFloat(l.debit) || parseFloat(l.credit)))
    .map(l => ({
      accountId:    parseInt(l.accountId),
      debit:        parseFloat(l.debit)  || 0,
      credit:       parseFloat(l.credit) || 0,
      narration:    l.narration || null,
      costCenterId: l.costCenterId ? parseInt(l.costCenterId) : null,
      entityType:   l.entityType  || null,
      entityId:     l.entityId    ? parseInt(l.entityId)    : null,
      referenceNo:  l.referenceNo || null,
    }));

  // ── save handlers ─────────────────────────────────────────────────────────────
  // Returns navigation path (string) for existing edits, or new JE object for new entries, or null on failure.
  const doSave = async (autoPost) => {
    if (!validate()) return null;
    setSaving(true);
    try {
      if (isExisting) {
        const res = await api.put(`/api/journal-entries/${id}`, {
          date, description: memo, referenceNo, reason, lines: buildLines(), autoPost,
        });
        toast.success(viewData?.status === 'posted' ? 'Correction posted' : 'Journal entry updated');
        return res.replacement?.id ? `/journal-entries/${res.replacement.id}` : '/journal-entries';
      } else {
        const je = await api.post('/api/journal-entries', {
          date, description: memo, referenceNo, sourceType: sourceType || 'manual',
          lines: buildLines(), autoPost,
        });
        if (autoPost) toast.success('Journal entry posted');
        else          toast.success('Journal entry saved as draft');

        // Save bill/invoice allocations (only when posting — drafts don't settle documents)
        if (autoPost && je?.id) {
          const allAllocs = [];
          lines.forEach(l => {
            if (l.allocations?.length && l.entityType && l.entityId) {
              l.allocations.forEach(a => {
                if (a.allocated_amount > 0) {
                  allAllocs.push({
                    entity_type:     l.entityType,
                    entity_id:       parseInt(l.entityId),
                    target_type:     a.target_type,
                    target_id:       a.target_id,
                    allocated_amount: a.allocated_amount,
                  });
                }
              });
            }
          });
          if (allAllocs.length > 0) {
            try {
              await api.post('/api/je-allocations', {
                je_id: je.id,
                allocation_date: date,
                allocations: allAllocs,
              });
              toast.success(`${allAllocs.length} bill allocation(s) applied`);
            } catch (allocErr) {
              toast.error(`JE posted; allocation failed: ${allocErr.message}`);
            }
          }
        }

        // Auto-reverse: create a paired reversal draft for the specified date
        if (autoPost && autoReverse && reverseDate && je?.id) {
          try {
            await api.post(`/api/journal-entries/${je.id}/reverse`, {
              reason: `Auto-reversal for ${je.je_number}`,
              date:   reverseDate,
            });
            toast.success('Auto-reversal draft created');
          } catch (revErr) {
            toast.error(`Entry posted; auto-reversal failed: ${revErr.message}`);
          }
        }
        return je;
      }
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    const result = await doSave(false);
    if (result) navigate(typeof result === 'string' ? result : '/journal-entries');
  };

  const handleSaveAndPost = async () => {
    const result = await doSave(true);
    if (result) navigate(typeof result === 'string' ? result : '/journal-entries');
  };

  const handleSaveAndNew = async () => {
    const result = await doSave(true);
    if (result && typeof result !== 'string') {
      // Reset form for next new entry
      setDate(new Date().toISOString().split('T')[0]);
      setJeNumber('Auto-generated');
      setReferenceNo('');
      setMemo('');
      setAutoReverse(false);
      setReverseDate('');
      setLines([emptyLine(), emptyLine()]);
      setReason('');
    }
  };

  // ── Allocation modal handlers ─────────────────────────────────────────────
  const openAllocModal = useCallback((lineKey) => {
    const line = lines.find(l => l._key === lineKey);
    if (!line || !line.entityId) return;
    const amount = parseFloat(line.debit) || parseFloat(line.credit) || 0;
    setAllocModal({
      lineKey,
      entityType:  line.entityType,
      entityId:    parseInt(line.entityId),
      entityName:  line.entityName || `${line.entityType} #${line.entityId}`,
      maxAmount:   amount,
    });
  }, [lines]);

  const handleAllocSave = useCallback((lineKey, allocations) => {
    setLines(prev => prev.map(l =>
      l._key === lineKey ? { ...l, allocations } : l
    ));
  }, []);

  // ── reverse / delete ──────────────────────────────────────────────────────────
  const reverseEntry = async () => {
    const why = window.prompt(`Reason to reverse ${viewData?.je_number}?`);
    if (!why) return;
    const hasAllocs = jeAllocations.length > 0;
    if (hasAllocs) {
      const ok = window.confirm(
        `This JE has ${jeAllocations.length} allocation(s) against open documents.\n\n` +
        `Reversing will:\n` +
        `  • Create a reversal JE\n` +
        `  • Remove all allocations\n` +
        `  • Reopen any closed bills/invoices\n\n` +
        `Continue?`
      );
      if (!ok) return;
    }
    try {
      const res = await api.post(`/api/journal-entries/${id}/reverse`, { reason: why });
      const removed = res.allocations_removed || 0;
      toast.success(`JE reversed${removed > 0 ? ` — ${removed} allocation(s) removed` : ''}`);
      navigate(`/journal-entries/${res.reversal.id}`);
    } catch (err) { toast.error(err.message); }
  };

  const deleteDraft = async () => {
    if (!window.confirm('Delete this draft journal entry?')) return;
    try {
      await api.del(`/api/journal-entries/${id}`);
      toast.success('Draft deleted');
      navigate('/journal-entries');
    } catch (err) { toast.error(err.message); }
  };

  // (quickCreateCC removed - now handled natively by CostCenterSelect component)

  // ── More menu items ───────────────────────────────────────────────────────────
  const isReversalEntry = ['reversal', 'edit_reversal'].includes(viewData?.source_type);
  const isReversedEntry = viewData?.is_reversed === true;

  const moreItems = readOnly ? [
    // Only allow Edit on posted JEs that are NOT reversed and NOT a reversal
    canEdit() && !isReversedEntry && !isReversalEntry && {
      label: 'Edit', icon: <Edit3 size={13} />, onClick: () => navigate(`/journal-entries/${id}?mode=edit`),
    },
    // Reverse only available if posted, not already reversed, not itself a reversal
    viewData?.status === 'posted' && canEdit() && !isReversedEntry && !isReversalEntry && {
      label: 'Reverse Entry', icon: <RotateCcw size={13} />, onClick: reverseEntry,
    },
    null,
    { label: 'Print', icon: <Printer size={13} />, onClick: () => window.print() },
  ].filter(Boolean) : [
    viewData?.status === 'draft' && canEdit() && {
      label: 'Delete Draft', icon: <Trash2 size={13} />, danger: true, onClick: deleteDraft,
    },
    { label: 'Print', icon: <Printer size={13} />, onClick: () => window.print() },
  ].filter(Boolean);

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <TransactionPageLayout
        header={
          <TransactionHeader
            title={isExisting ? `Journal Entry: ${viewData?.je_number || '…'}` : 'New Journal Entry'}
            icon={<BookOpen size={18} />}
            badge={viewData ? { label: viewData.status, className: `b-${viewData.status}` } : undefined}
            breadcrumbs={[
              { label: 'Accounting', href: '/journal-entries' },
              { label: 'Journal Entries', href: '/journal-entries' },
              { label: isExisting ? (viewData?.je_number || 'View') : 'New Journal Entry' },
            ]}
            backTo="/journal-entries"
            backLabel="Journal Entries"
            actions={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isReversedEntry && <span className="badge b-cancelled" style={{ fontSize: 10 }}>REVERSED</span>}
                {isReversalEntry && <span className="badge b-process" style={{ fontSize: 10 }}>REVERSAL</span>}
                {moreItems.length > 0 && <MoreMenu items={moreItems} />}
              </div>
            }
            auditMeta={viewData?.date ? `Dated: ${new Date(viewData.date).toLocaleDateString('en-IN')}` : undefined}
          />
        }
        footer={
          <StickyActionFooter
            left={
              <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                <div className="je-bal-item">
                  <div className="je-bal-label">Total Debit</div>
                  <div className="je-bal-value">{fmt(totals.debit)}</div>
                </div>
                <div className="je-bal-sep" />
                <div className="je-bal-item">
                  <div className="je-bal-label">Total Credit</div>
                  <div className="je-bal-value">{fmt(totals.credit)}</div>
                </div>
                <div className="je-bal-sep" />
                <div className="je-bal-item">
                  <div className="je-bal-label">Difference</div>
                  <div className={`je-bal-value ${totals.balanced ? 'bal-ok' : 'bal-err'}`}>
                    {totals.balanced
                      ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Check size={15} /> Balanced</span>
                      : fmt(totals.diff)}
                  </div>
                </div>
              </div>
            }
            right={isEdit ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => navigate(isExisting ? `/journal-entries/${id}` : '/journal-entries')}>Cancel</button>
                <button className="btn btn-sm" onClick={handleSaveDraft} disabled={saving}><Save size={13} /> Save Draft</button>
                <button className="btn btn-sm btn-primary" onClick={handleSaveAndPost} disabled={saving || !totals.balanced}>
                  <Check size={13} /> {saving ? 'Saving…' : (isExisting ? 'Save Correction' : 'Save & Post')}
                </button>
                {!isExisting && (
                  <button className="btn btn-sm" onClick={handleSaveAndNew} disabled={saving || !totals.balanced} title="Save, post, and start a new entry">
                    <RefreshCw size={13} /> Save & New
                  </button>
                )}
              </div>
            ) : null}
          />
        }
      >
        {/* ── Reversal/Reversed notice banner ── */}
        {isExisting && (isReversedEntry || isReversalEntry) && (
          <div style={{
            padding: '10px 14px',
            background: isReversedEntry ? '#FFF3E0' : '#F3E5F5',
            border: `1px solid ${isReversedEntry ? '#FFB74D' : '#CE93D8'}`,
            borderRadius: 8, fontSize: 12,
            display: 'flex', alignItems: 'center', gap: 8,
            color: isReversedEntry ? '#E65100' : '#6A1B9A',
          }}>
            <AlertCircle size={14} />
            {isReversedEntry
              ? `This entry has been reversed. GL balances are netted out. No further edits or allocations are allowed.`
              : `This is a reversal entry. It was created to undo ${viewData?.original_je?.je_number || 'a prior JE'} and cancels its accounting effect.`}
          </div>
        )}

        {/* Reversal links */}
        {isExisting && isReversedEntry && viewData?.reversal_je && (
          <div style={{ fontSize: 12, color: '#C62828', padding: '4px 2px' }}>
            Reversed by{' '}
            <button
              className="btn-link"
              style={{ color: '#C62828', fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => navigate(`/journal-entries/${viewData.reversal_je.id}`)}
            >
              {viewData.reversal_je.je_number}
            </button>
          </div>
        )}
        {isExisting && isReversalEntry && viewData?.original_je && (
          <div style={{ fontSize: 12, color: '#7B1FA2', padding: '4px 2px' }}>
            Reversal of{' '}
            <button
              className="btn-link"
              style={{ color: '#7B1FA2', fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => navigate(`/journal-entries/${viewData.original_je.id}`)}
            >
              {viewData.original_je.je_number}
            </button>
          </div>
        )}

        {/* ── Journal Details ── */}
        <FormSectionCard title="Journal Details" icon={<BookOpen size={13} />}>
          <div className="je-meta-grid">
            <div className="fg">
              <label>Journal Date *</label>
              <DatePicker value={date} onChange={v => setDate(v)} disabled={readOnly} />
            </div>
            <div className="fg">
              <label>JE Number</label>
              <input value={jeNumber} readOnly style={{ background: 'var(--g100)', color: 'var(--g600)' }} />
            </div>
            <div className="fg">
              <label>Currency</label>
              <input value="INR" readOnly style={{ background: 'var(--g100)', color: 'var(--g600)', maxWidth: 80 }} />
            </div>
            <div className="fg">
              <label>Reference No</label>
              <input
                value={referenceNo}
                onChange={e => setReferenceNo(e.target.value)}
                placeholder="Bill / Cheque / Bank ref"
                disabled={readOnly}
              />
            </div>
            <div className="fg">
              <label>Source Type</label>
              {readOnly ? (
                <input value={sourceType} readOnly style={{ background: 'var(--g100)', color: 'var(--g600)' }} />
              ) : (
                <SelectDropdown value={sourceType} onChange={e => setSourceType(e.target.value)} disabled={isExisting}>
                  <option value="manual">Manual</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="opening_balance">Opening Balance</option>
                  <option value="accrual">Accrual</option>
                  <option value="prepayment">Prepayment</option>
                  <option value="depreciation">Depreciation</option>
                  <option value="provision">Provision</option>
                </SelectDropdown>
              )}
            </div>
            <div className="fg je-meta-memo">
              <label>Memo / Description</label>
              <input
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder="Purpose of this journal entry"
                disabled={readOnly}
              />
            </div>
          </div>

          {/* Auto-Reverse row */}
          {!readOnly && !isExisting && (
            <div className="je-meta-reverse-row">
              <label className="je-toggle-label">
                <span className="je-toggle-wrap">
                  <input
                    type="checkbox"
                    className="je-toggle-input"
                    checked={autoReverse}
                    onChange={e => setAutoReverse(e.target.checked)}
                  />
                  <span className="je-toggle-slider" />
                </span>
                Auto-Reverse
              </label>
              {autoReverse && (
                <div className="fg" style={{ marginLeft: 16 }}>
                  <label>Reverse Date *</label>
                  <DatePicker
                    value={reverseDate}
                    onChange={v => setReverseDate(v)}
                    min={date}
                  />
                </div>
              )}
              {autoReverse && (
                <span className="je-auto-rev-hint">
                  A draft reversal entry will be created for the selected date after posting.
                </span>
              )}
            </div>
          )}

          {/* Edit correction reason */}
          {isExisting && isEdit && (
            <div className="je-meta-grid" style={{ marginTop: 10, borderTop: '1px solid var(--g200)', paddingTop: 10 }}>
              <div className="fg je-meta-memo">
                <label>Correction / Edit Reason *</label>
                <input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Required: explain why this entry is being edited (audit trail)"
                />
              </div>
            </div>
          )}
        </FormSectionCard>

        {/* ── Lines Section ── */}
        <FormSectionCard
          title="Entry Lines"
          icon={<BookOpen size={13} />}
          noPad
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BalanceTag balanced={totals.balanced} diff={totals.diff} />
              {isEdit && (
                <button className="btn btn-sm" onClick={addLine}>
                  <Plus size={12} /> Add Line
                </button>
              )}
            </div>
          }
        >
          <div className="je-table-scroll">
            <table className="je-pro-table">
              <thead>
                <tr>
                  <th className="je-th-num">#</th>
                  <th className="je-th-account">Account</th>
                  <th className="je-th-name">Name / Party</th>
                  <th className="je-th-desc">Description</th>
                  <th className="je-th-amt">Debit</th>
                  <th className="je-th-amt">Credit</th>
                  <th className="je-th-cc">Cost Center</th>
                  <th className="je-th-ref">Line Ref</th>
                  {isEdit && <th className="je-th-act"></th>}
                </tr>
              </thead>
              <tbody>
                {paginatedLines.map((line, localIdx) => {
                  const idx = (page - 1) * pageSize + localIdx;
                  return (
                  <JELineRow
                    key={line._key}
                    line={line}
                    idx={idx}
                    accounts={accounts}
                    entities={entities}
                    costCenters={costCenters}
                    readOnly={readOnly}
                    isEdit={isEdit}
                    canRemove={lines.length > 2}
                    onUpdate={updateLine}
                    onRemove={removeLine}
                    onDuplicate={duplicateLine}
                    onAddLine={addLine}
                    onRefreshCostCenters={loadCostCenters}
                    isLast={idx === lines.length - 1}
                    onOpenAllocation={openAllocModal}
                    lineAllocations={
                      isExisting
                        ? jeAllocations.filter(a =>
                            String(a.entity_id) === String(line.entityId) &&
                            a.entity_type === line.entityType)
                        : line.allocations || []
                    }
                  />
                  );
                })}
              </tbody>
            </table>
          </div>
            {lines.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
                <span>Showing {lines.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, lines.length)} of {lines.length} records</span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            )}

        </FormSectionCard>
      </TransactionPageLayout>

      {/* ── Allocation Modal ── */}
      {allocModal && (
        <AllocationModal
          isOpen={!!allocModal}
          onClose={() => setAllocModal(null)}
          onSave={(allocs) => { handleAllocSave(allocModal.lineKey, allocs); setAllocModal(null); }}
          entityType={allocModal.entityType}
          entityId={allocModal.entityId}
          entityName={allocModal.entityName}
          maxAmount={allocModal.maxAmount}
          existingAllocations={lines.find(l => l._key === allocModal.lineKey)?.allocations || []}
        />
      )}
    </>
  );
}

// ─── JE Line Row (extracted for clarity) ─────────────────────────────────────
function JELineRow({
  line, idx, accounts, entities, costCenters,
  readOnly, isEdit, canRemove,
  onUpdate, onRemove, onDuplicate, onAddLine, onRefreshCostCenters, isLast,
  onOpenAllocation, lineAllocations
}) {
  const handleAccountChange = (accId, acc) => {
    onUpdate(line._key, 'accountId', accId, { accountName: acc ? `${acc.name} (${acc.code})` : '' });
  };

  const handleEntityChange = (entId, entType, ent) => {
    onUpdate(line._key, 'entityId', entId, {
      entityType: entType || '',
      entityName: ent?.name || '',
    });
  };

  // Infer entity type filter from account name heuristics
  const entityTypeFilter = useMemo(() => {
    if (!line.accountId || !accounts.length) return '';
    const acc = accounts.find(a => String(a.id) === String(line.accountId));
    if (!acc) return '';
    const n = acc.name.toLowerCase();
    if (n.includes('receivable') || n.includes('debtor'))  return 'customer';
    if (n.includes('payable')    || n.includes('creditor')) return 'vendor';
    return '';
  }, [line.accountId, accounts]);

  // Show Allocate button when: AP/AR account + entity selected + amount entered
  const canAllocate = !readOnly && isEdit &&
    (entityTypeFilter === 'vendor' || entityTypeFilter === 'customer') &&
    !!line.entityId &&
    (parseFloat(line.debit) > 0 || parseFloat(line.credit) > 0);

  const allocCount  = (lineAllocations || []).length;
  const allocTotal  = (lineAllocations || []).reduce((s, a) => s + parseFloat(a.allocated_amount || 0), 0);

  // Enter on credit / ref field auto-adds row if on last line
  const handleAmtEnter = (e) => {
    if (e.key === 'Enter' && isLast) { e.preventDefault(); onAddLine(); }
  };

  return (
    <tr className={`je-line-row${!line.accountId ? ' je-line-empty' : ''}`}>
      {/* Row number */}
      <td className="je-td-num">{idx + 1}</td>

      {/* Account */}
      <td className="je-td-account">
        {readOnly ? (
          <span className="je-ro-text">{line.accountName || '—'}</span>
        ) : (
          <AccountSearch
            value={line.accountId}
            displayName={line.accountName}
            accounts={accounts}
            onChange={handleAccountChange}
            disabled={readOnly}
          />
        )}
      </td>

      {/* Name / Party */}
      <td className="je-td-name">
        {readOnly ? (
          <div>
            <span className="je-ro-text je-ro-muted">{line.entityName || '—'}</span>
            {allocCount > 0 && (
              <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: '#2E7D32',
                  background: '#E8F5E9', borderRadius: 3, padding: '1px 5px',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  <Link2 size={9} />
                  {allocCount} allocated · ₹{Math.round(allocTotal).toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <EntitySearch
            value={line.entityId}
            displayName={line.entityName}
            entities={entities}
            entityTypeFilter={entityTypeFilter}
            onChange={handleEntityChange}
            disabled={readOnly}
          />
        )}
      </td>

      {/* Description / Narration */}
      <td className="je-td-desc">
        {readOnly ? (
          <span className="je-ro-text je-ro-muted">{line.narration || '—'}</span>
        ) : (
          <input
            className="je-cell-input"
            value={line.narration}
            onChange={e => onUpdate(line._key, 'narration', e.target.value)}
            placeholder="Line note…"
          />
        )}
      </td>

      {/* Debit */}
      <td className="je-td-amt">
        {readOnly ? (
          <span className="je-ro-amt">{line.debit ? fmt(line.debit) : ''}</span>
        ) : (
          <input
            type="number"
            className="je-cell-input je-num-input"
            value={line.debit}
            onChange={e => onUpdate(line._key, 'debit', e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            onKeyDown={handleAmtEnter}
          />
        )}
      </td>

      {/* Credit */}
      <td className="je-td-amt">
        {readOnly ? (
          <span className="je-ro-amt">{line.credit ? fmt(line.credit) : ''}</span>
        ) : (
          <input
            type="number"
            className="je-cell-input je-num-input"
            value={line.credit}
            onChange={e => onUpdate(line._key, 'credit', e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            onKeyDown={handleAmtEnter}
          />
        )}
      </td>

      {/* Cost Center */}
      <td className="je-td-cc">
        {readOnly ? (
          <span className="je-ro-text je-ro-muted">
            {costCenters.find(cc => String(cc.id) === String(line.costCenterId))?.name || '—'}
          </span>
        ) : (
          <CostCenterSelect
            className="je-cell-input"
            value={line.costCenterId || ''}
            onChange={v => onUpdate(line._key, 'costCenterId', v)}
            costCenters={costCenters}
            onRefresh={onRefreshCostCenters}
            disabled={readOnly}
          />
        )}
      </td>

      {/* Line Reference */}
      <td className="je-td-ref">
        {readOnly ? (
          <span className="je-ro-text je-ro-muted">{line.referenceNo || '—'}</span>
        ) : (
          <input
            className="je-cell-input"
            value={line.referenceNo}
            onChange={e => onUpdate(line._key, 'referenceNo', e.target.value)}
            placeholder="Ref…"
            onKeyDown={handleAmtEnter}
          />
        )}
      </td>

      {/* Actions */}
      {isEdit && (
        <td className="je-td-act">
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {canAllocate && (
              <button
                className="btn btn-sm"
                onClick={() => onOpenAllocation(line._key)}
                style={{
                  fontSize: 10, padding: '2px 7px', height: 24,
                  display: 'flex', alignItems: 'center', gap: 3,
                  color:       allocCount > 0 ? '#2E7D32'      : 'var(--brand)',
                  borderColor: allocCount > 0 ? '#2E7D32'      : undefined,
                  background:  allocCount > 0 ? '#E8F5E9'      : undefined,
                  fontWeight:  allocCount > 0 ? 700            : 500,
                }}
              >
                <Link2 size={9} />
                {allocCount > 0 ? `${allocCount} Alloc.` : 'Allocate'}
              </button>
            )}
            <button
              className="icon-btn"
              title="Duplicate row"
              onClick={() => onDuplicate(line._key)}
              style={{ width: 24, height: 24 }}
            >
              <Copy size={11} />
            </button>
            {canRemove && (
              <button
                className="icon-btn"
                title="Remove row"
                onClick={() => onRemove(line._key)}
                style={{ width: 24, height: 24, color: 'var(--red)' }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
