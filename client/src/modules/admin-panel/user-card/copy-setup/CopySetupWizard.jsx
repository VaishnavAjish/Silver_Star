import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Loader2, X } from 'lucide-react';
import useDialogFocusTrap from '../useDialogFocusTrap';
import { useCopySetupContext, useCopySetupPayload } from './useCopySetupPreview';
import CopySetupSourceStep from './CopySetupSourceStep';
import CopySetupCategoryStep from './CopySetupCategoryStep';
import CopySetupPreviewStep from './CopySetupPreviewStep';
import CopySetupConfirmStep from './CopySetupConfirmStep';
import {
  CATEGORY,
  EMPTY_SELECTION,
  buildApplyPayload,
  buildCopyPreview,
  categoryRowCounts,
  overridesToMap,
  toggleCategory,
} from './copySetupPreviewModel';
import { buildPermissionImpact } from './copySetupImpactModel';
import './copySetup.css';

/**
 * RBAC Brick 6 — the Copy User Setup wizard.
 *
 * FOUR STAGES: source → categories → preview → confirm. The first three are
 * read-only. `api.post` appears exactly once in this file, on the confirm step's
 * Apply, and it sends the pre-Brick-6 payload to the pre-Brick-6 endpoint.
 *
 * THE APPLY STAYS ATOMIC. The backend performs all five categories inside one
 * BEGIN/COMMIT, and Brick 6 sends one request. It deliberately does NOT adopt
 * Brick 2's per-category save shape: this operation deletes rows, and splitting
 * it would make a partial copy reachable.
 *
 * ANY CHANGE OF INPUT INVALIDATES A REVIEWED PREVIEW. Changing the source or a
 * category selection drops the wizard back to the category step and clears both
 * acknowledgements, so an Apply is never authorised against a diff the admin did
 * not actually see.
 *
 * PREVIEW COMPUTATION IS MEMOISED, not done during render: `buildCopyPreview`
 * and `buildPermissionImpact` are the expensive steps and depend only on the
 * payload, the selection and the target's baseline.
 */

const STEPS = ['source', 'categories', 'preview', 'confirm'];
const STEP_LABELS = {
  source: 'Source',
  categories: 'Categories',
  preview: 'Preview',
  confirm: 'Confirm',
};

export default function CopySetupWizard({ targetUser, users = [], api, onClose, onSuccess }) {
  const [step, setStep] = useState('source');
  const [sourceUserId, setSourceUserId] = useState('');
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [ackDestructive, setAckDestructive] = useState(false);
  const [ackHighRisk, setAckHighRisk] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [stale, setStale] = useState(false);

  const dialogRef = useRef(null);
  const requestClose = useCallback(() => { if (!applying) onClose?.(); }, [applying, onClose]);
  useDialogFocusTrap({
    containerRef: dialogRef,
    onEscape: requestClose,
    selector: 'button:not([disabled]), input:not([disabled]), select:not([disabled])',
  });

  const { catalog, catalogFailed, baseline } = useCopySetupContext({ api, targetUser });
  const { payload, loading, error, reload } = useCopySetupPayload({
    api, targetId: targetUser?.id, sourceId: sourceUserId,
  });

  const candidates = useMemo(
    () => (users || []).filter(u => u?.is_active && Number(u.id) !== Number(targetUser?.id)),
    [users, targetUser?.id],
  );

  /* Any input change makes a reviewed preview obsolete. */
  const invalidate = useCallback(() => {
    setAckDestructive(false);
    setAckHighRisk(false);
    setApplyError(null);
    setStale(false);
    setStep(current => (current === 'source' ? current : 'categories'));
  }, []);

  const changeSource = useCallback((value) => {
    setSourceUserId(value);
    setAckDestructive(false);
    setAckHighRisk(false);
    setApplyError(null);
    setStale(false);
    setStep('source');
  }, []);

  const onToggleCategory = useCallback((key) => {
    setSelection(current => toggleCategory(current, key));
    invalidate();
  }, [invalidate]);

  const preview = useMemo(
    () => buildCopyPreview({ payload, selection }),
    [payload, selection],
  );

  const rowCounts = useMemo(() => (payload ? categoryRowCounts(payload) : null), [payload]);

  const targetIsSuperAdmin = (payload?.target?.role || targetUser?.role) === 'super_admin';
  const sourceIsSuperAdmin = payload?.source?.role === 'super_admin';

  const impact = useMemo(() => {
    if (!payload || !selection[CATEGORY.PERMISSIONS]) {
      return {
        available: false,
        reason: 'Permission Overrides is not selected.',
        changes: [],
        highRisk: [],
      };
    }
    return buildPermissionImpact({
      catalog,
      catalogFailed,
      baseline,
      isSuperAdmin: targetIsSuperAdmin,
      currentOverrides: overridesToMap(payload.categories.permissions.target.overrides),
      resultOverrides: overridesToMap(payload.categories.permissions.source.overrides),
    });
  }, [payload, selection, catalog, catalogFailed, baseline, targetIsSuperAdmin]);

  const stepIndex = STEPS.indexOf(step);
  const canLeaveSource = Boolean(sourceUserId) && Boolean(payload) && !error && !loading;
  const canLeaveCategories = preview.selectedCount > 0;
  const acknowledged = (!preview.isDestructive || ackDestructive)
    && (impact.highRisk?.length ? ackHighRisk : true);
  const canApply = preview.ready && acknowledged && !stale && !applying;

  const goNext = () => setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
  const goBack = () => setStep(STEPS[Math.max(stepIndex - 1, 0)]);

  const refreshPreview = useCallback(async () => {
    await reload();
    setStale(false);
    setAckDestructive(false);
    setAckHighRisk(false);
    setStep('preview');
  }, [reload]);

  /**
   * The only write in the flow.
   *
   * RBAC BRICK 7 — THE STALENESS CHECK IS NO LONGER BEST-EFFORT.
   *   Brick 6 could only re-read and compare on the client, which left a window
   *   between that read and the copy transaction's first statement. The reviewed
   *   fingerprint now travels WITH the request as `expected_fingerprint`, and the
   *   server re-derives it inside the copy transaction, under a row lock on both
   *   users, before writing anything. A mismatch is answered with
   *   409 STALE_COPY_PREVIEW and the transaction rolls back.
   *
   *   The client-side re-read below is kept, but its role has changed: it is now
   *   a fast, friendly pre-check that usually spares the user a round trip. It is
   *   NOT the guarantee. Even if it passes and the state changes a millisecond
   *   later, the server still refuses the write.
   *
   *   `payload.state_fingerprint` is preferred over the locally computed one: it
   *   is the server's own value for the state the admin reviewed, so the
   *   comparison never depends on client and server agreeing about serialisation
   *   at runtime. The local value is the fallback for a backend deployed before
   *   this brick, which simply keeps Brick 6 behaviour.
   */
  const applyCopy = useCallback(async () => {
    const reviewed = preview.fingerprint;
    const reviewedServerFingerprint = payload?.state_fingerprint;
    setApplying(true);
    setApplyError(null);

    try {
      const fresh = await reload();
      if (!fresh) {
        setApplyError('The current configuration could not be re-read, so the copy was not attempted.');
        return;
      }
      if (buildCopyPreview({ payload: fresh, selection }).fingerprint !== reviewed) {
        setStale(true);
        return;
      }

      await api.post(
        `/api/admin/users/${targetUser.id}/copy-setup`,
        {
          ...buildApplyPayload({ sourceId: sourceUserId, selection }),
          ...(reviewedServerFingerprint
            ? { expected_fingerprint: reviewedServerFingerprint }
            : {}),
        },
      );
      onSuccess?.({ sourceUserId: Number(sourceUserId), selection });
      onClose?.();
    } catch (err) {
      /* A 409 STALE_COPY_PREVIEW means the server refused because the state moved
         after the preview — the same condition the local check reports, caught
         where it can actually be guaranteed. Route it to the stale screen so the
         admin is offered a re-read, not a retry of a write that would fail
         identically. Matched on the stable code, never on message text. */
      if (err?.code === 'STALE_COPY_PREVIEW' || err?.status === 409) {
        setStale(true);
        return;
      }
      // No success is claimed and the wizard stays open on the confirm step with
      // the selection intact. The copy endpoint rolls its transaction back on
      // error, so a failure here leaves the target as it was.
      setApplyError(err?.message || 'The server rejected the copy.');
    } finally {
      setApplying(false);
    }
  }, [api, onClose, onSuccess, payload?.state_fingerprint, preview.fingerprint, reload, selection, sourceUserId, targetUser?.id]);

  const sourceUser = payload?.source
    || candidates.find(u => Number(u.id) === Number(sourceUserId))
    || null;

  return (
    <div className="uc-dialog-overlay cs-overlay">
      <div
        className="cs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-dialog-title"
        ref={dialogRef}
      >
        <div className="cs-dialog-head">
          <h2 className="cs-dialog-title" id="cs-dialog-title">Copy User Setup</h2>
          <button
            type="button"
            className="uc-action-btn cs-close"
            onClick={requestClose}
            disabled={applying}
            aria-label="Close copy user setup"
          >
            <X size={15} />
          </button>
        </div>

        <ol className="cs-steps" aria-label="Copy setup progress">
          {STEPS.map((name, index) => (
            <li
              key={name}
              className={`cs-steps-item${index === stepIndex ? ' cs-steps-current' : ''}`}
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span className="cs-steps-index">{index + 1}</span>
              <span>{STEP_LABELS[name]}</span>
            </li>
          ))}
        </ol>

        <div className="cs-dialog-body">
          {step === 'source' && (
            <CopySetupSourceStep
              targetUser={targetUser}
              sourceUser={sourceUser}
              candidates={candidates}
              sourceUserId={sourceUserId}
              onChangeSource={changeSource}
              loading={loading}
              error={error}
            />
          )}

          {step === 'categories' && (
            <CopySetupCategoryStep
              selection={selection}
              onToggle={onToggleCategory}
              rowCounts={rowCounts}
              targetIsSuperAdmin={targetIsSuperAdmin}
            />
          )}

          {step === 'preview' && (
            <CopySetupPreviewStep
              preview={preview}
              impact={impact}
              sourceIsSuperAdmin={sourceIsSuperAdmin}
              targetIsSuperAdmin={targetIsSuperAdmin}
            />
          )}

          {step === 'confirm' && (
            <CopySetupConfirmStep
              preview={preview}
              impact={impact}
              sourceUser={sourceUser}
              targetUser={payload?.target || targetUser}
              ackDestructive={ackDestructive}
              setAckDestructive={setAckDestructive}
              ackHighRisk={ackHighRisk}
              setAckHighRisk={setAckHighRisk}
              stale={stale}
              onRefreshPreview={refreshPreview}
              applyError={applyError}
            />
          )}
        </div>

        <div className="cs-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={requestClose}
            disabled={applying}
          >
            Cancel
          </button>

          {stepIndex > 0 && (
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={applying}>
              <ArrowLeft size={13} aria-hidden="true" /> Back
            </button>
          )}

          {step === 'source' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={!canLeaveSource}
            >
              Choose categories <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}

          {step === 'categories' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={!canLeaveCategories}
              title={canLeaveCategories ? undefined : 'Select at least one category to preview'}
            >
              Generate preview <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}

          {step === 'preview' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={!preview.ready}
            >
              Continue to confirm <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}

          {step === 'confirm' && (
            <button type="button" className="btn btn-primary" onClick={applyCopy} disabled={!canApply}>
              {applying
                ? <><Loader2 size={13} className="spin" aria-hidden="true" /> Applying…</>
                : <><Copy size={13} aria-hidden="true" /> Apply Copy Setup</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
