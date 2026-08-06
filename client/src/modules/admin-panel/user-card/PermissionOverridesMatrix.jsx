import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MODULE_TREE, PERM_BITS, ACTIONS } from '../../../shared/constants/permissions';
import { overrideKey, getOverrideState, nextOverrideState, applyOverrideState } from './userCardModel';

const STATE_CLASS = {
  ALLOW: 'uc-state-btn uc-state-allow',
  DENY: 'uc-state-btn uc-state-deny',
  INHERIT: 'uc-state-btn uc-state-inherit',
};

const STATE_TEXT = { ALLOW: '✓ ALLOW', DENY: '✕ DENY', INHERIT: '—' };

/**
 * The pre-Brick-2 action matrix, preserved verbatim in behaviour.
 *
 * Three-state cycling (INHERIT → ALLOW → DENY → INHERIT) and the mask arithmetic
 * come from userCardModel, which lifted them unchanged out of the old drawer.
 * Only the container changed: it now lives inside a card section instead of
 * owning the whole panel.
 *
 * RBAC Brick 3 replaces this view with the grouped editor. Until then it stays
 * the working editor, so nothing here should be redesigned.
 */
export default function PermissionOverridesMatrix({ overrides, setOverrides, editable }) {
  const [expanded, setExpanded] = useState({});

  const toggleExpand = (moduleKey) =>
    setExpanded(prev => ({ ...prev, [moduleKey]: !(prev[moduleKey] !== false) }));

  const cycle = (moduleKey, submoduleKey, actionId) => {
    const bit = PERM_BITS[actionId];
    if (bit === undefined) return;
    const key = overrideKey(moduleKey, submoduleKey);
    const current = getOverrideState(overrides, moduleKey, submoduleKey, bit);
    const next = nextOverrideState(current);
    setOverrides(prev => ({
      ...prev,
      [key]: applyOverrideState(prev[key], bit, next),
    }));
  };

  const submoduleTotal = MODULE_TREE.reduce((sum, m) => sum + (m.submodules?.length || 0), 0);

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          fontSize: 11, marginBottom: 10, padding: '6px 12px',
          background: 'var(--g50)', borderRadius: 6, border: '1px solid var(--g200)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--g700)' }}>Override State Legend:</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={STATE_CLASS.INHERIT}>—</span> Inherit (Role Baseline)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={STATE_CLASS.ALLOW}>✓ ALLOW</span> Explicit Allow
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={STATE_CLASS.DENY}>✕ DENY</span> Explicit Deny
        </span>
      </div>

      <div className="uc-matrix-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <caption className="uc-sr-only">
            Per-user permission overrides by module, submodule and action. Each cell
            cycles between Inherit, Allow and Deny.
          </caption>
          <thead>
            <tr style={{ background: 'var(--table-header)', position: 'sticky', top: 0, zIndex: 2 }}>
              <th
                scope="col"
                style={{
                  padding: '8px 12px', textAlign: 'left', fontWeight: 700,
                  color: 'var(--g600)', fontSize: 11, textTransform: 'uppercase',
                  letterSpacing: .4, borderBottom: '2px solid #D4E8DC', minWidth: 180,
                }}
              >
                Module / Submodule
              </th>
              {ACTIONS.map(a => (
                <th
                  key={a.id}
                  scope="col"
                  style={{
                    minWidth: 64, padding: '8px 4px', textAlign: 'center', fontWeight: 700,
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: .4,
                    color: 'var(--g600)', borderBottom: '2px solid #D4E8DC',
                  }}
                >
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_TREE.map(mod => {
              const isExpanded = expanded[mod.module] !== false;

              return (
                <tr key={mod.module}>
                  <td colSpan={ACTIONS.length + 1} style={{ padding: 0, borderBottom: '1px solid var(--g200)' }}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(mod.module)}
                      aria-expanded={isExpanded}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                        padding: '7px 10px', background: 'var(--g50)', border: 'none',
                        cursor: 'pointer', userSelect: 'none', textAlign: 'left', font: 'inherit',
                      }}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{mod.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--g400)' }}>
                        {(mod.submodules || []).length} submodules
                      </span>
                    </button>

                    {isExpanded && (mod.submodules || []).map((sm, si) => (
                      <div
                        key={sm.key}
                        style={{
                          display: 'flex', alignItems: 'center',
                          borderTop: '1px solid var(--g100)',
                          background: si % 2 === 0 ? '#fff' : 'var(--table-alt)',
                        }}
                      >
                        <div style={{
                          flex: 1, padding: '6px 8px 6px 32px', fontSize: 12,
                          fontWeight: 500, color: 'var(--g700)', minWidth: 160,
                        }}>
                          {sm.label}
                        </div>
                        {ACTIONS.map(a => {
                          const state = getOverrideState(overrides, mod.module, sm.key, PERM_BITS[a.id]);
                          return (
                            <div key={a.id} style={{ minWidth: 64, textAlign: 'center', padding: '5px 4px' }}>
                              <button
                                type="button"
                                disabled={!editable}
                                className={STATE_CLASS[state]}
                                onClick={() => editable && cycle(mod.module, sm.key, a.id)}
                                aria-label={`${mod.label} ${sm.label} ${a.label}: ${state}. Activate to cycle Inherit, Allow, Deny.`}
                                title="Click to cycle: Inherit → Allow → Deny"
                              >
                                {STATE_TEXT[state]}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11, color: 'var(--g400)', marginTop: 8 }}>
        Showing {submoduleTotal} submodules across {MODULE_TREE.length} modules
      </div>
    </>
  );
}
