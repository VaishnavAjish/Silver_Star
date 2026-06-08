import { lazy } from 'react';

// Five report pages share a single source file (named exports)
const LedgerPage        = lazy(() => import('./pages/ReportsPages').then(m => ({ default: m.LedgerPage })));
const PnLPage           = lazy(() => import('./pages/ReportsPages').then(m => ({ default: m.PnLPage })));
const CostingPage       = lazy(() => import('./pages/ReportsPages').then(m => ({ default: m.CostingPage })));
const BalanceSheetPage  = lazy(() => import('./pages/ReportsPages').then(m => ({ default: m.BalanceSheetPage })));
const TrialBalancePage  = lazy(() => import('./pages/ReportsPages').then(m => ({ default: m.TrialBalancePage })));

const TransactionReportPage      = lazy(() => import('./pages/TransactionReportPage'));
const BankReconciliationPage     = lazy(() => import('./pages/BankReconciliationPage'));
const CostCenterReportPage       = lazy(() => import('./pages/CostCenterReportPage'));
const CostCenterTransactionsPage = lazy(() => import('./pages/CostCenterTransactionsPage'));
const AccountsReceivablePage     = lazy(() => import('./pages/AccountsReceivablePage'));
const AccountsPayablePage        = lazy(() => import('./pages/AccountsPayablePage'));

export default [
  { path: 'ledger',                           Component: LedgerPage },
  { path: 'trial-balance',                    Component: TrialBalancePage },
  { path: 'pnl',                              Component: PnLPage },
  { path: 'costing',                          Component: CostingPage },
  { path: 'balance-sheet',                    Component: BalanceSheetPage },
  { path: 'reports/transactions',             Component: TransactionReportPage },
  { path: 'reports/bank-reconciliation',      Component: BankReconciliationPage },
  { path: 'reports/cost-center',              Component: CostCenterReportPage },
  { path: 'reports/cost-center-transactions', Component: CostCenterTransactionsPage },
  { path: 'reports/accounts-receivable',      Component: AccountsReceivablePage },
  { path: 'reports/accounts-payable',         Component: AccountsPayablePage },
];
