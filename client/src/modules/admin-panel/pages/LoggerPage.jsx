import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import { Terminal, Shield, RefreshCw, Trash2, CheckCircle2, AlertTriangle, Info, XCircle, Database } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoggerPage() {
  const api = useApi();
  const { user } = useAuth();
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; });

  const isSuperAdmin = user?.role === 'super_admin' || user?.role === 'superadmin' || user?.role === 'super admin';

  // Filters & State
  const [backendLevel, setBackendLevel] = useState('ALL');
  const [frontendLevel, setFrontendLevel] = useState('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [backendLogs, setBackendLogs] = useState([]);
  const [frontendLogs, setFrontendLogs] = useState([]);
  const [loadingBackend, setLoadingBackend] = useState(true);
  const [loadingFrontend, setLoadingFrontend] = useState(true);
  const [checkingMigrations, setCheckingMigrations] = useState(false);

  const backendTerminalRef = useRef(null);
  const frontendTerminalRef = useRef(null);

  // Fetch backend logs
  const fetchBackendLogs = async () => {
    try {
      const res = await apiRef.current.get(`/api/admin/logger/backend-logs?level=${backendLevel}&limit=500`);
      setBackendLogs(res.logs || []);
    } catch (err) {
      // silent
    } finally {
      setLoadingBackend(false);
    }
  };

  // Fetch frontend logs
  const fetchFrontendLogs = async () => {
    try {
      const res = await apiRef.current.get(`/api/admin/logger/frontend-logs?level=${frontendLevel}&limit=500`);
      setFrontendLogs(res.logs || []);
    } catch (err) {
      // silent
    } finally {
      setLoadingFrontend(false);
    }
  };

  // Initial and Polling load
  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchBackendLogs();
    fetchFrontendLogs();

    let timer;
    if (autoRefresh) {
      timer = setInterval(() => {
        fetchBackendLogs();
        fetchFrontendLogs();
      }, 3000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isSuperAdmin, backendLevel, frontendLevel, autoRefresh]);

  // Check migrations
  const handleCheckMigrations = async () => {
    setCheckingMigrations(true);
    try {
      const res = await apiRef.current.get('/api/admin/logger/migrations');
      toast.success(res.status || 'Migrations checked');
      await fetchBackendLogs();
    } catch (err) {
      toast.error('Failed to check migrations');
    } finally {
      setCheckingMigrations(false);
    }
  };

  // Clear logs
  const handleClearLogs = async (target) => {
    try {
      await apiRef.current.del(`/api/admin/logger/clear?target=${target}`);
      if (target === 'backend' || target === 'all') setBackendLogs([]);
      if (target === 'frontend' || target === 'all') setFrontendLogs([]);
      toast.success(`Cleared ${target} logs`);
    } catch (err) {
      toast.error('Failed to clear logs');
    }
  };

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 12, padding: '16px 24px',
          background: '#FFEBEE', borderRadius: 10, border: '1px solid #FFCDD2', color: '#C62828',
          fontSize: 14, fontWeight: 600,
        }}>
          <Shield size={20} />
          Access Denied: The Logger page is strictly restricted to Super Admin role.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px', background: '#F8FAFC', boxSizing: 'border-box' }}>
      
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: '#1E293B',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38BDF8',
            boxShadow: '0 2px 8px rgba(30,41,59,.3)', flexShrink: 0,
          }}>
            <Terminal size={20} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.2 }}>
                System Logger
              </h1>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                background: '#E0E7FF', color: '#3730A3', letterSpacing: 0.5,
              }}>
                SUPER ADMIN ONLY
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#64748B', margin: '2px 0 0 0' }}>
              Real-time activity logs, backend system traces, migration status, and client error records.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ accentColor: '#2563EB' }}
            />
            Auto Refresh (3s)
          </label>

          <button
            className="btn btn-secondary"
            onClick={() => { fetchBackendLogs(); fetchFrontendLogs(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}
          >
            <RefreshCw size={13} /> Refresh Now
          </button>
        </div>
      </div>

      {/* Main Dual Terminal Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
        
        {/* ── Left Panel: Backend Logs ── */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          background: '#0F172A', borderRadius: 10, border: '1px solid #1E293B',
          overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', background: '#1E293B', borderBottom: '1px solid #334155',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#F8FAFC', fontWeight: 600, fontSize: 13 }}>
              <Terminal size={15} style={{ color: '#38BDF8' }} />
              Backend Logs
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCheckMigrations}
                disabled={checkingMigrations}
                style={{ fontSize: 11, padding: '3px 10px', height: 26, background: '#2563EB', borderColor: '#2563EB', fontWeight: 600 }}
              >
                {checkingMigrations ? 'Checking...' : 'Check Migrations'}
              </button>

              {['ALL', 'INFO', 'WARN', 'ERROR'].map(lvl => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setBackendLevel(lvl)}
                  style={{
                    padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 4, border: 'none',
                    cursor: 'pointer',
                    background: backendLevel === lvl ? '#38BDF8' : '#334155',
                    color: backendLevel === lvl ? '#0F172A' : '#94A3B8',
                    transition: 'all 0.15s',
                  }}
                >
                  {lvl}
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleClearLogs('backend')}
                style={{
                  padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                  border: '1px solid #475569', background: 'transparent', color: '#94A3B8', cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Terminal Console View */}
          <div
            ref={backendTerminalRef}
            style={{
              flex: 1, padding: 14, overflowY: 'auto',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: 11.5,
              lineHeight: 1.6, color: '#E2E8F0', background: '#0F172A',
            }}
          >
            {loadingBackend && backendLogs.length === 0 ? (
              <div style={{ color: '#64748B', fontStyle: 'italic' }}>Loading backend system logs...</div>
            ) : backendLogs.length === 0 ? (
              <div style={{ color: '#64748B', fontStyle: 'italic' }}>No backend log records found. Active system events will appear here in real time.</div>
            ) : (
              backendLogs.map(log => {
                const lvl = log.level;
                let color = '#4ADE80'; // INFO green
                if (lvl === 'WARN') color = '#FACC15'; // WARN yellow
                if (lvl === 'ERROR') color = '#F87171'; // ERROR red

                return (
                  <div key={log.id} style={{ marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    <span style={{ color: '#64748B' }}>[{log.timestamp}]</span>{' '}
                    <span style={{ color, fontWeight: 700 }}>[{lvl}]</span>{' '}
                    <span style={{ color: '#94A3B8' }}>{log.category || 'default'}</span>{' - '}
                    <span style={{ color: lvl === 'ERROR' ? '#FCA5A5' : '#E2E8F0' }}>{log.message}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right Panel: Frontend Logs ── */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          background: '#FFFFFF', borderRadius: 10, border: '1px solid #E2E8F0',
          overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0F172A', fontWeight: 600, fontSize: 13 }}>
              <Terminal size={15} style={{ color: '#2563EB' }} />
              Frontend Logs
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {['ALL', 'ERROR'].map(lvl => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFrontendLevel(lvl)}
                  style={{
                    padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 4, border: 'none',
                    cursor: 'pointer',
                    background: frontendLevel === lvl ? '#0F172A' : '#E2E8F0',
                    color: frontendLevel === lvl ? '#FFFFFF' : '#475569',
                    transition: 'all 0.15s',
                  }}
                >
                  {lvl}
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleClearLogs('frontend')}
                style={{
                  padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4,
                  border: '1px solid #CBD5E1', background: '#FFFFFF', color: '#64748B', cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Terminal Console View */}
          <div
            ref={frontendTerminalRef}
            style={{
              flex: 1, padding: 14, overflowY: 'auto',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: 11.5,
              lineHeight: 1.6, color: '#1E293B', background: '#FFFFFF',
            }}
          >
            {loadingFrontend && frontendLogs.length === 0 ? (
              <div style={{ color: '#94A3B8', fontStyle: 'italic' }}>Loading frontend logs...</div>
            ) : frontendLogs.length === 0 ? (
              <div style={{ color: '#94A3B8', fontStyle: 'italic' }}>No frontend logs recorded yet. Client exceptions and UI errors will be logged here.</div>
            ) : (
              frontendLogs.map(log => (
                <div key={log.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #F1F5F9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <div style={{ color: '#475569', fontWeight: 600 }}>
                    [{log.timestamp}] userId:{log.userId} userName: {log.userName}
                  </div>
                  <div style={{ color: '#DC2626', marginTop: 2, fontWeight: 500 }}>
                    {log.message}
                  </div>
                  {log.stack && (
                    <div style={{ color: '#991B1B', fontSize: 11, marginTop: 4, opacity: 0.9, paddingLeft: 12 }}>
                      Stack: {log.stack}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
