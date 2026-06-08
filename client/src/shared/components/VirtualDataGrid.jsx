import { useRef, useState, useCallback, useMemo, memo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GripVertical, RefreshCw } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import FilterBar from './FilterBar';
import Paginator from './Paginator';
import ExportMenu from './ExportMenu';
import ColumnSettings from './ColumnSettings';
import useColumnManager from './useColumnManager';

const ROW_HEIGHT = 25;
const OVERSCAN = 20;
const MAX_VIRTUAL_ROWS = 100000;

const Cell = memo(({ column, row, onRowClick, onRowDoubleClick, isSticky, bgColor }) => {
  const accessor = column.accessor || column.key;
  const value = column.render
    ? column.render(row[accessor], row)
    : row[accessor] ?? '';

  const handleClick = () => onRowClick?.(row);
  const handleDblClick = () => onRowDoubleClick?.(row);

  return (
    <div
      className={`vdt-cell${isSticky ? ' vdt-cell-sticky' : ''}`}
      style={{
        width: column.width || 150,
        minWidth: column.minWidth || 80,
        ...(isSticky ? { position: 'sticky', left: column._stickyLeft, background: bgColor || '#fff', zIndex: 1 } : {}),
      }}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      title={typeof value === 'string' ? value : undefined}
    >
      {value}
    </div>
  );
});

const Row = memo(({ row, columns, index, style, onRowClick, onRowDoubleClick, stickyOffsets }) => (
  <div className="vdt-row" style={style} data-index={index}>
    {columns.map((col) => {
      const isSticky = stickyOffsets && stickyOffsets[col.key] !== undefined;
      return (
        <Cell
          key={col.accessor || col.key}
          column={col}
          row={row}
          onRowClick={onRowClick}
          onRowDoubleClick={onRowDoubleClick}
          isSticky={isSticky}
          bgColor={index % 2 === 0 ? undefined : '#f8fcf8'}
        />
      );
    })}
  </div>
));

const HeaderRow = memo(({ columns, sortCol, sortAsc, onSort, onResizeStart, dragOverKey, onDragStart, onDragOver, onDragLeave, onDrop }) => (
  <div className="vdt-header">
    {columns.map((col) => {
      const colKey = col.key || col.accessor;
      const isSorted = sortCol === colKey;
      const colLabel = col.label || col.header || colKey;
      const isSticky = col._stickyLeft !== undefined;
      return (
        <div
          key={colKey}
          data-col-key={colKey}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', colKey); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(colKey); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver?.(colKey); }}
          onDragLeave={() => onDragLeave?.()}
          onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k !== colKey) onDrop?.(k, colKey); }}
          className={`vdt-header-cell${col.sortable !== false && onSort ? ' sortable' : ''}${isSticky ? ' vdt-header-sticky' : ''}${dragOverKey === colKey ? ' drag-target' : ''}`}
          style={{
            width: col.width || 150,
            minWidth: col.minWidth || 80,
            ...(isSticky ? { position: 'sticky', left: col._stickyLeft, zIndex: 3 } : {}),
          }}
          onClick={() => {
            if (col.sortable !== false && onSort) {
              onSort(colKey, isSorted ? !sortAsc : true);
            }
          }}
        >
          <span
            draggable
            onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', colKey); e.dataTransfer.effectAllowed = 'move'; }}
            style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', marginRight: 4, opacity: 0.35, verticalAlign: 'middle', userSelect: 'none' }}
          >
            <GripVertical size={10} />
          </span>
          <span className="vdt-col-label">{colLabel}</span>
          {isSorted && <span className="vdt-sort-icon">{sortAsc ? ' ▲' : ' ▼'}</span>}
          <div
            className="vdt-resize-handle"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onResizeStart?.(e, colKey, col.width);
            }}
          />
        </div>
      );
    })}
  </div>
));

export default function VirtualDataGrid({
  columns: rawColumnsProp,
  data = [],
  totalRecords = 0,
  onRowClick,
  onRowDoubleClick,
  loading = false,
  onRefresh,
  emptyMessage = 'No records found',
  hideSearch = false,
  embedded = false,
  exportTitle,
  hideExportLabel = false,
  hideExport = false,
  hideRefresh = false,
  hideRecordCount = false,
  filterFields,
  filters,
  onFilterChange,
  page = 1,
  totalPages = 1,
  onPageChange,
  onSort: externalSort,
  sortCol: externalSortCol,
  sortAsc: externalSortAsc = true,
  pageSize = 500,
  onPageSizeChange,
  fetchExportData,
  storageKey,
  mandatoryKeys = ['_actions'],
  hideColumnSettings = false,
  onColumnManagerReady,
  maxVirtualRows = MAX_VIRTUAL_ROWS,
}) {
  const parentRef = useRef(null);
  const headerRef = useRef(null);
  const [localSearch, setLocalSearch] = useState('');
  const [dragOverKey, setDragOverKey] = useState(null);
  const [spinning, setSpinning] = useState(false);

  const normalizedCols = useMemo(() =>
    rawColumnsProp.map(col => ({
      key: col.key || col.accessor,
      label: col.label || col.header || col.key || col.accessor,
      ...col,
      render: col.render,
    })),
  [rawColumnsProp]);

  const colMgr = useColumnManager({
    columns: normalizedCols,
    storageKey,
    mandatoryKeys,
  });

  const {
    columns: allCols,
    visibleColumns,
    sortCol,
    sortAsc,
    setWidth,
    toggleColumn,
    reorder,
    handleSort: internalSort,
    resetLayout,
    getExportCols,
  } = colMgr;

  const prevColsKeyRef = useRef(null);
  useEffect(() => {
    if (onColumnManagerReady) {
      const key = normalizedCols.map(c => c.key).join(',');
      if (key !== prevColsKeyRef.current) {
        prevColsKeyRef.current = key;
        onColumnManagerReady(colMgr);
      }
    }
  }, [onColumnManagerReady, normalizedCols]);

  const computeStickyLeft = (cols) => {
    let left = 0;
    const offsets = {};
    for (const c of cols) {
      if (c.sticky) {
        offsets[c.key] = left;
        left += c.width || 150;
      }
    }
    return offsets;
  };

  const stickyOffsets = useMemo(() => computeStickyLeft(visibleColumns), [visibleColumns]);

  const displayCols = useMemo(() =>
    visibleColumns.map(col => ({
      ...col,
      accessor: col.accessor || col.key,
      header: col.header || col.label,
      _stickyLeft: stickyOffsets[col.key],
    })),
  [visibleColumns, stickyOffsets]);

  const hasFilters = Boolean(filterFields?.length || !hideSearch);
  const displayData = useMemo(() => {
    if (!data) return [];
    if (data.length > maxVirtualRows) {
      return data.slice(0, maxVirtualRows);
    }
    return data;
  }, [data, maxVirtualRows]);

  const virtualizer = useVirtualizer({
    count: displayData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const handleSort = useCallback((key, asc) => {
    if (externalSort) {
      if (sortCol === key) externalSort(key, !sortAsc);
      else externalSort(key, true);
    } else {
      internalSort(key);
    }
  }, [externalSort, sortCol, sortAsc, internalSort]);

  const displaySortCol = externalSortCol ?? sortCol;
  const displaySortAsc = externalSortCol !== undefined ? externalSortAsc : sortAsc;

  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setLocalSearch(value);
    if (onFilterChange) {
      onFilterChange({ ...filters, search: value || undefined });
    }
  }, [filters, onFilterChange]);

  const handlePageSizeChange = useCallback((e) => {
    const newSize = parseInt(e.target.value, 10);
    onPageSizeChange?.(newSize);
  }, [onPageSizeChange]);

  const handleResetFilters = useCallback(() => {
    if (!filterFields || !onFilterChange) return;
    filterFields.forEach(f => onFilterChange(f.key, ''));
  }, [filterFields, onFilterChange]);

  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      setSpinning(true);
      try { await onRefresh(); } finally { setSpinning(false); }
    }
  }, [onRefresh]);

  const resizeCleanupRef = useRef(null);
  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  const handleResizeStart = useCallback((e, colKey, startW) => {
    const startX = e.clientX;
    const onMove = (ev) => setWidth(colKey, startW + (ev.clientX - startX));
    const onUp = () => {
      resizeCleanupRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    resizeCleanupRef.current = onUp;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [setWidth]);

  const handleFetchExportRows = useCallback(async () => {
    let exportData = data;
    if (typeof fetchExportData === 'function') {
      try { exportData = await fetchExportData(); } catch {}
    }
    const expCols = getExportCols();
    return exportData.map(row =>
      expCols.map(c => {
        const v = row[c.key];
        if (c.render) {
          const rendered = c.render(v, row);
          return typeof rendered === 'string' || typeof rendered === 'number' ? rendered : (v ?? '');
        }
        return v ?? '';
      })
    );
  }, [data, fetchExportData, getExportCols]);

  const showToolbar = !hideSearch || (filterFields && filterFields.length > 0) || !hideRecordCount || (exportTitle && !hideExport) || !hideRefresh || !hideColumnSettings;

  const hasExport = Boolean(fetchExportData);

  return (
    <div className={`vdt-container${embedded ? ' vdt-embedded' : ''}`}>
      {showToolbar && (
        <div className="vdt-toolbar">
          {!hideSearch && (
            <div className="vdt-search">
              <input
                type="text"
                placeholder="Search..."
                value={localSearch}
                onChange={handleSearchChange}
                className="vdt-search-input"
              />
            </div>
          )}
          {filterFields && onFilterChange && (
            <FilterBar fields={filterFields} filters={filters} onChange={onFilterChange} onReset={handleResetFilters} />
          )}
          <div style={{ flex: 1 }} />
          {!hideRecordCount && (
            <span className="vdt-record-count">{(totalRecords ?? displayData.length).toLocaleString()} records</span>
          )}
          <div className="vdt-toolbar-actions">
            {!hideColumnSettings && (
              <ColumnSettings
                columns={allCols}
                visibleColumns={visibleColumns}
                toggleColumn={toggleColumn}
                resetLayout={resetLayout}
                mandatoryKeys={mandatoryKeys}
              />
            )}
            {hasExport && (
              <ExportMenu title={exportTitle || 'export'} headers={getExportCols().map(c => c.label || c.header)} fetchRows={handleFetchExportRows} />
            )}
            {!hideRefresh && onRefresh && (
              <button className="vdt-refresh-btn" onClick={handleRefresh} title="Refresh"
                style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {loading && <div className="vdt-loading-overlay"><div className="vdt-spinner" /></div>}

      <div className="vdt-header-wrapper" ref={headerRef}>
        <HeaderRow
          columns={displayCols}
          sortCol={displaySortCol}
          sortAsc={displaySortAsc}
          onSort={handleSort}
          onResizeStart={handleResizeStart}
          dragOverKey={dragOverKey}
          onDragStart={() => {}}
          onDragOver={setDragOverKey}
          onDragLeave={() => setDragOverKey(null)}
          onDrop={(from, to) => { reorder(from, to); setDragOverKey(null); }}
        />
      </div>

      <div ref={parentRef} className="vdt-body">
        {displayData.length === 0 && !loading ? (
          <div className="vdt-empty">{emptyMessage}</div>
        ) : (
          <div
            className="vdt-virtual-list"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = displayData[virtualItem.index];
              if (!row) return null;
              return (
                <Row
                  key={row.id ?? virtualItem.index}
                  row={row}
                  columns={displayCols}
                  index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualItem.size,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  onRowClick={onRowClick}
                  onRowDoubleClick={onRowDoubleClick}
                  stickyOffsets={stickyOffsets}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="vdt-footer">
        <div className="vdt-footer-left">
          {totalRecords > 0 && (
            <span className="vdt-footer-info">
              Showing {Math.min((page - 1) * pageSize + 1, totalRecords).toLocaleString()}
              {' - '}
              {Math.min(page * pageSize, totalRecords).toLocaleString()}
              {' of '}{totalRecords.toLocaleString()}
            </span>
          )}
        </div>
        <div className="vdt-footer-center">
          <Paginator
            page={page}
            totalPages={totalPages}
            onPage={onPageChange}
          />
        </div>
        <div className="vdt-footer-right">
          {onPageSizeChange && (
            <select
              className="vdt-page-size"
              value={pageSize}
              onChange={handlePageSizeChange}
            >
              {[100, 250, 500, 1000].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}