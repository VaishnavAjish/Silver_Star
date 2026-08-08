import { AlertTriangle, Info } from 'lucide-react';
import RestrictionStatusBadge from '../restrictions/RestrictionStatusBadge';
import { RESTRICTION_STATUS } from '../restrictions/viewRestrictionsModel';

/** One read-only fact. No Edit affordance exists anywhere in this section. */
function VisibilityRow({ label, value, status, detail, warning }) {
  return (
    <div className="ea-vis-row">
      <div className="ea-vis-main">
        <span className="ea-vis-label">{label}</span>
        <span className="ea-vis-value">{value}</span>
        {detail && <span className="ea-vis-detail">{detail}</span>}
        {warning && (
          <span className="ea-vis-warning">
            <AlertTriangle size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{warning}</span>
          </span>
        )}
      </div>
      {status && <RestrictionStatusBadge status={status} />}
    </div>
  );
}

/**
 * RBAC Brick 5 — read-only Data Visibility.
 *
 * WHICH RECORDS, NOT WHICH ACTIONS. This section answers a different question
 * from the permission rows above it and is kept visually separate for that
 * reason: department visibility is not operational authority, and neither is
 * approval authority. Both of those are printed as "Not modelled" rather than
 * left off the screen, because a dimension that is simply absent is the one an
 * administrator assumes something else already covers.
 *
 * NO EDIT CONTROL. Scope editing stays in Brick 4's panel on the same tab. This
 * is a report of what Brick 4 resolved, including its downgrade of the scope
 * status for the roles the inventory API lets past.
 */
export default function DataVisibilitySummary({ visibility, isSuperAdmin }) {
  const { scope, financial, stored, authority, storedWarning } = visibility;

  return (
    <section className="ea-visibility" aria-labelledby="ea-visibility-title">
      <h4 className="ea-summary-title" id="ea-visibility-title">Data Visibility</h4>

      <div className="ea-vis-rows">
        <VisibilityRow
          label="Inventory Departments"
          value={scope.summary}
          status={scope.available ? scope.status : RESTRICTION_STATUS.UNKNOWN}
          detail={scope.applies ? null : 'Not applicable — this role bypasses department scope'}
          warning={scope.warning}
        />

        <VisibilityRow
          label={financial.label}
          value={financial.available ? financial.summary : 'Unverified'}
          status={financial.status}
          detail={financial.available
            ? financial.sourceText
            : 'User overrides unavailable — the stored permission could not be read'}
          warning={financial.warning}
        />

        {authority.map(row => (
          <VisibilityRow
            key={row.code}
            label={row.label}
            value={row.summary}
            status={RESTRICTION_STATUS.NOT_APPLICABLE}
            detail={row.explanation}
          />
        ))}
      </div>

      {stored.length > 0 && (
        <>
          <p className="ea-vis-stored-head">
            Stored but Not Enforced — <strong>{stored.length}</strong>
            {stored.length === 1 ? ' setting' : ' settings'}
          </p>
          <p className="ea-note" role="note">
            <Info size={13} aria-hidden="true" />
            <span>{storedWarning}</span>
          </p>
          <ul className="ea-vis-stored">
            {stored.map(row => (
              <li key={row.code}>
                <span className="ea-vis-stored-label">{row.label}</span>
                <code className="ea-vis-stored-key">{row.code}</code>
                <span className="ea-vis-stored-value">{row.summary}</span>
                <RestrictionStatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      {isSuperAdmin && (
        <p className="ea-note" role="note">
          <Info size={13} aria-hidden="true" />
          <span>
            Super Admin bypasses inventory department scope and financial field checks in the
            resolver, so the values above do not restrict this user.
          </span>
        </p>
      )}
    </section>
  );
}
