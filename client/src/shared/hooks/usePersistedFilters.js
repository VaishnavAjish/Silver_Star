import { useState, useEffect, useRef } from 'react';

/**
 * Drop-in replacement for useState that persists filter state in sessionStorage.
 * State survives navigation but is cleared on page refresh or logout.
 * @param {string} key - unique storage key per page
 * @param {object} initial - default filter values
 */
export function usePersistedFilters(key, initial) {
  const [filters, setFilters] = useState(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored ? { ...initial, ...JSON.parse(stored) } : initial;
    } catch {
      return initial;
    }
  });

  const debounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      sessionStorage.setItem(key, JSON.stringify(filters));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [key, filters]);

  return [filters, setFilters];
}
