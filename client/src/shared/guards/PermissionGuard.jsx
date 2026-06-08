import { Navigate } from 'react-router-dom';
import { useAuth } from '../../core/context/AuthContext';

/**
 * Route guard that checks module-level permission.
 * Redirects to home if the user lacks the required permission.
 * Falls back to AdminGuard-style check (admin passes everything).
 */
export default function PermissionGuard({ module, action = 'view', children }) {
  const { user, hasPermission } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || user.role === 'super_admin') return children;
  if (!hasPermission(module, action)) return <Navigate to="/" replace />;

  return children;
}
