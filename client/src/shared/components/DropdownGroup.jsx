import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const DropdownGroupContext = createContext(null);

export function DropdownGroupProvider({ children }) {
  const [activeId, setActiveId] = useState(null);

  const toggle = useCallback((id) => {
    setActiveId(prev => prev === id ? null : id);
  }, []);

  const close = useCallback(() => {
    setActiveId(null);
  }, []);

  const isActive = useCallback((id) => activeId === id, [activeId]);

  const value = useMemo(() => ({ activeId, toggle, close, isActive }), [activeId, toggle, close, isActive]);

  return (
    <DropdownGroupContext.Provider value={value}>
      {children}
    </DropdownGroupContext.Provider>
  );
}

export function useDropdownGroup() {
  return useContext(DropdownGroupContext);
}
