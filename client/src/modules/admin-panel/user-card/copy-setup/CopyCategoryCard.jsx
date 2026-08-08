import { SEMANTICS_LABELS } from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — one selectable copy category.
 *
 * A REAL CHECKBOX, not a click-handling div. The pre-Brick-6 modal used a styled
 * `div` with an onClick, which is unreachable by keyboard and announces nothing;
 * this is a labelled `input type="checkbox"` so Tab, Space and screen readers all
 * work, and the selected state is carried by the control itself rather than only
 * by a background colour.
 *
 * THE SEMANTIC IS ALWAYS VISIBLE. Every category is a REPLACE, and the chip says
 * so next to the name rather than hiding it behind the word "Copy".
 */
export default function CopyCategoryCard({ meta, counts, checked, onToggle, disabled }) {
  const inputId = `cs-cat-${meta.key}`;
  const descriptionId = `${inputId}-desc`;

  return (
    <div className={`cs-cat${checked ? ' cs-cat-on' : ''}`}>
      <input
        type="checkbox"
        id={inputId}
        className="cs-cat-check"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(meta.key)}
        aria-describedby={descriptionId}
      />
      <div className="cs-cat-body">
        <label className="cs-cat-label" htmlFor={inputId}>
          <span className="cs-cat-name">{meta.label}</span>
          <span className="cs-chip cs-chip-replace">{SEMANTICS_LABELS[meta.semantics]}</span>
        </label>
        <p className="cs-cat-desc" id={descriptionId}>{meta.semanticsNote}</p>
        {counts && (
          <p className="cs-cat-counts">
            Source: {counts.source} · Target: {counts.target}
            {counts.extra ? <> · {counts.extra}</> : null}
          </p>
        )}
      </div>
    </div>
  );
}
