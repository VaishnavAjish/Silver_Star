import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ChevronDown, Settings, X, ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { useAuth } from '../../core/context/AuthContext';
import { useApi } from '../../shared/hooks/useApi';
import {
  ALL_ENTRIES, getEntryById, PRESETS, DEFAULT_PRESET_BY_ROLE, MAX_VISIBLE_SHORTCUTS,
} from '../../core/navigation/registry';
import {
  isEntryVisible, resolveShortcutIds, sanitizeShortcutIds,
  parseShortcutPref, serializeShortcutPref,
} from '../../core/navigation/selectors';


/**
 * User-pinned header shortcuts. Registry-driven, permission-filtered on EVERY
 * render (a revoked permission drops the chip; an unknown/stale id is skipped).
 * Ids only — never an arbitrary URL. Persisted to the user's own
 * user_preferences via the self-service API; localStorage mirrors first paint.
 */
export default function HeaderShortcuts() {
  const { user, hasPermission, hasRole, getPreference } = useAuth();
  const api = useApi();
  const navigate = useNavigate();

  const ctx = useMemo(() => ({ hasPermission, hasRole }), [hasPermission, hasRole]);
  const role = String(user?.role || '').toLowerCase();
  const defaultPreset = DEFAULT_PRESET_BY_ROLE[role] || 'inventory';

  const [state, setState] = useState({ preset: null, ids: null });
  const [showOverflow, setShowOverflow] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);

  // Load: localStorage cache first (instant), then the authoritative /me pref.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const cached = localStorage.getItem(`nav.shortcuts.cache:${user.id}`);
      if (cached) setState(parseShortcutPref(cached, defaultPreset));
    } catch { /* ignore */ }
  }, [user?.id, defaultPreset]);

  useEffect(() => {
    if (!user) return;
    const raw = getPreference('nav.shortcuts', null);
    if (raw != null) setState(parseShortcutPref(raw, defaultPreset));
  }, [user, getPreference, defaultPreset]);

  // Effective ids: explicit user list, else the role/persona preset.
  const effectiveIds = useMemo(() => {
    if (Array.isArray(state.ids)) return state.ids;
    const presetName = state.preset || defaultPreset;
    return PRESETS[presetName] || [];
  }, [state, defaultPreset]);

  const resolved = useMemo(
    () => resolveShortcutIds(effectiveIds, getEntryById, ctx),
    [effectiveIds, ctx]
  );
  const visible = resolved.slice(0, MAX_VISIBLE_SHORTCUTS);
  const overflow = resolved.slice(MAX_VISIBLE_SHORTCUTS);

  // Pinnable entries the user is permitted to see (the "add" catalogue).
  const pinnable = useMemo(
    () => ALL_ENTRIES.filter(e => e.pinnable && isEntryVisible(e, ctx)),
    [ctx]
  );
  const pinnedIdSet = new Set(resolved.map(e => e.id));

  const persist = useCallback((ids, preset) => {
    const clean = sanitizeShortcutIds(ids, getEntryById);
    const value = serializeShortcutPref(clean, preset);
    setState({ preset: preset || null, ids: clean });
    // Fire-and-forget; UI already reflects the change. Failure keeps the cache.
    api.put('/api/me/preferences', { preferences: [{ pref_key: 'nav.shortcuts', pref_value: value }] })
      .catch(() => { /* offline / unavailable — cache holds until next save */ });
    if (user?.id) {
      try { localStorage.setItem(`nav.shortcuts.cache:${user.id}`, value); } catch { /* ignore */ }
    }
  }, [api, user?.id]);

  const currentIds = () => resolved.map(e => e.id);
  const addShortcut = (id) => persist([...currentIds(), id], null);
  const removeShortcut = (id) => persist(currentIds().filter(x => x !== id), null);
  const move = (id, dir) => {
    const ids = currentIds();
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    persist(ids, null);
  };
  const applyPreset = (name) => persist(PRESETS[name] || [], name);

  const go = (entry) => { setShowOverflow(false); navigate(entry.path); };

  const chip = (entry, key) => {
    const Icon = entry.icon;
    return (
      <button key={key} type="button" className="hs-chip" title={entry.label} onClick={() => go(entry)}>
        {Icon && <Icon size={13} />}
        <span className="hs-chip-label">{entry.label}</span>
      </button>
    );
  };

  return (
    <div className="hs-wrap" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {visible.map((e, i) => chip(e, e.id + i))}

      {overflow.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button type="button" className="hs-chip" aria-haspopup="true" aria-expanded={showOverflow}
            onClick={() => setShowOverflow(o => !o)} title="More shortcuts">
            <ChevronDown size={13} /> More
          </button>
          {showOverflow && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowOverflow(false)} />
              <div className="hs-pop" style={popStyle}>
                {overflow.map(e => (
                  <button key={e.id} type="button" className="hs-pop-item" style={popItemStyle} onClick={() => go(e)}>
                    {e.icon && <e.icon size={13} />} {e.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button type="button" className="hs-chip" title="Customize shortcuts"
        aria-label="Customize shortcuts" onClick={() => setShowCustomize(true)}>
        <Settings size={14} />
      </button>

      {showCustomize && (
        <div className="modal-overlay" onClick={() => setShowCustomize(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <Star size={16} /> Customize Shortcuts
              </div>
              <button className="icon-btn" onClick={() => setShowCustomize(false)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase', marginBottom: 6 }}>Presets</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {['factory', 'accounts', 'inventory', 'management'].map(p => (
                  <button key={p} type="button" className="btn btn-sm" onClick={() => applyPreset(p)} style={{ textTransform: 'capitalize' }}>{p}</button>
                ))}
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase', marginBottom: 6 }}>
                Pinned ({resolved.length})
              </div>
              {resolved.length === 0 && <div style={{ fontSize: 12, color: 'var(--g500)', marginBottom: 10 }}>Nothing pinned yet.</div>}
              {resolved.map((e, i) => (
                <div key={e.id} style={rowStyle}>
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    {e.icon && <e.icon size={13} />} {e.label}
                    {i >= MAX_VISIBLE_SHORTCUTS && <span style={{ fontSize: 10, color: 'var(--g400)' }}>(overflow)</span>}
                  </span>
                  <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(e.id, -1)}><ArrowUp size={13} /></button>
                  <button className="icon-btn" title="Move down" disabled={i === resolved.length - 1} onClick={() => move(e.id, 1)}><ArrowDown size={13} /></button>
                  <button className="icon-btn" title="Unpin" onClick={() => removeShortcut(e.id)}><X size={13} /></button>
                </div>
              ))}

              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--g500)', textTransform: 'uppercase', margin: '14px 0 6px' }}>Add</div>
              {pinnable.filter(e => !pinnedIdSet.has(e.id)).map(e => (
                <div key={e.id} style={rowStyle}>
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    {e.icon && <e.icon size={13} />} {e.label}
                  </span>
                  <button className="icon-btn" title="Pin" onClick={() => addShortcut(e.id)}><Plus size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const popStyle = { position: 'absolute', right: 0, top: 34, background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 4, minWidth: 200, zIndex: 41, display: 'flex', flexDirection: 'column', gap: 2 };
const popItemStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'none', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%', color: 'inherit' };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--g100)' };
