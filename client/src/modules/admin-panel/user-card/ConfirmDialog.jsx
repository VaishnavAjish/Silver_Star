import { useEffect, useRef } from 'react';

/**
 * Focus-trapping confirmation dialog used for the unsaved-change warning and the
 * Reset Overrides confirmation.
 *
 * The dialog is deliberately not dismissable by clicking the backdrop: it exists
 * because data is at risk, so leaving requires choosing one of the actions.
 * Escape maps to the cancel action rather than closing silently.
 */
export default function ConfirmDialog({
  title,
  children,
  actions,
  onCancel,
  labelledBy = 'uc-confirm-title',
}) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;

    const focusables = () => Array.from(
      dialogRef.current?.querySelectorAll('button:not([disabled])') || [],
    );
    focusables()[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel?.();
        return;
      }
      if (e.key !== 'Tab') return;

      // Keep Tab inside the dialog so the form behind it cannot be reached
      // while a decision is pending.
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused.current?.focus?.();
    };
  }, [onCancel]);

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
