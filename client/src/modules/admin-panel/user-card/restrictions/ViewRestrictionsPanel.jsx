import { useMemo, useState, useCallback } from 'react';
import { Info, Shield } from 'lucide-react';
import RestrictionSummaryRow from './RestrictionSummaryRow';
import InventoryDepartmentDialog from './InventoryDepartmentDialog';
import RestrictionDetailsDialog from './RestrictionDetailsDialog';
import {
  RESTRICTION_GROUP,
  CATALOG_UNAVAILABLE_NOTICE,
  buildRestrictionsView,
} from './viewRestrictionsModel';
import './viewRestrictions.css';

/** A group heading plus its rows. Empty groups are not rendered at all. */
function RestrictionGroup({ title, hint, rows }) {
  if (rows.length === 0) return null;
  return (
    <section className="vr-group" aria-label={title}>
      <h4 className="vr-group-title">{title}</h4>
      {hint && <p className="vr-group-hint">{hint}</p>}
      <div className="vr-group-rows">{rows}</div>
    </section>
  );
}

/**
 * RBAC Brick 4 — the compact View Restrictions panel.
 *
 * WHAT IT OWNS: which dialog is open. Nothing else. The inventory scope itself
 * stays in useUserCard where Brick 2 put it, so the snapshot/dirty/save machinery
 * is untouched and there is no second dirty-state engine.
 *
 * WHAT IT NEVER DOES: issue a request. Every value on screen came from the
 * requests useUserCard already makes when the card opens (preferences,
 * departments, inventory-scope, permission-overrides) plus the catalog. Opening
 * the panel, opening a dialog, searching and cancelling are all pure client state.
 *
 * ROW GROUPING IS BY VERIFIED ENFORCEMENT, not by subject matter. "Active and
 * enforced" and "Permission controlled" are the only groups describing a live
 * security control; everything under "Stored but not enforced" says so in words
 * and offers no editing control at all.
 */
export default function ViewRestrictionsPanel({
  catalog,
  catalogFailed,
  prefs,
  overrides,
  baseline,
  role,
  isSuperAdmin,
  inventoryScope,
  setInventoryScope,
  departments,
  onOpenPermission,
}) {
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  /* Bumped per opening so the dialog remounts and reseeds its draft from the
     current scope — the reason Cancel is exact rather than approximate. */
  const [dialogKey, setDialogKey] = useState(0);

  const view = useMemo(() => buildRestrictionsView({
    catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
    inventoryScope, departments,
  }), [
    catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
    inventoryScope, departments,
  ]);

  const openScopeDialog = useCallback(() => {
    setDialogKey(k => k + 1);
    setScopeDialogOpen(true);
  }, []);

  /* Apply writes to the card's pending state only. Brick 2 decides dirtiness. */
  const applyScope = useCallback((draft) => {
    setInventoryScope({
      scope_mode: draft.scope_mode,
      department_ids: draft.department_ids,
    });
    setScopeDialogOpen(false);
  }, [setInventoryScope]);

  const { scope, financial, stored, diagnostics } = view;

  return (
    <div className="vr-panel">
      {!view.catalogAvailable && (
        <div className="uc-notice uc-notice-neutral vr-notice">
          <Info size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{CATALOG_UNAVAILABLE_NOTICE}</span>
        </div>
      )}

      <RestrictionGroup
        title={RESTRICTION_GROUP.ENFORCED}
        hint="Read and applied by verified backend code."
        rows={[
          <RestrictionSummaryRow
            key={scope.code}
            label={scope.label}
            summary={scope.summary}
            status={scope.status}
            description={scope.emptySelection
              ? 'Selected with no departments — the inventory APIs treat this as No Access'
              : null}
            warning={scope.warning}
            actionLabel="Edit"
            actionAccessibleName="Edit Inventory Departments"
            onAction={scope.editable ? openScopeDialog : null}
          />,
        ]}
      />

      <RestrictionGroup
        title={RESTRICTION_GROUP.PERMISSION}
        hint="Governed by an action permission, not by a visibility scope."
        rows={[
          <RestrictionSummaryRow
            key={financial.code}
            label={financial.label}
            summary={financial.summary}
            status={financial.status}
            description={financial.sourceText}
            warning={financial.warning}
            actionLabel="View Permission"
            actionAccessibleName="View Financial Fields in the permission editor"
            onAction={onOpenPermission ? () => onOpenPermission(financial) : null}
          />,
        ]}
      />

      <RestrictionGroup
        title={RESTRICTION_GROUP.STORED}
        hint="Values exist on the account, but no backend code reads them. They restrict nothing."
        rows={stored.map(row => (
          <RestrictionSummaryRow
            key={row.code}
            label={row.label}
            summary={row.summary}
            status={row.status}
            description={row.description}
            actionLabel="Details"
            actionAccessibleName={`Details for ${row.label}`}
            onAction={() => setDetailRow(row)}
          />
        ))}
      />

      {isSuperAdmin && (
        <RestrictionGroup
          title={RESTRICTION_GROUP.DIAGNOSTIC}
          hint="Super Admin diagnostics. Read-only, never written, and not granted to any standard role."
          rows={diagnostics.map(row => (
            <RestrictionSummaryRow
              key={row.code}
              label={row.label}
              summary={row.summary}
              status={row.status}
              description={row.description}
              actionLabel="Details"
              actionAccessibleName={`Details for ${row.label}`}
              onAction={() => setDetailRow(row)}
            />
          ))}
        />
      )}

      {isSuperAdmin && (
        <div className="uc-notice uc-notice-admin vr-notice">
          <Shield size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Super Admin bypasses inventory department scope and financial field checks in the
            resolver. No role row is created for the bypass.
          </span>
        </div>
      )}

      {scopeDialogOpen && (
        <InventoryDepartmentDialog
          key={dialogKey}
          scope={inventoryScope}
          departments={departments}
          restrictionLabel={scope.label}
          onApply={applyScope}
          onCancel={() => setScopeDialogOpen(false)}
        />
      )}

      {detailRow && (
        <RestrictionDetailsDialog row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </div>
  );
}
