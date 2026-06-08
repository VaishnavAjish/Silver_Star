import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function FormSectionCard({
  title, icon, children, noPad = false,
  collapsible = false, defaultOpen = true, actions,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="sec-card">
      <div
        className={`sec-card-hdr${collapsible ? ' collapsible' : ''}`}
        onClick={collapsible ? () => setOpen(o => !o) : undefined}
      >
        {icon && <span className="sec-card-hdr-icon">{icon}</span>}
        <span className="sec-card-hdr-title">{title}</span>
        {actions && <div className="sec-card-hdr-actions">{actions}</div>}
        {collapsible && (
          <ChevronDown
            size={13}
            style={{
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform .2s',
              color: 'var(--g400)',
              flexShrink: 0,
            }}
          />
        )}
      </div>
      {(!collapsible || open) && (
        <div className={`sec-card-body${noPad ? ' np' : ''}`}>{children}</div>
      )}
    </div>
  );
}
