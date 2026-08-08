import { AlertTriangle, ExternalLink } from 'lucide-react';
import { EffectBadge, EnforcementBadge, RiskBadge } from './EffectiveAccessBadge';
import { isRiskyGap } from './effectiveAccessModel';

/** A labelled cell. The label stays visible when the grid stacks on narrow screens. */
function Cell({ label, children, className = '' }) {
  return (
    <div className={`ea-cell ${className}`}>
      <span className="ea-cell-label">{label}</span>
      <span className="ea-cell-value">{children}</span>
    </div>
  );
}

/**
 * RBAC Brick 5 — one read-only action result.
 *
 * HAS NO OVERRIDE CONTROL, BY DESIGN. The tri-state control lives in Brick 3 and
 * only there; this row explains a decision and offers a link to the place where
 * it can be changed. That is what keeps "opening the preview issues zero writes"
 * a structural fact rather than a promise.
 *
 * Every value is read straight off the model row. No mask arithmetic happens in
 * this component — not for the badge, not for the source line, not for the risk
 * callout — so the summary tiles and these rows cannot disagree.
 */
export default function EffectiveAccessRow({ row, onOpenDetails, onEditPermission }) {
  const risky = isRiskyGap(row);

  return (
    <div className={`ea-row${risky ? ' ea-row-risky' : ''}`}>
      <div className="ea-cell ea-cell-name">
        <span className="ea-row-capability">{row.capability_label}</span>
        <span className="ea-row-action">{row.action.label}</span>
        <RiskBadge level={row.risk_level} />
      </div>

      <Cell label="Baseline">{row.role_baseline.label}</Cell>
      <Cell label="Override">{row.user_override.label}</Cell>
      <Cell label="Effective"><EffectBadge status={row.effective.status} /></Cell>

      <Cell label="Source" className="ea-cell-source">
        {row.effective.source_text}
      </Cell>

      <Cell label="Enforcement">
        <EnforcementBadge overall={row.enforcement.overall} />
      </Cell>

      <div className="ea-cell ea-cell-actions">
        <button
          type="button"
          className="ea-btn ea-btn-sm"
          onClick={() => onOpenDetails(row)}
          aria-label={`Explain ${row.capability_label} ${row.action.label}`}
        >
          Explain
        </button>
        {onEditPermission && (
          <button
            type="button"
            className="ea-btn ea-btn-sm"
            onClick={() => onEditPermission(row)}
            aria-label={`Edit permission for ${row.capability_label} ${row.action.label}`}
          >
            <ExternalLink size={12} aria-hidden="true" /> Edit Permission
          </button>
        )}
      </div>

      {risky && (
        <p className="ea-row-warning" role="note">
          <AlertTriangle size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>{row.risk_level} risk</strong> — effective Allowed, backend enforcement
            incomplete.
          </span>
        </p>
      )}
    </div>
  );
}
