import { useState, useEffect } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { useApi } from '../../../shared/hooks/useApi';
import { Download, Printer } from 'lucide-react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { exportToCSV, printTable } from '../../../shared/utils/exportUtils';

const OP_META = {
  purchase:        { label: 'Purchase / Intake',       bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  split:           { label: 'Lot Split',               bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
  split_out:       { label: 'Split — Parent',          bg: '#FFF3E0', color: '#E65100', border: '#FFCC80' },
  split_in:        { label: 'Split — Child Created',   bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  mix:             { label: 'Lot Mix',                 bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  mix_out:         { label: 'Mix — Parent Consumed',   bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  mix_in:          { label: 'Mix — Result Created',    bg: '#EDE7F6', color: '#4527A0', border: '#B39DDB' },
  issue:           { label: 'Issue to Process',        bg: '#FFF8E1', color: '#F57F17', border: '#FFE082' },
  issue_receive:   { label: 'Received for Process',    bg: '#FFF8E1', color: '#F57F17', border: '#FFE082' },
  return:          { label: 'Return from Process',     bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  return_usable:   { label: 'Return — Usable',         bg: '#E8F5E9', color: '#2E7D32', border: '#A5D6A7' },
  return_damaged:  { label: 'Return — Damaged',        bg: '#FFEBEE', color: '#C62828', border: '#EF9A9A' },
  return_consumed: { label: 'Return — Consumed (log)', bg: '#FAFAFA', color: '#757575', border: '#E0E0E0' },
  return_complete: { label: 'Process Return Complete', bg: '#FAFAFA', color: '#757575', border: '#E0E0E0' },
};
const DEFAULT_META = { label: null, bg: '#F5F5F5', color: '#616161', border: '#E0E0E0' };

function getMeta(op) { return OP_META[op?.toLowerCase()] || DEFAULT_META; }
function getLabel(op) { return getMeta(op).label || op || '—'; }

const statusCls = s =>
  s === 'IN STOCK'   ? 'b-stock'    :
  s === 'IN PROCESS' ? 'b-process'  :
  s === 'CONSUMED'   ? 'b-inactive' :
  s === 'SOLD'       ? 'b-active'   :
  s === 'DAMAGED'    ? 'b-cancelled': 'b-draft';

export default function LotMovementLedger({ lotId }) {
  const api = useApi();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [opFilt,  setOpFilt]  = useState('');

  useEffect(() => {
    if (!lotId) return;
    setLoading(true);
    api.get(`/api/inventory/${lotId}/movement-ledger`)
      .then(setData)
      .catch(() => setData({ events: [] }))
      .finally(() => setLoading(false));
  }, [lotId]);

  const allEvents  = data?.events || [];
  const uniqueOps  = [...new Set(allEvents.map(e => e.op_type))];
  const events     = opFilt ? allEvents.filter(e => e.op_type === opFilt) : allEvents;

  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(events, []);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  const csvHeaders = ['Date', 'Time', 'Operation', 'Qty Delta', 'Status After', 'Reference', 'Operator', 'Notes'];
  const csvRows    = () => events.map(e => [
    new Date(e.ts).toLocaleDateString('en-IN'),
    new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    getLabel(e.op_type),
    e.qty_delta != null ? Number(e.qty_delta).toFixed(4) : '',
    e.new_status || '',
    e.ref_number || (e.ref_type ? `${e.ref_type}#${e.ref_id}` : ''),
    e.performed_by || '',
    e.notes || '',
  ]);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <SelectDropdown
          style={{ minWidth: 160 }}
          value={opFilt}
          onChange={e => setOpFilt(e.target.value)}
        >
          <option value="">All Operations</option>
          {uniqueOps.map(op => (
            <option key={op} value={op}>{getLabel(op)}</option>
          ))}
        </SelectDropdown>
        <span style={{ fontSize: 11, color: 'var(--g500)' }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => exportToCSV(`lot-${lotId}-movements.csv`, csvHeaders, csvRows())}>
            <Download size={11} /> CSV
          </button>
          <button className="btn btn-sm"
            onClick={() => printTable(
              `Movement Ledger — Lot ${lotId}`,
              `Exported ${new Date().toLocaleDateString('en-IN')}`,
              csvHeaders, csvRows()
            )}>
            <Printer size={11} /> Print
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--g400)',
          fontSize: 12, fontStyle: 'italic', border: '1px dashed var(--g300)', borderRadius: 8 }}>
          No movement history recorded for this lot.
        </div>
      ) : (
        <>
        <div style={{ background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, overflow: 'hidden' }}>
          <table className="dgrid" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 145 }}>Date / Time</th>
                <th style={{ width: 175 }}>Operation</th>
                <th style={{ width: 85 }}>Qty Δ</th>
                <th style={{ width: 100 }}>Status After</th>
                <th style={{ width: 130 }}>Reference</th>
                <th>Notes</th>
                <th style={{ width: 115 }}>Operator</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((e, i) => {
                const m  = getMeta(e.op_type);
                const qd = e.qty_delta != null ? Number(e.qty_delta) : null;
                return (
                  <tr key={i}>
                    <td>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {new Date(e.ts).toLocaleDateString('en-IN')}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--g400)', fontFamily: 'var(--mono)' }}>
                        {new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 10, fontSize: 10.5, fontWeight: 700,
                        background: m.bg, color: m.color, border: `1px solid ${m.border}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {m.label || e.op_type}
                      </span>
                    </td>
                    <td className="num" style={{
                      fontWeight: 700,
                      color: qd == null ? 'var(--g400)' : qd >= 0 ? '#2E7D32' : '#C62828',
                    }}>
                      {qd != null ? `${qd >= 0 ? '+' : ''}${qd.toFixed(4)}` : '—'}
                    </td>
                    <td>
                      {e.new_status
                        ? <span className={`badge ${statusCls(e.new_status)}`} style={{ fontSize: 9.5 }}>
                            {e.new_status}
                          </span>
                        : <span style={{ color: 'var(--g400)' }}>—</span>}
                    </td>
                    <td>
                      {e.ref_number
                        ? <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                            {e.ref_number}
                          </span>
                        : e.ref_type
                          ? <span style={{ fontSize: 10, color: 'var(--g400)' }}>
                              {e.ref_type}#{e.ref_id}
                            </span>
                          : <span style={{ color: 'var(--g400)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--g600)', maxWidth: 240, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                      {e.notes || <span style={{ color: 'var(--g400)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>{e.performed_by || <span style={{ color: 'var(--g400)' }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {events.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--g50)', borderTop: '1px solid var(--g200)', fontSize: 11, color: 'var(--g500)' }}>
            <span>Showing {events.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, events.length)} of {events.length} records</span>
            <Paginator page={page} totalPages={totalPages} onPage={setPage} />
          </div>
        )}
        </>
      )}
    </div>
  );
}
