import { Navigate } from 'react-router-dom';
import { useAuth } from '@core/context/AuthContext';

/** Redirects non-admin users to home. Assumes ProtectedRoute has already verified login. */
export default function AdminGuard({ children }) {
  const { user } = useAuth();
  if (user && user.role !== 'admin' && user.role !== 'super_admin') return <Navigate to="/" replace />;
  return children;
}
