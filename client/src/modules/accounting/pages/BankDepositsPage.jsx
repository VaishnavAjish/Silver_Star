import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import { CreditCard, Plus, Eye, Pencil, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

const fmt = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function BankDepositsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const [deposits, setDeposits] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [reversing, setReversing] = useState(null);

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadDeposits = (pg = 1) => {
    setLoading(true);
    api.get(`/api/bank-deposits?page=${pg}&pageSize=${PAGE_SIZE}`)
      .then(r => {
        setDeposits(r.data || []);
        setTotal(r.totalCount ?? r.total ?? 0);
      })
      .catch(err => toast.error(err.message || 'Failed to load bank deposits'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDeposits(page); }, [page]);

  const handleReverse = async (e, row) => {
    e.stopPropagation();
    if (!window.confirm(`Reverse deposit ${row.je_number || row.id}? This will create a reversing JE.`)) return;
    setReversing(row.id);
    try {
      await api.post(`/api/bank-deposits/${row.id}/reverse`, {});
      toast.success('Deposit reversed successfully');
      loadDeposits(page);
    } catch (err) {
      toast.error(err.message || 'Failed to reverse deposit');
    } finally {
      setReversing(null);
    }
  };

  const columns = [
    { key: 'date',             label: 'Date',         width: 110, render: v => fmtDate(v) },
    { key: 'bank_account_name', label: 'Bank Account', width: 160 },
    { key: 'total_amount',     label: 'Total Amount (₹)', width: 160, numeric: true,
      render: v => <span style={{ fontWeight: 600 }}>₹{fmt(v)}</span> },
    { key: 'memo',             label: 'Memo',
      render: v => <span style={{ color: v ? 'inherit' : 'var(--g400)' }}>{v || '—'}</span> },
    { key: 'created_by_name',  label: 'Created By',   width: 140 },
    { key: 'status',           label: 'Status',       width: 90,
      render: v => {
        const meta = { posted: ['#1b7e4a','#e6f5ec'], reversed: ['#b91c1c','#fef2f2'], draft: ['#b45309','#fffbeb'] };
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
    { key: '_actions',         label: '',             width: 110,
      render: (_, row) => {
        const isPosted   = (row.status || 'posted') === 'posted';
        const isReversed = row.status === 'reversed';
        const canEditRow = canEdit() && !isReversed && row.je_status !== 'posted';
        return (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="icon-btn"
              title="View"
              onClick={e => { e.stopPropagation(); navigate(`/bank-deposits/${row.id}`); }}
            >
              <Eye size={14} />
            </button>
            <button
              className="icon-btn"
              title={canEditRow ? 'Edit' : 'Cannot edit posted/reversed deposit'}
              disabled={!canEditRow}
              onClick={e => { e.stopPropagation(); navigate(`/bank-deposits/${row.id}/edit`); }}
            >
              <Pencil size={14} />
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
        exportTitle="Bank Deposits"
        storageKey="bank_deposits_cols"
        fetchExportData={async () => {
          const r = await api.get('/api/bank-deposits?limit=10000');
          return r.data || [];
        }}
        columns={columns}
        data={deposits}
        totalRecords={total}
        page={page}
        pageSize={PAGE_SIZE}
        totalPages={totalPages}
        onPageChange={setPage}
        loading={loading}
        onRefresh={() => loadDeposits(page)}
        onRowClick={row => navigate(`/bank-deposits/${row.id}`)}
        emptyMessage="No bank deposits found."
        toolbarActions={
          canEdit() && (
            <button className="btn btn-sm btn-primary" onClick={() => navigate('/bank-deposits/new')} style={{ height: 32.73 }}>
              <Plus size={13} /> New Deposit
            </button>
          )
        }
      />
    </div>
  );
}
