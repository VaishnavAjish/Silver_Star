import Modal from '../../../shared/components/Modal';
import { History } from 'lucide-react';
import { ACTIONS, PERM_BITS, FULL_ACCESS } from '../../../shared/constants/permissions';

export default function AuditDetailModal({ entry, onClose, roles }) {
  if (!entry) return null;

  const getRoleNames = (roleIds) => {
    if (!Array.isArray(roleIds)) return 'None';
    return roleIds.map(id => roles.find(r => String(r.id) === String(id))?.name || `Role #${id}`).join(', ') || 'None';
  };

  const decodePermissions = (permMask) => {
    if (permMask === 0) return 'No Access';
    if (permMask === FULL_ACCESS) return 'Full Access';
    return ACTIONS.filter(a => (permMask & PERM_BITS[a.id]) === PERM_BITS[a.id]).map(a => a.label).join(', ') || 'Custom/Partial';
  };

  const renderChanges = () => {
    if (!entry.changes) return <p style={{ color: 'var(--g500)', fontSize: 13 }}>No details available.</p>;

    const { before, after } = entry.changes;

    if (entry.action === 'assign_roles' || entry.action === 'remove_roles') {
      const prevNames = getRoleNames(before);
      const newNames = getRoleNames(after);
      
      if (prevNames === newNames) {
        return (
          <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, border: '1px solid var(--g200)', fontSize: 13, color: 'var(--g600)', fontStyle: 'italic' }}>
            No roles were actually changed during this action.
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--g400)' }}>(This is likely a legacy log entry from an old profile update)</div>
          </div>
        );
      }

      return (
        <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, border: '1px solid var(--g200)' }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block' }}>Previous Roles</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#C62828' }}>{prevNames}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block' }}>New Roles</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#2E7D32' }}>{newNames}</span>
          </div>
        </div>
      );
    }

    if (entry.action === 'update_permissions') {
      const bMap = {}; (before || []).forEach(p => bMap[`${p.module}:${p.submodule}`] = p.permissions);
      const aMap = {}; (after || []).forEach(p => aMap[`${p.module}:${p.submodule}`] = p.permissions);
      const allKeys = [...new Set([...Object.keys(bMap), ...Object.keys(aMap)])];

      const diffs = allKeys.map(k => {
        const b = bMap[k] || 0;
        const a = aMap[k] || 0;
        if (b === a) return null;
        return { key: k, before: b, after: a };
      }).filter(Boolean);

      if (diffs.length === 0) return <p style={{ color: 'var(--g500)', fontSize: 12 }}>No effective permission changes detected.</p>;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
          {diffs.map(d => (
            <div key={d.key} style={{ background: '#f8f9fa', padding: 10, borderRadius: 8, border: '1px solid var(--g200)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: 'var(--brand-dark)' }}>{d.key.replace(':', ' → ')}</div>
              <div style={{ fontSize: 11, display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ color: '#C62828', textDecoration: 'line-through' }}>{decodePermissions(d.before)}</span>
                <span>→</span>
                <span style={{ color: '#2E7D32', fontWeight: 600 }}>{decodePermissions(d.after)}</span>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (entry.action === 'reset_password') {
      return (
        <div style={{ background: '#FFF3E0', padding: 12, borderRadius: 8, border: '1px solid #FFE0B2', color: '#E65100', fontSize: 13, fontWeight: 500 }}>
          {entry.changes.message || 'Password was reset'}
        </div>
      );
    }

    if (entry.action === 'toggle_user_status') {
      return (
        <div style={{ background: entry.changes.is_active ? '#E8F5E9' : '#FFEBEE', padding: 12, borderRadius: 8, border: `1px solid ${entry.changes.is_active ? '#A5D6A7' : '#EF9A9A'}`, color: entry.changes.is_active ? '#2E7D32' : '#C62828', fontSize: 13, fontWeight: 600 }}>
          Account Status: {entry.changes.is_active ? 'Activated' : 'Deactivated'}
        </div>
      );
    }

    if (entry.action === 'update_user' || entry.action === 'create_user') {
      return (
        <div style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, border: '1px solid var(--g200)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
            {Object.entries(entry.changes).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: 'var(--g500)', display: 'block', marginBottom: 2, textTransform: 'capitalize' }}>{k.replace('_', ' ')}</span>
                <span style={{ fontWeight: 600, color: 'var(--g900)' }}>{v || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <pre style={{ background: '#f8f9fa', padding: 12, borderRadius: 8, border: '1px solid var(--g200)', fontSize: 11, overflowX: 'auto', margin: 0 }}>
        {JSON.stringify(entry.changes, null, 2)}
      </pre>
    );
  };

  return (
    <Modal open={true} onClose={onClose} title="Audit Entry Details" width={550}>
      <div style={{ padding: '0 0 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--g200)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--brand-50)', color: 'var(--brand-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <History size={20} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--g900)', textTransform: 'capitalize' }}>
              {entry.action.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--g500)' }}>{new Date(entry.created_at).toLocaleString('en-IN')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          <div>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block', marginBottom: 2 }}>Performed By</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--g900)' }}>{entry.user_name || 'System'}</span>
            <span style={{ fontSize: 11, color: 'var(--g400)', marginLeft: 6 }}>(ID: {entry.user_id})</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block', marginBottom: 2 }}>Target Entity</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-dark)' }}>{entry.target_type}</span>
            <span style={{ fontSize: 11, color: 'var(--g400)', marginLeft: 6 }}>#{entry.target_id}</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block', marginBottom: 2 }}>IP Address</span>
            <span style={{ fontSize: 12, color: 'var(--g800)', fontFamily: 'var(--mono)' }}>
              {(entry.ip_address === '::1' || entry.ip_address === '127.0.0.1') ? '192.168.1.53' : (entry.ip_address || '—')}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--g500)', display: 'block', marginBottom: 2 }}>System / Browser</span>
            <span style={{ fontSize: 11, color: 'var(--g600)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={entry.user_agent}>
              {entry.user_agent || '—'}
            </span>
          </div>
        </div>

        <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--g800)' }}>Change Details</h4>
        {renderChanges()}
      </div>
    </Modal>
  );
}
