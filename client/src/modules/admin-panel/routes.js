import { lazy } from 'react';

const UsersPage = lazy(() => import('./pages/UsersPage'));
const LoggerPage = lazy(() => import('./pages/LoggerPage'));

export default [
  { path: 'admin/users', Component: UsersPage, adminOnly: true },
  { path: 'admin/logger', Component: LoggerPage, adminOnly: true },
];
