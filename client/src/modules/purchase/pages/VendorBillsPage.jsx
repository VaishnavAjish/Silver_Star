import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import toast from 'react-hot-toast';

export const VendorBillsPage = () => {
  const navigate = useNavigate();
  const api = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, rowsPerPage, onPageChange, onRowsPerPageChange } = usePagination();

  const [bills, setBills] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const status = searchParams.get('status') || '';
  const search = searchParams.get('search') || '';

  const fetchBills = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/expense-bills', {
        params: { limit: rowsPerPage, offset: page * rowsPerPage, status, search }
      });
      setBills(res.data);
      setTotal(res.total);
    } catch (err) {
      console.error(err);
      toast.error('Error fetching bills');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBills();
  }, [page, rowsPerPage, status, search]);

  const onSearch = (val) => { setSearchParams({ search: val, status }); onPageChange(0); };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded shadow">
        <h1 className="text-2xl font-bold">Vendor Bills</h1>
        <div className="flex gap-4">
          <input 
            type="text" 
            placeholder="Search by Bill No or Vendor" 
            className="border p-2 rounded" 
            value={search}
            onChange={e => onSearch(e.target.value)}
          />
          <select
            className="border rounded p-2"
            value={status}
            onChange={e => { setSearchParams({ status: e.target.value, search }); onPageChange(0); }}
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={() => navigate('/purchase/bills/new')} className="bg-blue-600 text-white px-4 py-2 rounded">
            + New Bill
          </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-white rounded shadow">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="p-3">Bill No</th>
              <th className="p-3">Date</th>
              <th className="p-3">Vendor</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-4 text-center">Loading...</td></tr>
            ) : bills.length === 0 ? (
              <tr><td colSpan={5} className="p-4 text-center text-gray-500">No Bills found</td></tr>
            ) : (
              bills.map(b => (
                <tr key={b.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/purchase/bills/${b.id}`)}>
                  <td className="p-3 font-medium text-blue-600">{b.doc_number}</td>
                  <td className="p-3">{new Date(b.doc_date).toLocaleDateString()}</td>
                  <td className="p-3">{b.vendor_name}</td>
                  <td className="p-3 text-right">{parseFloat(b.grand_total).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      b.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      b.payment_status === 'PAID' ? 'bg-green-100 text-green-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {b.status === 'cancelled' ? 'CANCELLED' : b.payment_status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Paginator 
        page={page} 
        rowsPerPage={rowsPerPage} 
        total={total} 
        onPageChange={onPageChange} 
        onRowsPerPageChange={onRowsPerPageChange} 
      />
    </div>
  );
};

export const VendorBillForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const isEdit = !!id;

  const [header, setHeader] = useState({
    doc_date: new Date().toISOString().split('T')[0],
    vendor_id: '',
    department_id: '',
    cost_center_id: '',
    reference_no: '',
    remark: ''
  });
  const [lines, setLines] = useState([
    { expense_account_id: '', description: '', amount: '', department_id: '', cost_center_id: '' }
  ]);

  const [vendors, setVendors] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/vendors?limit=1000').then(res => setVendors(res.data)),
      api.get('/api/accounts?status=active&is_group=false').then(res => setAccounts((Array.isArray(res) ? res : (res?.data || [])).filter(a => a.is_posting && a.type?.toLowerCase() === 'expense'))),
      api.get('/api/departments?limit=1000').then(res => setDepartments(res.data)),
      api.get('/api/cost-centers?limit=1000').then(res => setCostCenters(res.data))
    ]);
  }, [api]);

  useEffect(() => {
    if (isEdit) {
      api.get(`/api/expense-bills/${id}`).then(res => {
        const d = res;
        setHeader({
          doc_date: d.doc_date.split('T')[0],
          vendor_id: d.vendor_id || '',
          department_id: d.department_id || '',
          cost_center_id: d.cost_center_id || '',
          reference_no: d.reference_no || '',
          remark: d.remark || '',
          doc_number: d.doc_number,
          status: d.status,
          payment_status: d.payment_status
        });
        if (d.lines && d.lines.length > 0) {
          setLines(d.lines.map(l => ({
            expense_account_id: l.expense_account_id || '',
            description: l.description || '',
            amount: l.amount || '',
            department_id: l.department_id || '',
            cost_center_id: l.cost_center_id || ''
          })));
        }
      });
    }
  }, [id, isEdit, api]);

  const grandTotal = lines.reduce((sum, line) => sum + (parseFloat(line.amount) || 0), 0);

  const handleSave = async () => {
    if (!header.doc_date || !header.vendor_id) return toast.error('Date and Vendor are required');
    const validLines = lines.filter(l => l.expense_account_id && parseFloat(l.amount) > 0);
    if (validLines.length === 0) return toast.error('At least one valid line is required (Category and Amount > 0)');

    setLoading(true);
    try {
      if (isEdit) {
        toast.error('Editing bills is not supported. Please cancel and create a new one if necessary.');
      } else {
        await api.post('/api/expense-bills', { ...header, lines: validLines });
        navigate('/purchase/bills');
        toast.success('Bill saved');
      }
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!window.confirm('Cancel this bill?')) return;
    try {
      await api.delete(`/api/expense-bills/${id}`);
      navigate('/purchase/bills');
      toast.success('Bill cancelled');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{isEdit ? `Bill ${header.doc_number || ''}` : 'New Vendor Bill'}</h1>
        <div className="flex gap-2">
          <button onClick={() => navigate('/purchase/bills')} className="px-4 py-2 border rounded bg-white">Cancel</button>
          {isEdit && header.status !== 'cancelled' && (
            <button onClick={handleDelete} className="px-4 py-2 bg-red-600 text-white rounded">Cancel Bill</button>
          )}
          {!isEdit && (
            <button onClick={handleSave} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
              {loading ? 'Saving...' : 'Save Bill'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Vendor *</label>
          <select 
            value={header.vendor_id} 
            onChange={e => setHeader({...header, vendor_id: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          >
            <option value="">Select Vendor</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date *</label>
          <input 
            type="date" 
            value={header.doc_date} 
            onChange={e => setHeader({...header, doc_date: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Reference No</label>
          <input 
            type="text" 
            value={header.reference_no} 
            onChange={e => setHeader({...header, reference_no: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Department</label>
          <select 
            value={header.department_id} 
            onChange={e => setHeader({...header, department_id: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          >
            <option value="">-- None --</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cost Center</label>
          <select 
            value={header.cost_center_id} 
            onChange={e => setHeader({...header, cost_center_id: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          >
            <option value="">-- None --</option>
            {costCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="block text-sm font-medium mb-1">Memo / Remark</label>
          <input 
            type="text" 
            value={header.remark} 
            onChange={e => setHeader({...header, remark: e.target.value})}
            className="w-full border p-2 rounded"
            disabled={isEdit}
          />
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-bold mb-4">Expense Details</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="p-2 w-1/4">Category (Account) *</th>
              <th className="p-2 w-1/4">Description</th>
              <th className="p-2 w-1/6">Department</th>
              <th className="p-2 w-1/6">Cost Center</th>
              <th className="p-2 w-1/6 text-right">Amount *</th>
              {!isEdit && <th className="p-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="border-b">
                <td className="p-2">
                  <select 
                    value={line.expense_account_id}
                    onChange={e => {
                      const newLines = [...lines];
                      newLines[i].expense_account_id = e.target.value;
                      setLines(newLines);
                    }}
                    className="w-full border p-2 rounded"
                    disabled={isEdit}
                  >
                    <option value="">Select Category...</option>
                    {accounts.filter(a => a.is_posting).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input 
                    type="text" 
                    value={line.description}
                    onChange={e => {
                      const newLines = [...lines];
                      newLines[i].description = e.target.value;
                      setLines(newLines);
                    }}
                    className="w-full border p-2 rounded"
                    placeholder="Description"
                    disabled={isEdit}
                  />
                </td>
                <td className="p-2">
                  <select 
                    value={line.department_id}
                    onChange={e => {
                      const newLines = [...lines];
                      newLines[i].department_id = e.target.value;
                      setLines(newLines);
                    }}
                    className="w-full border p-2 rounded"
                    disabled={isEdit}
                  >
                    <option value="">Default</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <select 
                    value={line.cost_center_id}
                    onChange={e => {
                      const newLines = [...lines];
                      newLines[i].cost_center_id = e.target.value;
                      setLines(newLines);
                    }}
                    className="w-full border p-2 rounded"
                    disabled={isEdit}
                  >
                    <option value="">Default</option>
                    {costCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <input 
                    type="number" 
                    value={line.amount}
                    onChange={e => {
                      const newLines = [...lines];
                      newLines[i].amount = e.target.value;
                      setLines(newLines);
                    }}
                    className="w-full border p-2 rounded text-right"
                    placeholder="0.00"
                    disabled={isEdit}
                  />
                </td>
                {!isEdit && (
                  <td className="p-2 text-center">
                    <button 
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      className="text-red-500 font-bold px-2"
                    >×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        
        <div className="flex justify-between items-center mt-4">
          {!isEdit ? (
            <button 
              onClick={() => setLines([...lines, { expense_account_id: '', description: '', amount: '', department_id: '', cost_center_id: '' }])}
              className="text-blue-600 font-medium"
            >
              + Add Line
            </button>
          ) : <div></div>}
          <div className="text-xl font-bold">
            Total: {grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
          </div>
        </div>
      </div>
    </div>
  );
};
