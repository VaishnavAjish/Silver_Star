import { memo } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import PermissionActionRow from './PermissionActionRow';
import {
  PermissionEnforcementBadge, PermissionStatusBadge, PermissionRiskBadge,
} from './PermissionBadges';
import { BASELINE, NO_BASELINE_NOTE, NOT_REPORTED_NOTE } from './permissionEditorModel';
import { STATUS_NOTE } from './permissionCatalogModel';

/** `inventory:stock_transfer` — diagnostic only, never the primary label. */
function backendKeyOf(capability) {
  return capability.submodule === ''
    ? `${capability.module} (${capability.submoduleLabel})`
    : `${capability.module}:${capability.submodule}`;
}

/**
 * One business capability: a header carrying its classification, then only the
 * actions the catalog says apply to it.
 *
 * The backend module/submodule key is present but demoted to a diagnostic line —
 * an admin picks a capability by what it does, not by its database key, while
 * support still needs the key to be findable.
 */
function PermissionCapabilityCard({
  view, roleNames, editable, onChangeAction, onResetCapability,
}) {
  const { capability, visibleRows, overrideCount } = view;
  const statusNote = STATUS_NOTE[capability.status];
  const baselineNotReported = visibleRows.some(r => r.baselineState === BASELINE.NOT_REPORTED);

  return (
    <section className="pe-capability" aria-label={capability.label} data-code={capability.code}>
      <header className="pe-cap-head">
        <div className="pe-cap-title">
          <h5 className="pe-cap-label">{capability.label}</h5>
          <div className="pe-cap-chips">
            <PermissionStatusBadge status={capability.status} />
            <PermissionRiskBadge risk={capability.riskLevel} />
            <PermissionEnforcementBadge capability={capability} />
            {overrideCount > 0 && (
              <span className="pe-chip pe-chip-override">
                {overrideCount} override{overrideCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        {editable && overrideCount > 0 && (
          <button
            type="button"
            className="pe-linkbtn"
            onClick={() => onResetCapability(capability)}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset {capability.label}
          </button>
        )}
      </header>

      {capability.description && <p className="pe-cap-desc">{capability.description}</p>}

      <p className="pe-cap-key" title={`Catalog code ${capability.code}`}>
        Stored as <code>{backendKeyOf(capability)}</code>
        {capability.canonicalCode && <> · canonical <code>{capability.canonicalCode}</code></>}
      </p>

      {statusNote && <p className="pe-cap-note">{statusNote}</p>}

      {!capability.hasBaselineRow && (
        <p className="pe-cap-note pe-cap-note-warn">
          <AlertTriangle size={12} aria-hidden="true" />
          {NO_BASELINE_NOTE}
        </p>
      )}

      {baselineNotReported && (
        <p className="pe-cap-note">
          <AlertTriangle size={12} aria-hidden="true" />
          {NOT_REPORTED_NOTE}
        </p>
      )}

      <div className="pe-actions">
        {visibleRows.map(row => (
          <PermissionActionRow
            key={row.action.id}
            row={row}
            capability={capability}
            roleNames={roleNames}
            disabled={!editable}
            onChange={next => onChangeAction(capability, row.action, next)}
          />
        ))}
      </div>
    </section>
  );
}

export default memo(PermissionCapabilityCard);
