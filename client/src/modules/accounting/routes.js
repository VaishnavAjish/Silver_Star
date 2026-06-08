import { lazy } from 'react';

const AccountsPage        = lazy(() => import('./pages/AccountsPage'));
const JournalEntriesPage  = lazy(() => import('./pages/JournalEntriesPage'));
const JournalEntryForm    = lazy(() => import('./pages/JournalEntryForm'));
const BankDepositsPage    = lazy(() => import('./pages/BankDepositsPage'));
const BankDepositPage     = lazy(() => import('./pages/BankDepositPage'));
const BankDepositViewPage = lazy(() => import('./pages/BankDepositViewPage'));
// Named exports from a shared file — mapped to default via .then()
const PaymentsPage        = lazy(() => import('./pages/PaymentsReceiptsPage').then(m => ({ default: m.PaymentsPage })));
const ReceiptsPage        = lazy(() => import('./pages/PaymentsReceiptsPage').then(m => ({ default: m.ReceiptsPage })));
const PaymentEntryPage    = lazy(() => import('./pages/PaymentEntryPage'));
const ReceiptEntryPage    = lazy(() => import('./pages/ReceiptEntryPage'));
const DepreciationRuns    = lazy(() => import('./pages/DepreciationRunsPage'));
const NewDepreciationRun  = lazy(() => import('./pages/NewDepreciationRunPage'));

export default [
  { path: 'accounts',               Component: AccountsPage },
  { path: 'journal-entries',        Component: JournalEntriesPage },
  { path: 'journal-entries/new',    Component: JournalEntryForm },
  { path: 'journal-entries/:id',    Component: JournalEntryForm },
  { path: 'bank-deposits',          Component: BankDepositsPage },
  { path: 'bank-deposits/new',      Component: BankDepositPage },
  { path: 'bank-deposits/:id',      Component: BankDepositViewPage },
  { path: 'bank-deposits/:id/edit', Component: BankDepositPage },
  { path: 'payments',               Component: PaymentsPage },
  { path: 'payments/new',           Component: PaymentEntryPage },
  { path: 'receipts',               Component: ReceiptsPage },
  { path: 'receipts/new',           Component: ReceiptEntryPage },
  { path: 'depreciation-runs',      Component: DepreciationRuns },
  { path: 'depreciation-runs/new',  Component: NewDepreciationRun },
];
