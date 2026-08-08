import { Lock } from 'lucide-react';
import { NEVER_COPIED } from './copySetupPreviewModel';

/**
 * RBAC Brick 6 — what Copy Setup does not touch, stated rather than assumed.
 *
 * This list is not a policy promise; it is a reading of the copy transaction.
 * No statement in POST /copy-setup names users.role, users.department_id,
 * password_hash, any MFA column, any refresh token or any session, and
 * copySetupPreviewModel.test.js asserts that the applied payload can only ever
 * carry the five `copy_*` flags — so nothing else can be requested either.
 *
 * Rendered on both the preview and the confirmation step, because the moment an
 * admin most needs to know the role is safe is the moment before they click.
 */
export default function NeverCopiedPanel({ headingId = 'cs-never-title' }) {
  return (
    <section className="cs-never" aria-labelledby={headingId}>
      <h4 className="cs-never-title" id={headingId}>
        <Lock size={13} aria-hidden="true" /> Never copied
      </h4>
      <dl className="cs-never-list">
        {NEVER_COPIED.map(item => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
