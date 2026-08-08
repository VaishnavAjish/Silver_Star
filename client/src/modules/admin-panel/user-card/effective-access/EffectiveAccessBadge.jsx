import { EFFECT, EFFECT_LABELS, ENFORCEMENT, ENFORCEMENT_LABELS } from './effectiveAccessModel';

/**
 * RBAC Brick 5 — the chips that carry a verdict.
 *
 * COLOUR IS DECORATION, NEVER THE CARRIER. Every chip renders its own label as
 * text, so a reader who cannot distinguish the teal chip from the amber one
 * still reads "Allowed" and "Not enforced". Deleting this stylesheet would lose
 * the styling and none of the security information.
 *
 * There is deliberately no single green "Secure" chip anywhere: the permission
 * verdict and the enforcement verdict are separate chips because they are
 * separate facts, and one of them being good says nothing about the other.
 */

const EFFECT_CLASS = {
  [EFFECT.ALLOWED]: 'ea-badge ea-badge-allowed',
  [EFFECT.DENIED]: 'ea-badge ea-badge-denied',
  [EFFECT.UNKNOWN]: 'ea-badge ea-badge-unknown',
};

export function EffectBadge({ status }) {
  return (
    <span className={EFFECT_CLASS[status] || EFFECT_CLASS[EFFECT.UNKNOWN]}>
      {EFFECT_LABELS[status] || EFFECT_LABELS.UNKNOWN}
    </span>
  );
}

/**
 * Only ENFORCED gets the affirmative treatment. Everything between "partial" and
 * "not enforced at all" is styled as a gap, because for an administrator reading
 * this screen they carry the same instruction: do not rely on it.
 */
const ENFORCEMENT_CLASS = {
  [ENFORCEMENT.ENFORCED]: 'ea-badge ea-badge-enforced',
  [ENFORCEMENT.PARTIALLY_ENFORCED]: 'ea-badge ea-badge-partial',
  [ENFORCEMENT.FRONTEND_ONLY]: 'ea-badge ea-badge-gap',
  [ENFORCEMENT.ROLE_STRING_ONLY]: 'ea-badge ea-badge-gap',
  [ENFORCEMENT.AUTHENTICATE_ONLY]: 'ea-badge ea-badge-gap',
  [ENFORCEMENT.NOT_ENFORCED]: 'ea-badge ea-badge-gap',
  [ENFORCEMENT.NO_ACTIVE_FEATURE]: 'ea-badge ea-badge-inactive',
  [ENFORCEMENT.UNKNOWN]: 'ea-badge ea-badge-unknown',
};

export function EnforcementBadge({ overall }) {
  return (
    <span className={ENFORCEMENT_CLASS[overall] || ENFORCEMENT_CLASS[ENFORCEMENT.UNKNOWN]}>
      {ENFORCEMENT_LABELS[overall] || ENFORCEMENT_LABELS.UNKNOWN}
    </span>
  );
}

/** Risk is a small text pill, never a bare colour dot. */
export function RiskBadge({ level }) {
  if (!level) return null;
  return <span className={`ea-risk ea-risk-${String(level).toLowerCase()}`}>{level}</span>;
}

export default EffectBadge;
