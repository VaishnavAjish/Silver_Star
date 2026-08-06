import { useMemo, useState, useRef, useCallback } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import AccessControlSummary from '../AccessControlSummary';
import PermissionOverridesMatrix from '../PermissionOverridesMatrix';
import GroupedPermissionEditor from '../permissions/GroupedPermissionEditor';
import ViewRestrictionsPanel from '../restrictions/ViewRestrictionsPanel';
import { validateCatalog } from '../permissions/permissionCatalogModel';

/**
 * Access Control tab — the read-only summary, the compact View Restrictions
 * panel (Brick 4) and the permission editor (Brick 3).
 *
 * The two are deliberately separate sections because they answer different
 * questions: View Restrictions is "which records may this user see", the
 * permission editor is "what may this user do". Neither is derived from the
 * other — department visibility grants no operational and no approval authority.
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

  /* Deep link from the Financial Fields row to the same capability in Brick 3's
     editor. It only ever moves the viewport and seeds a search — no permission is
     changed from the restriction summary. */
  const permissionsRef = useRef(null);
  const [permissionFocus, setPermissionFocus] = useState(null);

  const openPermission = useCallback((row) => {
    setPermissionFocus(prev => ({ code: row.code, token: (prev?.token || 0) + 1 }));
    permissionsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);

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
        <h3 className="uc-section-title">View Restrictions</h3>
        <p className="uc-section-hint">
          Which records this user may see. Each row states whether the setting is
          actually enforced by backend code — a stored value is not a restriction.
        </p>
        <ViewRestrictionsPanel
          catalog={catalog}
          catalogFailed={catalogFailed}
          prefs={prefs}
          overrides={userOverrides}
          baseline={roleBaseline}
          role={basic.role}
          isSuperAdmin={isSuperAdmin}
          inventoryScope={inventoryScope}
          setInventoryScope={setInventoryScope}
          departments={departments}
          onOpenPermission={openPermission}
        />
      </div>

      <div className="uc-section" ref={permissionsRef}>
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
            focusRequest={permissionFocus}
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
