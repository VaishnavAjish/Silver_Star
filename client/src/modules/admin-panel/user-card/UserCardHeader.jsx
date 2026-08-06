import { X, Copy, Clock, RotateCcw, Shield } from 'lucide-react';
import { describeScope } from './userCardModel';

const ROLE_BADGE_CLASS = {
  super_admin: 'b-active',
  admin: 'b-active',
  operator: 'b-draft',
  viewer: 'b-inactive',
};

const DATE_OPTS = { day: '2-digit', month: 'short', year: 'numeric' };

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-IN', DATE_OPTS);
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="uc-summary-card">
      <div className="uc-summary-label">{label}</div>
      <div className="uc-summary-value">{value}</div>
      {sub && <div className="uc-summary-sub">{sub}</div>}
    </div>
  );
}

/**
 * Fixed identity header: who is being edited, five read-only summary cards, and
 * the card-level actions.
 *
 * Every number shown here is derived from data already loaded — the header never
 * fetches. When the role baseline could not be read the effective-permission
 * card says so rather than showing a total that would misstate real access.
 *
 * `users.updated_at` is not exposed by GET /api/admin/users, so Last Updated
 * falls back to "Not reported" instead of borrowing an unrelated timestamp.
 */
export default function UserCardHeader({
  user,
  basic,
  isSelf,
  isSuperAdmin,
  overrideRecordCount,
  inventoryScope,
  effectiveAccess,
  onCopySetup,
  onViewAudit,
  onResetOverrides,
  onClose,
  busy,
}) {
  const updatedAt = formatDate(user.updated_at);
  const createdAt = formatDate(user.created_at);

  return (
    <div className="uc-header">
      <div className="uc-identity">
        <div className="uc-avatar" aria-hidden="true">
          {(user.full_name || user.username || '?').charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="uc-name">
            <span>{user.full_name}</span>
            <span className={`badge ${ROLE_BADGE_CLASS[basic.role] || 'b-inactive'}`} style={{ fontSize: 9 }}>
              {basic.role}
            </span>
            {isSelf && <span className="uc-chip">You</span>}
          </div>
          <div className="uc-meta">
            <span>@{user.username}</span>
            <span className="uc-meta-sep">·</span>
            <span>{user.email || 'No email'}</span>
            <span className="uc-meta-sep">·</span>
            <span>{user.department_name || 'No department'}</span>
            <span className="uc-meta-sep">·</span>
            <span className={`badge ${user.is_active ? 'b-active' : 'b-cancelled'}`} style={{ fontSize: 9 }}>
              {user.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="uc-action-btn"
          onClick={onClose}
          aria-label="Close user card"
          style={{ width: 30, padding: 0, justifyContent: 'center', flexShrink: 0 }}
        >
          <X size={15} />
        </button>
      </div>

      <div className="uc-summary">
        <SummaryCard label="Role" value={basic.role} sub="Role baseline" />
        <SummaryCard
          label="User Overrides"
          value={overrideRecordCount}
          sub={overrideRecordCount === 1 ? 'override record' : 'override records'}
        />
        <SummaryCard
          label="Inventory Departments"
          value={describeScope(inventoryScope)}
          sub="Enforced scope"
        />
        <SummaryCard
          label="Effective Permissions"
          value={isSuperAdmin
            ? 'Unrestricted'
            : effectiveAccess.hasBaseline
              ? `${effectiveAccess.allowed} / ${effectiveAccess.total}`
              : '—'}
          sub={isSuperAdmin
            ? 'Super Admin bypass'
            : effectiveAccess.hasBaseline
              ? `${effectiveAccess.defaultDenied} default-denied · ${effectiveAccess.deniedByOverride} denied by override`
              : 'Role baseline unavailable'}
        />
        <SummaryCard
          label="Last Updated"
          value={updatedAt || 'Not reported'}
          sub={updatedAt ? null : createdAt ? `Account created ${createdAt}` : null}
        />
      </div>

      <div className="uc-actions">
        {onCopySetup && (
          <button
            type="button"
            className="uc-action-btn"
            onClick={() => onCopySetup(user)}
            disabled={isSelf}
            title={isSelf ? 'Cannot copy a setup onto your own account' : undefined}
          >
            <Copy size={13} /> Copy Setup
          </button>
        )}
        {onViewAudit && (
          <button type="button" className="uc-action-btn" onClick={() => onViewAudit(user)}>
            <Clock size={13} /> View Audit
          </button>
        )}
        {overrideRecordCount > 0 && (
          <button
            type="button"
            className="uc-action-btn uc-danger"
            onClick={onResetOverrides}
            disabled={busy}
          >
            <RotateCcw size={13} /> Reset Overrides ({overrideRecordCount})
          </button>
        )}
        {isSuperAdmin && (
          <span
            className="uc-status-chip"
            style={{ borderColor: '#C5CAE9', background: '#E8EAF6', color: '#283593' }}
          >
            <Shield size={11} /> Super Admin — effective access bypasses role and user override masks.
          </span>
        )}
      </div>
    </div>
  );
}
