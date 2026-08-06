import { AlertTriangle, Info, Shield } from 'lucide-react';
import { describeScope } from './userCardModel';

function SummaryTile({ label, value, sub }) {
  return (
    <div className="uc-summary-card">
      <div className="uc-summary-label">{label}</div>
      <div className="uc-summary-value">{value}</div>
      {sub && <div className="uc-summary-sub">{sub}</div>}
    </div>
  );
}

/**
 * Compact read-only summary above the Access Control editors.
 *
 * The enforcement warning is driven by the Brick 1 catalog, not by a hard-coded
 * assumption: it appears when the catalog reports active permissions whose API
 * surfaces are all unguarded. The matrix below is never described as fully
 * enforced.
 */
export default function AccessControlSummary({
  basic,
  isSuperAdmin,
  overrideRecordCount,
  inventoryScope,
  effectiveAccess,
  catalog,
  catalogFailed,
}) {
  const unenforcedCount = catalog?.enforcement_summary?.api_unguarded_active?.length ?? 0;
  const activeCount = catalog?.totals?.by_status?.ACTIVE;
  const totalCount = catalog?.totals?.total;
  const inactiveCount = totalCount != null && activeCount != null ? totalCount - activeCount : null;
  const groupCount = catalog?.groups?.length;

  return (
    <div className="uc-section">
      <h3 className="uc-section-title">Access Summary</h3>
      <p className="uc-section-hint">
        Read-only. Derived from the role baseline and this user&apos;s overrides.
      </p>

      <div className="uc-summary" style={{ marginTop: 0 }}>
        <SummaryTile label="Role Baseline" value={basic.role} sub="Inherited permissions" />
        <SummaryTile
          label="User Overrides"
          value={overrideRecordCount}
          sub="Non-zero override entries"
        />
        <SummaryTile
          label="Inventory Scope"
          value={describeScope(inventoryScope)}
          sub="Enforced by inventory APIs"
        />
        <SummaryTile
          label="Effective Access"
          value={isSuperAdmin
            ? 'Unrestricted'
            : effectiveAccess.hasBaseline
              ? `${effectiveAccess.allowed} allowed`
              : 'Unavailable'}
          sub={isSuperAdmin
            ? 'Bypasses masks'
            : effectiveAccess.hasBaseline
              ? `${effectiveAccess.deniedByOverride} denied · ${effectiveAccess.defaultDenied} default-denied · ${effectiveAccess.total} total`
              : 'Role baseline could not be read'}
        />
      </div>

      {isSuperAdmin && (
        <div className="uc-notice uc-notice-admin" style={{ marginTop: 12, marginBottom: 0 }}>
          <Shield size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Super Admin — effective access bypasses role and user override masks.</span>
        </div>
      )}

      {unenforcedCount > 0 && (
        <div className="uc-notice uc-notice-warn" style={{ marginTop: 12, marginBottom: 0 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Some configured permissions are not yet enforced by backend APIs. Security
            coverage will be completed in RBAC Brick 8.
            {' '}
            <strong>{unenforcedCount}</strong>
            {' '}
            active {unenforcedCount === 1 ? 'permission has' : 'permissions have'} no guarded API surface.
          </span>
        </div>
      )}

      {catalogFailed && (
        <div className="uc-notice uc-notice-neutral" style={{ marginTop: 12, marginBottom: 0 }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Permission catalog diagnostics unavailable.</span>
        </div>
      )}

      {catalog && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--g500)' }}>
          Catalog:
          {activeCount != null && <> {activeCount} active</>}
          {inactiveCount != null && <> · {inactiveCount} inactive</>}
          {groupCount != null && <> · {groupCount} business groups</>}
        </div>
      )}
    </div>
  );
}
