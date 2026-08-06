import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import useDialogFocusTrap from '../useDialogFocusTrap';
import RestrictionStatusBadge from './RestrictionStatusBadge';
import { RESTRICTION_STATUS } from './viewRestrictionsModel';

/** A metadata line, rendered only when the catalog actually supplied the value. */
function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="vr-detail-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Read-only diagnostics for one restriction.
 *
 * DELIBERATELY HAS NO EDIT CONTROL, for every role including Super Admin. The
 * settings it describes have no backend enforcement, so an editor here would let
 * an admin believe they had restricted something. The only affordance is Close.
 *
 * Everything shown comes from the Brick 1 catalog entry plus the value already
 * loaded into the card. Nothing is fetched and nothing is written — opening this
 * dialog cannot create a preference row for a key that has none.
 */
export default function RestrictionDetailsDialog({ row, onClose }) {
  const dialogRef = useRef(null);
  useDialogFocusTrap({ containerRef: dialogRef, onEscape: onClose });

  const meta = row.meta || null;
  const inactive = row.status === RESTRICTION_STATUS.PLANNED_INACTIVE;

  return (
    <div className="uc-dialog-overlay">
      <div
        className="uc-dialog vr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vr-detail-title"
        ref={dialogRef}
      >
        <h2 className="uc-dialog-title" id="vr-detail-title">{row.label}</h2>

        <div className="uc-dialog-body vr-dialog-body">
          <p className="vr-detail-status">
            <RestrictionStatusBadge status={row.status} />
            <span>{row.description}</span>
          </p>

          <dl className="vr-detail-list">
            <Field label="Setting key" value={row.code} />
            <Field
              label="Current stored value"
              value={row.storedValue === null
                ? 'No value stored for this user — Brick 4 does not create one.'
                : row.storedValue}
            />
            <Field label="Meaning" value={meta?.description} />
            <Field label="Storage" value={meta?.storage} />
            <Field label="Setting type" value={meta?.setting_type} />
            <Field label="Risk" value={meta?.risk_level} />
            <Field
              label="Enforced by"
              value={meta?.enforced_by?.length ? meta.enforced_by.join(', ') : null}
            />
            <Field
              label="References"
              value={meta?.refs?.length ? meta.refs.join(', ') : null}
            />
          </dl>

          {meta?.notes?.length > 0 && (
            <ul className="vr-detail-notes">
              {meta.notes.map(note => <li key={note}>{note}</li>)}
            </ul>
          )}

          <p className="vr-dialog-warning" role="note">
            <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {row.warning
                || (inactive
                  ? 'Inactive — not granted to any standard role. Shown for diagnosis only.'
                  : 'Stored configuration; no active backend enforcement.')}
              {' '}
              Changing this value would not protect any data, so it is read-only here. The
              enforced financial control is the
              {' '}
              <strong>inventory.inventory_financial</strong>
              {' '}
              permission.
            </span>
          </p>

          {!meta && (
            <p className="vr-dialog-note">
              Catalog metadata for this setting was not available, so only the stored value
              is shown.
            </p>
          )}
        </div>

        <div className="uc-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
