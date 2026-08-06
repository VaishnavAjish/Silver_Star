import { AlertTriangle, Info } from 'lucide-react';

/**
 * Security tab — administrator password reset.
 *
 * The button posts to the existing POST /api/admin/users/:id/reset-password
 * through the `security` save category, so the result is reported per category
 * like every other tab.
 *
 * MFA and session controls are described but not offered: the only MFA endpoints
 * are self-service (they act on the caller's own account), and no session
 * revocation API exists. Brick 2 does not invent either.
 */
export default function SecurityTab({ pw, updatePw, onSavePassword, busy, dirty, error }) {
  const tooShort = pw.password.length > 0 && pw.password.length < 6;
  const mismatch = pw.confirm.length > 0 && pw.password !== pw.confirm;

  return (
    <div>
      <div className="uc-notice uc-notice-warn">
        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Setting a new password will invalidate the user&apos;s current session token on
          their next request.
        </span>
      </div>

      <div className="uc-section">
        <h3 className="uc-section-title">Reset Password</h3>
        <p className="uc-section-hint">
          Sets a new password directly. The user is not emailed — communicate it yourself.
        </p>

        <div className="form-row">
          <div className="fg w">
            <label htmlFor="uc-new-password">New Password</label>
            <input
              id="uc-new-password"
              type="password"
              name="sec-new-pw"
              autoComplete="new-password"
              value={pw.password}
              onChange={e => updatePw({ password: e.target.value })}
              placeholder="Min 6 characters"
              aria-describedby="uc-password-help"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="fg w">
            <label htmlFor="uc-confirm-password">Confirm Password</label>
            <input
              id="uc-confirm-password"
              type="password"
              name="sec-confirm-pw"
              value={pw.confirm}
              onChange={e => updatePw({ confirm: e.target.value })}
              placeholder="Repeat password"
            />
          </div>
        </div>

        <div id="uc-password-help" style={{ fontSize: 11, minHeight: 16, color: 'var(--g500)' }}>
          {tooShort && <span style={{ color: '#C62828' }}>Password must be at least 6 characters.</span>}
          {!tooShort && mismatch && <span style={{ color: '#C62828' }}>Passwords do not match.</span>}
          {!tooShort && !mismatch && 'Minimum 6 characters.'}
        </div>

        {error && (
          <div className="uc-notice uc-notice-danger" style={{ marginTop: 10, marginBottom: 0 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Password reset failed: {error}</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={onSavePassword}
          disabled={busy || !dirty || tooShort || mismatch || pw.confirm.length === 0}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Updating Password…' : 'Update Password'}
        </button>
      </div>

      <div className="uc-section">
        <h3 className="uc-section-title">Multi-Factor Authentication</h3>
        <div className="uc-notice uc-notice-neutral" style={{ marginBottom: 0 }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            MFA enrolment is self-service — a user sets it up from their own account.
            There is no administrator endpoint to enable, disable or reset another
            user&apos;s MFA, so none is offered here.
          </span>
        </div>
      </div>

      <div className="uc-section">
        <h3 className="uc-section-title">Sessions</h3>
        <div className="uc-notice uc-notice-neutral" style={{ marginBottom: 0 }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Resetting the password above is the only session-invalidation mechanism
            currently implemented. Explicit session revocation is scheduled for RBAC Brick 7.
          </span>
        </div>
      </div>
    </div>
  );
}
