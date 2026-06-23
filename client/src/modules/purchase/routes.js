import { lazy } from 'react';

const VendorsPage       = lazy(() => import('./pages/VendorsPage'));
const VendorDetailsPage = lazy(() => import('./pages/VendorDetailsPage'));
// PurchaseNotesPage uses named exports
const PurchaseNotesPage = lazy(() => import('./pages/PurchaseNotesPage').then(m => ({ default: m.PurchaseNotesPage })));
const PurchaseNoteForm  = lazy(() => import('./pages/PurchaseNotesPage').then(m => ({ default: m.PurchaseNoteForm })));
// ExpensesPage is the default export; ExpenseForm is a named export
const ExpensesPage      = lazy(() => import('./pages/ExpensesPage'));
const ExpenseForm       = lazy(() => import('./pages/ExpensesPage').then(m => ({ default: m.ExpenseForm })));

const VendorBillsPage = lazy(() => import('./pages/VendorBillsPage').then(m => ({ default: m.VendorBillsPage })));
const VendorBillForm  = lazy(() => import('./pages/VendorBillsPage').then(m => ({ default: m.VendorBillForm })));

export default [
  { path: 'vendors',             Component: VendorsPage },
  { path: 'vendors/:id',         Component: VendorDetailsPage },
  { path: 'bills',               Component: VendorBillsPage },
  { path: 'bills/new',           Component: VendorBillForm },
  { path: 'bills/:id',           Component: VendorBillForm },
  { path: 'purchase-notes',      Component: PurchaseNotesPage },
  { path: 'purchase-notes/new',  Component: PurchaseNoteForm },
  { path: 'purchase-notes/:id',  Component: PurchaseNoteForm },
  { path: 'expenses',            Component: ExpensesPage },
  { path: 'expenses/new',        Component: ExpenseForm },
];
