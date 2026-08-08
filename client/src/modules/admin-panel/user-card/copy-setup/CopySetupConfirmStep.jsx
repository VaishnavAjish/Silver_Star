import { AlertTriangle, RefreshCw } from 'lucide-react';
import HighRiskChangeWarning from './HighRiskChangeWarning';
import NeverCopiedPanel from './NeverCopiedPanel';
import { CATEGORY } from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — step 4: the decision.
 *
 * ACKNOWLEDGEMENT IS PER RISK, NOT A SINGLE "I AGREE". A destructive copy and a
 * privilege-raising copy are different facts, so when both apply the admin ticks
 * both. Neither box exists when its risk does not, so the flow never trains
 * anyone to tick boxes reflexively.
 *
 * STALENESS IS REPORTED HONESTLY. The wizard re-reads the target immediately
 * before applying and compares fingerprints. That closes the realistic window —
 * a preview left open while someone else edits the user — and not the
 * theoretical one between that read and the copy transaction, which would need a
 * precondition on the write endpoint. The wording claims only what it does.
 */

function AckCheckbox({ id, checked, onChange, children }) {
  return (
    <div className="cs-ack">
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
      <label htmlFor={id}>{children}</label>
    </div>
  );
}

export default function CopySetupConfirmStep({
  preview,
  impact,
  sourceUser,
  targetUser,
  ackDestructive,
  setAckDestructive,
  ackHighRisk,
  setAckHighRisk,
  stale,
  onRefreshPreview,
  applyError,
}) {
  const permissions = preview.categories[CATEGORY.PERMISSIONS];
  const visibility = preview.categories[CATEGORY.VISIBILITY];
  const highRisk = permissions.selected ? impact.highRisk : [];

  return (
    <section className="cs-step" aria-labelledby="cs-step-confirm">
      <h3 className="cs-step-title" id="cs-step-confirm">Confirm</h3>
      <p className="cs-step-hint">
        Applying runs the existing copy endpoint as one transaction. Review the summary,
        then confirm.
      </p>

      <dl className="cs-counts cs-counts-wide">
        <div>
          <dt>Copy from</dt>
          <dd>{sourceUser?.full_name} (@{sourceUser?.username}) — {sourceUser?.role}</dd>
        </div>
        <div>
          <dt>Copy to</dt>
          <dd>{targetUser?.full_name} (@{targetUser?.username}) — {targetUser?.role}</dd>
        </div>
        <div>
          <dt>Selected categories</dt>
          <dd>
            {preview.selectedCount}
            {' — '}
            {preview.selectedKeys.map(key => preview.categories[key].label).join(', ')}
          </dd>
        </div>
        {permissions.selected && (
          <div>
            <dt>Permission overrides</dt>
            <dd>
              +{permissions.diff.counts.added} added, −{permissions.diff.counts.removed} removed,
              {' '}{permissions.diff.counts.changed} changed
            </dd>
          </div>
        )}
        {visibility.selected && (
          <div>
            <dt>Inventory scope</dt>
            <dd>
              {visibility.diff.before.effective_mode} → {visibility.diff.after.effective_mode}
            </dd>
          </div>
        )}
        <div>
          <dt>High-risk changes</dt>
          <dd>{highRisk.length}</dd>
        </div>
      </dl>

      {stale && (
        <div className="uc-notice uc-notice-warn" role="alert">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="cs-stale-text">
              Target user configuration changed after this preview was generated. Refresh the
              preview before copying — applying now would carry out a copy that was never
              reviewed.
            </p>
            <button
              type="button"
              className="btn btn-secondary cs-inline-btn"
              onClick={onRefreshPreview}
            >
              <RefreshCw size={12} aria-hidden="true" /> Refresh preview
            </button>
          </div>
        </div>
      )}

      {applyError && (
        <p className="uc-notice uc-notice-danger" role="alert">
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>The copy did not complete. {applyError}</span>
        </p>
      )}

      <HighRiskChangeWarning changes={highRisk} headingId="cs-highrisk-confirm" />

      {preview.isDestructive && (
        <AckCheckbox id="cs-ack-destructive" checked={ackDestructive} onChange={setAckDestructive}>
          I understand this replaces existing settings on {targetUser?.full_name} and that
          {' '}{preview.destructiveWarnings.length === 1 ? 'the change' : 'the changes'} listed
          {' '}in the preview cannot be undone from this screen.
        </AckCheckbox>
      )}

      {highRisk.length > 0 && (
        <AckCheckbox id="cs-ack-highrisk" checked={ackHighRisk} onChange={setAckHighRisk}>
          I understand this grants {highRisk.length} high-risk
          {highRisk.length === 1 ? ' capability' : ' capabilities'} to {targetUser?.full_name}.
        </AckCheckbox>
      )}

      <NeverCopiedPanel headingId="cs-never-confirm" />
    </section>
  );
}
