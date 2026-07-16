import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import toast from 'react-hot-toast';
import { Search, Loader2, X } from 'lucide-react';
import { useAuth } from '../../core/context/AuthContext';
import { useClipboard } from '../../core/context/ClipboardContext';
import { groupBy } from '../../shared/utils/groupBy';
import { NAVIGATION } from '../../core/navigation/registry';
import { filterPages } from '../../core/navigation/selectors';

const TYPE_LABELS = {
  page:        'Page',
  inventory:   'Lot',
  invoice:     'Invoice',
  voucher:     'Voucher',
  account:     'Account',
  customer:    'Customer',
  vendor:      'Vendor',
  fixed_asset: 'Asset',
};

const TYPE_ORDER = ['page', 'inventory', 'invoice', 'voucher', 'account', 'customer', 'vendor', 'fixed_asset'];

function groupResults(results) {
  const grouped = groupBy(results, 'type');
  return TYPE_ORDER.filter(t => grouped[t]).map(t => ({ type: t, items: grouped[t] }));
}

// Mutable ref lets GlobalScanInput open the palette pre-filled without a circular import.
export let openPaletteWith = () => {};

export default function CommandPalette() {
  const { token, user, hasPermission, hasRole } = useAuth();
  const { add } = useClipboard();
  const navigate = useNavigate();

  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);

  const inputRef    = useRef(null);
  const abortRef    = useRef(null);
  const debounceRef = useRef(null);
  const focusTimerRef = useRef(null);

  useEffect(() => {
    openPaletteWith = (text) => {
      setQuery(text);
      setOpen(true);
    };
    return () => { openPaletteWith = () => {}; };
  }, []);

  useHotkeys('mod+k', (e) => {
    e.preventDefault();
    if (!user) { navigate('/login'); return; }
    setOpen(o => !o);
  }, { enableOnFormTags: false });

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current);
    
    const qLower = (q || '').toLowerCase();
    // Registry + shared permission selector — never surfaces inaccessible pages.
    const pages = filterPages(NAVIGATION, { hasPermission, hasRole })
      .filter(p => p.path && p.label.toLowerCase().includes(qLower))
      .map(p => ({
        id: p.path,
        type: 'page',
        label: p.label,
        subtitle: p.path,
        url: p.path
      }));

    if (!q || q.length < 2) { 
      setResults(pages); 
      setLoading(false); 
      return; 
    }

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&limit=20`,
          { headers: { Authorization: `Bearer ${token}` }, signal: abortRef.current.signal }
        );
        const data = await res.json();
        
        setResults([...pages, ...(data.results || [])]);
        setCursor(0);
      } catch (err) {
        if (err.name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, [token]);

  useEffect(() => {
    if (open) {
      focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
      search(query);
    } else {
      clearTimeout(focusTimerRef.current);
      setQuery('');
      setResults([]);
      setCursor(0);
    }
    return () => clearTimeout(focusTimerRef.current);
  }, [open, search, query]);

  useEffect(() => { search(query); }, [query, search]);

  // Cleanup debounce + abort on unmount
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const navigateTo = useCallback((item) => {
    setOpen(false);
    navigate(item.url);
  }, [navigate]);

  const clipItem = useCallback((item) => {
    add({ entity_type: item.type, entity_id: item.id, label: item.label });
    toast.success(`Clipped: ${item.label}`);
  }, [add]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[cursor];
      if (!item) return;
      if (e.shiftKey) clipItem(item);
      else navigateTo(item);
    }
  }, [results, cursor, clipItem, navigateTo]);

  if (!open) return null;

  const groups = groupResults(results);
  let globalIdx = 0;

  return (
    <div
      className="cp-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="cp-modal">
        <div className="cp-input-row">
          <Search size={16} className="cp-icon" />
          <input
            ref={inputRef}
            className="cp-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search lots, invoices, accounts, assets…"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <Loader2 size={16} className="cp-spin" />}
          <button className="cp-close" onClick={() => setOpen(false)}><X size={16} /></button>
        </div>

        {groups.length > 0 && (
          <div className="cp-results">
            {groups.map(({ type, items }) => (
              <div key={type} className="cp-group">
                <div className="cp-group-label">{TYPE_LABELS[type]}</div>
                {items.map(item => {
                  const idx    = globalIdx++;
                  const active = idx === cursor;
                  return (
                    <div
                      key={item.id}
                      className={`cp-item${active ? ' cp-item--active' : ''}`}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => navigateTo(item)}
                      onMouseDown={e => e.preventDefault()}
                    >
                      <div className="cp-item-main">
                        <span className="cp-item-label">{item.label}</span>
                        {item.subtitle && <span className="cp-item-sub">{item.subtitle}</span>}
                      </div>
                      <button
                        className="cp-clip-btn"
                        title="Add to clipboard (Shift+Enter)"
                        onClick={e => { e.stopPropagation(); clipItem(item); }}
                        onMouseDown={e => e.preventDefault()}
                      >
                        +Clip
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="cp-hint">↑↓ navigate · Enter open · Shift+Enter clip · Esc close</div>
          </div>
        )}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="cp-empty">No results for "{query}"</div>
        )}
      </div>

      <style>{`
        .cp-overlay {
          position: fixed; inset: 0; z-index: 9000;
          background: rgba(0,0,0,0.45);
          display: flex; align-items: flex-start; justify-content: center;
          padding-top: 80px;
        }
        .cp-modal {
          background: #fff; border-radius: 12px;
          box-shadow: 0 24px 60px rgba(0,0,0,0.25);
          width: 640px; max-width: 95vw;
          overflow: hidden;
        }
        .cp-input-row {
          display: flex; align-items: center; gap: 10px;
          padding: 14px 16px; border-bottom: 1px solid #eee;
        }
        .cp-icon { color: #888; flex-shrink: 0; }
        .cp-input {
          flex: 1; border: none; outline: none;
          font-size: 15px; font-family: inherit; background: transparent;
        }
        .cp-spin { animation: spin 0.8s linear infinite; color: #888; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .cp-close {
          background: none; border: none; cursor: pointer; color: #888; padding: 2px;
          display: flex; align-items: center;
        }
        .cp-results { max-height: 420px; overflow-y: auto; padding: 8px 0; }
        .cp-group { padding: 4px 0; }
        .cp-group-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: #999;
          padding: 4px 16px 2px;
        }
        .cp-item {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 16px; cursor: pointer; gap: 12px;
        }
        .cp-item--active { background: #f0faf6; }
        .cp-item-main { flex: 1; min-width: 0; }
        .cp-item-label {
          display: block; font-size: 13px; font-weight: 500; color: #1a1a1a;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cp-item-sub {
          display: block; font-size: 11px; color: #888;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .cp-clip-btn {
          font-size: 10px; padding: 2px 8px; border-radius: 4px;
          border: 1px solid #c8e6c9; background: #e8f5e9; color: #2e7d32;
          cursor: pointer; white-space: nowrap; flex-shrink: 0;
        }
        .cp-clip-btn:hover { background: #c8e6c9; }
        .cp-hint {
          font-size: 10px; color: #bbb; text-align: center;
          padding: 8px; border-top: 1px solid #f0f0f0;
        }
        .cp-empty { padding: 24px; text-align: center; color: #999; font-size: 13px; }
      `}</style>
    </div>
  );
}
