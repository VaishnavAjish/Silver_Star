import { lazy } from 'react';

const LabelsPrintPage = lazy(() => import('./pages/LabelsPrintPage'));

export default [
  { path: 'labels/print', Component: LabelsPrintPage },
];
