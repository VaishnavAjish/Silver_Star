import { AlertTriangle, Shield } from 'lucide-react';
import CopyDiffSummary from './CopyDiffSummary';
import PermissionImpactPreview from './PermissionImpactPreview';
import HighRiskChangeWarning from './HighRiskChangeWarning';
import NeverCopiedPanel from './NeverCopiedPanel';
import {
  CATEGORY,
  CATEGORY_ORDER,
  SUPER_ADMIN_SOURCE_NOTE,
} from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — step 3: the read-only diff.
 *
 * REACHING THIS SCREEN WRITES NOTHING. Everything shown is derived by the pure
 * model from one GET issued when the source was chosen; expanding sections,
 * going back and changing categories, and closing the wizard all cost zero
 * requests and zero writes.
 *
 * UNSELECTED CATEGORIES ARE NOT RENDERED AS A DIFF. They appear once, in a plain
 * "not selected" list, so nothing on screen can suggest they will be written.
 */
export default function CopySetupPreviewStep({
  preview,
  impact,
  sourceIsSuperAdmin,
  targetIsSuperAdmin,
}) {
  const selected = preview.selectedKeys.map(key => preview.categories[key]);
  const notSelected = CATEGORY_ORDER
    .filter(key => !preview.categories[key].selected)
    .map(key => preview.categories[key]);

  const permissionsSelected = preview.categories[CATEGORY.PERMISSIONS].selected;

  return (
    <section className="cs-step" aria-labelledby="cs-step-preview">
      <h3 className="cs-step-title" id="cs-step-preview">Copy preview</h3>
      <p className="cs-step-hint">
        Read-only. This is what an apply would do, computed from the stored rows of both
        users. Nothing below has been written.
      </p>

      {preview.destructiveWarnings.length > 0 && (
        <section
          className="uc-notice uc-notice-warn cs-destructive"
          role="note"
          aria-labelledby="cs-destructive-title"
        >
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 className="cs-destructive-title" id="cs-destructive-title">
              This copy removes or overwrites existing target settings
            </h4>
            <ul className="cs-destructive-list">
              {preview.destructiveWarnings.map(text => <li key={text}>{text}</li>)}
            </ul>
          </div>
        </section>
      )}

      {permissionsSelected && sourceIsSuperAdmin && (
        <p className="uc-notice uc-notice-admin" role="note">
          <Shield size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{SUPER_ADMIN_SOURCE_NOTE}</span>
        </p>
      )}

      {permissionsSelected && (
        <HighRiskChangeWarning changes={impact.highRisk} headingId="cs-highrisk-preview" />
      )}

      {selected.map(category => (
        <CopyDiffSummary key={category.key} category={category} />
      ))}

      {permissionsSelected && (
        <PermissionImpactPreview impact={impact} targetIsSuperAdmin={targetIsSuperAdmin} />
      )}

      {notSelected.length > 0 && (
        <section className="cs-notselected" aria-labelledby="cs-notselected-title">
          <h4 className="cs-notselected-title" id="cs-notselected-title">Not selected</h4>
          <ul className="cs-notselected-list">
            {notSelected.map(category => (
              <li key={category.key}>
                {category.label} — not selected, not previewed, not copied.
              </li>
            ))}
          </ul>
        </section>
      )}

      <NeverCopiedPanel headingId="cs-never-preview" />
    </section>
  );
}
