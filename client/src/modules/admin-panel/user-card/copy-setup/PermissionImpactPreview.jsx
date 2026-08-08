import { Info, Shield } from 'lucide-react';
import { SUPER_ADMIN_TARGET_NOTE } from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — what the copied permission rows do to the target's real access.
 *
 * EVERY NUMBER HERE COMES FROM BRICK 5, TWICE. `buildPermissionImpact` runs
 * Brick 5's `buildAccessIndex` against the target's current overrides and against
 * the overrides the copy would leave, using the TARGET's role baseline on both
 * sides because no role is ever copied. Nothing on this screen resolves a mask.
 *
 * STORED IS NOT THE SAME AS EFFECTIVE. A row can change without the result
 * changing — most obviously on a Super Admin target, where the bypass decides
 * everything before a mask is read. Those are counted separately rather than
 * being presented as access changes.
 */

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

function ImpactTile({ label, value, sub }) {
  return (
    <div className="cs-tile">
      <div className="cs-tile-label">{label}</div>
      <div className="cs-tile-value">{value}</div>
      {sub && <div className="cs-tile-sub">{sub}</div>}
    </div>
  );
}

function ChangeRow({ change }) {
  return (
    <li className="cs-impact-row">
      <span className="cs-impact-name">
        {change.group} → {change.capability_label} → {change.action_label}
      </span>
      <span className="cs-impact-detail">
        Override {change.override.before_label} → {change.override.after_label}
        {' · '}
        Result {change.effective.before} → {change.effective.after}
        {change.risk_level ? ` · Risk ${change.risk_level}` : ''}
      </span>
    </li>
  );
}

export default function PermissionImpactPreview({ impact, targetIsSuperAdmin }) {
  if (!impact.available) {
    return (
      <section className="cs-impact" aria-labelledby="cs-impact-title">
        <h4 className="cs-impact-title" id="cs-impact-title">Effective access impact</h4>
        <p className="uc-notice uc-notice-warn" role="note">
          <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{impact.reason}</span>
        </p>
      </section>
    );
  }

  const resultChanges = impact.changes.filter(c => c.effective.changed);

  return (
    <section className="cs-impact" aria-labelledby="cs-impact-title">
      <h4 className="cs-impact-title" id="cs-impact-title">Effective access impact</h4>

      <div className="cs-tiles">
        <ImpactTile
          label="Allowed actions"
          value={`${impact.before.allowed} → ${impact.after.allowed}`}
          sub={`${signed(impact.delta.allowed)} after copy`}
        />
        <ImpactTile
          label="Denied actions"
          value={`${impact.before.denied} → ${impact.after.denied}`}
          sub={`${signed(impact.delta.denied)} after copy`}
        />
        <ImpactTile
          label="Stored override rows"
          value={`${impact.before.overrides} → ${impact.after.overrides}`}
          sub={`${signed(impact.delta.overrides)} explicit allow/deny bits`}
        />
        <ImpactTile
          label="Results that change"
          value={resultChanges.length}
          sub={`${impact.granted.length} newly allowed · ${impact.revoked.length} newly denied`}
        />
      </div>

      {resultChanges.length > 0 ? (
        <div className="cs-impact-list-wrap">
          <h5 className="cs-changes-title">
            Actions whose result changes ({resultChanges.length})
          </h5>
          <ul className="cs-impact-list">
            {resultChanges.slice(0, 12).map(change => (
              <ChangeRow key={change.id} change={change} />
            ))}
          </ul>
          {resultChanges.length > 12 && (
            <p className="cs-changes-more">…and {resultChanges.length - 12} more.</p>
          )}
        </div>
      ) : (
        <p className="cs-changes-more">
          No action changes its allowed/denied result for this target.
        </p>
      )}

      {impact.storedOnlyChanges.length > 0 && (
        <p className="cs-note" role="note">
          <Info size={13} aria-hidden="true" />
          <span>
            {impact.storedOnlyChanges.length} stored override
            {impact.storedOnlyChanges.length === 1 ? ' row changes' : ' rows change'} without
            changing the result — the role baseline or the Super Admin bypass already decides
            those actions.
          </span>
        </p>
      )}

      {targetIsSuperAdmin && (
        <p className="uc-notice uc-notice-admin" role="note">
          <Shield size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{SUPER_ADMIN_TARGET_NOTE}</span>
        </p>
      )}
    </section>
  );
}
