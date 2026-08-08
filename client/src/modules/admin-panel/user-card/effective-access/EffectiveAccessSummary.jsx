import { Info, Shield, AlertTriangle } from 'lucide-react';
import {
  ENFORCEMENT_SEPARATION_NOTE,
  SUPER_ADMIN_SUMMARY_NOTE,
  OVERRIDES_UNAVAILABLE_NOTE,
  BASELINE_UNAVAILABLE_NOTE,
} from './effectiveAccessModel';

function Tile({ label, value, sub, tone }) {
  return (
    <div className={`ea-tile${tone ? ` ea-tile-${tone}` : ''}`}>
      <div className="ea-tile-label">{label}</div>
      <div className="ea-tile-value">{value}</div>
      {sub && <div className="ea-tile-sub">{sub}</div>}
    </div>
  );
}

/**
 * RBAC Brick 5 — the compact metrics header.
 *
 * TWO ROWS, TWO DIMENSIONS, NEVER MERGED. The first band answers "what did the
 * resolver decide"; the second answers "does the backend actually stop anyone".
 * They are separated by a labelled heading and an explicit note because the
 * whole failure mode this brick guards against is reading a large "Allowed"
 * number as a statement about security.
 *
 * Every number here comes from `summariseRows`. Nothing on this screen recounts
 * anything, so the header and the rows below it cannot drift apart.
 */
export default function EffectiveAccessSummary({
  summary, isSuperAdmin, scopeSummary, baselineAvailable, overridesAvailable,
}) {
  return (
    <section className="ea-summary" aria-labelledby="ea-summary-title">
      <h4 className="ea-summary-title" id="ea-summary-title">Effective Access</h4>

      <div className="ea-tiles">
        <Tile
          label="Allowed"
          value={summary.allowed}
          sub={`of ${summary.totalActions} actions`}
          tone="allowed"
        />
        <Tile label="Denied" value={summary.denied} sub="Resolver denies" tone="denied" />
        <Tile
          label="Overrides"
          value={summary.overrides}
          sub={`${summary.explicitAllows} allow · ${summary.explicitDenies} deny`}
        />
        <Tile
          label="Default Deny"
          value={summary.defaultDenies}
          sub="No baseline configured"
        />
        {summary.unverified > 0 && (
          <Tile
            label="Unverified"
            value={summary.unverified}
            sub="Could not be read"
            tone="unknown"
          />
        )}
        <Tile
          label="Data Scope"
          value={scopeSummary}
          sub="Inventory departments"
        />
      </div>

      <h4 className="ea-summary-title ea-summary-title-sub" id="ea-enforcement-title">
        Enforcement Coverage
      </h4>
      <div className="ea-tiles" aria-labelledby="ea-enforcement-title">
        <Tile label="Enforced" value={summary.enforced} sub="Every surface checks" />
        <Tile label="Partial" value={summary.partiallyEnforced} sub="Some surfaces check" tone="warn" />
        <Tile
          label="Unenforced"
          value={summary.enforcementGaps}
          sub="Short of full coverage"
          tone="warn"
        />
        <Tile
          label="Authentication only"
          value={summary.authenticateOnly}
          sub="Any signed-in user passes"
        />
        <Tile label="Role based" value={summary.roleStringOnly} sub="Role string, not bits" />
        {summary.notReported > 0 && (
          <Tile
            label="Not reported"
            value={summary.notReported}
            sub="Baseline exists, unreadable"
            tone="unknown"
          />
        )}
      </div>

      <p className="ea-note" role="note">
        <Info size={13} aria-hidden="true" />
        <span>{ENFORCEMENT_SEPARATION_NOTE}</span>
      </p>

      {summary.riskyGaps > 0 && (
        <p className="uc-notice uc-notice-warn ea-notice" role="note">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{summary.riskyGaps}</strong>
            {summary.riskyGaps === 1 ? ' high-risk action resolves' : ' high-risk actions resolve'}
            {' '}Allowed while backend enforcement is incomplete. Use the Unenforced filter to
            review them.
          </span>
        </p>
      )}

      {isSuperAdmin && (
        <p className="uc-notice uc-notice-admin ea-notice" role="note">
          <Shield size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{SUPER_ADMIN_SUMMARY_NOTE}</span>
        </p>
      )}

      {!overridesAvailable && !isSuperAdmin && (
        <p className="uc-notice uc-notice-warn ea-notice" role="note">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>User overrides unavailable. {OVERRIDES_UNAVAILABLE_NOTE}</span>
        </p>
      )}

      {!baselineAvailable && !isSuperAdmin && (
        <p className="uc-notice uc-notice-warn ea-notice" role="note">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Role baseline unavailable. {BASELINE_UNAVAILABLE_NOTE}</span>
        </p>
      )}
    </section>
  );
}
