import { lazy } from 'react';

const UsersPage = lazy(() => import('./pages/UsersPage'));

export default [
  { path: 'admin/users', Component: UsersPage, adminOnly: true },
];
