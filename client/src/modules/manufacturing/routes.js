import { lazy } from 'react';

const ManufacturingDashboard = lazy(() => import('./pages/ManufacturingDashboardPage'));
const ProcessMasterPage      = lazy(() => import('./pages/ProcessMasterPage'));

export default [
  { path: 'manufacturing/control-tower',  Component: ManufacturingDashboard },
  { path: 'manufacturing/process-master', Component: ProcessMasterPage },
];
