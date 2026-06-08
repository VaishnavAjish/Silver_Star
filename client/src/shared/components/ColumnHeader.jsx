import { useRef, useCallback, useEffect } from 'react';
import { GripVertical } from 'lucide-react';

export default function ColumnHeader({
  column,
  sortCol,
  sortAsc,
  onSort,
  onResize,
  onAutoFit,
  onDragStart,
  onDragOver,
  onDrop,
}) {
  const resizing = useRef(null);
  const thRef = useRef(null);
  const resizeCleanupRef = useRef(null);

  useEffect(() => {
    return () => resizeCleanupRef.current?.();
  }, []);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = column.width;
    resizing.current = true;

    const onMove = (ev) => {
      if (!resizing.current) return;
      const diff = ev.clientX - startX;
      onResize(column.key, startW + diff);
    };
    const onUp = () => {
      resizing.current = false;
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
  }, [column.key, column.width, onResize]);

  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    const table = thRef.current?.closest('.dgrid');
    onAutoFit(column.key, table);
  }, [column.key, onAutoFit]);

  const handleDragStart = useCallback((e) => {
    e.dataTransfer.setData('text/plain', column.key);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(column.key);
  }, [column.key, onDragStart]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver?.(column.key);
  }, [column.key, onDragOver]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const fromKey = e.dataTransfer.getData('text/plain');
    if (fromKey !== column.key) onDrop?.(fromKey, column.key);
  }, [column.key, onDrop]);

  const isSorted = sortCol === column.key;

  return (
    <th
      ref={thRef}
      data-col-key={column.key}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => onSort?.(column.key)}
      style={{
        width: column.width,
        minWidth: column.width,
        maxWidth: column.width,
        position: 'relative',
        cursor: onSort ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      className={column.className}
    >
      <span
        className="col-drag-handle"
        draggable
        onDragStart={handleDragStart}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'grab', marginRight: 4, opacity: 0.4, verticalAlign: 'middle' }}
      >
        <GripVertical size={10} />
      </span>
      <span className="col-label">{column.label}</span>
      {isSorted && (
        <span style={{ marginLeft: 4, fontSize: 10 }}>
          {sortAsc ? '▲' : '▼'}
        </span>
      )}
      <div
        className="col-resize-handle"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 5, cursor: 'col-resize', zIndex: 10,
        }}
      />
    </th>
  );
}
