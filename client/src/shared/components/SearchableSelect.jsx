/**
 * SearchableSelect — lightweight typeahead dropdown.
 *
 * Two modes controlled by `dropdownSearch` prop:
 *
 * dropdownSearch=false (default — form fields)
 *   Trigger is a text input; search happens in the trigger.
 *   Dropdown shows only the filtered list.
 *
 * dropdownSearch=true (filter bars)
 *   Trigger is a button showing the selected label + chevron.
 *   Dropdown opens with a search input pinned at the top (sticky)
 *   followed by a scrollable list capped at 5 items.
 *
 * Props
 * ─────
 * value        {id, name, code, ...} | null
 * onChange     (item | null) => void
 * onSearch     async (q: string) => [{id, name, code, ...}]
 * options      static option array [{id, name, code}] (alternative to onSearch)
 * placeholder  string
 * disabled     boolean
 * dropdownSearch  boolean — use button-trigger + in-dropdown search
 * onAddNew     () => void
 * addNewLabel  string
 * style        object — wrapper styles
 * inputStyle   object — trigger input styles (default mode only)
 */
import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { X, ChevronDown, Search } from 'lucide-react';
import PortalDropdown from './PortalDropdown';
import { useDropdownGroup } from './DropdownGroup';

/* ── shared base styles ─────────────────────────────────────────────────────── */
const base = {
  wrapper:   { position: 'relative' },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  input: {
    width: '100%', height: 34, padding: '0 52px 0 8px',
    borderWidth: 1, borderStyle: 'solid', borderColor: '#ccc', borderRadius: 4,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    backgroundColor: '#fff', fontFamily: 'inherit',
    transition: 'border-color .12s',
  },
  inputFocus: { borderColor: '#0D7C5F', boxShadow: '0 0 0 2px rgba(13,124,95,.12)' },
  clearBtn: {
    position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#aaa', padding: 2, display: 'flex', alignItems: 'center',
  },
  chevron: {
    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
    color: '#aaa', pointerEvents: 'none', display: 'flex',
  },
  item: {
    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
    borderBottom: '1px solid #f5f5f5', display: 'flex',
    alignItems: 'baseline', gap: 6,
  },
  itemHover:  { background: '#EBF5F0' },
  itemActive: { background: '#E8F5E9' },
  itemName:   { fontWeight: 500, color: '#222' },
  itemCode:   { fontSize: 11, color: '#888' },
  msg:        { padding: '8px 12px', color: '#999', fontSize: 12 },
  addNew: {
    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
    color: '#0D7C5F', fontWeight: 600,
    borderTop: '1px solid #e8e8e8', background: '#F0FAF6',
    display: 'flex', alignItems: 'center', gap: 4,
  },
};

function createDebounce(fn, delay) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

export default function SearchableSelect({
  value, onChange, onSearch, options: staticOptions,
  placeholder = 'Search…',
  disabled = false,
  dropdownSearch = false,
  onAddNew, addNewLabel = '+ Add New',
  className, style, inputStyle,
  dropdownId,
}) {
  const idPrefix = useId();
  const [query,    setQuery]    = useState('');
  const [options,  setOptions]  = useState([]);
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef         = useRef(null);
  const inputRef        = useRef(null);
  const searchRef       = useRef(null);
  const portalRef       = useRef(null);
  const ignoreFocusRef  = useRef(false);
  const valueRef      = useRef(value);
  const openRef       = useRef(internalOpen);
  const mountedRef    = useRef(true);
  const hadOptionsRef = useRef((staticOptions?.length ?? 0) > 0);

  const group = useDropdownGroup();
  const usesGroup = !!(dropdownId && group);
  const open = usesGroup ? group.isActive(dropdownId) : internalOpen;

  const setOpen = useCallback((v) => {
    if (usesGroup) {
      if (typeof v === 'function') {
        const next = v(group.isActive(dropdownId));
        if (next) group.toggle(dropdownId);
        else group.close();
      } else if (v) {
        group.toggle(dropdownId);
      } else {
        group.close();
      }
    } else {
      setInternalOpen(v);
    }
  }, [usesGroup, dropdownId, group]);

  // Mark that staticOptions has been populated at least once (used to show
  // "Loading…" instead of "No options" while async parent data is arriving).
  useEffect(() => {
    if ((staticOptions?.length ?? 0) > 0) hadOptionsRef.current = true;
  }, [staticOptions]);

  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (dropdownId && group && group.isActive(dropdownId)) {
        group.close();
      }
    };
  }, []); // eslint-disable-line

  const runSearch = useCallback((q) => {
    if (staticOptions) return;
    if (!onSearch) return;
    debouncedSearch(q);
  }, [onSearch, staticOptions]); // eslint-disable-line

  const displayOptions = staticOptions ? (() => {
    const lower = (query || '').toLowerCase();
    return staticOptions.filter(o =>
      (o.name || '').toLowerCase().includes(lower) ||
      (o.code || '').toLowerCase().includes(lower) ||
      (o.item_name || '').toLowerCase().includes(lower) ||
      (o.lot_name || '').toLowerCase().includes(lower) ||
      (o.lot_number || '').toLowerCase().includes(lower)
    ).map(o => ({
      id: o.id,
      name: o.name || o.item_name || o.lot_name || o.lot_number,
      code: o.code || (o.lot_number !== (o.name || o.item_name || o.lot_name) ? o.lot_number : ''),
    }));
  })() : options;

  const debouncedSearch = useRef(createDebounce(async (q) => {
    setLoading(true);
    try {
      const res = await onSearch(q);
      if (mountedRef.current) {
        setOptions(Array.isArray(res) ? res : []);
      }
    } catch {
      if (mountedRef.current) setOptions([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, 180)).current;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, displayOptions.length]);

  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(`${idPrefix}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, idPrefix]);

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < displayOptions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : (displayOptions.length === 1 ? 0 : -1);
      if (idx >= 0 && idx < displayOptions.length) {
        handleSelect(displayOptions[idx]);
        wrapRef.current?.querySelector('button, input')?.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      wrapRef.current?.querySelector('button, input')?.focus();
    } else if (e.key === 'Tab') {
      // Close dropdown and let browser naturally move to next element
      setOpen(false);
      setQuery('');
    }
  };

  /* ── sync display text with selected value ─────────────────────────────────── */
  useEffect(() => {
    if (!dropdownSearch && mountedRef.current) {
      const v = valueRef.current;
      setQuery(v ? (v.code ? `${v.name} (${v.code})` : (v.name || '')) : '');
    }
  }, [dropdownSearch, value?.id]);

  /* ── close on outside click + ESC key ──────────────────────────────────── */
  useEffect(() => {
    const close = () => {
      if (!mountedRef.current) return;
      setOpen(false);
      setFocused(false);
      const v = valueRef.current;
      if (!dropdownSearch) {
        setQuery(v ? (v.code ? `${v.name} (${v.code})` : (v.name || '')) : '');
      } else {
        setQuery('');
      }
    };
    const outsideHandler = (e) => {
      if (!openRef.current) return;
      if (!wrapRef.current?.contains(e.target) && !portalRef.current?.contains(e.target)) {
        close();
      }
    };
    const escHandler = (e) => {
      if (openRef.current && e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('mousedown', outsideHandler);
    document.addEventListener('touchstart', outsideHandler);
    document.addEventListener('focusin', outsideHandler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', outsideHandler);
      document.removeEventListener('touchstart', outsideHandler);
      document.removeEventListener('focusin', outsideHandler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [dropdownSearch]); // eslint-disable-line

  /* ── re-filter when staticOptions list changes ───────────────────────────── */
  // Removed effect because staticOptions is now handled by derived state

  /* ── focus the in-dropdown search input when dropdown opens ─────────────── */
  useEffect(() => {
    if (dropdownSearch && open) {
      setQuery('');
      runSearch('');
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open, dropdownSearch]); // eslint-disable-line

  const handleSelect = (opt) => {
    onChange(opt);
    if (!dropdownSearch) {
      setQuery(opt.code ? `${opt.name} (${opt.code})` : (opt.name || ''));
    } else {
      setQuery('');
    }
    setOpen(false);
    setFocused(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
    setQuery('');
    setOpen(false);
    if (!dropdownSearch) inputRef.current?.focus();
  };

  const displayLabel = value ? (value.code ? `${value.name} (${value.code})` : (value.name || '')) : '';

  /* ══════════════════════════════════════════════════════════════════════════
     DROPDOWN-SEARCH MODE
  ══════════════════════════════════════════════════════════════════════════ */
  if (dropdownSearch) {
    return (
      <div ref={wrapRef} style={{ ...base.wrapper, ...style }}>
        <button
          type="button"
          className={className}
          disabled={disabled}
          onMouseDown={(e) => {
            ignoreFocusRef.current = true;
            if (!disabled) setOpen(o => !o);
            setTimeout(() => { ignoreFocusRef.current = false; }, 100);
          }}
          onFocus={(e) => {
            // Only open when arriving via Tab from outside this wrapper
            if (!disabled && !ignoreFocusRef.current && !wrapRef.current?.contains(e.relatedTarget)) {
              setOpen(true);
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget;
            if (!wrapRef.current?.contains(next) && !next?.closest?.('[data-portal-dropdown]')) {
              setOpen(false);
              setQuery('');
            }
          }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', height: 32, padding: '0 10px',
            borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--g300)', borderRadius: 'var(--radius)',
            background: disabled ? '#f5f5f5' : '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 13, fontFamily: 'inherit',
            color: value ? 'var(--g800)' : '#999',
            outline: 'none', boxSizing: 'border-box',
            transition: 'border-color .12s',
            ...(open ? { borderColor: '#0D7C5F', boxShadow: '0 0 0 2px rgba(13,124,95,.12)' } : {}),
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
            {displayLabel || placeholder}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 4 }}>
            {value && !disabled && (
              <span
                onMouseDown={handleClear}
                style={{ display: 'flex', alignItems: 'center', color: '#bbb', padding: 2 }}
              >
                <X size={11} />
              </span>
            )}
            <ChevronDown size={13} style={{ color: '#aaa', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </span>
        </button>

        <PortalDropdown anchorRef={wrapRef} open={open && !disabled} minWidth={160} maxHeight={280}>
          <div data-portal-dropdown="true" ref={portalRef}>
            <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '8px 8px 6px', background: '#fff', borderBottom: '1px solid var(--g200)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#bbb', pointerEvents: 'none' }} />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={e => { const q = e.target.value; setQuery(q); runSearch(q); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search…"
                  autoComplete="off"
                  style={{
                    width: '100%', height: 30, padding: '0 8px 0 28px',
                    border: '1px solid var(--g300)', borderRadius: 4,
                    fontSize: 12, outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {loading && <div style={base.msg}>Searching…</div>}
              {!loading && displayOptions.length === 0 && (
                <div style={base.msg}>
                  {query.trim()
                    ? 'No results'
                    : (staticOptions !== undefined && !hadOptionsRef.current
                        ? 'Loading…'   // async options not yet arrived
                        : 'No options'
                      )
                  }
                </div>
              )}
              {!loading && displayOptions.map((opt, idx) => (
                <div
                  key={opt.id}
                  id={`${idPrefix}-opt-${idx}`}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(opt); }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(-1)}
                  style={{
                    ...base.item,
                    ...(activeIndex === idx  ? base.itemHover  : {}),
                    ...(value?.id === opt.id ? base.itemActive : {}),
                  }}
                >
                  <span style={base.itemName}>{opt.name}</span>
                  {opt.code && <span style={base.itemCode}>({opt.code})</span>}
                </div>
              ))}
              {onAddNew && (
                <div onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onAddNew(); }} style={base.addNew}>
                  {addNewLabel}
                </div>
              )}
            </div>
          </div>
        </PortalDropdown>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     DEFAULT MODE  (input trigger)
  ══════════════════════════════════════════════════════════════════════════ */
  const handleInputChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    setOpen(true);
    if (!q.trim()) onChange(null);
    runSearch(q);
  };

  const handleFocus = () => { setFocused(true); setOpen(true); runSearch(query); };

  const inputStyle_ = {
    ...base.input,
    ...(focused  ? base.inputFocus : {}),
    ...(disabled ? { backgroundColor: '#f5f5f5', color: '#888', cursor: 'not-allowed' } : {}),
    ...inputStyle,
  };

  return (
    <div ref={wrapRef} style={{ ...base.wrapper, ...style }}>
      <div style={base.inputWrap}>
        <input
          ref={inputRef}
          type="text"
          className={className}
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => { setTimeout(() => { if (mountedRef.current) setFocused(false); }, 200); }}
          style={inputStyle_}
          autoComplete="off"
        />
        {value && !disabled && (
          <button style={base.clearBtn} onMouseDown={handleClear} tabIndex={-1}>
            <X size={12} />
          </button>
        )}
        <span style={base.chevron}><ChevronDown size={13} /></span>
      </div>

      <PortalDropdown anchorRef={wrapRef} open={open && !disabled} minWidth={180} maxHeight={260}>
        <div data-portal-dropdown="true" ref={portalRef}>
          {loading && <div style={base.msg}>Searching…</div>}
          {!loading && displayOptions.length === 0 && (
            <div style={base.msg}>{query.trim() ? 'No results found' : 'Start typing to search'}</div>
          )}
          {!loading && displayOptions.map((opt, idx) => (
            <div
              key={opt.id}
              id={`${idPrefix}-opt-${idx}`}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(opt); }}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(-1)}
              style={{
                ...base.item,
                ...(activeIndex === idx  ? base.itemHover  : {}),
                ...(value?.id === opt.id ? base.itemActive : {}),
              }}
            >
              <span style={base.itemName}>{opt.name}</span>
              {opt.code && <span style={base.itemCode}>({opt.code})</span>}
            </div>
          ))}
          {onAddNew && (
            <div
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); onAddNew(); }}
              style={base.addNew}
            >
              {addNewLabel}
            </div>
          )}
        </div>
      </PortalDropdown>
    </div>
  );
}
