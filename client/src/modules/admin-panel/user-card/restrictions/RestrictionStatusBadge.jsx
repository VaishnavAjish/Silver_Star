import { RESTRICTION_STATUS, RESTRICTION_STATUS_LABELS } from './viewRestrictionsModel';

/**
 * Status chip for one restriction row.
 *
 * The status is always spelled out in text — colour is decoration, never the
 * carrier. A reader who cannot distinguish the teal chip from the amber one still
 * reads "Enforced" and "Not enforced".
 */
const CLASS_BY_STATUS = {
  [RESTRICTION_STATUS.ENFORCED]: 'vr-badge vr-badge-enforced',
  [RESTRICTION_STATUS.PARTIALLY_ENFORCED]: 'vr-badge vr-badge-partial',
  [RESTRICTION_STATUS.PERMISSION_CONTROLLED]: 'vr-badge vr-badge-permission',
  [RESTRICTION_STATUS.STORED_NOT_ENFORCED]: 'vr-badge vr-badge-stored',
  [RESTRICTION_STATUS.PLANNED_INACTIVE]: 'vr-badge vr-badge-inactive',
  [RESTRICTION_STATUS.NOT_APPLICABLE]: 'vr-badge vr-badge-inactive',
  [RESTRICTION_STATUS.UNKNOWN]: 'vr-badge vr-badge-unknown',
};

export default function RestrictionStatusBadge({ status }) {
  return (
    <span className={CLASS_BY_STATUS[status] || 'vr-badge vr-badge-unknown'}>
      {RESTRICTION_STATUS_LABELS[status] || RESTRICTION_STATUS_LABELS.UNKNOWN}
    </span>
  );
}
