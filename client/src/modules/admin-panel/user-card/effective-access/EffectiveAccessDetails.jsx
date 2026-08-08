import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import useDialogFocusTrap from '../useDialogFocusTrap';
import { EffectBadge, EnforcementBadge, RiskBadge } from './EffectiveAccessBadge';
import { STATUS_LABELS } from '../permissions/permissionCatalogModel';
import {
  ENFORCEMENT_SURFACE_LABELS,
  ENFORCEMENT_SEPARATION_NOTE,
  maskDetailFor,
} from './effectiveAccessModel';

/** A definition line, rendered only when the value actually exists. */
function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="ea-detail-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** `null` means the value was never read — which is not the same as zero. */
const maskText = value => (value === null ? 'Not available' : String(value));

/**
 * RBAC Brick 5 — the full explanation for one action result.
 *
 * READ-ONLY, WITH NO ESCAPE HATCH. The only buttons are Close and the Brick 3
 * deep link. Nothing in this dialog can change a mask, and nothing it renders
 * was fetched when it opened — every field came from data the card already held.
 *
 * MASKS APPEAR HERE AND NOWHERE ELSE. They are the resolver's language, not an
 * administrator's, so the normal rows speak in verdicts and this panel carries
 * the arithmetic for whoever needs to audit it. "Not available" is printed
 * rather than 0 when a source could not be read, because a zero mask is a real
 * and different fact.
 */
export default function EffectiveAccessDetails({ row, onClose, onEditPermission }) {
  const dialogRef = useRef(null);
  useDialogFocusTrap({ containerRef: dialogRef, onEscape: onClose });

  const masks = maskDetailFor(row);
  const surfaces = Object.entries(ENFORCEMENT_SURFACE_LABELS)
    .filter(([surface]) => row.enforcement[surface] !== undefined);

  return (
    <div className="uc-dialog-overlay">
      <div
        className="uc-dialog ea-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ea-detail-title"
        ref={dialogRef}
      >
        <h2 className="uc-dialog-title" id="ea-detail-title">
          {row.capability_label} — {row.action.label}
        </h2>

        <div className="uc-dialog-body ea-dialog-body">
          <p className="ea-detail-verdict">
            <EffectBadge status={row.effective.status} />
            <EnforcementBadge overall={row.enforcement.overall} />
            <RiskBadge level={row.risk_level} />
          </p>

          <p className="ea-detail-source">
            <strong>{row.effective.source_text}</strong>
            <br />
            {row.effective.explanation}
          </p>

          <h3 className="ea-detail-heading">Decision</h3>
          <dl className="ea-detail-list">
            <Field label="Capability" value={row.capability_label} />
            <Field label="Action" value={row.action.label} />
            <Field label="Canonical code" value={row.canonical_code} />
            <Field label="Storage key" value={row.storage_key} />
            <Field label="Backend module" value={row.backend_module} />
            <Field label="Backend submodule" value={row.submodule_label} />
            <Field label="Role baseline" value={row.role_baseline.label} />
            <Field
              label="Role contributions"
              value={row.role_baseline.roles.length > 0
                ? row.role_baseline.roles.join(', ')
                : 'No role assigned'}
            />
            <Field label="User override" value={row.user_override.label} />
            <Field label="Effective result" value={row.effective.label} />
            <Field
              label="Lifecycle"
              value={STATUS_LABELS[row.lifecycle_status] || row.lifecycle_status}
            />
            <Field label="Risk" value={row.risk_level} />
          </dl>

          <h3 className="ea-detail-heading">Enforcement surfaces</h3>
          <p className="ea-detail-hint">{ENFORCEMENT_SEPARATION_NOTE}</p>
          <dl className="ea-detail-list ea-detail-surfaces">
            {surfaces.map(([surface, label]) => (
              <div className="ea-detail-field" key={surface}>
                <dt>{label}</dt>
                <dd>{row.enforcement[surface]}</dd>
              </div>
            ))}
          </dl>

          <h3 className="ea-detail-heading">Diagnostic detail</h3>
          <p className="ea-detail-hint">
            Raw masks as the resolver reads them:
            {' '}
            <code>((role | allow) &amp; ~deny) &amp; 4095</code>
          </p>
          <dl className="ea-detail-list ea-detail-masks">
            <Field label="Action bit" value={masks.bit} />
            <Field label="Role mask" value={maskText(masks.roleMask)} />
            <Field label="Allow mask" value={maskText(masks.allowMask)} />
            <Field label="Deny mask" value={maskText(masks.denyMask)} />
            <Field label="Effective mask" value={maskText(masks.effectiveMask)} />
          </dl>

          {row.warnings.length > 0 && (
            <>
              <h3 className="ea-detail-heading">Known warnings</h3>
              <ul className="ea-detail-warnings">
                {row.warnings.map(warning => (
                  <li key={warning}>
                    <AlertTriangle
                      size={12}
                      aria-hidden="true"
                      style={{ flexShrink: 0, marginTop: 3 }}
                    />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="uc-dialog-actions">
          {onEditPermission && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onEditPermission(row)}
            >
              Edit Permission
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
