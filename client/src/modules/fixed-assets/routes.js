import { lazy } from 'react';

const FixedAssetsList       = lazy(() => import('./pages/FixedAssetsListPage'));
const FixedAssetDetail      = lazy(() => import('./pages/FixedAssetDetailPage'));
const ManualFixedAssetEntry = lazy(() => import('./pages/ManualFixedAssetEntryPage'));
const AssetTemplateMaster   = lazy(() => import('./pages/AssetTemplateMasterPage'));
const FixedAssetRegister    = lazy(() => import('./pages/FixedAssetRegisterPage'));
const DepreciationSchedule  = lazy(() => import('./pages/DepreciationSchedulePage'));

export default [
  { path: 'assets',                        Component: FixedAssetsList },
  { path: 'assets/new',                    Component: ManualFixedAssetEntry },
  { path: 'assets/:id',                    Component: FixedAssetDetail },
  { path: 'assets/:id/edit',               Component: ManualFixedAssetEntry },
  { path: 'asset-templates',               Component: AssetTemplateMaster },
  { path: 'reports/fixed-asset-register',  Component: FixedAssetRegister },
  { path: 'reports/depreciation-schedule', Component: DepreciationSchedule },
];
