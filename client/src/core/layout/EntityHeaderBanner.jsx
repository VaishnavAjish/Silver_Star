import { Link } from 'react-router-dom';

export default function EntityHeaderBanner({ name, code, type, meta, status, statusVariant = 'b-active', link }) {
  const initial = (name || '?')[0].toUpperCase();
  return (
    <div className="entity-bann">
      <div className="entity-bann-ava">{initial}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="entity-bann-name">
            {link
              ? <Link to={link} style={{ color: 'inherit', textDecoration: 'none' }}>{name}</Link>
              : name
            }
          </div>
          {status && <span className={`badge ${statusVariant}`}>{status}</span>}
        </div>
        {(code || type) && (
          <div className="entity-bann-code">
            {code && <span>{code}</span>}
            {code && type && <span style={{ margin: '0 5px', color: 'var(--g300)' }}>·</span>}
            {type && <span>{type}</span>}
          </div>
        )}
        {meta && meta.length > 0 && (
          <div className="entity-bann-meta">
            {meta.map((m, i) => (
              <span key={i} className="entity-bann-meta-item">
                {m.label}: <strong>{m.value}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
