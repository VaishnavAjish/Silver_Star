import { memo } from 'react';
import PermissionOverrideControl from './PermissionOverrideControl';
import { PermissionEffectiveResult } from './PermissionBadges';
import { BASELINE, BASELINE_LABELS } from './permissionEditorModel';

/**
 * One applicable action of one capability, as four labelled fields:
 * Action · Role Baseline · User Override · Effective Result (+ source).
 *
 * On desktop these are grid columns; the same markup stacks under the User
 * Card's narrow breakpoint, which is why every field carries its own visible
 * label rather than relying on a distant table header. Nothing here computes
 * permission algebra — `row` arrives already resolved.
 */
function PermissionActionRow({ row, capability, roleNames, disabled, onChange }) {
  const { action, baselineState, overrideState, effect, source } = row;

  return (
    <div className="pe-action-row">
      <div className="pe-cell pe-cell-action">
        <span className="pe-field-label">Action</span>
        <span className="pe-action-name">{action.label}</span>
      </div>

      <div className="pe-cell">
        <span className="pe-field-label">Role Baseline</span>
        <span className={`pe-baseline pe-baseline-${baselineState.toLowerCase()}`}>
          {BASELINE_LABELS[baselineState]}
          {baselineState === BASELINE.NO_ROW && (
            <span className="uc-sr-only"> — no role baseline row is configured</span>
          )}
        </span>
      </div>

      <div className="pe-cell">
        <span className="pe-field-label">User Override</span>
        <PermissionOverrideControl
          label={`${capability.label} — ${action.label} user override`}
          state={overrideState}
          disabled={disabled}
          onChange={onChange}
        />
      </div>

      <div className="pe-cell pe-cell-effect">
        <span className="pe-field-label">Effective Result</span>
        <PermissionEffectiveResult effect={effect} source={source} roleNames={roleNames} />
      </div>
    </div>
  );
}

export default memo(PermissionActionRow);
