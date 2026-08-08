import { ChevronDown, ChevronRight } from 'lucide-react';
import EffectiveAccessRow from './EffectiveAccessRow';
import { STATUS_LABELS } from '../permissions/permissionCatalogModel';

/**
 * RBAC Brick 5 — one business group of action results.
 *
 * MEMBERSHIP IS NEVER DECLARED HERE. The group exists because the Brick 1
 * catalog says it does, and it contains what `filterAccessView` put in it. A
 * second hard-coded membership list is precisely how a capability goes missing
 * from one screen while still being editable on another.
 *
 * The header counts describe WHAT IS SHOWN, not what exists. Under an active
 * filter that is the only honest reading: a header claiming 34 allowed above
 * four visible rows would invite the admin to trust a number whose basis is
 * off screen.
 */
export default function EffectiveAccessGroup({
  group, expanded, onToggle, onOpenDetails, onEditPermission,
}) {
  const { counts } = group;
  const panelId = `ea-group-${group.name.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <section className="ea-group">
      <h4 className="ea-group-heading">
        {/* The accessible name is qualified rather than being the bare group
            name: the Brick 3 editor on the same tab has an accordion for the
            same business group, and two controls announcing only "Inventory"
            would be indistinguishable to a screen reader. */}
        <button
          type="button"
          className="ea-group-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`Effective access for ${group.name}`}
          onClick={() => onToggle(group.name)}
        >
          {expanded
            ? <ChevronDown size={14} aria-hidden="true" />
            : <ChevronRight size={14} aria-hidden="true" />}
          <span className="ea-group-name">{group.name}</span>
          <span className="ea-group-counts">
            {counts.allowed} Allowed · {counts.denied} Denied
            {counts.overrides > 0 && <> · {counts.overrides} Overrides</>}
            {counts.gaps > 0 && <> · {counts.gaps} Enforcement Gaps</>}
          </span>
        </button>
      </h4>

      {expanded && (
        <div className="ea-group-body" id={panelId}>
          {group.rows.map(row => (
            <EffectiveAccessRow
              key={row.id}
              row={row}
              onOpenDetails={onOpenDetails}
              onEditPermission={onEditPermission}
            />
          ))}

          {group.diagnostics.length > 0 && (
            <div className="ea-diagnostics">
              <p className="ea-diagnostics-title">
                Inactive diagnostics — read-only, not part of effective business access
              </p>
              {group.diagnostics.map(capability => (
                <div className="ea-diagnostic-row" key={capability.code}>
                  <span className="ea-diagnostic-label">{capability.label}</span>
                  <span className="ea-diagnostic-code">{capability.code}</span>
                  <span className="ea-badge ea-badge-inactive">
                    {STATUS_LABELS[capability.status] || capability.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
