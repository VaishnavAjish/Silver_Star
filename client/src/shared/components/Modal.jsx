import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, icon, children, footer, large, style, closeOnOverlay = true }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={e => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${large ? 'modal-lg' : ''}`} style={style}>
        <div className="modal-header">
          <h3>{icon}{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
