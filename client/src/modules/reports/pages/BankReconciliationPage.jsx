import { useState, useEffect, useMemo, useRef } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import {
  ArrowLeftRight, Upload, Link2, Unlink2, Save,
  RefreshCw, CheckCircle2, Circle, AlertTriangle,
} from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmt = v =>
  '₹' + Math.abs(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtSigned = v => {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const localDate = isoOrStr => {
  if (!isoOrStr) return '—';
  try { return new Date(isoOrStr).toLocaleDateString('en-IN'); } catch { return isoOrStr; }
};

// ── CSV parser (browser-side) ─────────────────────────────────────────────────

function splitCSVLine(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdrs = splitCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (cols, ...names) => {
    for (const n of names) {
      const i = hdrs.findIndex(h => h.includes(n));
      if (i >= 0 && cols[i] !== undefined) return cols[i].trim();
    }
    return '';
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCSVLine(lines[i]);
    const dateStr = col(cols, 'date', 'txndate', 'transactiondate', 'valuedate');
    const amtStr = col(cols, 'amount', 'debit', 'credit', 'withdrawal', 'deposit', 'dr', 'cr');
    const ref = col(cols, 'ref', 'description', 'narration', 'particulars', 'remarks', 'desc');
    if (!dateStr) continue;
    const amount = parseFloat(amtStr.replace(/[,₹\s]/g, ''));
    if (isNaN(amount)) continue;
    rows.push({ idx: i - 1, date: dateStr, amount, ref });
  }
  return rows;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankReconciliationPage() {
  const api = useApi();
  const fileRef = useRef();
  const today = new Date().toISOString().split('T')[0];

  // ── Filter state ──
  const [bankAccounts, setBankAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [stmtDate, setStmtDate] = useState('');
  const [stmtBal, setStmtBal] = useState('');

  // ── Data state ──
  const [sysData, setSysData] = useState(null); // { transactions[], openingBalance }
  const [bankRows, setBankRows] = useState([]);   // [{ idx, date, amount, ref }]

  // matches: [{ sysKey, bankIdx, je_id, system_amount, bank_amount, bank_date, bank_ref, status }]
  // sysKey = String(je_line_id)
  const [matches, setMatches] = useState([]);

  // ── Selection state for manual linking ──
  const [pendingSys, setPendingSys] = useState(null); // je_line_id string
  const [pendingBank, setPendingBank] = useState(null); // bank idx number

  // ── Loading/save state ──
  const [loadingSystem, setLoadingSystem] = useState(false);
  const [autoMatchLoading, setAutoMatchLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState('');

  // ── Derived lookups ──
  const sysToMatch = useMemo(
    () => Object.fromEntries(matches.map(m => [m.sysKey, m])),
    [matches]
  );
  const bankToMatch = useMemo(
    () => Object.fromEntries(matches.map(m => [String(m.bankIdx), m])),
    [matches]
  );
  const sysTxnMap = useMemo(() => {
    const map = {};
    (sysData?.transactions || []).forEach(t => { map[String(t.je_line_id)] = t; });
    return map;
  }, [sysData]);

  // ── Computed balances ──
  const sysClosingBalance = useMemo(() => {
    if (!sysData) return 0;
    return sysData.openingBalance +
      sysData.transactions.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  }, [sysData]);

  const statementBalance = parseFloat(stmtBal || 0);
  const difference = statementBalance - sysClosingBalance;
  const isBalanced = Math.abs(difference) < 0.01;

  const unmatchedSys = useMemo(
    () => (sysData?.transactions || []).filter(t => !sysToMatch[String(t.je_line_id)]),
    [sysData, sysToMatch]
  );
  const unmatchedBank = useMemo(
    () => bankRows.filter(b => !bankToMatch[String(b.idx)]),
    [bankRows, bankToMatch]
  );

  // ── Effects ──
  useEffect(() => {
    api.get('/api/accounts?is_group=false&status=active')
      .then(data => {
        const banks = (data || []).filter(a =>
          a.sub_type === 'bank' || a.sub_type === 'cash' ||
          (a.type === 'asset' && /bank|cash/i.test(a.name))
        );
        setBankAccounts(banks);
      })
      .catch(() => { });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──
  const loadSystem = async () => {
    if (!accountId) { setError('Select a bank account first'); return; }
    setLoadingSystem(true);
    setError('');
    setSysData(null);
    setMatches([]);
    setPendingSys(null);
    setPendingBank(null);
    setSavedId(null);
    try {
      const d = await api.get(
        `/api/bank-recon/system?account_id=${accountId}&from=${fromDate}&to=${toDate}`
      );
      setSysData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingSystem(false);
    }
  };

  const clearFilters = () => {
    setAccountId('');
    setFromDate('');
    setToDate('');
    setStmtDate('');
    setStmtBal('');
    setSysData(null);
    setBankRows([]);
    setMatches([]);
    setPendingSys(null);
    setPendingBank(null);
    setError('');
    setSavedId(null);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCSVText(text);
      if (rows.length === 0) {
        setError('No valid rows found. Check CSV columns: date, amount, ref/description');
        return;
      }
      setBankRows(rows);
      setMatches([]);
      setPendingSys(null);
      setPendingBank(null);
      setError('');
    } catch (ex) {
      setError('Failed to parse CSV: ' + ex.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAutoMatch = async () => {
    if (!sysData || bankRows.length === 0) return;
    setAutoMatchLoading(true);
    setError('');
    try {
      const res = await api.post('/api/bank-recon/auto-match', {
        systemTxns: sysData.transactions,
        bankRows,
      });
      const newMatches = res.matches.map(m => ({
        sysKey: String(m.je_line_id || m.je_id),
        bankIdx: m.bank_idx,
        je_id: m.je_id,
        system_amount: m.system_amount,
        bank_amount: m.bank_amount,
        bank_date: m.bank_date,
        bank_ref: m.bank_ref,
        status: 'auto',
      }));
      setMatches(newMatches);
      setPendingSys(null);
      setPendingBank(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAutoMatchLoading(false);
    }
  };

  const handleSysClick = (txn) => {
    const key = String(txn.je_line_id);
    if (sysToMatch[key]) {
      setMatches(prev => prev.filter(m => m.sysKey !== key));
      return;
    }
    setPendingSys(prev => prev === key ? null : key);
  };

  const handleBankClick = (row) => {
    const idx = row.idx;
    if (bankToMatch[String(idx)]) {
      setMatches(prev => prev.filter(m => m.bankIdx !== idx));
      return;
    }
    setPendingBank(prev => prev === idx ? null : idx);
  };

  const handleManualLink = () => {
    if (pendingSys === null || pendingBank === null) return;
    const sysTxn = sysTxnMap[pendingSys];
    const bankRow = bankRows.find(b => b.idx === pendingBank);
    if (!sysTxn || !bankRow) return;
    setMatches(prev => [
      ...prev,
      {
        sysKey: pendingSys,
        bankIdx: pendingBank,
        je_id: sysTxn.je_id,
        system_amount: sysTxn.amount,
        bank_amount: bankRow.amount,
        bank_date: bankRow.date,
        bank_ref: bankRow.ref,
        status: 'manual',
      },
    ]);
    setPendingSys(null);
    setPendingBank(null);
  };

  const handleSave = async () => {
    if (!accountId || !stmtDate) {
      setError('Select account and statement date before saving');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/bank-recon/save', {
        account_id: parseInt(accountId),
        statement_date: stmtDate,
        statement_balance: statementBalance,
        matches: matches.map(m => ({
          je_id: m.je_id,
          system_amount: m.system_amount,
          bank_amount: m.bank_amount,
          bank_date: m.bank_date,
          bank_ref: m.bank_ref,
          match_status: m.status,
        })),
        unmatched_sys: unmatchedSys.map(t => ({ je_id: t.je_id, amount: t.amount })),
        unmatched_bank: unmatchedBank.map(b => ({ amount: b.amount, date: b.date, ref: b.ref })),
      });
      setSavedId(res.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Row style helpers ──
  const getSysStyle = (txn) => {
    const key = String(txn.je_line_id);
    if (sysToMatch[key]) return { background: '#E8F5E9', cursor: 'pointer' };
    if (pendingSys === key) return { background: '#E3F2FD', cursor: 'pointer', outline: '2px solid #90CAF9' };
    return { cursor: 'pointer' };
  };

  const getBankStyle = (row) => {
    if (bankToMatch[String(row.idx)]) return { background: '#E8F5E9', cursor: 'pointer' };
    if (pendingBank === row.idx) return { background: '#E3F2FD', cursor: 'pointer', outline: '2px solid #90CAF9' };
    return { cursor: 'pointer' };
  };

  // ── Both selections active ──
  const canLink = pendingSys !== null && pendingBank !== null;

  return (
    <div style={{ padding: 20 }} className="animate-in">

      {/* ── Page title ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 }}>
      </div>

      {/* ── Filters row ── */}
      <div
        className="form-row"
        style={{ marginBottom: 16, background: 'var(--g50)', padding: 14, borderRadius: 10, border: '1px solid var(--g200)', flexWrap: 'wrap', gap: 10 }}
      >
        <style>
          {`
            .form-row .fg {
              width: 200px;
              flex: none;
            }
            .form-row .fg input, 
            .form-row .fg button:not([class*="dp-"]), 
            .form-row .fg .dp-trigger {
              height: 30px !important;
              min-height: 30px !important;
              width: 100% !important;
              box-sizing: border-box;
            }
          `}
        </style>
        <div className="fg">
          <label>Bank Account *</label>
          <SelectDropdown value={accountId} onChange={e => { setAccountId(e.target.value); setSysData(null); }}>
            <option value="">— Select —</option>
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </SelectDropdown>
        </div>
        <div className="fg"><label>From</label>
          <DatePicker value={fromDate} onChange={v => setFromDate(v)} />
        </div>
        <div className="fg"><label>To</label>
          <DatePicker value={toDate} onChange={v => setToDate(v)} />
        </div>
        <div className="fg"><label>Statement Date</label>
          <DatePicker value={stmtDate} onChange={v => setStmtDate(v)} />
        </div>
        <div className="fg"><label>Statement Balance (₹)</label>
          <input
            type="number" value={stmtBal}
            onChange={e => setStmtBal(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 'auto', flexWrap: 'nowrap', paddingBottom: '1px' }}>
          <button
            className="btn"
            onClick={clearFilters}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', height: '30px', padding: '0 12px' }}
          >
            Clear
          </button>
          <button
            className="btn btn-primary"
            onClick={loadSystem}
            disabled={!accountId || loadingSystem}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', height: '30px', padding: '0 12px' }}
          >
            {loadingSystem ? <RefreshCw size={13} className="spin" /> : null} Load System
          </button>
          <label
            className="btn"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, whiteSpace: 'nowrap', height: '30px', margin: 0, padding: '0 12px' }}
          >
            <Upload size={13} /> Upload CSV
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#FFEBEE', border: '1px solid #EF9A9A', borderRadius: 8, color: 'var(--red)', fontWeight: 600, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* ── Save success ── */}
      {savedId && (
        <div style={{ padding: '10px 14px', background: '#E8F5E9', border: '1px solid #A5D6A7', borderRadius: 8, color: 'var(--green)', fontWeight: 600, marginBottom: 12 }}>
          ✓ Reconciliation saved — ID #{savedId}
        </div>
      )}

      {/* ── Summary + action bar (only when system loaded) ── */}
      {sysData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          {/* Balance cards */}
          {[
            { label: 'System Balance', value: sysClosingBalance, color: '#1565c0' },
            { label: 'Statement Balance', value: statementBalance, color: 'var(--green)' },
            {
              label: 'Difference',
              value: difference,
              color: isBalanced ? 'var(--green)' : 'var(--red)',
              extra: isBalanced ? '✓ Balanced' : '⚠ Unbalanced',
            },
          ].map((c, i) => (
            <div key={i} style={{ padding: '8px 16px', background: 'var(--g50)', borderRadius: 8, border: `1px solid ${isBalanced || i < 2 ? 'var(--g200)' : '#EF9A9A'}`, minWidth: 150 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: c.color }}>{c.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--mono)', color: c.color }}>{fmtSigned(c.value)}</div>
              {c.extra && <div style={{ fontSize: 10, fontWeight: 600, color: c.color }}>{c.extra}</div>}
            </div>
          ))}

          {/* Match stats badge */}
          <div style={{ padding: '8px 14px', background: 'var(--g50)', borderRadius: 8, border: '1px solid var(--g200)', fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: 'var(--brand-dark)', marginBottom: 2 }}>Match Status</div>
            <div>System: <b>{matches.length}</b> / {sysData.transactions.length} matched</div>
            <div>Bank: <b>{matches.length}</b> / {bankRows.length} matched</div>
          </div>

          {/* Action buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              onClick={handleAutoMatch}
              disabled={autoMatchLoading || bankRows.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              title="Auto-match by amount (±₹1) and date (±3 days)"
            >
              <RefreshCw size={13} /> Auto Match
            </button>

            {canLink && (
              <button
                className="btn"
                onClick={handleManualLink}
                style={{ background: '#E3F2FD', border: '1px solid #90CAF9', color: '#1565c0', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Link2 size={13} /> Link Selected
              </button>
            )}

            {(pendingSys !== null || pendingBank !== null) && (
              <button
                className="btn"
                onClick={() => { setPendingSys(null); setPendingBank(null); }}
              >
                Clear Selection
              </button>
            )}

            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ background: 'var(--green)', border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save Reconciliation'}
            </button>
          </div>
        </div>
      )}

      {/* ── Hint bar ── */}
      {sysData && (
        <div style={{ fontSize: 11, color: 'var(--g500)', marginBottom: 8 }}>
          {canLink
            ? <span style={{ color: '#1565c0', fontWeight: 700 }}>● Both rows selected — click "Link Selected" to match them</span>
            : pendingSys
              ? <span style={{ color: '#1565c0' }}>● System row selected — now click a bank row to pair it</span>
              : pendingBank
                ? <span style={{ color: '#1565c0' }}>● Bank row selected — now click a system row to pair it</span>
                : <span>Click any row to select it for manual matching. Click a matched row (green) to unmatch.</span>}
        </div>
      )}

      {loadingSystem && <div className="empty-state"><div className="spinner" /></div>}

      {/* ── Two-panel layout ── */}
      {sysData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* ─── LEFT: System Transactions ─── */}
          <div>
            <div style={{
              padding: '6px 12px', borderRadius: '6px 6px 0 0',
              background: '#E3F2FD', border: '1px solid #90CAF9', borderBottom: 'none',
              fontWeight: 700, fontSize: 12, color: '#1565c0',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>System Transactions</span>
              <span style={{ fontWeight: 400, color: '#5c8acd' }}>{sysData.transactions.length} entries</span>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid var(--g200)', borderRadius: '0 0 6px 6px' }}>
              <table className="dgrid" style={{ fontSize: 11, margin: 0 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 88 }}>Date</th>
                    <th>Description</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Amount (₹)</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sysData.transactions.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--g400)', padding: 24, fontStyle: 'italic' }}>
                        No posted transactions in this period
                      </td>
                    </tr>
                  )}
                  {sysData.transactions.map((txn, i) => {
                    const key = String(txn.je_line_id);
                    const isMatch = !!sysToMatch[key];
                    const isPend = pendingSys === key;
                    const matchInf = sysToMatch[key];
                    return (
                      <tr
                        key={i}
                        style={getSysStyle(txn)}
                        onClick={() => handleSysClick(txn)}
                        title={isMatch ? 'Matched — click to unmatch' : 'Click to select for manual match'}
                      >
                        <td style={{ fontSize: 10, color: 'var(--g600)' }}>
                          {localDate(txn.date)}
                        </td>
                        <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
                          <span>{txn.description || txn.je_number || '—'}</span>
                          {matchInf && (
                            <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--g400)', fontStyle: 'italic' }}>
                              ↔ {matchInf.bank_ref || localDate(matchInf.bank_date)}
                            </span>
                          )}
                        </td>
                        <td className="num" style={{
                          fontFamily: 'var(--mono)', fontWeight: 600,
                          color: txn.amount >= 0 ? '#2E7D32' : 'var(--red)',
                        }}>
                          {fmtSigned(txn.amount)}
                        </td>
                        <td style={{ textAlign: 'center', padding: '0 4px' }}>
                          {isMatch
                            ? <CheckCircle2 size={13} style={{ color: '#2E7D32' }} />
                            : isPend
                              ? <Circle size={13} style={{ color: '#1565c0' }} />
                              : <Circle size={13} style={{ color: 'var(--g200)' }} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#E3F2FD', fontWeight: 700 }}>
                    <td colSpan={2} style={{ textAlign: 'right', fontSize: 11, color: '#1565c0' }}>Closing Balance</td>
                    <td className="num" style={{ fontFamily: 'var(--mono)', color: '#1565c0' }}>{fmtSigned(sysClosingBalance)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ─── RIGHT: Bank Statement ─── */}
          <div>
            <div style={{
              padding: '6px 12px', borderRadius: '6px 6px 0 0',
              background: '#E8F5E9', border: '1px solid #A5D6A7', borderBottom: 'none',
              fontWeight: 700, fontSize: 12, color: '#2E7D32',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Bank Statement</span>
              <span style={{ fontWeight: 400, color: '#4CAF50' }}>
                {bankRows.length > 0 ? `${bankRows.length} entries` : 'Upload CSV →'}
              </span>
            </div>
            <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid var(--g200)', borderRadius: '0 0 6px 6px' }}>
              {bankRows.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--g400)' }}>
                  <Upload size={36} style={{ opacity: 0.3, marginBottom: 10 }} />
                  <div style={{ fontWeight: 600, fontSize: 13 }}>No bank statement loaded</div>
                  <div style={{ fontSize: 11, marginTop: 6 }}>
                    Upload a CSV with columns: <b>date, amount, ref</b> (or description/narration)
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: 'var(--g300)' }}>
                    Positive amounts = deposits · Negative amounts = withdrawals
                  </div>
                </div>
              ) : (
                <table className="dgrid" style={{ fontSize: 11, margin: 0 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>
                    <tr>
                      <th style={{ width: 88 }}>Date</th>
                      <th>Reference</th>
                      <th style={{ width: 110, textAlign: 'right' }}>Amount (₹)</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankRows.map((row, i) => {
                      const isMatch = !!bankToMatch[String(row.idx)];
                      const isPend = pendingBank === row.idx;
                      const matchInf = bankToMatch[String(row.idx)];
                      const pairedTxn = matchInf ? sysTxnMap[matchInf.sysKey] : null;
                      return (
                        <tr
                          key={i}
                          style={getBankStyle(row)}
                          onClick={() => handleBankClick(row)}
                          title={isMatch ? 'Matched — click to unmatch' : 'Click to select for manual match'}
                        >
                          <td style={{ fontSize: 10, color: 'var(--g600)' }}>{row.date}</td>
                          <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
                            <span>{row.ref || '—'}</span>
                            {pairedTxn && (
                              <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--g400)', fontStyle: 'italic' }}>
                                ↔ {pairedTxn.description || pairedTxn.je_number || localDate(pairedTxn.date)}
                              </span>
                            )}
                          </td>
                          <td className="num" style={{
                            fontFamily: 'var(--mono)', fontWeight: 600,
                            color: row.amount >= 0 ? '#2E7D32' : 'var(--red)',
                          }}>
                            {fmtSigned(row.amount)}
                          </td>
                          <td style={{ textAlign: 'center', padding: '0 4px' }}>
                            {isMatch
                              ? <CheckCircle2 size={13} style={{ color: '#2E7D32' }} />
                              : isPend
                                ? <Circle size={13} style={{ color: '#1565c0' }} />
                                : <Circle size={13} style={{ color: 'var(--g200)' }} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {stmtBal && (
                    <tfoot>
                      <tr style={{ background: '#E8F5E9', fontWeight: 700 }}>
                        <td colSpan={2} style={{ textAlign: 'right', fontSize: 11, color: '#2E7D32' }}>Statement Balance</td>
                        <td className="num" style={{ fontFamily: 'var(--mono)', color: '#2E7D32' }}>{fmt(statementBalance)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Unmatched summary panel ── */}
      {sysData && (unmatchedSys.length > 0 || unmatchedBank.length > 0) && (
        <div style={{ marginTop: 16, padding: 14, background: '#FFF3E0', border: '1px solid #FFCC80', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#E65100', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Unlink2 size={13} />
            Unmatched Entries — {unmatchedSys.length} system · {unmatchedBank.length} bank statement
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Unmatched system */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 11, color: '#1565c0', marginBottom: 6 }}>
                System ({unmatchedSys.length})
              </div>
              {unmatchedSys.length === 0
                ? <div style={{ fontSize: 11, color: 'var(--g400)' }}>All matched ✓</div>
                : unmatchedSys.slice(0, 8).map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #FFCC80' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                      {localDate(t.date)} — {t.description || t.source_type || '—'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: t.amount >= 0 ? '#2E7D32' : 'var(--red)', flexShrink: 0 }}>
                      {fmtSigned(t.amount)}
                    </span>
                  </div>
                ))
              }
              {unmatchedSys.length > 8 && (
                <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 4 }}>
                  +{unmatchedSys.length - 8} more…
                </div>
              )}
            </div>
            {/* Unmatched bank */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 11, color: '#2E7D32', marginBottom: 6 }}>
                Bank Statement ({unmatchedBank.length})
              </div>
              {unmatchedBank.length === 0
                ? <div style={{ fontSize: 11, color: 'var(--g400)' }}>All matched ✓</div>
                : unmatchedBank.slice(0, 8).map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #FFCC80' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                      {b.date} — {b.ref || '—'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: b.amount >= 0 ? '#2E7D32' : 'var(--red)', flexShrink: 0 }}>
                      {fmtSigned(b.amount)}
                    </span>
                  </div>
                ))
              }
              {unmatchedBank.length > 8 && (
                <div style={{ fontSize: 10, color: 'var(--g500)', marginTop: 4 }}>
                  +{unmatchedBank.length - 8} more…
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
