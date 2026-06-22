import React, { useState, useEffect } from 'react';
import api from '../../../../api';
import { useAuth } from '../../../../contexts/AuthContext';
import { PageHeader } from '../../../../components/layout/PageHeader';
import { Drawer } from '../../../../components/layout/Drawer';

function money(v) {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const th = { textAlign: 'left', padding: '10px', borderBottom: '2px solid var(--g200)', fontSize: 13, color: 'var(--g600)', background: 'var(--g50)' };
const td = { padding: '12px 10px', fontSize: 14, borderBottom: '1px solid var(--g100)', color: 'var(--g800)' };
const tdNum = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export default function CostCenterCorrectionsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('workspace');
  const [loading, setLoading] = useState(false);
  
  // Workspace state
  const [docs, setDocs] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState({}); // { je_id: target_cc_id }
  
  // Drawer state
  const [previewData, setPreviewData] = useState(null); // { doc_number, lines: [...] }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState('');

  // History state
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetchCostCenters();
    fetchDocs();
  }, []);

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab]);

  async function fetchCostCenters() {
    try {
      const res = await api.get('/cost-centers?status=active');
      setCostCenters(res.data.data);
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchDocs() {
    setLoading(true);
    try {
      const res = await api.get('/cost-center-corrections/search-transactions');
      setDocs(res.data.data || []);
      setSelectedDocs({});
    } catch (err) {
      console.error(err);
      alert('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory() {
    setLoading(true);
    try {
      const res = await api.get('/cost-center-corrections/audit-history');
      setHistory(res.data.data || []);
    } catch (err) {
      console.error(err);
      alert('Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  const handlePreview = async (doc) => {
    const targetCcId = selectedDocs[doc.je_id];
    if (targetCcId === undefined) {
      alert('Please select a Target Cost Centre for this document first.');
      return;
    }

    const je_line_ids = doc.je_lines.map(l => l.je_line_id);

    try {
      setApplying(true);
      const res = await api.post('/cost-centers/bulk-reassign', {
        je_line_ids,
        new_cost_center_id: targetCcId || null,
        preview: true
      });
      setPreviewData({
        doc,
        lines: res.data.lines,
        targetCcId
      });
      setReason(''); // Reset reason
      setDrawerOpen(true);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Preview failed');
    } finally {
      setApplying(false);
    }
  };

  const handleApply = async () => {
    if (!previewData) return;
    const { doc, targetCcId } = previewData;
    const je_line_ids = doc.je_lines.map(l => l.je_line_id);

    if (!reason.trim()) {
      alert('Please select or enter a reason for this correction.');
      return;
    }

    try {
      setApplying(true);
      await api.post('/cost-centers/bulk-reassign', {
        je_line_ids,
        new_cost_center_id: targetCcId || null,
        reason: reason.trim(),
        preview: false
      });
      setDrawerOpen(false);
      setPreviewData(null);
      await fetchDocs(); // refresh list
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="page-container">
      <PageHeader title="Cost Centre Corrections" />

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, borderBottom: '1px solid var(--g200)' }}>
        <button 
          onClick={() => setTab('workspace')}
          style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: tab === 'workspace' ? '2px solid var(--brand)' : '2px solid transparent', color: tab === 'workspace' ? 'var(--brand)' : 'var(--g600)', fontWeight: tab === 'workspace' ? 600 : 400, cursor: 'pointer' }}
        >
          Correction Workspace
        </button>
        <button 
          onClick={() => setTab('history')}
          style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: tab === 'history' ? '2px solid var(--brand)' : '2px solid transparent', color: tab === 'history' ? 'var(--brand)' : 'var(--g600)', fontWeight: tab === 'history' ? 600 : 400, cursor: 'pointer' }}
        >
          Audit History
        </button>
      </div>

      {loading ? <p style={{ padding: 24 }}>Loading…</p> : (
        tab === 'workspace' ? (
          <div>
            <div style={{ padding: 16, background: 'var(--g50)', borderRadius: 8, marginBottom: 16 }}>
              <p style={{ margin: 0, color: 'var(--g700)', fontSize: 14 }}>
                <strong>Tip:</strong> Select a new target cost centre for a document and click "Preview" to review the underlying journal lines before applying.
              </p>
            </div>
            
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Doc Number</th>
                  <th style={th}>Vendor / Party</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                  <th style={th}>Target Cost Centre</th>
                  <th style={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {docs.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--g500)' }}>No transactions found for the period.</td></tr>
                ) : docs.map(d => (
                  <tr key={d.je_id}>
                    <td style={td}>{new Date(d.document_date).toLocaleDateString('en-GB')}</td>
                    <td style={td}>{d.document_type}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{d.document_number}</td>
                    <td style={td}>{d.vendor_name || '—'}</td>
                    <td style={tdNum}>{money(d.amount)}</td>
                    <td style={td}>
                      <select 
                        value={selectedDocs[d.je_id] ?? ''} 
                        onChange={(e) => setSelectedDocs({...selectedDocs, [d.je_id]: e.target.value === '' ? '' : Number(e.target.value)})}
                        style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--g300)' }}
                      >
                        <option value="" disabled>-- Select target --</option>
                        <option value="">(Blank / None)</option>
                        {costCenters.map(cc => (
                          <option key={cc.id} value={cc.id}>{cc.code} - {cc.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <button 
                        onClick={() => handlePreview(d)}
                        disabled={selectedDocs[d.je_id] === undefined || applying}
                        className="btn btn-outline"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Timestamp</th>
                  <th style={th}>User</th>
                  <th style={th}>Doc Number</th>
                  <th style={th}>Old Cost Centre</th>
                  <th style={th}>New Cost Centre</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--g500)' }}>No history logs found.</td></tr>
                ) : history.map(h => (
                  <tr key={h.id}>
                    <td style={td}>{new Date(h.created_at).toLocaleString('en-GB')}</td>
                    <td style={td}>{h.user_name || 'System'}</td>
                    <td style={td}>{h.document_number || '—'}</td>
                    <td style={{ ...td, color: 'var(--red)' }}>{h.old_cost_center_name || 'None'}</td>
                    <td style={{ ...td, color: 'var(--green)' }}>{h.new_cost_center_name || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Preview Drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Correction Preview" width={600}>
        {previewData && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: 18 }}>{previewData.doc.document_number}</h3>
                <p style={{ margin: 0, color: 'var(--g600)' }}>
                  Vendor: {previewData.doc.vendor_name || 'N/A'}<br/>
                  New Cost Centre: <strong>{previewData.lines[0]?.new_cc_name || 'Blank'}</strong>
                </p>
              </div>

              <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: 'var(--g700)', textTransform: 'uppercase' }}>Lines Affected</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Account</th>
                    <th style={th}>Current Cost Centre</th>
                    <th style={th}>New Cost Centre</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.lines.map(l => (
                    <tr key={l.je_line_id}>
                      <td style={td}>{l.account_name}</td>
                      <td style={td}>{l.old_cc_name || 'None'}</td>
                      <td style={td}>{l.new_cc_name || 'None'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 24, padding: 16, background: 'var(--red-50)', color: 'var(--red-700)', borderRadius: 8 }}>
                <p style={{ margin: 0, fontSize: 14 }}>
                  <strong>Safety Guaranteed:</strong> The underlying journal entry, debits, and credits remain perfectly untouched.
                </p>
              </div>

              <div style={{ marginTop: 24 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 500, color: 'var(--g700)' }}>
                  Reason for Correction <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <select 
                  value={reason} 
                  onChange={e => setReason(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid var(--g300)' }}
                >
                  <option value="" disabled>-- Select a reason --</option>
                  <option value="Wrong assignment">Wrong assignment</option>
                  <option value="Entry mistake">Entry mistake</option>
                  <option value="Project completed">Project completed</option>
                  <option value="Department transfer">Department transfer</option>
                  <option value="Cleanup">Cleanup</option>
                  <option value="Other">Other</option>
                </select>
                {reason === 'Other' && (
                  <input 
                    type="text" 
                    placeholder="Please specify..." 
                    onChange={e => setReason(e.target.value)} 
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: '1px solid var(--g300)', marginTop: 8 }}
                  />
                )}
              </div>
            </div>
            
            <div style={{ padding: 24, borderTop: '1px solid var(--g200)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-outline" onClick={() => setDrawerOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || !reason.trim()}>
                {applying ? 'Saving...' : 'Confirm & Apply'}
              </button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
