import { useState, useRef, useMemo, useCallback } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import useDialogFocusTrap from '../useDialogFocusTrap';
import {
  SCOPE_MODE,
  SCOPE_MODE_OPTIONS,
  setScopeMode,
  toggleDepartment,
  selectDepartments,
  clearDepartments,
  filterDepartments,
  scopesEqual,
  isEmptySelection,
} from './viewRestrictionsModel';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

/**
 * The focused editor for Inventory Department Access.
 *
 * IT NEVER SAVES. Apply hands a new scope object to the caller, which puts it in
 * the User Card's existing `inventoryScope` state; Brick 2's snapshot comparison
 * then decides whether Access Control is dirty and the existing category save
 * writes it. Cancel simply discards the draft — the card's state was never
 * touched, so there is nothing to roll back.
 *
 * The draft is seeded once from `scope` when the dialog mounts (the panel gives
 * it a fresh key per opening), which is what makes Cancel exact rather than
 * approximate. Search text lives here too, so typing can never reach the card
 * and can never mark anything dirty.
 */
export default function InventoryDepartmentDialog({
  scope,
  departments,
  onApply,
  onCancel,
  restrictionLabel = 'Inventory Departments',
}) {
  const dialogRef = useRef(null);
  useDialogFocusTrap({ containerRef: dialogRef, onEscape: onCancel, selector: FOCUSABLE });

  const [draft, setDraft] = useState(() => ({
    scope_mode: scope?.scope_mode || SCOPE_MODE.ALL,
    department_ids: [...(scope?.department_ids || [])],
  }));
  const [search, setSearch] = useState('');

  const visible = useMemo(() => filterDepartments(departments, search), [departments, search]);
  const selectedCount = draft.department_ids.length;
  const isSelected = draft.scope_mode === SCOPE_MODE.SELECTED;
  const unchanged = scopesEqual(draft, scope);

  const changeMode = useCallback(mode => setDraft(d => setScopeMode(d, mode)), []);

  return (
    <div className="uc-dialog-overlay">
      <div
        className="uc-dialog vr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vr-dept-title"
        ref={dialogRef}
      >
        <h2 className="uc-dialog-title" id="vr-dept-title">Edit {restrictionLabel}</h2>

        <div className="uc-dialog-body vr-dialog-body">
          <fieldset className="vr-mode-set">
            <legend className="vr-mode-legend">Access mode</legend>
            {SCOPE_MODE_OPTIONS.map(mode => (
              <label key={mode.value} className="vr-mode-option">
                <input
                  type="radio"
                  name="vr_scope_mode"
                  value={mode.value}
                  checked={draft.scope_mode === mode.value}
                  onChange={() => changeMode(mode.value)}
                />
                <span>{mode.label}</span>
              </label>
            ))}
          </fieldset>

          <p className="vr-mode-hint">
            {draft.scope_mode === SCOPE_MODE.ALL
              && 'Every department, including departments created later. This is not the same '
                + 'as ticking every department individually.'}
            {draft.scope_mode === SCOPE_MODE.NONE
              && 'No inventory departments. Inventory queries return no rows for this user.'}
            {isSelected
              && 'Only the departments ticked below. Departments created later are not '
                + 'included until they are ticked.'}
          </p>

          {isSelected && (
            <div className="vr-picker">
              <div className="vr-picker-head">
                <div className="vr-search">
                  <Search size={13} aria-hidden="true" />
                  <input
                    type="text"
                    className="vr-search-input"
                    placeholder="Search departments…"
                    aria-label="Search departments"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <p className="vr-selected-count" role="status" aria-live="polite">
                  {selectedCount} of {departments.length} departments selected
                </p>
              </div>

              <div className="vr-picker-actions">
                <button
                  type="button"
                  className="vr-link-btn"
                  aria-label={search.trim() === ''
                    ? 'Select all departments'
                    : 'Select all matching departments'}
                  onClick={() => setDraft(d => selectDepartments(d, visible.map(dept => dept.id)))}
                >
                  {search.trim() === '' ? 'Select All' : 'Select All Matching'}
                </button>
                <button
                  type="button"
                  className="vr-link-btn vr-link-danger"
                  aria-label="Clear all selected departments"
                  onClick={() => setDraft(clearDepartments)}
                >
                  Clear All
                </button>
              </div>

              <div className="vr-picker-list">
                {visible.length === 0 ? (
                  <p className="vr-picker-empty">No departments match “{search}”.</p>
                ) : visible.map(dept => (
                  <label key={dept.id} className="vr-dept-option">
                    <input
                      type="checkbox"
                      checked={draft.department_ids.some(id => Number(id) === Number(dept.id))}
                      onChange={() => setDraft(d => toggleDepartment(d, dept.id))}
                    />
                    <span>{dept.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isEmptySelection(draft) && (
            <p className="vr-dialog-warning" role="alert">
              <AlertTriangle size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Selected Departments with nothing ticked is rejected by the inventory-scope
                API, and the query builder treats it as No Access. Tick at least one
                department, or choose No Access.
              </span>
            </p>
          )}

          <p className="vr-dialog-note">
            Applying keeps this as a pending change. Nothing is written until Access
            Control is saved.
          </p>
        </div>

        <div className="uc-dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApply(draft)}
            disabled={unchanged}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
