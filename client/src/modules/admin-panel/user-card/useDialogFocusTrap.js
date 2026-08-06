import { useEffect } from 'react';

/**
 * Focus containment for the User Card's modal dialogs.
 *
 * Extracted verbatim from ConfirmDialog so Brick 4's two dialogs get the same
 * behaviour rather than a second, subtly different implementation. The only
 * addition is a configurable `selector`: the confirmation dialogs contain nothing
 * but buttons, while the department dialog also contains radios, checkboxes and a
 * search field that must all stay reachable.
 *
 * ESCAPE IS HANDLED IN THE CAPTURE PHASE. UserDrawer listens for Escape on
 * `document` to close the whole card, and that listener would otherwise fire
 * behind an open dialog and skip the unsaved-change guard. Capturing here and
 * stopping propagation means Escape closes the dialog only.
 *
 * @param {object}   options
 * @param {object}   options.containerRef  ref to the dialog element
 * @param {Function} options.onEscape      invoked instead of closing the card
 * @param {string}   [options.selector]    focusable-element selector
 */
export default function useDialogFocusTrap({
  containerRef,
  onEscape,
  selector = 'button:not([disabled])',
}) {
  useEffect(() => {
    const previouslyFocused = document.activeElement;

    const focusables = () => Array.from(containerRef.current?.querySelectorAll(selector) || []);
    focusables()[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEscape?.();
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
      // Returns focus to the row's Edit / Details button that opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [containerRef, onEscape, selector]);
}
