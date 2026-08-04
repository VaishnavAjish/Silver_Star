import { lazy } from 'react';

const InventoryPage        = lazy(() => import('./pages/InventoryPage'));
const InventoryOpeningPage = lazy(() => import('./pages/InventoryAccountingPages').then(m => ({ default: m.InventoryOpeningPage })));
const InventoryClosingPage = lazy(() => import('./pages/InventoryAccountingPages').then(m => ({ default: m.InventoryClosingPage })));
const SeedStockPage        = lazy(() => import('./pages/SeedStockPage'));
const GasStockPage         = lazy(() => import('./pages/GasStockPage'));
const MixLots              = lazy(() => import('./pages/MixLotsPage'));
const LotWorkspacePage     = lazy(() => import('./pages/LotWorkspacePage'));
const SplitLot             = lazy(() => import('./pages/SplitLotPage'));
const LotLineagePage       = lazy(() => import('./pages/LotLineagePage'));
const LotMovementsList     = lazy(() => import('./pages/LotMovementsPage'));
const LotIssueListPage     = lazy(() => import('./pages/LotIssueListPage'));
const LotIssuePage         = lazy(() => import('./pages/LotIssuePage'));
const LotReturnPage        = lazy(() => import('./pages/LotReturnPage'));
const ProcessReturnsListPage = lazy(() => import('./pages/ProcessReturnsListPage'));
const StockTransferPage    = lazy(() => import('./pages/StockTransferPage'));
const NewTransferPage      = lazy(() => import('./pages/NewTransferPage'));
const NidhiConnectPage     = lazy(() => import('./pages/NidhiConnectPage'));

export default [
  { path: 'inventory',                           Component: InventoryPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'all_inventory' } },
  { path: 'inventory/clipboard-data',            Component: InventoryPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'all_inventory' } },
  // Inventory Management (Phase 1) — read-only stock control views.
  { path: 'inventory/seed-stock',                Component: SeedStockPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'seed_stock' } },
  { path: 'inventory/gas-stock',                 Component: GasStockPage,  requirePermission: { module: 'inventory', action: 'view', submodule: 'gas_stock' } },
  { path: 'inventory/opening',                   Component: InventoryOpeningPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'opening_entry' } },
  { path: 'inventory/closing',                   Component: InventoryClosingPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'closing_entry' } },
  { path: 'inventory/nidhi-connect',             Component: NidhiConnectPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'all_inventory' } },
  { path: 'inventory/mix',                       Component: MixLots, requirePermission: { module: 'inventory', action: 'view', submodule: 'mix_lots' } },
  { path: 'inventory/lots/:id',                  Component: LotWorkspacePage, requirePermission: { module: 'inventory', action: 'view', submodule: 'all_inventory' } },
  { path: 'inventory/:lotId/split',              Component: SplitLot, requirePermission: { module: 'inventory', action: 'edit', submodule: 'all_inventory' } },
  { path: 'inventory/:lotId/lineage',            Component: LotLineagePage, requirePermission: { module: 'inventory', action: 'view', submodule: 'all_inventory' } },
  { path: 'lot-movements',                       Component: LotMovementsList, requirePermission: { module: 'inventory', action: 'view', submodule: 'lot_movements' } },
  { path: 'inventory/process-issues',            Component: LotIssueListPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'process_issues' } },
  { path: 'inventory/process-issues/new',        Component: LotIssuePage, requirePermission: { module: 'inventory', action: 'create', submodule: 'process_issues' } },
  { path: 'inventory/process-issues/:id/return', Component: LotReturnPage, requirePermission: { module: 'inventory', action: 'create', submodule: 'process_issues' } },
  { path: 'inventory/process-returns',           Component: ProcessReturnsListPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'process_issues' } },
  { path: 'inventory/stock-transfer',            Component: StockTransferPage, requirePermission: { module: 'inventory', action: 'view', submodule: 'stock_transfer' } },
  { path: 'inventory/stock-transfer/new',        Component: NewTransferPage, requirePermission: { module: 'inventory', action: 'create', submodule: 'stock_transfer' } },
];
