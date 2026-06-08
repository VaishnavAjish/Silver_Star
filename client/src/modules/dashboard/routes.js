import { lazy } from 'react';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));

export default [
  { index: true, Component: DashboardPage },
];
