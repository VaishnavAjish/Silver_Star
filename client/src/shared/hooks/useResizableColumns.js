import { useEffect, useRef, useCallback } from 'react';

const STORAGE_PREFIX = 'col_widths_';

/**
 * Makes table columns resizable by dragging the right edge of <th> elements.
 * Injects .col-resize-handle divs into <th> elements and handles drag logic.
 * Widths are persisted to localStorage per storageKey.
 *
 * @param {Object} ref - React ref to the table element (or its parent container)
 * @param {string} storageKey - Unique key for localStorage persistence
 * @param {Object} options
 * @param {number} options.minWidth - Minimum column width in px (default 40)
 */
export default function useResizableColumns(ref, storageKey, { minWidth = 40 } = {}) {
  const widthsRef = useRef({});
  const handleRef = useRef(null);
  const startXRef = useRef(0);
  const startWRef = useRef(0);
  const colKeyRef = useRef('');
  const thRef = useRef(null);
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  // Load saved widths from localStorage
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (saved) widthsRef.current = JSON.parse(saved);
    } catch { /* ignore */ }
  }, [storageKey]);

  // Apply saved widths to <th> elements
  const applyWidths = useCallback(() => {
    if (!ref.current) return;
    const tbl = ref.current.tagName === 'TABLE' ? ref.current : ref.current.querySelector('table');
    if (!tbl) return;
    const saved = widthsRef.current;
    if (Object.keys(saved).length === 0) return;
    tbl.querySelectorAll('thead th').forEach(th => {
      const key = th.dataset.colKey || th.textContent.trim();
      const w = saved[key];
      if (w && w >= minWidth) {
        th.style.width = w + 'px';
        th.style.minWidth = w + 'px';
        th.style.maxWidth = w + 'px';
      }
    });
  }, [ref, minWidth]);

  useEffect(() => {
    if (!ref.current) return;
    // Small delay to let the DOM render, then apply widths and inject handles
    const timer = setTimeout(() => {
      applyWidths();
      injectHandles(ref.current);
    }, 50);
    return () => clearTimeout(timer);
  }, [ref, applyWidths]);

  // Re-apply when storageKey changes (e.g. tab switch)
  useEffect(() => {
    applyWidths();
  }, [storageKey, applyWidths]);

  const injectHandles = (container) => {
    const tbl = container.tagName === 'TABLE' ? container : container.querySelector('table');
    if (!tbl) return;
    tbl.querySelectorAll('thead th').forEach(th => {
      if (th.querySelector('.col-resize-handle')) return;
      // Ensure position relative
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.dataset.colKey = th.dataset.colKey || th.textContent.trim();
      th.appendChild(handle);
    });
  };

  const onMouseDown = useCallback((e) => {
    const handle = e.target.closest('.col-resize-handle');
    if (!handle) return;
    e.preventDefault();
    const th = handle.parentElement;
    if (!th) return;
    const colKey = handle.dataset.colKey || th.textContent.trim();
    const startW = th.getBoundingClientRect().width;
    colKeyRef.current = colKey;
    startXRef.current = e.clientX;
    startWRef.current = startW;
    thRef.current = th;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onMouseMove = useCallback((e) => {
    if (!thRef.current) return;
    const diff = e.clientX - startXRef.current;
    const newW = Math.max(minWidth, startWRef.current + diff);
    thRef.current.style.width = newW + 'px';
    thRef.current.style.minWidth = newW + 'px';
    thRef.current.style.maxWidth = newW + 'px';
  }, [minWidth]);

  const onMouseUp = useCallback(() => {
    if (!thRef.current) return;
    const colKey = colKeyRef.current;
    const w = thRef.current.getBoundingClientRect().width;
    if (colKey) {
      widthsRef.current[colKey] = Math.round(w);
      if (storageKeyRef.current) {
        try {
          localStorage.setItem(STORAGE_PREFIX + storageKeyRef.current, JSON.stringify(widthsRef.current));
        } catch { /* ignore */ }
      }
    }
    thRef.current = null;
    colKeyRef.current = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Attach global mousemove/mouseup + click delegation for handles
  useEffect(() => {
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseDown, onMouseMove, onMouseUp]);
}
