export default function JournalPreviewPanel({ title = 'Auto Journal Entry', text, lines }) {
  return (
    <div className="je-prev-pnl">
      <div className="je-prev-hdr">{title}</div>
      <div className="je-prev-body">
        {text && <span>{text}</span>}
        {lines && lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: i > 0 ? 4 : 0 }}>
            <span style={{ flex: 1, fontSize: 11 }}>{l.account}</span>
            {l.dr && (
              <span style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
                Dr {l.dr}
              </span>
            )}
            {l.cr && (
              <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
                Cr {l.cr}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
