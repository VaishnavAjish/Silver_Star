import { Info, Shield } from 'lucide-react';
import CopyCategoryCard from './CopyCategoryCard';
import {
  CATEGORY,
  CATEGORY_ORDER,
  CATEGORY_META,
  VIS_EXCLUSION_NOTE,
  SUPER_ADMIN_TARGET_NOTE,
} from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — step 2: which categories are in scope.
 *
 * EVERY CATEGORY IS INDEPENDENT. Nothing on this screen enables anything else:
 * the backend runs the five `if (copy_*)` blocks in isolation inside one
 * transaction, so there is no dependency to model and none is invented. Selecting
 * Permissions does not select Visibility, and Preferences does not drag Dashboard
 * along with it.
 *
 * NOTHING IS PRE-SELECTED. The previous modal defaulted all five to on, which
 * made the most destructive possible copy the path of least resistance.
 */

function countsFor(key, rowCounts) {
  const c = rowCounts?.[key];
  if (!c) return null;

  switch (key) {
    case CATEGORY.PERMISSIONS:
      return {
        source: `${c.source} override rows`,
        target: `${c.target} override rows`,
        extra: (c.sourceLegacy || c.targetLegacy)
          ? `legacy rows — source ${c.sourceLegacy}, target ${c.targetLegacy}`
          : null,
      };
    case CATEGORY.VISIBILITY:
      return {
        source: `${c.sourceMode} scope`,
        target: `${c.targetMode} scope`,
        extra: `${c.source} / ${c.target} departments listed`,
      };
    case CATEGORY.PREFERENCES:
      return {
        source: `${c.source} keys`,
        target: `${c.target} keys`,
        extra: `${c.sourceCopyable} copyable after the vis.* exclusion`,
      };
    case CATEGORY.DASHBOARD:
      return { source: `${c.source} widgets`, target: `${c.target} widgets`, extra: null };
    case CATEGORY.TEMPLATES:
      return {
        source: `${c.source} shares`,
        target: `${c.target} shares`,
        extra: `${c.sourceOwned} non-global templates the source created`,
      };
    default:
      return null;
  }
}

export default function CopySetupCategoryStep({
  selection,
  onToggle,
  rowCounts,
  targetIsSuperAdmin,
}) {
  const selectedCount = CATEGORY_ORDER.filter(key => selection[key]).length;

  return (
    <section className="cs-step" aria-labelledby="cs-step-categories">
      <h3 className="cs-step-title" id="cs-step-categories">Categories</h3>
      <p className="cs-step-hint">
        Select only what should be copied. Each category is independent — selecting one
        never selects another — and each one replaces the target&apos;s stored rows for
        that category rather than merging into them.
      </p>

      <fieldset className="cs-fieldset">
        <legend className="cs-legend">
          Copy categories ({selectedCount} of {CATEGORY_ORDER.length} selected)
        </legend>
        <div className="cs-cat-list">
          {CATEGORY_ORDER.map(key => (
            <CopyCategoryCard
              key={key}
              meta={CATEGORY_META[key]}
              counts={countsFor(key, rowCounts)}
              checked={Boolean(selection[key])}
              onToggle={onToggle}
            />
          ))}
        </div>
      </fieldset>

      <p className="cs-note" role="note">
        <Info size={13} aria-hidden="true" />
        <span>{VIS_EXCLUSION_NOTE}</span>
      </p>

      {targetIsSuperAdmin && (
        <p className="uc-notice uc-notice-admin" role="note">
          <Shield size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{SUPER_ADMIN_TARGET_NOTE}</span>
        </p>
      )}
    </section>
  );
}
