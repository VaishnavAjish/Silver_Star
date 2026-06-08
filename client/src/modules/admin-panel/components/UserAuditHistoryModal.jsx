import React, { useState, useEffect } from 'react';
import Modal from '../../../shared/components/Modal';
import { History, Search, Loader2, Trash2, Plus, Edit3 } from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';
import AuditDetailModal from './AuditDetailModal';

export default function UserAuditHistoryModal({ user, onClose, roles }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedAudit, setSelectedAudit] = useState(null);
  const api = useApi();

  useEffect(() => {
    if (!user) return;
    const fetchLogs = async () => {
      try {
        setLoading(true);
        // Fetch actions performed BY this user
        const res = await api.get(`/api/roles/audit-log?user_id=${user.id}&pageSize=100`);
        setLogs(res.data || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, [user]);

  if (!user) return null;

  return (
    <>
      <Modal open={true} onClose={onClose} title={`${user.full_name}'s Activity History`} width={750}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 16px 0', minHeight: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--g200)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--brand-50)', color: 'var(--brand-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--g900)' }}>{user.full_name}</div>
              <div style={{ fontSize: 13, color: 'var(--g500)' }}>@{user.username}</div>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--g500)' }}>
              <Loader2 className="spin" size={24} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 13 }}>Loading history...</div>
            </div>
          ) : error ? (
            <div style={{ padding: 16, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: 13 }}>
              Failed to load history: {error}
            </div>
          ) : logs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--g500)' }}>
              <History size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No Activity Found</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>This user hasn't performed any logged actions yet.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 500 }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Target</th>
                    <th>IP Address</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(entry => (
                    <tr key={entry.id} 
                      onDoubleClick={() => setSelectedAudit(entry)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 24, height: 24, borderRadius: 4,
                            background: entry.action?.includes('delete') ? '#FFEBEE' : entry.action?.includes('create') ? '#E8F5E9' : '#E3F2FD',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            {entry.action?.includes('delete') ? <Trash2 size={12} style={{ color: '#C62828' }} /> :
                            entry.action?.includes('create') ? <Plus size={12} style={{ color: '#2E7D32' }} /> :
                            <Edit3 size={12} style={{ color: '#1565C0' }} />}
                          </div>
                          <span style={{ textTransform: 'capitalize', fontSize: 12, fontWeight: 500, color: 'var(--g800)' }}>
                            {entry.action?.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: 'var(--g700)' }}>
                          <strong>{entry.target_type}</strong> #{entry.target_id}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--g600)' }}>
                          {(entry.ip_address === '::1' || entry.ip_address === '127.0.0.1') ? '192.168.1.53' : (entry.ip_address || '—')}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 11, color: 'var(--g500)' }}>
                          {new Date(entry.created_at).toLocaleString('en-IN')}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {selectedAudit && (
        <AuditDetailModal entry={selectedAudit} onClose={() => setSelectedAudit(null)} roles={roles} />
      )}
    </>
  );
}
