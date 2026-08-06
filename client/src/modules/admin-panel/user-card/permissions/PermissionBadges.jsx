import { CheckCircle2, XCircle, HelpCircle, Shield, ShieldAlert, ShieldOff, Ban } from 'lucide-react';
import { EFFECT, EFFECT_LABELS, describeSource } from './permissionEditorModel';
import {
  ENFORCEMENT_LEVEL, ENFORCEMENT_LABELS, STATUS, STATUS_LABELS,
} from './permissionCatalogModel';

/* ── Effective result ───────────────────────────────────────── */

const EFFECT_ICON = {
  [EFFECT.ALLOWED]: CheckCircle2,
  [EFFECT.DENIED]: XCircle,
  [EFFECT.UNKNOWN]: HelpCircle,
};

/**
 * The verdict and why it holds. Both are text: an admin reading "Denied" needs
 * to know whether that came from their own override or from a missing baseline,
 * and assistive technology has to convey the same thing.
 */
export function PermissionEffectiveResult({ effect, source, roleNames }) {
  const Icon = EFFECT_ICON[effect] || HelpCircle;
  return (
    <div className={`pe-effect pe-effect-${effect.toLowerCase()}`}>
      <span className="pe-effect-verdict">
        <Icon size={13} aria-hidden="true" />
        {EFFECT_LABELS[effect]}
      </span>
      <span className="pe-effect-source">{describeSource(source, roleNames)}</span>
    </div>
  );
}

/* ── Enforcement ────────────────────────────────────────────── */

const ENFORCEMENT_ICON = {
  [ENFORCEMENT_LEVEL.ENFORCED]: Shield,
  [ENFORCEMENT_LEVEL.PARTIAL]: ShieldAlert,
  [ENFORCEMENT_LEVEL.NOT_ENFORCED]: ShieldOff,
  [ENFORCEMENT_LEVEL.NO_ACTIVE_FEATURE]: Ban,
};

/** Human wording for one surface, used in the badge's detail tooltip. */
const SURFACE_LABELS = {
  navigation: 'Navigation',
  frontend_route: 'Frontend route',
  frontend_action: 'Frontend action',
  api_list: 'API list',
  api_detail: 'API detail',
  api_create: 'Create',
  api_edit: 'Edit',
  api_delete: 'Delete / reverse',
  api_approve: 'Approve / reject',
  export: 'Export',
  print: 'Print',
};

function surfaceDetail(enforcement) {
  return Object.entries(enforcement || {})
    .map(([surface, status]) => `${SURFACE_LABELS[surface] || surface}: ${status}`)
    .join('\n');
}

/**
 * Four honest levels, never one "Secure" flag. The per-surface breakdown stays
 * reachable through the title so a partial gap cannot be hidden by the summary.
 */
export function PermissionEnforcementBadge({ capability }) {
  const level = capability.enforcementLevel;
  const Icon = ENFORCEMENT_ICON[level] || ShieldAlert;
  return (
    <span
      className={`pe-chip pe-chip-enf pe-enf-${level.toLowerCase()}`}
      title={surfaceDetail(capability.enforcement)}
    >
      <Icon size={11} aria-hidden="true" />
      {ENFORCEMENT_LABELS[level]}
    </span>
  );
}

/* ── Lifecycle and risk ─────────────────────────────────────── */

export function PermissionStatusBadge({ status }) {
  if (status === STATUS.ACTIVE) return null;
  return (
    <span className={`pe-chip pe-chip-status pe-status-${status.toLowerCase()}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function PermissionRiskBadge({ risk }) {
  if (!risk) return null;
  return (
    <span className={`pe-chip pe-chip-risk pe-risk-${risk.toLowerCase()}`}>
      {risk} risk
    </span>
  );
}
