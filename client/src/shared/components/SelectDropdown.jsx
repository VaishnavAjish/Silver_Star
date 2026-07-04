/**
 * SelectDropdown — styled drop-in replacement for native <select>.
 *
 * Usage (identical to <select>):
 *   <SelectDropdown value={form.status} onChange={e => setForm(p => ({...p, status: e.target.value}))}>
 *     <option value="">— Select —</option>
 *     <option value="active">Active</option>
 *     <option value="inactive">Inactive</option>
 *   </SelectDropdown>
 *
 * Behaviour:
 *   - ≤5 real options  → button trigger + dropdown list (no search)
 *   - >5 real options  → button trigger + sticky search in dropdown + scrollable list
 *   - onChange is called as onChange({ target: { value } }) — fully compatible with
 *     existing handlers that read e.target.value
 */
import { useState, useRef, useEffect, useMemo, useId } from 'react';
import React from 'react';
import { ChevronDown, Search, CheckSquare, Square, Trash2, X, Check } from 'lucide-react';
import PortalDropdown from './PortalDropdown';

export default function SelectDropdown({
  value,
  onChange,
  children,
  disabled = false,
  style,
  buttonStyle,
  className,
  placeholder,
  multiple = false,
  size = 'md',
}) {
  // Recursively extract plain text from React children (handles arrays, strings, numbers)
  const getText = (ch) => {
    if (ch == null) return '';
    if (typeof ch === 'string' || typeof ch === 'number') return String(ch);
    if (Array.isArray(ch)) return ch.map(getText).join('');
    if (React.isValidElement(ch)) return getText(ch.props.children);
    return '';
  };

  // Extract {value, label} from <option> children.
  // When <option> has no value prop, use its text content — matching native HTML behaviour.
  const options = React.Children.toArray(children)
    .filter(c => React.isValidElement(c) && c.type === 'option')
    .map(c => {
      const label = getText(c.props.children);
      const value = c.props.value !== undefined ? c.props.value : label;
      return { value, label, disabled: !!c.props.disabled };
    });

  const realCount  = options.filter(o => o.value !== '' && o.value != null).length;
  const showSearch = realCount > 3; // Enable search if there are more than 3 options

  const idPrefix = useId();

  const [open,       setOpen]      = useState(false);
  const [query,      setQuery]     = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [draftValues, setDraftValues] = useState([]);
  const wrapRef   = useRef(null);
  const searchRef = useRef(null);
  const ignoreFocusRef = useRef(false);
  const [focused, setFocused] = useState(false);

  // Close on outside click
  useEffect(() => {
    const handler = e => {
      if (wrapRef.current?.contains(e.target)) return;
      if (e.target.closest?.('[data-portal-dropdown]')) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (open && showSearch) {
      setQuery('');
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open, showSearch]);

  // Sync draft values for multi-select
  useEffect(() => {
    if (open && multiple) {
      setDraftValues(value ? String(value).split(',').filter(Boolean) : []);
    }
  }, [open, multiple, value]);

  const toggleDraftValue = (val) => {
    const sVal = String(val);
    setDraftValues(prev => prev.includes(sVal) ? prev.filter(v => v !== sVal) : [...prev, sVal]);
  };

  const applyMultiple = () => {
    setOpen(false);
    setQuery('');
    if (onChange) onChange({ target: { value: draftValues.join(',') } });
  };

  const clearMultiple = () => setDraftValues([]);

  // Memoized filters for performance
  const baseOpts = useMemo(() => 
    multiple ? options.filter(o => o.value !== '' && o.value != null) : options,
  [multiple, options]);

  const visibleOpts = useMemo(() => 
    showSearch && query.trim()
      ? baseOpts.filter(o => String(o.label).toLowerCase().includes(query.toLowerCase()))
      : baseOpts,
  [baseOpts, showSearch, query]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, visibleOpts.length]);

  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(`${idPrefix}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, idPrefix]);

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < visibleOpts.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : (visibleOpts.length === 1 ? 0 : -1);
      if (idx >= 0 && idx < visibleOpts.length) {
        handleSelect(visibleOpts[idx].value);
        if (!multiple) wrapRef.current?.querySelector('button')?.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      wrapRef.current?.querySelector('button')?.focus();
    } else if (e.key === 'Tab') {
      // Close dropdown and let browser naturally move to next element
      setOpen(false);
      setQuery('');
    }
  };

  const toggleAll = () => {
    if (draftValues.length === visibleOpts.length) {
      setDraftValues([]);
    } else {
      setDraftValues(visibleOpts.map(o => String(o.value)));
    }
  };

  let displayLabel = placeholder || '— Select —';
  const hasValue = value !== '' && value !== null && value !== undefined;

  if (multiple) {
    const vals = value ? String(value).split(',').filter(Boolean) : [];
    if (vals.length === 1) {
      displayLabel = options.find(o => String(o.value) === vals[0])?.label || vals[0];
    } else if (vals.length > 1) {
      const prefix = placeholder ? placeholder.replace('All ', '') : 'Selected';
      displayLabel = `${prefix} (${vals.length})`;
    }
  } else {
    const selectedLabel = options.find(o => String(o.value) === String(value ?? ''))?.label ?? '';
    displayLabel = hasValue && selectedLabel !== '' ? selectedLabel : displayLabel;
  }

  const handleSelect = val => {
    if (multiple) {
      toggleDraftValue(val);
    } else {
      setOpen(false);
      setQuery('');
      if (onChange) onChange({ target: { value: val } });
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      {/* Trigger button */}
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
          setFocused(true);
          // Only open when arriving via Tab (relatedTarget is outside this wrapper)
          if (!disabled && !ignoreFocusRef.current && !wrapRef.current?.contains(e.relatedTarget)) {
            setOpen(true);
          }
        }}
        onBlur={(e) => {
          setFocused(false);
          // Close when focus leaves the entire component (including portal dropdown)
          const next = e.relatedTarget;
          if (!wrapRef.current?.contains(next) && !next?.closest?.('[data-portal-dropdown]')) {
            setOpen(false);
            setQuery('');
          }
        }}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', height: size === 'sm' ? 28 : 34, padding: '0 10px',
          borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--g300)', borderRadius: 'var(--radius)',
          background: disabled ? 'var(--g100)' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: size === 'sm' ? 12 : 13, fontFamily: 'inherit',
          color: hasValue ? 'var(--g800)' : '#999',
          outline: 'none', boxSizing: 'border-box',
          transition: 'border-color .12s',
          ...(open || focused ? { borderColor: '#0D7C5F', boxShadow: '0 0 0 2px rgba(13,124,95,.12)' } : {}),
          ...buttonStyle,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel}
        </span>
        <ChevronDown
          size={13}
          style={{ color: '#aaa', flexShrink: 0, marginLeft: 6,
                   transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </button>

      {/* Dropdown */}
      <PortalDropdown anchorRef={wrapRef} open={open && !disabled} minWidth={0} maxHeight={340}>
        <div data-portal-dropdown="true" style={{ display: 'flex', flexDirection: 'column', maxHeight: 340 }}>
          {/* Sticky search (only when >5 options) */}
          {showSearch && (
            <div style={{
              position: 'sticky', top: 0, zIndex: 2,
              padding: '8px 8px 6px', background: '#fff',
              borderBottom: '1px solid var(--g200)',
            }}>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#bbb', pointerEvents: 'none' }} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search…"
                  autoComplete="off"
                  style={{
                    width: '100%', height: 30, padding: '0 8px 0 28px',
                    border: '1px solid var(--g300)', borderRadius: 4,
                    fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          )}

          {/* Select All (Multi-select) */}
          {multiple && visibleOpts.length > 0 && (
            <div
              onMouseDown={toggleAll}
              style={{
                padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                borderBottom: '1px solid var(--g200)', background: '#fafafa',
                display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--g700)'
              }}
            >
              <div style={{ marginRight: 8, display: 'flex', alignItems: 'center', color: draftValues.length === visibleOpts.length ? 'var(--brand)' : 'var(--g400)' }}>
                {draftValues.length === visibleOpts.length ? <CheckSquare size={14} /> : <Square size={14} />}
              </div>
              Select All
            </div>
          )}

          {/* Options list */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: showSearch ? 180 : 200 }}>
            {visibleOpts.map((opt, i) => {
              const isSel     = multiple ? draftValues.includes(String(opt.value)) : String(opt.value) === String(value ?? '');
              const isHovered = activeIndex === i;
              const isEmpty   = opt.value === '' || opt.value == null;
              return (
                <div
                  key={i}
                  id={`${idPrefix}-opt-${i}`}
                  onMouseDown={() => !opt.disabled && handleSelect(opt.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(-1)}
                  style={{
                    padding: '8px 12px', fontSize: 13,
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    borderBottom: '1px solid #f5f5f5',
                    background: (isSel && !multiple) ? '#E8F5E9' : isHovered ? '#EBF5F0' : '#fff',
                    color: opt.disabled ? '#ccc' : isEmpty ? '#999' : 'var(--g800)',
                    fontWeight: isSel ? 600 : 400,
                    display: 'flex', alignItems: 'center'
                  }}
                >
                  {multiple && (
                    <div style={{ marginRight: 8, display: 'flex', alignItems: 'center', color: isSel ? 'var(--brand)' : 'var(--g400)' }}>
                      {isSel ? <CheckSquare size={14} /> : <Square size={14} />}
                    </div>
                  )}
                  {opt.label}
                </div>
              );
            })}
            {visibleOpts.length === 0 && (
              <div style={{ padding: '8px 12px', color: '#999', fontSize: 12 }}>No results</div>
            )}
          </div>

          {/* Multi-select footer */}
          {multiple && (
            <div style={{
              padding: '8px 12px', borderTop: '1px solid var(--g200)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#fcfcfc', flexShrink: 0
            }}>
              <button type="button" title="Clear Selection" onClick={clearMultiple} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: '#FFEBEE', border: '1px solid #FFCDD2', color: '#C62828', borderRadius: 4, cursor: 'pointer' }}>
                <Trash2 size={13} />
              </button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" title="Cancel" onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: '#fff', border: '1px solid var(--g300)', color: 'var(--g700)', borderRadius: 4, cursor: 'pointer' }}>
                  <X size={14} />
                </button>
                <button type="button" title="Apply" onClick={applyMultiple} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'var(--brand)', border: '1px solid var(--brand-dark)', color: '#fff', borderRadius: 4, cursor: 'pointer' }}>
                  <Check size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </PortalDropdown>
    </div>
  );
}
