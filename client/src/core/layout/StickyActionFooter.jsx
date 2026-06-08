export default function StickyActionFooter({ left, right, hint, children }) {
  return (
    <div className="txn-footer">
      <div className="txn-footer-left">{left}</div>
      {hint && <span className="txn-footer-hint">{hint}</span>}
      <div className="txn-footer-right">{right ?? children}</div>
    </div>
  );
}
