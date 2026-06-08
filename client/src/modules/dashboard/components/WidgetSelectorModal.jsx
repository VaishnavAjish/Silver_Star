import { useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, X } from 'lucide-react';
import { WIDGET_REGISTRY } from './widgetRegistry';

// ─── Single draggable row ─────────────────────────────────────────────────────
function SelectorRow({ item, onToggle }) {
  const controls = useDragControls();
  const meta     = WIDGET_REGISTRY[item.widget_key];
  if (!meta) return null;
  const Icon = meta.icon;

  return (
    <Reorder.Item
      as="div"
      value={item}
      dragListener={false}
      dragControls={controls}
      className="wsm-item"
      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,.15)' }}
    >
      <div
        className="wsm-grip"
        onPointerDown={(e) => controls.start(e)}
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <GripVertical size={14} />
      </div>

      <div className="wsm-icon" style={{ background: meta.color }}>
        <Icon size={14} />
      </div>

      <div className="wsm-info">
        <div className="wsm-title">{meta.title}</div>
        <div className="wsm-desc">{meta.description}</div>
      </div>

      <label className="wsm-toggle-wrap" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          className="wsm-toggle-input"
          checked={!!item.is_visible}
          onChange={() => onToggle(item.widget_key)}
        />
        <span className="wsm-toggle-slider" />
      </label>
    </Reorder.Item>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export default function WidgetSelectorModal({ widgets, onSave, onClose }) {
  const [items, setItems] = useState([...widgets]);

  const toggle = (key) =>
    setItems(prev => prev.map(w => w.widget_key === key ? { ...w, is_visible: !w.is_visible } : w));

  const handleSave = () =>
    onSave(items.map((w, i) => ({ ...w, position: i })));

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h3>Customize Dashboard</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ paddingBottom: 0 }}>
          <p style={{ fontSize: 11.5, color: 'var(--g500)', marginBottom: 12 }}>
            Drag <strong>⠿</strong> to reorder · Toggle to show/hide
          </p>

          <Reorder.Group
            as="div"
            axis="y"
            values={items}
            onReorder={setItems}
            className="wsm-list"
          >
            {items.map(item => (
              <SelectorRow key={item.widget_key} item={item} onToggle={toggle} />
            ))}
          </Reorder.Group>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Layout</button>
        </div>
      </div>
    </div>
  );
}
