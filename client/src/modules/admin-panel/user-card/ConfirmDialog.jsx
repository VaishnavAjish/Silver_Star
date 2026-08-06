import { useRef } from 'react';
import useDialogFocusTrap from './useDialogFocusTrap';

/**
 * Focus-trapping confirmation dialog used for the unsaved-change warning and the
 * Reset Overrides confirmation.
 *
 * The dialog is deliberately not dismissable by clicking the backdrop: it exists
 * because data is at risk, so leaving requires choosing one of the actions.
 * Escape maps to the cancel action rather than closing silently.
 *
 * The trap itself lives in useDialogFocusTrap so Brick 4's dialogs share it
 * rather than reimplementing it. Behaviour here is unchanged.
 */
export default function ConfirmDialog({
  title,
  children,
  actions,
  onCancel,
  labelledBy = 'uc-confirm-title',
}) {
  const dialogRef = useRef(null);
  useDialogFocusTrap({ containerRef: dialogRef, onEscape: onCancel });

  return (
    <div className="uc-dialog-overlay">
      <div
        className="uc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={dialogRef}
      >
        <h2 className="uc-dialog-title" id={labelledBy}>{title}</h2>
        <div className="uc-dialog-body">{children}</div>
        <div className="uc-dialog-actions">
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              className={action.className || 'btn btn-secondary'}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
