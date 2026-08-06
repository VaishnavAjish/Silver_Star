import { AlertTriangle } from 'lucide-react';
import RestrictionStatusBadge from './RestrictionStatusBadge';

/**
 * One dense View Restrictions row: label, current value, status, action.
 *
 * PURELY PRESENTATIONAL. It fetches nothing, derives nothing and owns no state —
 * everything it shows was computed by viewRestrictionsModel. A row must never
 * become a place where a request is issued.
 *
 * The action is always a button with a restriction-specific accessible name
 * ("Edit Inventory Departments", "Details for Margin %"), because a column of
 * seven buttons all called "Details" is unusable with a screen reader.
 */
export default function RestrictionSummaryRow({
  label,
  summary,
  status,
  description,
  warning,
  actionLabel,
  actionAccessibleName,
  onAction,
  actionDisabled = false,
}) {
  const slug = String(label).replace(/\W+/g, '-').toLowerCase();
  const warningId = warning ? `vr-warn-${slug}` : undefined;

  return (
    <div className="vr-row">
      <div className="vr-row-main">
        <div className="vr-row-label">{label}</div>
        <div className="vr-row-summary">{summary}</div>
        {description && <div className="vr-row-desc">{description}</div>}
      </div>

      <div className="vr-row-status">
        <RestrictionStatusBadge status={status} />
      </div>

      <div className="vr-row-action">
        {onAction ? (
          <button
            type="button"
            className="vr-action-btn"
            onClick={onAction}
            disabled={actionDisabled}
            aria-label={actionAccessibleName || `${actionLabel} ${label}`}
            aria-describedby={warningId}
          >
            {actionLabel}
          </button>
        ) : (
          <span className="vr-row-noaction">Read-only</span>
        )}
      </div>

      {warning && (
        <p className="vr-row-warning" id={warningId}>
          <AlertTriangle size={12} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{warning}</span>
        </p>
      )}
    </div>
  );
}
