import { lazy } from 'react';

// RoughGrowthListPage and RoughGrowthForm are named exports
const RoughGrowthListPage = lazy(() => import('./pages/RoughGrowthPages').then(m => ({ default: m.RoughGrowthListPage })));
const RoughGrowthForm     = lazy(() => import('./pages/RoughGrowthPages').then(m => ({ default: m.RoughGrowthForm })));
const GrowthRunsPage      = lazy(() => import('./pages/GrowthRunsPage'));
// Thin read-model preset over the existing Inventory Engine (category=rough) —
// no second inventory table, store, or posting engine.
const RoughDiamondInventoryPage = lazy(() => import('./pages/RoughDiamondInventoryPage'));

// Phase 33: legacy direct rough creation is disabled. Rough Output (Growth Output)
// is the ONLY rough creation path. The old `rough-growth/new` route is removed
// entirely — a redirect *component* must never be a keep-alive tab target, as it
// hijacks the global URL on every render. Legacy deep links are handled by an
// imperative redirect in Layout instead.
export default [
  { path: 'rough-growth',               Component: RoughGrowthListPage },
  { path: 'rough-growth/:id',           Component: RoughGrowthForm },
  { path: 'growth-runs',                Component: GrowthRunsPage },
  { path: 'rough-diamonds/inventory',   Component: RoughDiamondInventoryPage },
];
