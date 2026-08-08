import toast from 'react-hot-toast';
import { useApi } from '../../../shared/hooks/useApi';
import CopySetupWizard from '../user-card/copy-setup/CopySetupWizard';

/**
 * Copy User Setup — compatibility entry point.
 *
 * RBAC Brick 6 replaced the blind single-screen modal with a four-stage wizard
 * (source → categories → read-only preview → confirm). This file is kept as the
 * only call site's entry point so UsersPage and anything importing
 * `CopyUserSetupModal` keeps working, and it holds NO copy logic of its own —
 * there is exactly one Copy Setup implementation, in user-card/copy-setup/.
 *
 * WHAT CHANGED FOR THE CALLER: nothing. Same props, same `onSuccess` contract,
 * same backend endpoint and same request payload.
 *
 * WHAT CHANGED FOR THE ADMIN: categories are no longer pre-selected, the diff is
 * shown before anything is written, and the `window.confirm` one-liner is
 * replaced by a confirmation step that names what will be removed.
 */
export default function CopyUserSetupModal({ targetUser, users, onClose, onSuccess }) {
  const api = useApi();

  return (
    <CopySetupWizard
      targetUser={targetUser}
      users={users}
      api={api}
      onClose={onClose}
      onSuccess={() => {
        toast.success('User setup copied successfully');
        onSuccess?.();
      }}
    />
  );
}
