export default function SideSummaryPanel({ title, actions, children, maxHeight }) {
  return (
    <div className="side-pnl">
      <div className="side-pnl-hdr">
        <span>{title}</span>
        {actions && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{actions}</div>}
      </div>
      <div
        className="side-pnl-body"
        style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
