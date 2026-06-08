import { useState, useRef, useCallback, useEffect } from 'react';

const MAX_WINDOW = 5000;
const GC_INTERVAL = 30000;

export function useSlidingWindow(options = {}) {
  const {
    maxWindow = MAX_WINDOW,
    gcInterval = GC_INTERVAL,
  } = options;

  const bufferRef = useRef(new Map());
  const [window, setWindow] = useState({ start: 0, end: 0 });
  const versionRef = useRef(0);

  const insert = useCallback((items, startIndex = 0) => {
    const map = bufferRef.current;
    items.forEach((item, i) => {
      if (item?.id != null) {
        map.set(item.id, { data: item, index: startIndex + i, version: versionRef.current });
      }
    });
  }, []);

  const evictOutside = useCallback((start, end) => {
    const map = bufferRef.current;
    const now = Date.now();
    for (const [id, entry] of map) {
      if (entry.version < versionRef.current - 1) {
        map.delete(id);
      }
    }
    setWindow({ start, end });
  }, []);

  const slideTo = useCallback((start, end) => {
    setWindow({ start, end });
    versionRef.current += 1;
  }, []);

  const getSlice = useCallback((items, page, pageSize) => {
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, items.length);
    const slice = items.slice(start, end);
    insert(slice, start);
    slideTo(start, end);
    return slice;
  }, [insert, slideTo]);

  const reset = useCallback(() => {
    bufferRef.current.clear();
    versionRef.current += 1;
    setWindow({ start: 0, end: 0 });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const map = bufferRef.current;
      for (const [id, entry] of map) {
        if (entry.version < versionRef.current - 1) {
          map.delete(id);
        }
      }
    }, gcInterval);
    return () => clearInterval(timer);
  }, [gcInterval]);

  return { getSlice, reset, bufferRef, window, insert, evictOutside, slideTo };
}
