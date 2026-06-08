import { lazy } from 'react';

// Both InvoicesPage and InvoiceForm are named exports
const InvoicesPage        = lazy(() => import('./pages/InvoicesPage').then(m => ({ default: m.InvoicesPage })));
const InvoiceForm         = lazy(() => import('./pages/InvoicesPage').then(m => ({ default: m.InvoiceForm })));
const CustomersPage       = lazy(() => import('./pages/CustomersPage'));
const CustomerDetailsPage = lazy(() => import('./pages/CustomerDetailsPage'));

export default [
  { path: 'invoices',      Component: InvoicesPage },
  { path: 'invoices/new',  Component: InvoiceForm },
  { path: 'invoices/:id',  Component: InvoiceForm },
  { path: 'customers',     Component: CustomersPage },
  { path: 'customers/:id', Component: CustomerDetailsPage },
];
