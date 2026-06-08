import React, { useState, useRef, useMemo } from 'react';

function TabItem({ tab, isActive, onSelect, onClose, onContextMenu, onDragStart, onDragOver, onDragEnd, onDrop, index, tabRef }) {
  const [hovering, setHovering] = useState(false);
  const itemRef = useRef(null);

  const handleMiddleClick = (e) => {
    if (e.button === 1 && tab.closable) {
      e.preventDefault();
      onClose(tab.id);
    }
  };

  const handleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    if (onDragStart) onDragStart(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (onDragOver) onDragOver(index);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex) && fromIndex !== index && onDrop) onDrop(fromIndex, index);
  };

  const iconEl = useMemo(() => {
    if (!tab.icon) return null;
    if (React.isValidElement(tab.icon) || typeof tab.icon === 'string') return <span className="tab-icon">{tab.icon}</span>;
    if (typeof tab.icon === 'function' || tab.icon.$$typeof) {
      const Icon = tab.icon;
      return <span className="tab-icon"><Icon size={14} /></span>;
    }
    return null;
  }, [tab.icon]);

  return (
    <div
      ref={(el) => {
        itemRef.current = el;
        if (tabRef) tabRef(el);
      }}
      className={`tab-item${isActive ? ' tab-active' : ''}`}
      onClick={() => onSelect(tab.id)}
      onMouseDown={handleMiddleClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, tab); }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={onDragEnd}
      onDrop={handleDrop}
      role="tab"
      aria-selected={isActive}
      aria-label={`${tab.name} tab`}
      tabIndex={isActive ? 0 : -1}
      title={tab.name}
    >
      {iconEl}
      <span className="tab-name">{tab.name}</span>
      {tab.closable && (
        <button
          className={`tab-close${hovering ? ' tab-close-visible' : ''}`}
          onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
          aria-label={`Close ${tab.name}`}
          title="Close"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default React.memo(TabItem, (prev, next) => {
  return prev.tab.id === next.tab.id
    && prev.tab.name === next.tab.name
    && prev.tab.closable === next.tab.closable
    && prev.isActive === next.isActive
    && prev.index === next.index;
});
