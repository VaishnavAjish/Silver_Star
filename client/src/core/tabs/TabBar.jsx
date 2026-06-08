import { useState, useRef, useEffect, useCallback, memo } from 'react';
import TabItem from './TabItem';
import { Search, Plus } from 'lucide-react';
import { openPaletteWith } from '../../features/command-palette/CommandPalette';

function TabBar({ tabs, activeTabId, onSelect, onClose, onReorder, onContextMenu }) {
  const barRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [contextTab, setContextTab] = useState(null);
  const dragOverIndexRef = useRef(null);

  const checkOverflow = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    setShowLeftArrow(el.scrollLeft > 4);
    setShowRightArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = barRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkOverflow);
    window.addEventListener('resize', checkOverflow);
    return () => {
      el.removeEventListener('scroll', checkOverflow);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [checkOverflow, tabs.length]);

  // Scroll active tab into view
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const activeEl = el.querySelector('.tab-active');
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  // Horizontal scroll via mouse wheel
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const handler = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handler, { passive: true });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const scrollBy = useCallback((dir) => {
    const el = barRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 200, behavior: 'smooth' });
  }, []);

  const handleContextMenu = useCallback((e, tab) => {
    setContextTab(tab);
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => { setContextMenu(null); setContextTab(null); }, []);

  const handleContextAction = useCallback((action) => {
    if (!contextMenu) return;
    const tabId = contextTab.id;
    closeContextMenu();
    switch (action) {
      case 'close': onClose(tabId); break;
      case 'closeOthers': onContextMenu?.('closeOthers', tabId); break;
      case 'closeAll': onContextMenu?.('closeAll'); break;
      case 'closeRight': onContextMenu?.('closeRight', tabId); break;
      default: break;
    }
  }, [contextMenu, contextTab, closeContextMenu, onClose, onContextMenu]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => closeContextMenu();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu, closeContextMenu]);

  // Keyboard navigation — use ref so handler stays stable, registered once
  const handlerRef = useRef(null);
  handlerRef.current = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? onPrevTab() : onNextTab();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      if (activeTabId !== '/') onClose(activeTabId);
    }
    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      const tab = tabs[idx];
      if (tab) onSelect(tab.id);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      const tab = tabs[9];
      if (tab) onSelect(tab.id);
    }
    if (e.key === 'Escape' && contextMenu) {
      closeContextMenu();
    }
  };
  useEffect(() => {
    const handler = (e) => handlerRef.current(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const onNextTab = () => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx < tabs.length - 1) onSelect(tabs[idx + 1].id);
    else if (tabs.length > 0) onSelect(tabs[0].id);
  };

  const onPrevTab = () => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx > 0) onSelect(tabs[idx - 1].id);
    else if (tabs.length > 0) onSelect(tabs[tabs.length - 1].id);
  };

  const handleTabContextMenu = useCallback((action, tabId) => {
    switch (action) {
      case 'closeOthers': onContextMenu?.('closeOthers', tabId); break;
      case 'closeAll': onContextMenu?.('closeAll'); break;
      case 'closeRight': onContextMenu?.('closeRight', tabId); break;
      default: break;
    }
  }, [onContextMenu]);

  const handleDrop = useCallback((from, to) => {
    onReorder(from, to);
  }, [onReorder]);

  return (
    <div className="tab-bar-wrapper">
      {showLeftArrow && (
        <button className="tab-scroll-btn tab-scroll-left" onClick={() => scrollBy(-1)} aria-label="Scroll left">
          ‹
        </button>
      )}
      <div className="tab-bar" ref={barRef} role="tablist" aria-label="Open tabs">
        {tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            index={i}
            isActive={tab.id === activeTabId}
            onSelect={onSelect}
            onClose={onClose}
            onContextMenu={handleContextMenu}
            onDragStart={() => { dragOverIndexRef.current = null; }}
            onDragOver={(idx) => { dragOverIndexRef.current = idx; }}
            onDragEnd={() => { dragOverIndexRef.current = null; }}
            onDrop={handleDrop}
          />
        ))}
      </div>
      {showRightArrow && (
        <button className="tab-scroll-btn tab-scroll-right" onClick={() => scrollBy(1)} aria-label="Scroll right">
          ›
        </button>
      )}

      <button
        className="tab-search-btn"
        onClick={() => openPaletteWith('')}
        title="Search Pages (Ctrl+K)"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, margin: '4px 8px 4px 4px', flexShrink: 0,
          background: '#fff', border: '1px solid var(--g300)',
          borderRadius: 6, color: 'var(--g700)', cursor: 'pointer',
          transition: 'all 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--g100)'; e.currentTarget.style.color = 'var(--g900)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = 'var(--g700)'; }}
      >
        <Plus size={16} strokeWidth={2.5} />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextTab?.closable !== false && (
            <button className="tab-context-item" onClick={() => handleContextAction('close')}>
              Close Tab
            </button>
          )}
          <button className="tab-context-item" onClick={() => handleContextAction('closeOthers')}>
            Close Others
          </button>
          <button className="tab-context-item" onClick={() => handleContextAction('closeAll')}>
            Close All
          </button>
          <button className="tab-context-item" onClick={() => handleContextAction('closeRight')}>
            Close Tabs to the Right
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(TabBar);
