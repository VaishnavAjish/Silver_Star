import { useRef } from 'react';
import { OVERRIDE_STATES, OVERRIDE_STATE_LABELS } from './permissionEditorModel';

/**
 * The tri-state user override: Inherit | Allow | Deny.
 *
 * Deliberately NOT click-to-cycle. The old matrix made an admin click through
 * Allow to reach Deny, which is a poor default for a security control — every
 * state here is reachable in one action and is always visible as text.
 *
 * Implemented as a radiogroup with roving tabindex: Tab reaches the control
 * once, arrow keys move within it, Space/Enter selects. Selection is conveyed by
 * aria-checked, by the ●/○ marker and by weight — never by colour alone.
 */
export default function PermissionOverrideControl({ label, state, disabled, onChange }) {
  const buttonsRef = useRef([]);

  const move = (offset) => {
    const index = OVERRIDE_STATES.indexOf(state);
    const next = (index + offset + OVERRIDE_STATES.length) % OVERRIDE_STATES.length;
    onChange(OVERRIDE_STATES[next]);
    buttonsRef.current[next]?.focus();
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    }
  };

  return (
    <div className="pe-segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {OVERRIDE_STATES.map((option, index) => {
        const selected = option === state;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            ref={(node) => { buttonsRef.current[index] = node; }}
            className={`pe-seg pe-seg-${option.toLowerCase()}${selected ? ' pe-seg-on' : ''}`}
            onClick={() => !disabled && onChange(option)}
          >
            <span className="pe-seg-mark" aria-hidden="true">{selected ? '●' : '○'}</span>
            {OVERRIDE_STATE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
