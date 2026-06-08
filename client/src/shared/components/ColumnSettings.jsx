import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Settings, Eye, EyeOff, RotateCcw } from 'lucide-react';

function ColumnRow({ col, isVisible, isMandatory, onToggle }) {
  const iconRef = useRef(null);

  useLayoutEffect(() => {
    if (iconRef.current) {
      iconRef.current.animate(
        [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 200, easing: 'ease-out' }
      );
    }
  }, [isVisible]);

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', cursor: isMandatory ? 'default' : 'pointer',
        fontSize: 13, color: isVisible ? 'var(--g800)' : 'var(--g400)',
        opacity: isVisible ? 1 : 0.6,
        transition: 'background .08s, color .15s, opacity .15s',
      }}
      onMouseEnter={e => { if (!isMandatory) e.currentTarget.style.background = 'var(--g50)'; }}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <span ref={iconRef} style={{ display: 'flex', alignItems: 'center', color: isVisible ? 'var(--brand)' : 'var(--g300)' }}>
        {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
      </span>
      <span style={{ flex: 1 }}>{col.label}</span>
      {isMandatory && (
        <span style={{ fontSize: 10, color: 'var(--g400)', fontStyle: 'italic' }}>required</span>
      )}
    </div>
  );
}

export default function ColumnSettings({ columns, visibleColumns, toggleColumn, resetLayout, mandatoryKeys = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const visibleCount = visibleColumns.filter(c => c.key !== '_actions').length;
  const totalCount = columns.filter(c => c.key !== '_actions').length;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        className="icon-btn"
        onClick={() => setOpen(o => !o)}
        title="Column settings"
        style={{ position: 'relative' }}
      >
        <Settings size={14} />
        {visibleCount < totalCount && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--accent)', border: '2px solid #fff',
          }} />
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, zIndex: 3000,
          marginTop: 6, background: '#fff',
          border: '1px solid var(--g200)', borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
          minWidth: 220, maxHeight: 320, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--g200)',
            fontSize: 12, fontWeight: 700, color: 'var(--g700)',
            textTransform: 'uppercase', letterSpacing: '0.3px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Columns ({visibleCount}/{totalCount})</span>
            <button
              onClick={() => { resetLayout(); setOpen(false); }}
              title="Reset columns to default"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 11, color: 'var(--g500)', padding: '2px 6px',
                borderRadius: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {columns.filter(c => c.key !== '_actions').map(col => {
              const isMandatory = mandatoryKeys.includes(col.key);
              const isVisible = col.visible !== false;
              return (
                <ColumnRow
                  key={col.key}
                  col={col}
                  isVisible={isVisible}
                  isMandatory={isMandatory}
                  onToggle={() => !isMandatory && toggleColumn(col.key)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}