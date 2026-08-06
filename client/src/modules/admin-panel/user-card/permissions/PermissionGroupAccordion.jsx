import { ChevronDown, ChevronRight } from 'lucide-react';
import PermissionCapabilityCard from './PermissionCapabilityCard';
import { PermissionStatusBadge } from './PermissionBadges';
import { OVERRIDE_STATE, overrideStateFor } from './permissionEditorModel';
import { STATUS_NOTE } from './permissionCatalogModel';

const STATE_TEXT = {
  [OVERRIDE_STATE.ALLOW]: 'Allow',
  [OVERRIDE_STATE.DENY]: 'Deny',
  [OVERRIDE_STATE.INHERIT]: 'Inherit',
};

/**
 * A hidden entry, shown only under "Show inactive diagnostics".
 *
 * Read-only by construction: there is no override control at all, so a duplicate
 * or orphaned key can never become a second editable copy of a live capability.
 * Whatever masks it already holds are displayed, because they are preserved.
 */
function DiagnosticEntry({ capability, overrides }) {
  const stored = capability.actions
    .map(action => ({
      action,
      state: overrideStateFor(overrides, capability.storageKey, action.bit),
    }))
    .filter(entry => entry.state !== OVERRIDE_STATE.INHERIT);

  return (
    <div className="pe-diagnostic">
      <div className="pe-diag-head">
        <span className="pe-diag-label">{capability.label}</span>
        <PermissionStatusBadge status={capability.status} />
        <code className="pe-diag-key">
          {capability.module}:{capability.submodule || capability.submoduleLabel}
        </code>
      </div>
      <p className="pe-cap-note">{STATUS_NOTE[capability.status]}</p>
      <p className="pe-diag-values">
        {stored.length === 0
          ? 'No stored override on this key.'
          : `Stored override preserved: ${stored.map(e => `${e.action.label} — ${STATE_TEXT[e.state]}`).join(', ')}`}
      </p>
    </div>
  );
}

/**
 * One business-group accordion.
 *
 * Expansion is pure presentation: it is owned by the editor above, never written
 * into the override map, and therefore can never make the card dirty or change
 * what a save sends.
 */
export default function PermissionGroupAccordion({
  group, expanded, onToggle, roleNames, editable, overrides,
  onChangeAction, onResetCapability,
}) {
  const panelId = `pe-group-${group.name.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="pe-group">
      <h4 className="pe-group-heading">
        <button
          type="button"
          className="pe-group-btn"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onToggle(group.name)}
        >
          {expanded
            ? <ChevronDown size={14} aria-hidden="true" />
            : <ChevronRight size={14} aria-hidden="true" />}
          <span className="pe-group-name">{group.name}</span>
          <span className="pe-group-counts">
            <span>{group.totalCapabilities} capabilities</span>
            {group.overrideCount > 0 && (
              <span className="pe-count-override">{group.overrideCount} overrides</span>
            )}
            {group.deniedCount > 0 && (
              <span className="pe-count-denied">{group.deniedCount} denied</span>
            )}
            {group.unenforcedCount > 0 && (
              <span className="pe-count-warn">{group.unenforcedCount} unenforced</span>
            )}
          </span>
        </button>
      </h4>

      {expanded && (
        <div className="pe-group-body" id={panelId}>
          {group.capabilities.map(view => (
            <PermissionCapabilityCard
              key={view.capability.code}
              view={view}
              roleNames={roleNames}
              editable={editable}
              onChangeAction={onChangeAction}
              onResetCapability={onResetCapability}
            />
          ))}

          {group.diagnostics.length > 0 && (
            <div className="pe-diagnostics">
              <h5 className="pe-diag-title">
                Inactive diagnostics ({group.diagnostics.length}) — read-only
              </h5>
              {group.diagnostics.map(capability => (
                <DiagnosticEntry
                  key={capability.code}
                  capability={capability}
                  overrides={overrides}
                />
              ))}
            </div>
          )}

          {group.capabilities.length === 0 && group.diagnostics.length === 0 && (
            <p className="pe-empty">No capabilities match the current search and filters.</p>
          )}
        </div>
      )}
    </div>
  );
}
