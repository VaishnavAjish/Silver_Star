import { lazy } from 'react';

const FixedAssetCategories = lazy(() => import('./pages/FixedAssetCategoriesPage'));
const CostCenterMaster      = lazy(() => import('./pages/CostCenterMasterPage'));
const CostCenterCorrections = lazy(() => import('./pages/CostCenterCorrectionsPage'));
const CostCenterReports     = lazy(() => import('./pages/CostCenterReportsPage'));

// Note: dynamic MASTER_CONFIGS routes (items, machines, departments, etc.)
// are handled in router/index.jsx because they pass a configKey prop to MasterPage.
export default [
  { path: 'fixed-asset-categories', Component: FixedAssetCategories },
  { path: 'cost-centers',           Component: CostCenterMaster },
  { path: 'cost-center-corrections', Component: CostCenterCorrections },
  { path: 'cost-center-reports',     Component: CostCenterReports },
];
