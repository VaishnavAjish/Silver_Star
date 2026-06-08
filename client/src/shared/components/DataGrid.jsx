import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, RefreshCw, GripVertical } from 'lucide-react';
import ExportMenu from './ExportMenu';
import DatePicker from './DatePicker';
import Paginator from './Paginator';
import SearchableSelect from './SearchableSelect';
import useColumnManager from './useColumnManager';
import ColumnSettings from './ColumnSettings';

export default function DataGrid({
  columns: rawColumns,
  data,
  totalRecords,
  onRowClick,
  onRowDoubleClick,
  loading,
  onRefresh,
  emptyMessage      = 'No records found',
  hideSearch        = false,
  embedded          = false,
  exportTitle,
  hideExportLabel   = false,
  hideExport        = false,
  hideRefresh       = false,
  toolbarActions,
  hideRecordCount   = false,
  fetchExportData,
  filterFields,
  filters,
  onFilterChange,
  page            = 1,
  totalPages      = 1,
  onPageChange,
  onSort: externalSort,
  sortCol: externalSortCol,
  sortAsc: externalSortAsc = true,
  pageSize        = 100,
  onPageSizeChange,
  storageKey,
  mandatoryKeys    = ['_actions'],
  hideColumnSettings = false,
  onColumnManagerReady,
  fixedLayout,
  virtualize = false,
}) {
  const [localSearch, setLocalSearch] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  const tableRef = useRef(null);
  const gridWrapRef = useRef(null);

  const colMgr = useColumnManager({
    columns: rawColumns,
    storageKey,
    mandatoryKeys,
  });

  const {
    columns: allCols,
    visibleColumns,
    sortCol,
    sortAsc,
    setWidth,
    autoFitWidth,
    toggleColumn,
    reorder,
    handleSort: internalSort,
    resetLayout,
    getExportCols,
  } = colMgr;

  const prevColsKeyRef = useRef(null);
  useEffect(() => {
    if (onColumnManagerReady) {
      const key = rawColumns.map(c => c.key).join(',');
      if (key !== prevColsKeyRef.current) {
        prevColsKeyRef.current = key;
        onColumnManagerReady(colMgr);
      }
    }
  }, [onColumnManagerReady, rawColumns]);

  const handleSort = useCallback((key) => {
    if (externalSort) {
      if (sortCol === key) externalSort(key, !sortAsc);
      else externalSort(key, true);
    } else {
      internalSort(key);
    }
  }, [externalSort, sortCol, sortAsc, internalSort]);

  const displaySortCol = externalSortCol ?? sortCol;
  const displaySortAsc = externalSortCol !== undefined ? externalSortAsc : sortAsc;

  const rowVirtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => gridWrapRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  const handleRefresh = useCallback(async () => {
    if (onRefresh) {
      setSpinning(true);
      try { await onRefresh(); } finally { setSpinning(false); }
    } else {
      window.location.reload();
    }
  }, [onRefresh]);

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

  const showToolbar = !hideSearch || (filterFields && filterFields.length > 0) || !hideRecordCount || (exportTitle && !hideExport) || !hideRefresh || (exportTitle && !hideExportLabel) || !hideColumnSettings;

  const toolbar = showToolbar ? (
    <div className="grid-toolbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>

      {!hideSearch && (
        <div className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">SEARCH</label>
          <div className="grid-toolbar-search" style={{ margin: 0 }}>
            <Search size={14} />
            <input
              placeholder="Filter search..."
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
            />
          </div>
        </div>
      )}
      {filterFields && filterFields.map(f => (
        <div key={f.key} className="filter-field" style={{ width: 200 }}>
          <label className="filter-label">{f.label}</label>
          {f.type === 'select' ? (
            <SearchableSelect
              value={(() => {
                const v = filters?.[f.key] ?? '';
                if (!v) return null;
                const match = (f.options || []).find(o => o.value === v);
                return match ? { id: match.value, name: match.label, code: '' } : { id: v, name: v, code: '' };
              })()}
              onChange={opt => onFilterChange?.(f.key, opt?.id || '')}
              options={(f.options || []).map(o => ({ id: o.value, name: o.label, code: '' }))}
              placeholder="All"
              style={{ minWidth: 110 }}
              dropdownSearch
            />
          ) : f.type === 'searchable-select' ? (
            <SearchableSelect
              value={(() => { const v = filters?.[f.key] ?? ''; return v ? { id: v, name: v, code: '' } : null; })()}
              onChange={opt => onFilterChange?.(f.key, opt?.name || '')}
              options={f.options || []}
              placeholder="All"
              style={{ minWidth: 130 }}
              dropdownSearch
            />
          ) : f.type === 'text' || !f.type ? (
            <input
              className="filter-input"
              placeholder="All"
              value={filters?.[f.key] ?? ''}
              onChange={e => onFilterChange?.(f.key, e.target.value)}
            />
          ) : f.type === 'date' ? (
            <DatePicker
              value={filters?.[f.key] ?? ''}
              onChange={v => onFilterChange?.(f.key, v)}
              placeholder="Select date"
              className="dp-compact"
            />
          ) : null}
        </div>
      ))}
      {filterFields && Object.values(filters || {}).some(v => v) && (
        <button className="filter-reset-btn" style={{ alignSelf: 'flex-end' }}
          onClick={() => filterFields.forEach(f => onFilterChange?.(f.key, ''))}>
          Clear All
        </button>
      )}
      <div style={{ flex: 1 }} />
      {!hideRecordCount && <span className="grid-count" style={{ paddingBottom: 6 }}>{(totalRecords ?? data?.length ?? 0)} records</span>}
      <div className="grid-toolbar-right" style={{ paddingBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
        {!hideColumnSettings && (
          <ColumnSettings
            columns={allCols}
            visibleColumns={visibleColumns}
            toggleColumn={toggleColumn}
            resetLayout={resetLayout}
            mandatoryKeys={mandatoryKeys}
          />
        )}
        {exportTitle && !hideExport && (
          <ExportMenu title={exportTitle} headers={getExportCols().map(c => c.label)} fetchRows={handleFetchExportRows} />
        )}
        {toolbarActions}
        {!hideRefresh && (
          <button className="icon-btn" title="Refresh table" onClick={handleRefresh}
            style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </div>
  ) : null;

  const rows = data || [];

  const computeStickyLeft = (colKey) => {
    let left = 0;
    for (const c of visibleColumns) {
      if (c.key === colKey) return left;
      if (c.sticky) left += c.width;
    }
    return null;
  };

  const tableArea = (
    <div className="grid-wrap" ref={gridWrapRef} style={{ overflow: 'auto' }}>
      {loading ? (
        <div className="empty-state" style={{ padding: '60px' }}>
          <div className="spinner" /><p>Loading data…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '60px' }}>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <table className="dgrid" style={{ tableLayout: fixedLayout ? 'fixed' : 'auto', width: '100%' }}>
          <thead>
            <tr>
              {visibleColumns.map(c => {
                const stickyLeft = computeStickyLeft(c.key);
                const isSticky = stickyLeft !== null;
                const cls = [c.className, isSticky ? 'col-sticky-th' : '', dragOverKey === c.key ? 'drag-target' : ''].filter(Boolean).join(' ');
                return (
                  <th
                    key={c.key}
                    data-col-key={c.key}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.key); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(c.key); }}
                    onDragLeave={() => setDragOverKey(null)}
                    onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain'); if (k !== c.key) reorder(k, c.key); setDragOverKey(null); }}
                    onClick={() => handleSort(c.key)}
                    style={{
                      width: Number.isFinite(c.width) ? c.width : undefined,
                      minWidth: Number.isFinite(c.width) ? c.width : undefined,
                      maxWidth: Number.isFinite(c.width) ? c.width : undefined,
                      position: isSticky ? 'sticky' : undefined,
                      left: isSticky ? stickyLeft : undefined,
                    }}
                    className={cls}
                  >
                    <span
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', c.key); e.dataTransfer.effectAllowed = 'move'; }}
                      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', marginRight: 4, opacity: 0.4, verticalAlign: 'middle' }}
                    >
                      <GripVertical size={10} />
                    </span>
                    <span className="col-label">{c.label}</span>
                    {displaySortCol === c.key && (
                      <span style={{ marginLeft: 4, fontSize: 10 }}>
                        {displaySortAsc ? '▲' : '▼'}
                      </span>
                    )}
                    <div
                      className="col-resize-handle"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startW = c.width ?? e.currentTarget.closest('th')?.offsetWidth ?? 130;
                        const onMove = (ev) => { setWidth(c.key, startW + (ev.clientX - startX)); };
                        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                        document.body.style.cursor = 'col-resize';
                        document.body.style.userSelect = 'none';
                      }}
                      onDoubleClick={(e) => { e.stopPropagation(); const tbl = tableRef.current; if (tbl) autoFitWidth(c.key, tbl); }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtualize ? (() => {
              const vItems = rowVirtualizer.getVirtualItems();
              if (!vItems.length) return null;
              const totalSize = rowVirtualizer.getTotalSize();
              const paddingTop = vItems[0].start;
              const paddingBottom = totalSize - vItems[vItems.length - 1].end;
              const colCount = visibleColumns.length;
              return (
                <>
                  {paddingTop > 0 && <tr><td colSpan={colCount} style={{ height: paddingTop, padding: 0 }} /></tr>}
                  {vItems.map(vRow => {
                    const row = rows[vRow.index];
                    const ri = vRow.index;
                    return (
                      <tr key={row.id || ri} onClick={() => onRowClick?.(row)} onDoubleClick={() => onRowDoubleClick?.(row)} style={onRowClick || onRowDoubleClick ? { cursor: 'pointer' } : {}}>
                        {visibleColumns.map(c => {
                          const stickyLeft = computeStickyLeft(c.key);
                          const isSticky = stickyLeft !== null;
                          const bgColor = ri % 2 === 0 ? undefined : 'var(--table-alt)';
                          return (
                            <td
                              key={c.key}
                              data-col-key={c.key}
                              className={[c.numeric ? 'num' : '', isSticky ? 'col-sticky-td' : ''].filter(Boolean).join(' ')}
                              style={{
                                ...(isSticky ? { position: 'sticky', left: stickyLeft, background: bgColor || '#fff' } : {}),
                              }}
                            >
                              {c.render ? c.render(row[c.key], row) : row[c.key]}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && <tr><td colSpan={colCount} style={{ height: paddingBottom, padding: 0 }} /></tr>}
                </>
              );
            })() : rows.map((row, ri) => (
              <tr key={row.id || ri} onClick={() => onRowClick?.(row)} onDoubleClick={() => onRowDoubleClick?.(row)} style={onRowClick || onRowDoubleClick ? { cursor: 'pointer' } : {}}>
                {visibleColumns.map(c => {
                  const stickyLeft = computeStickyLeft(c.key);
                  const isSticky = stickyLeft !== null;
                  const bgColor = ri % 2 === 0 ? undefined : 'var(--table-alt)';
                  return (
                    <td
                      key={c.key}
                      data-col-key={c.key}
                      className={[c.numeric ? 'num' : '', isSticky ? 'col-sticky-td' : ''].filter(Boolean).join(' ')}
                      style={{
                        ...(isSticky ? { position: 'sticky', left: stickyLeft, background: bgColor || '#fff' } : {}),
                      }}
                    >
                      {c.render ? c.render(row[c.key], row) : row[c.key]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const recordStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const recordEnd = Math.min(page * pageSize, totalRecords ?? rows.length);

  const footer = (
    <div className="grid-footer">
      <div className="grid-footer-left">
        <span>Showing {recordStart} to {recordEnd} of {totalRecords ?? rows.length} records</span>
      </div>
      <div className="grid-footer-center">
        <Paginator page={page} totalPages={totalPages} onPage={onPageChange || (() => {})} />
      </div>
      <div className="grid-footer-right"></div>
    </div>
  );

  if (embedded) {
    return (
      <>
        {toolbar}
        {tableArea}
        {footer}
      </>
    );
  }

  return (
    <div className="grid-page animate-in">
      {toolbar}
      {tableArea}
      {footer}
    </div>
  );
}
