import { AlertTriangle } from 'lucide-react';

/**
 * RBAC Brick 6 — the callout for newly granted CRITICAL/HIGH capabilities.
 *
 * RISK COMES FROM THE BRICK 1 CATALOG. `change.risk_level` is carried through
 * Brick 5's rows from the catalog payload; there is no second risk table here and
 * no keyword matching on action names.
 *
 * NEWLY granted only. A high-risk capability the target could already use is not
 * a change this copy makes, and listing it would train admins to ignore the box.
 *
 * The warning is a `role="alert"` so it is announced when it appears, and every
 * entry states the transition in words — the styling adds emphasis, never meaning.
 */
export default function HighRiskChangeWarning({ changes, headingId = 'cs-highrisk-title' }) {
  if (!changes?.length) return null;

  return (
    <section
      className="uc-notice uc-notice-danger cs-highrisk"
      role="alert"
      aria-labelledby={headingId}
    >
      <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <h4 className="cs-highrisk-title" id={headingId}>
          High-risk access change — {changes.length}
          {changes.length === 1 ? ' capability' : ' capabilities'}
        </h4>
        <p className="cs-highrisk-lead">
          This copy newly allows the following high-risk
          {changes.length === 1 ? ' action' : ' actions'} for the target user.
        </p>
        <ul className="cs-highrisk-list">
          {changes.map(change => (
            <li key={change.id}>
              <strong>{change.capability_label} / {change.action_label}</strong>
              {' — '}{change.directionLabel}
              {' · '}Risk {change.risk_level}
              {' · '}Enforcement {change.enforcement_label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
