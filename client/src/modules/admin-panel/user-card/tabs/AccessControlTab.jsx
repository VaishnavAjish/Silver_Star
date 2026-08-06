import { useMemo } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import AccessControlSummary from '../AccessControlSummary';
import InventoryScopeEditor from '../InventoryScopeEditor';
import PermissionOverridesMatrix from '../PermissionOverridesMatrix';
import GroupedPermissionEditor from '../permissions/GroupedPermissionEditor';
import { validateCatalog } from '../permissions/permissionCatalogModel';

/**
 * The seven stored-but-unenforced financial visibility preferences.
 *
 * server/rbac/viewRestrictions.js classifies every one of these as
 * STORED_NOT_ENFORCED: they are written and copied between users, but nothing
 * reads them — not the client, not the server. Presenting them as editable
 * security controls would misrepresent the system, so Brick 2 shows them
 * read-only. The compact editor is Brick 4's job.
 */
const VIEW_RESTRICTION_KEYS = [
  { key: 'vis.show_cogs', label: 'Cost of Goods (COGS)' },
  { key: 'vis.show_purchase_rate', label: 'Purchase Rate' },
  { key: 'vis.show_sale_rate', label: 'Sale Rate' },
  { key: 'vis.show_margin', label: 'Margin %' },
  { key: 'vis.show_gross_profit', label: 'Gross Profit' },
  { key: 'vis.show_net_profit', label: 'Net Profit' },
  { key: 'vis.show_balances', label: 'Account Balances' },
];

/**
 * Access Control tab — the read-only summary, the enforced inventory scope, the
 * read-only unenforced view restrictions, and the permission editor.
 *
 * The editor is chosen, not hard-coded. Brick 3's grouped editor needs a catalog
 * it can trust; when the endpoint fails or returns something it cannot map, the
 * Brick 2 matrix is rendered instead so user administration never stops because
 * a diagnostic endpoint did. Exactly one editor is on screen at a time.
 */
export default function AccessControlTab({
  basic,
  isSuperAdmin,
  prefs,
  overrideRecordCount,
  inventoryScope,
  setInventoryScope,
  departments,
  userOverrides,
  setUserOverrides,
  effectiveAccess,
  catalog,
  catalogFailed,
  roleBaseline,
  onResetAllStored,
  busy,
}) {
  const catalogCheck = useMemo(
    () => (catalogFailed ? { ok: false, reason: 'the catalog endpoint failed' } : validateCatalog(catalog)),
    [catalog, catalogFailed],
  );

  return (
    <div>
      <AccessControlSummary
        basic={basic}
        isSuperAdmin={isSuperAdmin}
        overrideRecordCount={overrideRecordCount}
        inventoryScope={inventoryScope}
        effectiveAccess={effectiveAccess}
        catalog={catalog}
        catalogFailed={catalogFailed}
      />

      <div className="uc-section">
        <h3 className="uc-section-title">Inventory Department Access</h3>
        <InventoryScopeEditor
          inventoryScope={inventoryScope}
          setInventoryScope={setInventoryScope}
          departments={departments}
          isSuperAdmin={isSuperAdmin}
        />
      </div>

      <div className="uc-section">
        <h3 className="uc-section-title">Financial Field Visibility</h3>
        <div className="uc-notice uc-notice-neutral">
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            These values are stored on the account but no backend API reads them yet,
            so they are shown read-only. The enforced financial control is the
            <strong> inventory.inventory_financial </strong>
            permission in the matrix below. A compact editor arrives in RBAC Brick 4.
          </span>
        </div>
        <div>
          {VIEW_RESTRICTION_KEYS.map(({ key, label }) => {
            const on = prefs[key] === 'true' || prefs[key] === true;
            return (
              <div key={key} className="uc-row">
                <div>
                  <div className="uc-row-label">{label}</div>
                  <div className="uc-row-desc">
                    Stored setting — backend enforcement not implemented
                  </div>
                </div>
                <span className="uc-readonly-value">{on ? 'Visible' : 'Hidden'}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="uc-section">
        <h3 className="uc-section-title">Permission Overrides</h3>

        {!isSuperAdmin && (
          <p className="uc-section-hint">
            Editing <strong>{basic.full_name} ({basic.username})</strong> user overrides.
            This changes only this user — the role baseline and other users are untouched.
          </p>
        )}

        {catalogCheck.ok ? (
          <GroupedPermissionEditor
            catalog={catalog}
            overrides={userOverrides}
            setOverrides={setUserOverrides}
            baseline={roleBaseline}
            roleLabel={basic.role}
            editable={!isSuperAdmin}
            userLabel={`${basic.full_name} (${basic.username})`}
            overrideRecordCount={overrideRecordCount}
            onResetAllStored={onResetAllStored}
            busy={busy}
          />
        ) : (
          <>
            <div className="uc-notice uc-notice-warn">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Grouped permission catalog unavailable. The legacy permission editor is
                being shown so user administration can continue.
                {catalogCheck.reason && <> Reason: {catalogCheck.reason}.</>}
              </span>
            </div>

            {isSuperAdmin && (
              <div className="uc-notice uc-notice-admin">
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Super Admin — full unrestricted access granted. The matrix is shown for
                  reference and is not editable for this role.
                </span>
              </div>
            )}

            <PermissionOverridesMatrix
              overrides={userOverrides}
              setOverrides={setUserOverrides}
              editable={!isSuperAdmin}
            />
          </>
        )}
      </div>
    </div>
  );
}
