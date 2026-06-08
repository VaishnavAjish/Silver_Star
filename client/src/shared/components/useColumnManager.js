import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

const STORAGE_PREFIX = 'col_mgr_';
const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 130;

function loadSaved(key) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(key, state) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state)); } catch {}
}

export default function useColumnManager({
  columns: rawColumns,
  storageKey,
  mandatoryKeys = ['code', '_actions'],
}) {
  const defaultCols = useMemo(() =>
    rawColumns.map((c, i) => ({
      ...c,
      width: c.width, // Allow flexible columns if no width is specified
      index: i,
      visible: true,
    })),
  [rawColumns]);

  const [cols, setCols] = useState(() => {
    const saved = storageKey ? loadSaved(storageKey) : null;
    if (saved && Array.isArray(saved.columns)) {
      return saved.columns.map((sc, i) => {
        const orig = rawColumns.find(c => c.key === sc.key);
        // If the original has no width, and saved has no width, keep it undefined.
        // If original has a new width, we might still respect saved if it was explicitly resized,
        // but for simplicity, we keep sc.width if it exists, otherwise orig.width.
        let finalWidth = sc.width || orig?.width;
        if (finalWidth !== undefined && typeof finalWidth === 'number') {
          finalWidth = Math.max(MIN_COL_WIDTH, finalWidth);
        }
        
        return {
          ...orig,
          key: sc.key,
          width: finalWidth,
          visible: mandatoryKeys.includes(sc.key) ? true : sc.visible !== false,
          index: i,
        };
      }).filter(c => rawColumns.some(r => r.key === c.key));
    }
    return [...defaultCols];
  });

  const [sortCol, setSortCol] = useState(() => {
    const saved = storageKey ? loadSaved(storageKey) : null;
    return saved?.sortCol ?? null;
  });
  const [sortAsc, setSortAsc] = useState(() => {
    const saved = storageKey ? loadSaved(storageKey) : null;
    return saved?.sortAsc ?? true;
  });

  const persist = useCallback((c, sc, sa) => {
    if (!storageKey) return;
    saveState(storageKey, {
      columns: c.map(col => ({ key: col.key, width: col.width, visible: col.visible })),
      sortCol: sc,
      sortAsc: sa,
    });
  }, [storageKey]);

  const sortedCols = useMemo(() =>
    [...cols].sort((a, b) => a.index - b.index),
  [cols]);

  const visibleCols = useMemo(() =>
    sortedCols.filter(c => c.visible !== false),
  [sortedCols]);

  const updateCol = useCallback((key, patch) => {
    setCols(prev => {
      const next = prev.map(c => c.key === key ? { ...c, ...patch } : c);
      persist(next, sortCol, sortAsc);
      return next;
    });
  }, [persist, sortCol, sortAsc]);

  const setWidth = useCallback((key, width) => {
    if (!Number.isFinite(width)) return;
    updateCol(key, { width: Math.max(MIN_COL_WIDTH, width) });
  }, [updateCol]);

  const autoFitWidth = useCallback((key, tableEl) => {
    if (!tableEl) return;
    const headerCell = tableEl.querySelector(`th[data-col-key="${key}"]`);
    if (!headerCell) return;
    const headerText = headerCell.querySelector('.col-label');
    const headerWidth = headerText ? headerText.scrollWidth + 40 : 60;

    let maxContent = headerWidth;
    const cells = tableEl.querySelectorAll(`td[data-col-key="${key}"]`);
    cells.forEach(td => {
      const w = td.scrollWidth + 10;
      if (w > maxContent) maxContent = w;
    });

    setWidth(key, Math.max(MIN_COL_WIDTH, Math.min(maxContent, 500)));
  }, [setWidth]);

  const toggleColumn = useCallback((key) => {
    if (mandatoryKeys.includes(key)) return;
    setCols(prev => {
      const col = prev.find(c => c.key === key);
      if (!col) return prev;
      const next = prev.map(c => c.key === key ? { ...c, visible: !(c.visible !== false) } : c);
      persist(next, sortCol, sortAsc);
      return next;
    });
  }, [mandatoryKeys, persist, sortCol, sortAsc]);

  const reorder = useCallback((fromKey, toKey) => {
    setCols(prev => {
      const from = prev.find(c => c.key === fromKey);
      const to = prev.find(c => c.key === toKey);
      if (!from || !to) return prev;
      const next = prev.map(c => {
        if (c.key === fromKey) return { ...c, index: to.index };
        if (c.key === toKey) return { ...c, index: from.index };
        return c;
      });
      persist(next, sortCol, sortAsc);
      return next;
    });
  }, [persist, sortCol, sortAsc]);

  const handleSort = useCallback((key) => {
    setSortCol(prev => {
      const nextCol = prev === key ? prev : key;
      return nextCol;
    });
    setSortAsc(prev => {
      const nextAsc = sortCol === key ? !prev : true;
      if (storageKey) {
        const s = loadSaved(storageKey) || {};
        saveState(storageKey, { ...s, sortCol: key, sortAsc: nextAsc });
      }
      return nextAsc;
    });
  }, [sortCol, storageKey]);

  const resetLayout = useCallback(() => {
    if (storageKey) {
      try { localStorage.removeItem(STORAGE_PREFIX + storageKey); } catch {}
    }
    setCols(defaultCols.map(c => ({ ...c })));
    setSortCol(null);
    setSortAsc(true);
  }, [storageKey, defaultCols]);

  const getExportCols = useCallback(() =>
    visibleCols.filter(c => c.key !== '_actions'),
  [visibleCols]);

  return useMemo(() => ({
    columns: sortedCols,
    visibleColumns: visibleCols,
    sortCol,
    sortAsc,
    setWidth,
    autoFitWidth,
    toggleColumn,
    reorder,
    handleSort,
    resetLayout,
    getExportCols,
    setCols,
  }), [
    sortedCols, visibleCols, sortCol, sortAsc,
    setWidth, autoFitWidth, toggleColumn, reorder,
    handleSort, resetLayout, getExportCols, setCols,
  ]);
}
