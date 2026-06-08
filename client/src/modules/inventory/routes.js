import { lazy } from 'react';

const InventoryPage        = lazy(() => import('./pages/InventoryPage'));
const InventoryOpeningPage = lazy(() => import('./pages/InventoryAccountingPages').then(m => ({ default: m.InventoryOpeningPage })));
const InventoryClosingPage = lazy(() => import('./pages/InventoryAccountingPages').then(m => ({ default: m.InventoryClosingPage })));
const MixLots              = lazy(() => import('./pages/MixLotsPage'));
const LotWorkspacePage     = lazy(() => import('./pages/LotWorkspacePage'));
const SplitLot             = lazy(() => import('./pages/SplitLotPage'));
const LotLineagePage       = lazy(() => import('./pages/LotLineagePage'));
const LotMovementsList     = lazy(() => import('./pages/LotMovementsPage'));
const LotIssueListPage     = lazy(() => import('./pages/LotIssueListPage'));
const LotIssuePage         = lazy(() => import('./pages/LotIssuePage'));
const LotReturnPage        = lazy(() => import('./pages/LotReturnPage'));
const StockTransferPage    = lazy(() => import('./pages/StockTransferPage'));

export default [
  { path: 'inventory',                           Component: InventoryPage },
  { path: 'inventory/clipboard-data',            Component: InventoryPage },
  { path: 'inventory/opening',                   Component: InventoryOpeningPage },
  { path: 'inventory/closing',                   Component: InventoryClosingPage },
  { path: 'inventory/mix',                       Component: MixLots },
  { path: 'inventory/lots/:id',                  Component: LotWorkspacePage },
  { path: 'inventory/:lotId/split',              Component: SplitLot },
  { path: 'inventory/:lotId/lineage',            Component: LotLineagePage },
  { path: 'lot-movements',                       Component: LotMovementsList },
  { path: 'inventory/process-issues',            Component: LotIssueListPage },
  { path: 'inventory/process-issues/new',        Component: LotIssuePage },
  { path: 'inventory/process-issues/:id/return', Component: LotReturnPage },
  { path: 'inventory/stock-transfer',            Component: StockTransferPage },
];
