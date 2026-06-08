import { useNavigate } from 'react-router-dom';
import { GitBranch, GitMerge, ArrowUp, ArrowDown } from 'lucide-react';

const statusColor = s => {
  if (s === 'IN STOCK')   return { bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' };
  if (s === 'IN PROCESS') return { bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' };
  if (s === 'CONSUMED')   return { bg: '#FAFAFA', color: '#757575', border: '#E0E0E0' };
  if (s === 'DAMAGED')    return { bg: '#FFEBEE', color: '#C62828', border: '#EF9A9A' };
  if (s === 'SOLD')       return { bg: '#E8EAF6', color: '#283593', border: '#9FA8DA' };
  if (s === 'ARCHIVED')   return { bg: '#F3E5F5', color: '#4A148C', border: '#CE93D8' };
  return { bg: '#F5F5F5', color: '#616161', border: '#E0E0E0' };
};

function LotCard({ lot, highlight, depth = 0 }) {
  const navigate = useNavigate();
  const sc = statusColor(lot.status);
  const eff = lot.unit === 'CT' ? parseFloat(lot.historical_weight ?? lot.weight ?? 0) : parseFloat(lot.historical_qty ?? lot.qty ?? 0);

  return (
    <div
      onClick={() => navigate(`/inventory/lots/${lot.id}`)}
      style={{
        display: 'inline-flex', flexDirection: 'column', gap: 2,
        padding: '8px 12px', borderRadius: 8, cursor: 'pointer', minWidth: 200,
        border: `2px solid ${highlight ? 'var(--brand)' : sc.border}`,
        background: highlight ? '#FFFDE7' : sc.bg,
        boxShadow: highlight ? '0 0 0 3px rgba(var(--brand-rgb), 0.15)' : 'none',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--g900)', fontFamily: 'var(--mono)' }}>
        {lot.lot_number}
      </div>
      <div style={{ fontSize: 10, color: 'var(--g500)' }}>{lot.item_name}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--g700)', fontFamily: 'var(--mono)' }}>
          {eff.toFixed(4)} {lot.unit}
        </span>
        <span style={{ fontSize: 10, color: 'var(--g500)' }}>
          ₹{Number(lot.rate || 0).toLocaleString('en-IN')}/{lot.unit}
        </span>
      </div>
      <span style={{
        alignSelf: 'flex-start', marginTop: 2, fontSize: 9, padding: '1px 6px',
        borderRadius: 4, fontWeight: 700, textTransform: 'uppercase',
        background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
      }}>
        {lot.status}
      </span>
      {lot.source_type && (
        <span style={{ fontSize: 9, color: 'var(--g400)', marginTop: 1 }}>
          via {lot.source_type}
        </span>
      )}
    </div>
  );
}

function MovementBadge({ movement }) {
  if (!movement) return null;
  const isSplit = movement?.movement_type === 'split';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: isSplit ? '#FFF8E1' : '#E8EAF6',
      border: `1px solid ${isSplit ? '#FFD54F' : '#9FA8DA'}`,
      fontSize: 10, fontWeight: 700,
      color: isSplit ? '#F57F17' : '#283593',
    }}>
      {isSplit ? <GitBranch size={10} /> : <GitMerge size={10} />}
      {movement?.movement_number}
    </div>
  );
}

export default function LotLineageTree({ lineage }) {
  if (!lineage) return null;
  const { lot, ancestors, descendants } = lineage;

  return (
    <div style={{ fontFamily: 'var(--font)', fontSize: 12 }}>

      {/* Ancestors */}
      {ancestors.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <ArrowUp size={14} style={{ color: 'var(--g500)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.8px', color: 'var(--g600)' }}>
              Ancestors ({ancestors.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ancestors.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                paddingLeft: (a.depth - 1) * 24 }}>
                <div style={{ width: 1, height: 24, background: 'var(--g300)',
                  position: 'relative', flexShrink: 0 }} />
                <MovementBadge movement={a.via_movement} />
                <div style={{ width: 1, height: 1, flex: 0, flexShrink: 0 }} />
                <LotCard lot={a.lot} depth={a.depth} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current lot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--brand)', flexShrink: 0,
        }} />
        <LotCard lot={{ ...lot, id: lot.id }} highlight />
        <span style={{ fontSize: 10, color: 'var(--g500)', fontStyle: 'italic' }}>← current lot</span>
      </div>

      {/* Descendants */}
      {descendants.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <ArrowDown size={14} style={{ color: 'var(--g500)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '.8px', color: 'var(--g600)' }}>
              Descendants ({descendants.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {descendants.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8,
                paddingLeft: (d.depth - 1) * 24 }}>
                <div style={{ width: 1, height: 24, background: 'var(--g300)',
                  position: 'relative', flexShrink: 0 }} />
                <MovementBadge movement={d.via_movement} />
                <LotCard lot={d.lot} depth={d.depth} />
              </div>
            ))}
          </div>
        </div>
      )}

      {ancestors.length === 0 && descendants.length === 0 && (
        <div style={{ color: 'var(--g400)', fontSize: 12, fontStyle: 'italic',
          textAlign: 'center', padding: '20px 0' }}>
          No lineage recorded — this is a root lot (created by purchase or growth).
        </div>
      )}
    </div>
  );
}
