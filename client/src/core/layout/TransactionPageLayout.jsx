export default function TransactionPageLayout({ header, footer, aside, children }) {
  return (
    <div className="txn-page">
      {header}
      <div className="txn-body">
        <div className="txn-main">{children}</div>
        {aside && <div className="txn-aside">{aside}</div>}
      </div>
      {footer}
    </div>
  );
}
