import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import { Plus, Eye, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { getTransfers, reverseTransfer } from '../services/transferService';

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function TransfersListPage() {
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const [transfers, setTransfers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reversing, setReversing] = useState(null);

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadTransfers = async (pg = 1) => {
    setLoading(true);
    try {
      const res = await getTransfers({ page: pg, limit: PAGE_SIZE });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch transfers');
      setTransfers(data.data || []);
      setTotal(data.meta?.total || 0);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTransfers(page); }, [page]);

  const handleReverse = async (e, row) => {
    e.stopPropagation();
    if (!window.confirm(`Reverse transfer ${row.transfer_no}? This will create a reversing Journal Entry.`)) return;
    setReversing(row.id);
    try {
      const res = await reverseTransfer(row.id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reverse transfer');
      toast.success('Transfer reversed successfully');
      loadTransfers(page);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReversing(null);
    }
  };

  const columns = [
    { key: 'transfer_no',      label: 'Transfer No', width: 130, render: v => <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{v}</span> },
    { key: 'transfer_date',    label: 'Date',         width: 110, render: v => fmtDate(v) },
    { key: 'from_account_name',label: 'From Ledger',  width: 180 },
    { key: 'to_account_name',  label: 'To Ledger',    width: 180 },
    { key: 'amount',           label: 'Amount (₹)',   width: 140, numeric: true, render: v => <span style={{ fontWeight: 600 }}>₹{fmt(v)}</span> },
    { key: 'reference_no',     label: 'Reference No', render: v => <span style={{ color: v ? 'inherit' : 'var(--g400)' }}>{v || '—'}</span> },
    { key: 'status',           label: 'Status',       width: 90,
      render: v => {
        const meta = { posted: ['#1b7e4a','#e6f5ec'], reversed: ['#b91c1c','#fef2f2'] };
        const [color, bg] = meta[v] || ['#555','#f5f5f5'];
        return (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            color, background: bg, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {v || 'posted'}
          </span>
        );
      }
    },
    { key: '_actions',         label: '',             width: 80,
      render: (_, row) => {
        const isPosted   = (row.status || 'posted') === 'posted';
        const isReversed = row.status === 'reversed';
        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="icon-btn"
              title="View"
              onClick={e => { e.stopPropagation(); navigate(`/transfers/${row.id}`); }}
            >
              <Eye size={14} />
            </button>
            <button
              className="icon-btn"
              title={isPosted && !isReversed ? 'Reverse' : 'Cannot reverse'}
              disabled={!isPosted || isReversed || reversing === row.id || !canEdit()}
              onClick={e => handleReverse(e, row)}
              style={{ color: (isPosted && !isReversed) ? '#e57373' : undefined }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        );
      }
    },
  ];

  return (
    <div className="grid-page">
      <DataGrid
        embedded
        exportTitle="Transfers"
        storageKey="transfers_cols"
        fetchExportData={async () => {
          const r = await getTransfers({ limit: 10000 });
          const json = await r.json();
          return json.data || [];
        }}
        columns={columns}
        data={transfers}
        totalRecords={total}
        page={page}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        onRefresh={() => loadTransfers(page)}
        onRowClick={row => navigate(`/transfers/${row.id}`)}
        emptyMessage="No transfers found."
        toolbarActions={
          canEdit() && (
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/transfers/new')} style={{ height: 32.73 }}>
              <Plus size={13} /> New Transfer
            </button>
          )
        }
      />
    </div>
  );
}
