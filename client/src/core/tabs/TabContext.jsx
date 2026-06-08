import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'sg_open_tabs';
const STORAGE_ACTIVE_KEY = 'sg_active_tab';
const MAX_TABS = 15;
const HOME_TAB = {
  id: '/',
  name: 'Dashboard',
  path: '/',
  closable: false,
};

// Phase 33: routes that no longer exist. Any persisted tab pointing at one of
// these is dropped on load so stale tabs can't reference removed components.
const DEAD_TAB_IDS = new Set(['/rough-growth/new']);

function loadPersistedTabs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      let parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const uniqueTabs = [];
        const seenIds = new Set();
        for (const t of parsed) {
          const id = t.id === 'dashboard' ? '/' : t.id;
          if (DEAD_TAB_IDS.has(id)) continue; // drop removed routes
          if (!seenIds.has(id)) {
            seenIds.add(id);
            uniqueTabs.push({ ...t, id, closable: id !== '/' });
          }
        }
        return uniqueTabs.slice(0, MAX_TABS);
      }
    }
  } catch {}
  return [HOME_TAB];
}

function loadPersistedActive() {
  try {
    const active = localStorage.getItem(STORAGE_ACTIVE_KEY) || '/';
    return DEAD_TAB_IDS.has(active) ? '/' : active;
  } catch {
    return '/';
  }
}

export function TabProvider({ children, navMap = {} }) {
  const [tabs, setTabs] = useState(loadPersistedTabs);
  const [activeTabId, setActiveTabId] = useState(loadPersistedActive);
  const tabIdCounter = useRef(Date.now());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeTabId);
  activeIdRef.current = activeTabId;

  useEffect(() => {
    try {
      const serialized = JSON.stringify(tabs);
      localStorage.setItem(STORAGE_KEY, serialized);
      if (serialized.length > 500000) {
        setTabs(prev => prev.length > 8 ? prev.slice(0, 8) : prev);
      }
    } catch {
      if (tabs.length > 5) {
        setTabs(prev => prev.filter(t => t.id === '/' || t.id === activeTabId).concat(
          prev.filter(t => t.id !== '/' && t.id !== activeTabId).slice(0, 3)
        ));
      }
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_ACTIVE_KEY, activeTabId); } catch {}
  }, [activeTabId]);

  useEffect(() => {
    setTabs(prev => prev.some(t => t.id === '/') ? prev : [HOME_TAB, ...prev]);
  }, []);

  useEffect(() => {
    if (!tabs.some(t => t.id === activeTabId)) {
      setActiveTabId('/');
    }
  }, [tabs, activeTabId]);

  const openTab = useCallback((tab) => {
    const id = tab.id || tab.path;
    setTabs(prev => {
      if (prev.some(t => t.id === id)) {
        // Auto-refresh by incrementing a refresh key if it's already opened
        return prev.map(t => t.id === id ? { ...t, refreshKey: (t.refreshKey || 0) + 1 } : t);
      }

      const newTab = { id, name: tab.name, icon: tab.icon, path: tab.path, closable: tab.closable !== false };

      if (prev.length >= MAX_TABS) {
        const evictable = prev.filter(t => t.id !== '/' && t.id !== id);
        if (evictable.length > 0) {
          const toEvict = evictable.reduce((oldest, t) =>
            !oldest || t._opened < oldest._opened ? t : oldest
          );
          return prev.map(t => t.id === toEvict.id ? newTab : t);
        }
        return prev;
      }

      return [...prev, newTab];
    });
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((tabId) => {
    if (tabId === '/') return;
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const filtered = prev.filter(t => t.id !== tabId);
      if (tabId === activeIdRef.current) {
        const nextIdx = Math.min(idx, filtered.length - 1);
        const nextTab = filtered[nextIdx];
        setActiveTabId(nextTab ? nextTab.id : '/');
      }
      return filtered;
    });
  }, []);

  const switchTab = useCallback((tabId) => {
    if (tabsRef.current.some(t => t.id === tabId)) {
      // Auto-refresh the tab whenever it is switched to
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, refreshKey: (t.refreshKey || 0) + 1 } : t));
      setActiveTabId(tabId);
    }
  }, []);

  const closeOtherTabs = useCallback((tabId) => {
    setTabs(prev => prev.filter(t => t.id === tabId || t.id === '/'));
    setActiveTabId(tabId);
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([HOME_TAB]);
    setActiveTabId('/');
  }, []);

  const closeTabsToRight = useCallback((tabId) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      if (idx === -1) return prev;
      const keep = prev.slice(0, idx + 1).filter(t => t.id !== '/');
      const dashboard = prev.find(t => t.id === '/');
      const result = dashboard ? [dashboard, ...keep] : keep;
      if (!result.some(t => t.id === activeIdRef.current)) setActiveTabId(tabId);
      return result;
    });
  }, []);

  const reorderTabs = useCallback((fromIndex, toIndex) => {
    setTabs(prev => {
      if (fromIndex === toIndex) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  const updateTabMeta = useCallback((tabId, meta) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...meta } : t));
  }, []);

  const patchTabs = useCallback((patcher) => {
    setTabs(prev => patcher(prev));
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const value = {
    tabs, activeTabId, activeTab,
    openTab, closeTab, switchTab,
    closeOtherTabs, closeAllTabs, closeTabsToRight,
    reorderTabs, updateTabMeta, patchTabs, navMap,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

export function useTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error('useTabs must be used within a TabProvider');
  return ctx;
}

const TabContext = createContext(null);
