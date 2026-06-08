// ── Individual components (direct import, most common usage) ─────────────────
export { default as DataGrid }         from './DataGrid';
export { default as FilterBar }        from './FilterBar';
export { default as Modal }            from './Modal';
export { default as Paginator }        from './Paginator';
export { default as PortalDropdown }   from './PortalDropdown';
export { default as SearchableSelect } from './SearchableSelect';
export { default as Barcode }          from './Barcode';
export { default as DatePicker }       from './DatePicker';

// ── Layout transaction components (flat re-export for convenience) ────────────
// Physical files: src/core/layout/  |  Subfolder barrel: ./Layout
export * from './Layout';

// ── Grouped namespace barrels (for selective imports by category) ─────────────
// import { DataGrid, FilterBar } from '@shared/components/Tables'
// import { Modal }               from '@shared/components/Modals'
// import { SearchableSelect }    from '@shared/components/Forms'
// import { TransactionPageLayout } from '@shared/components/Layout'
