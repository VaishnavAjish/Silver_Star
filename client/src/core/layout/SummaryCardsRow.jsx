export default function SummaryCardsRow({ cards }) {
  if (!cards || cards.length === 0) return null;
  return (
    <div className="sum-row">
      {cards.map((c, i) => (
        <div key={i} className={`sum-card${c.variant ? ` ${c.variant}` : ''}`}>
          <div className="sum-card-lbl">{c.label}</div>
          <div className="sum-card-val">{c.value ?? '—'}</div>
          {c.sub && <div className="sum-card-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
