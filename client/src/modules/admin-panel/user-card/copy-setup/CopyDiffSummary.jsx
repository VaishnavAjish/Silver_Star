import { AlertTriangle, Info } from 'lucide-react';
import {
  CATEGORY,
  SEMANTICS_LABELS,
  SCOPE_AUTHORITY_NOTE,
  DASHBOARD_AUTHORITY_NOTE,
  VIS_PRESERVATION_NOTE,
} from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — the row-level diff for one selected category.
 *
 * SOURCE / TARGET / RESULT, ALWAYS IN THAT ORDER, and always with the removal
 * count beside them. "Result 7" on its own reads like an addition; "Target 2 →
 * Result 7, 2 removed" is the sentence that is actually true of a replace.
 *
 * NO MEANING IS CARRIED BY COLOUR. Every added, changed and removed line is
 * prefixed with the word, not only tinted, and the counts are rendered as
 * labelled figures rather than as a red/green bar.
 *
 * This component only renders — every number it shows was computed by
 * copySetupPreviewModel, and nothing here recounts anything.
 */

function CountRow({ counts, unit = 'rows' }) {
  return (
    <dl className="cs-counts">
      <div><dt>Source</dt><dd>{counts.source} {unit}</dd></div>
      <div><dt>Target now</dt><dd>{counts.target} {unit}</dd></div>
      <div><dt>Result</dt><dd>{counts.result} {unit}</dd></div>
      <div><dt>Added</dt><dd>{counts.added}</dd></div>
      <div><dt>Changed</dt><dd>{counts.changed}</dd></div>
      <div><dt>Removed</dt><dd>{counts.removed}</dd></div>
    </dl>
  );
}

function ChangeList({ title, entries, describe, limit = 8 }) {
  if (!entries?.length) return null;
  const shown = entries.slice(0, limit);
  const hidden = entries.length - shown.length;

  return (
    <div className="cs-changes">
      <h5 className="cs-changes-title">{title} ({entries.length})</h5>
      <ul className="cs-changes-list">
        {shown.map(entry => <li key={entry.key}>{describe(entry)}</li>)}
      </ul>
      {hidden > 0 && <p className="cs-changes-more">…and {hidden} more.</p>}
    </div>
  );
}

const maskText = row => `allow ${Number(row?.allow_mask) || 0} / deny ${Number(row?.deny_mask) || 0}`;

function PermissionsDiff({ diff }) {
  const { overrides, legacy } = diff;
  return (
    <>
      <CountRow counts={overrides.counts} unit="override rows" />
      <ChangeList
        title="Added"
        entries={overrides.added}
        describe={e => `Added ${e.key} — ${maskText(e.after)}`}
      />
      <ChangeList
        title="Changed"
        entries={overrides.changed}
        describe={e => `Changed ${e.key} — ${maskText(e.before)} becomes ${maskText(e.after)}`}
      />
      <ChangeList
        title="Removed"
        entries={overrides.removed}
        describe={e => `Removed ${e.key} — ${maskText(e.before)} is deleted`}
      />

      {(legacy.counts.source > 0 || legacy.counts.target > 0) && (
        <p className="cs-note" role="note">
          <Info size={13} aria-hidden="true" />
          <span>
            Legacy/inactive stored permission rows: source {legacy.counts.source},
            {' '}target {legacy.counts.target}. The copy replaces the legacy
            {' '}user_permissions table in the same transaction, so {legacy.counts.removed}
            {' '}target {legacy.counts.removed === 1 ? 'row is' : 'rows are'} deleted and
            {' '}{legacy.counts.result} {legacy.counts.result === 1 ? 'row is' : 'rows are'}
            {' '}written. These rows are not shown by the permission editor and their keys
            {' '}are not rewritten.
          </span>
        </p>
      )}
    </>
  );
}

function scopeText(side) {
  if (!side.has_row) return 'No stored scope row — resolves as All departments';
  if (side.effective_mode === 'ALL') return 'All inventory departments';
  if (side.effective_mode === 'NONE') return 'No inventory departments';
  return side.departments.length
    ? side.departments.map(d => d.name).join(', ')
    : 'Selected departments (none listed)';
}

function VisibilityDiff({ diff }) {
  return (
    <>
      <dl className="cs-counts cs-counts-wide">
        <div><dt>Target now</dt><dd>{scopeText(diff.before)}</dd></div>
        <div><dt>After copy</dt><dd>{scopeText(diff.after)}</dd></div>
        <div><dt>Scope mode</dt><dd>{diff.before.effective_mode} → {diff.after.effective_mode}</dd></div>
        <div>
          <dt>Unassigned records</dt>
          <dd>
            {diff.before.include_unassigned ? 'Included' : 'Excluded'}
            {' → '}
            {diff.after.include_unassigned ? 'Included' : 'Excluded'}
          </dd>
        </div>
      </dl>
      {!diff.changed && <p className="cs-changes-more">This category resolves to no change.</p>}
      <p className="cs-note" role="note">
        <Info size={13} aria-hidden="true" />
        <span>{SCOPE_AUTHORITY_NOTE}</span>
      </p>
    </>
  );
}

function PreferencesDiff({ diff }) {
  return (
    <>
      <CountRow counts={diff.counts} unit="keys" />
      <ChangeList
        title="Added"
        entries={diff.added}
        describe={e => `Added ${e.key} = ${e.after.pref_value}`}
      />
      <ChangeList
        title="Changed"
        entries={diff.changed}
        describe={e => `Changed ${e.key} — ${e.before.pref_value} becomes ${e.after.pref_value}`}
      />
      <ChangeList
        title="Removed"
        entries={diff.removed}
        describe={e => `Removed ${e.key} (was ${e.before.pref_value})`}
      />

      {diff.counts.excluded > 0 && (
        <p className="cs-note" role="note">
          <Info size={13} aria-hidden="true" />
          <span>
            {diff.counts.excluded} source {diff.excludedPrefix}*
            {' '}{diff.counts.excluded === 1 ? 'key is' : 'keys are'} excluded from the copy and
            {' '}will not be written to the target.
          </span>
        </p>
      )}

      {/* RBAC Brick 7: this was a destructive-removal warning. The copy's DELETE
          now carries the same vis.* filter as its INSERT, so these rows survive,
          and the note states the preservation rather than warning about a loss
          that no longer happens. Still shown rather than hidden — an admin
          should see which security-relevant keys the copy is leaving alone. */}
      {diff.counts.preservedExcluded > 0 && (
        <p className="cs-note" role="note">
          <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {diff.counts.preservedExcluded} stored {diff.excludedPrefix}*
            {' '}{diff.counts.preservedExcluded === 1 ? 'preference' : 'preferences'} on the target
            {' '}({diff.preservedExcluded.map(e => e.key).join(', ')}) will be kept
            {' '}unchanged. {VIS_PRESERVATION_NOTE}
          </span>
        </p>
      )}
    </>
  );
}

function DashboardDiff({ diff }) {
  return (
    <>
      <CountRow counts={diff.counts} unit="widgets" />
      <ChangeList
        title="Added"
        entries={diff.added}
        describe={e => `Added ${e.key} at position ${e.after.position}${e.after.is_visible ? '' : ' (hidden)'}`}
      />
      <ChangeList
        title="Changed"
        entries={diff.changed}
        describe={e => `Changed ${e.key} — position ${e.before.position} becomes ${e.after.position}, `
          + `${e.before.is_visible ? 'visible' : 'hidden'} becomes ${e.after.is_visible ? 'visible' : 'hidden'}`}
      />
      <ChangeList title="Removed" entries={diff.removed} describe={e => `Removed ${e.key}`} />
      <p className="cs-note" role="note">
        <Info size={13} aria-hidden="true" />
        <span>{DASHBOARD_AUTHORITY_NOTE}</span>
      </p>
    </>
  );
}

function TemplatesDiff({ diff }) {
  return (
    <>
      <CountRow counts={diff.counts} unit="shares" />
      <ChangeList
        title="Added"
        entries={diff.added}
        describe={e => `Added share of ${e.after.name}`
          + `${e.after.via_owned ? ' (a template the source created)' : ''}`}
      />
      <ChangeList
        title="Removed"
        entries={diff.removed}
        describe={e => `Removed share of ${e.before.name}`}
      />
      <p className="cs-note" role="note">
        <Info size={13} aria-hidden="true" />
        <span>
          {diff.counts.sourceShares} explicit {diff.counts.sourceShares === 1 ? 'share' : 'shares'}
          {' '}plus {diff.counts.sourceOwned} non-global
          {' '}{diff.counts.sourceOwned === 1 ? 'template' : 'templates'} the source created
          {diff.counts.duplicatesIgnored > 0
            ? `, with ${diff.counts.duplicatesIgnored} duplicate ${diff.counts.duplicatesIgnored === 1 ? 'entry' : 'entries'} ignored`
            : ''}
          . Template ownership is never transferred — the source keeps every template it created.
        </span>
      </p>
    </>
  );
}

const BODIES = {
  [CATEGORY.PERMISSIONS]: PermissionsDiff,
  [CATEGORY.VISIBILITY]: VisibilityDiff,
  [CATEGORY.PREFERENCES]: PreferencesDiff,
  [CATEGORY.DASHBOARD]: DashboardDiff,
  [CATEGORY.TEMPLATES]: TemplatesDiff,
};

export default function CopyDiffSummary({ category }) {
  const Body = BODIES[category.key];
  const headingId = `cs-diff-${category.key}`;

  return (
    <section className="cs-diff" aria-labelledby={headingId}>
      <h4 className="cs-diff-title" id={headingId}>
        <span>{category.label}</span>
        <span className="cs-chip cs-chip-replace">{SEMANTICS_LABELS[category.semantics]}</span>
        {category.destructive && (
          <span className="cs-chip cs-chip-danger">Removes existing settings</span>
        )}
      </h4>
      <p className="cs-diff-semantics">{category.semanticsNote}</p>
      <Body diff={category.diff} />
    </section>
  );
}
