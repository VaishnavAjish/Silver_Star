import { lazy } from 'react';

const FixedAssetCategories = lazy(() => import('./pages/FixedAssetCategoriesPage'));

// Note: dynamic MASTER_CONFIGS routes (items, machines, departments, etc.)
// are handled in router/index.jsx because they pass a configKey prop to MasterPage.
export default [
  { path: 'fixed-asset-categories', Component: FixedAssetCategories },
];
