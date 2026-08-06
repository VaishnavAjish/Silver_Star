import { useState, useEffect, useCallback, useRef } from 'react';
import { User, Shield, Settings, Lock, Save, Check, AlertTriangle, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import useUserCard from '../user-card/useUserCard';
import UserCardHeader from '../user-card/UserCardHeader';
import ConfirmDialog from '../user-card/ConfirmDialog';
import GeneralTab from '../user-card/tabs/GeneralTab';
import AccessControlTab from '../user-card/tabs/AccessControlTab';
import PreferencesTab from '../user-card/tabs/PreferencesTab';
import SecurityTab from '../user-card/tabs/SecurityTab';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  SAVE_STATE,
  SAVE_STATE_LABELS,
} from '../user-card/userCardModel';
import '../user-card/userCard.css';

const TABS = [
  { id: 'general', label: 'General', icon: User },
  { id: 'access', label: 'Access Control', icon: Shield },
  { id: 'preferences', label: 'Preferences', icon: Settings },
  { id: 'security', label: 'Security', icon: Lock },
];

const STATUS_CLASS = {
  [SAVE_STATE.SAVING]: 'uc-status-chip uc-status-saving',
  [SAVE_STATE.SAVED]: 'uc-status-chip uc-status-saved',
  [SAVE_STATE.FAILED]: 'uc-status-chip uc-status-failed',
  [SAVE_STATE.NOT_CHANGED]: 'uc-status-chip',
};

const STATUS_ICON = {
  [SAVE_STATE.SAVING]: Loader,
  [SAVE_STATE.SAVED]: Check,
  [SAVE_STATE.FAILED]: AlertTriangle,
};

/** Per-category save result. The text always states the state — never colour alone. */
function StatusChip({ category, state }) {
  const Icon = STATUS_ICON[state];
  return (
    <span className={STATUS_CLASS[state]} data-testid={`uc-status-${category}`}>
      {Icon && <Icon size={11} aria-hidden="true" />}
      {CATEGORY_LABELS[category]}: {SAVE_STATE_LABELS[state]}
    </span>
  );
}

/**
 * RBAC Brick 2 — compact User Card.
 *
 * A fixed identity header, four tabs (General / Access Control / Preferences /
 * Security) and an independently scrolling panel, replacing the five full-width
 * pages the old drawer used.
 *
 * The card owns which user is being edited. When the parent asks for a different
 * user while something is unsaved, the request is held and the unsaved-change
 * dialog decides — nothing is discarded silently.
 *
 * Saving still goes category by category to the pre-existing endpoints. There is
 * no atomic composite save, so the footer reports each category separately and a
 * partial failure never shows as global success.
 */
export default function UserDrawer({
  user,
  onClose,
  onSaved,
  onCopySetup,
  onViewAudit,
  onRequestedUserReverted,
}) {
  const api = useApi();
  const { user: me, refreshUser } = useAuth();

  /* The user actually being edited. Diverges from `user` only while an unsaved
     change is blocking a requested switch. */
  const [activeUser, setActiveUser] = useState(user || null);
  const [tab, setTab] = useState('general');
  const [pendingAction, setPendingAction] = useState(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const tablistRef = useRef(null);

  const handleAfterSave = useCallback(async () => {
    if (activeUser?.id === me?.id) await refreshUser?.();
    onSaved?.();
  }, [activeUser?.id, me?.id, refreshUser, onSaved]);

  const card = useUserCard({ user: activeUser, api, onAfterSave: handleAfterSave });
  const { dirty, saveState, saveErrors, busy } = card;

  /* ── Requested-user changes ───────────────────────────────── */
  useEffect(() => {
    if (!user) { setActiveUser(null); return; }
    if (activeUser?.id === user.id) { setActiveUser(user); return; }
    if (!activeUser || !dirty.any) {
      setActiveUser(user);
      setTab('general');
      return;
    }
    setPendingAction({ type: 'switch', user });
  }, [user, activeUser, dirty.any]);

  /* Nothing behind the card may scroll while it is open. */
  useEffect(() => {
    if (!activeUser) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [activeUser]);

  const closeNow = useCallback(() => {
    setPendingAction(null);
    onClose?.();
  }, [onClose]);

  /** Every exit route funnels through here so the dirty guard cannot be bypassed. */
  const requestClose = useCallback(() => {
    if (dirty.any) setPendingAction({ type: 'close' });
    else closeNow();
  }, [dirty.any, closeNow]);

  /* Escape closes — subject to the same guard. ConfirmDialog listens in the
     capture phase, so while a dialog is open this never fires. */
  useEffect(() => {
    if (!activeUser) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeUser, requestClose]);

  /* ── Saving ───────────────────────────────────────────────── */
  const reportResults = (outcome) => {
    if (outcome.nothingToSave || outcome.skipped) return;
    const saved = Object.entries(outcome.results)
      .filter(([, s]) => s === SAVE_STATE.SAVED)
      .map(([c]) => CATEGORY_LABELS[c]);
    const failed = outcome.failedCategories?.map(c => CATEGORY_LABELS[c]) || [];

    if (failed.length === 0) {
      toast.success(`Saved: ${saved.join(', ')}`);
      return;
    }
    // Never a global success message while anything failed.
    toast.error(
      saved.length > 0
        ? `Saved ${saved.join(', ')} — failed: ${failed.join(', ')}. Your unsaved changes are kept.`
        : `Failed to save ${failed.join(', ')}. Your changes are kept.`,
      { duration: 6000 },
    );
  };

  const runSave = async (categories) => {
    const outcome = await card.saveCategories(categories);
    reportResults(outcome);
    return outcome;
  };

  const handleSaveAll = () => runSave(CATEGORIES);
  const handleSaveCurrentTab = () => runSave([tab]);

  /* ── Unsaved-change dialog resolution ─────────────────────── */
  const applyPendingAction = (action) => {
    if (action.type === 'close') { closeNow(); return; }
    setActiveUser(action.user);
    setTab('general');
    setPendingAction(null);
  };

  const handleContinueEditing = () => {
    // Put the parent's selection back so it stops asking for the other user.
    if (pendingAction?.type === 'switch' && activeUser) {
      onRequestedUserReverted?.(activeUser);
    }
    setPendingAction(null);
  };

  const handleDiscard = () => applyPendingAction(pendingAction);

  const handleSaveThenContinue = async () => {
    const action = pendingAction;
    const outcome = await runSave(CATEGORIES);
    if (outcome.allSaved) applyPendingAction(action);
    else setPendingAction(null); // stay open on the data that failed
  };

  /* ── Reset overrides ──────────────────────────────────────── */
  const handleResetOverrides = async () => {
    setResetConfirmOpen(false);
    const result = await card.resetOverrides();
    if (result.ok) toast.success('All permission overrides removed. Role baseline unchanged.');
    else if (!result.skipped) toast.error(result.error || 'Failed to reset overrides');
  };

  /* ── Tab keyboard navigation ──────────────────────────────── */
  const onTablistKeyDown = (e) => {
    const index = TABS.findIndex(t => t.id === tab);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    setTab(TABS[nextIndex].id);
    tablistRef.current?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
  };

  if (!activeUser) return null;

  const isSelf = activeUser.id === me?.id;
  const isSuperAdmin = card.basic.role === 'super_admin';
  const currentTabDirty = dirty.byCategory[tab];

  return (
    <>
      <div className="uc-overlay" onClick={requestClose} role="presentation" />

      <div
        className="uc-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`User card for ${activeUser.full_name}`}
      >
        <UserCardHeader
          user={activeUser}
          basic={card.basic}
          isSelf={isSelf}
          isSuperAdmin={isSuperAdmin}
          overrideRecordCount={card.overrideRecordCount}
          inventoryScope={card.inventoryScope}
          effectiveAccess={card.effectiveAccess}
          onCopySetup={onCopySetup}
          onViewAudit={onViewAudit}
          onResetOverrides={() => setResetConfirmOpen(true)}
          onClose={requestClose}
          busy={busy || card.resetting}
        />

        <div
          className="uc-tablist"
          role="tablist"
          aria-label="User settings"
          ref={tablistRef}
          onKeyDown={onTablistKeyDown}
        >
          {TABS.map(t => {
            const isDirty = dirty.byCategory[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`uc-tab-${t.id}`}
                className="uc-tab"
                aria-selected={tab === t.id}
                aria-controls={`uc-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
              >
                <t.icon size={13} aria-hidden="true" />
                {t.label}
                {isDirty && (
                  <>
                    <span className="uc-dirty-dot" aria-hidden="true" />
                    <span className="uc-sr-only">has unsaved changes</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="uc-body"
          role="tabpanel"
          id={`uc-panel-${tab}`}
          aria-labelledby={`uc-tab-${tab}`}
          tabIndex={-1}
        >
          {card.fetching ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <div className="spinner" />
              <span className="uc-sr-only">Loading user settings</span>
            </div>
          ) : card.loadError ? (
            <div className="uc-notice uc-notice-danger">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{card.loadError}</span>
            </div>
          ) : (
            <>
              {tab === 'general' && (
                <GeneralTab
                  user={activeUser}
                  basic={card.basic}
                  updateBasic={card.updateBasic}
                  changeRole={card.changeRole}
                  departments={card.departments}
                  isSelf={isSelf}
                />
              )}

              {tab === 'access' && (
                <AccessControlTab
                  basic={card.basic}
                  isSuperAdmin={isSuperAdmin}
                  prefs={card.prefs}
                  overrideRecordCount={card.overrideRecordCount}
                  inventoryScope={card.inventoryScope}
                  setInventoryScope={card.setInventoryScope}
                  departments={card.departments}
                  userOverrides={card.userOverrides}
                  setUserOverrides={card.setUserOverrides}
                  effectiveAccess={card.effectiveAccess}
                  catalog={card.catalog}
                  catalogFailed={card.catalogFailed}
                  roleBaseline={card.roleBaseline}
                  onResetAllStored={() => setResetConfirmOpen(true)}
                  busy={busy || card.resetting}
                />
              )}

              {tab === 'preferences' && (
                <PreferencesTab prefs={card.prefs} updatePrefs={card.updatePrefs} />
              )}

              {tab === 'security' && (
                <SecurityTab
                  pw={card.pw}
                  updatePw={card.updatePw}
                  onSavePassword={() => runSave(['security'])}
                  busy={busy}
                  dirty={dirty.byCategory.security}
                  error={saveErrors.security}
                />
              )}
            </>
          )}
        </div>

        <div className="uc-footer">
          <div className="uc-save-report" role="status" aria-live="polite">
            {CATEGORIES.map(c => (
              <StatusChip key={c} category={c} state={saveState[c]} />
            ))}
          </div>

          <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={busy}>
            {dirty.any ? 'Cancel' : 'Close'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveCurrentTab}
            disabled={busy || !currentTabDirty}
          >
            Save Current Tab
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveAll}
            disabled={busy || !dirty.any}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={14} aria-hidden="true" /> {busy ? 'Saving…' : 'Save All Changes'}
          </button>
        </div>
      </div>

      {pendingAction && (
        <ConfirmDialog
          title="Unsaved changes"
          labelledBy="uc-unsaved-title"
          onCancel={handleContinueEditing}
          actions={[
            { label: 'Continue Editing', onClick: handleContinueEditing },
            { label: 'Discard Changes', onClick: handleDiscard, className: 'btn btn-secondary' },
            { label: 'Save Changes', onClick: handleSaveThenContinue, className: 'btn btn-primary', disabled: busy },
          ]}
        >
          <p style={{ margin: 0 }}>
            {pendingAction.type === 'switch'
              ? `You have unsaved changes for ${activeUser.full_name}. Opening another user will lose them.`
              : 'You have unsaved changes. Closing this card will lose them.'}
          </p>
          <ul className="uc-dialog-list">
            {dirty.dirtyCategories.map(c => <li key={c}>{CATEGORY_LABELS[c]}</li>)}
          </ul>
        </ConfirmDialog>
      )}

      {resetConfirmOpen && (
        <ConfirmDialog
          title="Reset permission overrides?"
          labelledBy="uc-reset-title"
          onCancel={() => setResetConfirmOpen(false)}
          actions={[
            { label: 'Cancel', onClick: () => setResetConfirmOpen(false) },
            {
              label: card.resetting ? 'Resetting…' : 'Reset Overrides',
              onClick: handleResetOverrides,
              className: 'btn btn-primary',
              disabled: card.resetting,
            },
          ]}
        >
          <p style={{ margin: 0 }}>
            This removes <strong>{card.overrideRecordCount}</strong>
            {' '}
            override {card.overrideRecordCount === 1 ? 'record' : 'records'} for
            {' '}
            <strong>{activeUser.full_name}</strong>.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            The <strong>{card.basic.role}</strong> role baseline is not changed — this user
            simply falls back to it. Other users are unaffected.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
