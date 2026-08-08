import { AlertTriangle, ArrowRight, Loader2, User } from 'lucide-react';

/**
 * RBAC Brick 6 — step 1: who is being copied FROM, and onto whom.
 *
 * SELF-COPY IS BLOCKED HERE AND AT THE BACKEND. The target is filtered out of
 * the source list, so it cannot normally be chosen; the endpoint rejects it
 * independently with 400 "Cannot copy setup to self", which is the protection
 * that actually holds. The UI filter is convenience, not the control.
 *
 * The target identity is shown but never editable: the wizard is opened for one
 * user, and copying onto a different user is a different decision.
 */

function IdentityCard({ heading, user, tone }) {
  if (!user) {
    return (
      <div className={`cs-identity cs-identity-${tone} cs-identity-empty`}>
        <div className="cs-identity-heading">{heading}</div>
        <div className="cs-identity-name">Not selected</div>
      </div>
    );
  }

  return (
    <div className={`cs-identity cs-identity-${tone}`}>
      <div className="cs-identity-heading">{heading}</div>
      <div className="cs-identity-name">
        <User size={13} aria-hidden="true" />
        <span>{user.full_name || user.username}</span>
      </div>
      <dl className="cs-identity-meta">
        <div><dt>Username</dt><dd>@{user.username}</dd></div>
        <div><dt>Role</dt><dd>{user.role || 'Not reported'}</dd></div>
        <div><dt>Department</dt><dd>{user.department_name || 'None'}</dd></div>
      </dl>
    </div>
  );
}

export default function CopySetupSourceStep({
  targetUser,
  sourceUser,
  candidates,
  sourceUserId,
  onChangeSource,
  loading,
  error,
}) {
  return (
    <section className="cs-step" aria-labelledby="cs-step-source">
      <h3 className="cs-step-title" id="cs-step-source">Source and target</h3>
      <p className="cs-step-hint">
        Choose the user whose configuration should be copied. Selecting a source only
        reads stored settings; nothing is changed until you confirm at the last step.
      </p>

      <div className="cs-field">
        <label className="cs-label" htmlFor="cs-source-select">Copy setup from</label>
        <select
          id="cs-source-select"
          className="cs-select"
          value={sourceUserId}
          onChange={e => onChangeSource(e.target.value)}
        >
          <option value="">— Select a source user —</option>
          {candidates.map(u => (
            <option key={u.id} value={u.id}>
              {u.full_name} (@{u.username}) — {u.role}
            </option>
          ))}
        </select>
        <p className="cs-field-hint">
          {targetUser.full_name} is excluded from this list. A user cannot be copied onto
          themselves, and the server rejects that request as well.
        </p>
      </div>

      <div className="cs-identity-pair">
        <IdentityCard heading="From (source)" user={sourceUser} tone="source" />
        <div className="cs-identity-arrow" aria-hidden="true"><ArrowRight size={16} /></div>
        <IdentityCard heading="To (target)" user={targetUser} tone="target" />
      </div>

      {loading && (
        <p className="cs-loading" role="status">
          <Loader2 size={14} className="spin" aria-hidden="true" />
          <span>Reading the stored configuration of both users…</span>
        </p>
      )}

      {error && (
        <p className="uc-notice uc-notice-danger" role="alert">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            The copy preview could not be loaded, so no copy can be previewed or applied.
            {' '}Reason: {error}
          </span>
        </p>
      )}
    </section>
  );
}
