import React, { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { useApi } from '../../../shared/hooks/useApi';

export default function AuditUserHistory({ userId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const { api } = useApi();

  const loadHistory = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const uId = userId || '0';
      const res = await api.get(`/api/audit-logs/user/${uId}?page=${p}&pageSize=50`);
      setHistory(res.data || []);
      setTotal(res.total || 0);
      setPage(res.page || 1);
    } catch (err) {
      console.error('Failed to load user history', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadHistory(1);
  }, [loadHistory]);

  if (loading && history.length === 0) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--g500)' }}>Loading history...</div>;
  }

  if (history.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--g500)' }}>
        No actions recorded for this user yet.
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--g800)' }}>Detailed Activity History</h4>
      <div style={{ overflowY: 'auto', maxHeight: 400, border: '1px solid var(--g200)', borderRadius: 4, background: '#fff' }}>
        <table className="adm-table" style={{ border: 'none' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Table</th>
              <th>Record ID</th>
              <th>Changes (Snapshot)</th>
              <th>IP Address</th>
            </tr>
          </thead>
          <tbody>
            {history.map(row => (
              <tr key={row.id}>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--g600)' }}>
                  {new Date(row.timestamp).toLocaleString()}
                </td>
                <td style={{ fontWeight: 500, color: 'var(--g800)' }}>{row.action}</td>
                <td style={{ color: 'var(--g600)' }}>{row.table_name || '-'}</td>
                <td style={{ fontFamily: 'var(--mono)', color: 'var(--g600)' }}>{row.record_id || '-'}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.new_values ? (
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--g500)', whiteSpace: 'pre-wrap', maxHeight: 60, overflowY: 'auto' }}>
                      {row.new_values}
                    </div>
                  ) : '-'}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g500)' }}>
                  {row.ip_address || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => loadHistory(page - 1)}>Prev</button>
          <span style={{ fontSize: 11, alignSelf: 'center' }}>Page {page} of {Math.ceil(total / 50)}</span>
          <button className="btn btn-sm" disabled={page >= Math.ceil(total / 50)} onClick={() => loadHistory(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
