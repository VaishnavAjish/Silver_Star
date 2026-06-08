import { useState, useEffect, useCallback } from 'react';
import { usePagination } from '../../../shared/hooks/usePagination';
import Paginator from '../../../shared/components/Paginator';
import { Search, Plus, Download, RefreshCw, Filter, List, TrendingUp } from 'lucide-react';

export default function StructuredGridPageTemplate() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // Mockup for API data fetching
  const fetchData = useCallback(() => {
    setLoading(true);
    // Replace with actual API call: api.get('/api/your-endpoint')
    setTimeout(() => {
      setData([
        { id: 1001, name: 'Example Record 1', status: 'Active', amount: 5000 },
        { id: 1002, name: 'Example Record 2', status: 'Draft', amount: 1200 },
      ]);
      setLoading(false);
    }, 500);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Utilizing your existing pagination hook
  const { page, setPage, paginatedItems, totalPages, pageSize } = usePagination(data, []);

  return (
    <div style={{ padding: 24, minHeight: '100%', background: 'var(--g50)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        
        {/* 1. Page Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 2px 8px rgba(13,124,95,.3)' }}>
              <List size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: 19, fontWeight: 700, color: 'var(--g900)', lineHeight: 1.25 }}>Manage Records</h1>
              <p style={{ fontSize: 12, color: 'var(--g500)', marginTop: 1 }}>View, filter, and manage all your records in one place.</p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => {}}>
            <Plus size={14} /> Add New Record
          </button>
        </div>

        {/* 2. Quick Stats / Summary Row (Optional) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--brand)' }}><TrendingUp size={18} /></div>
            <div>
              <div className="stat-val">{data.length}</div>
              <div className="stat-lbl">Total Records</div>
            </div>
          </div>
        </div>

        {/* 3. Main Data Grid Container */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--g200)', boxShadow: '0 1px 6px rgba(0,0,0,.06)', overflow: 'hidden' }}>
          
          {/* Grid Toolbar */}
          <div className="grid-toolbar" style={{ borderBottom: '1px solid var(--g200)', padding: '12px 16px', margin: 0 }}>
            <div className="filter-field">
              <div className="grid-toolbar-search">
                <Search size={14} />
                <input 
                  placeholder="Search records..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div className="grid-toolbar-right">
              <button className="btn btn-sm"><Filter size={13} /> Filter</button>
              <button className="btn btn-sm"><Download size={13} /> Export</button>
              <button className="icon-btn" onClick={fetchData} title="Refresh"><RefreshCw size={14} /></button>
            </div>
          </div>

          {/* Scrollable Table Area */}
          <div className="grid-wrap" style={{ border: 'none', maxHeight: 'calc(100vh - 280px)' }}>
            <table className="dgrid">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>ID</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="4" style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></td></tr>
                ) : paginatedItems.length === 0 ? (
                  <tr><td colSpan="4" style={{ padding: 40, textAlign: 'center', color: 'var(--g500)' }}>No records found.</td></tr>
                ) : (
                  paginatedItems.map(row => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td style={{ fontWeight: 500 }}>{row.name}</td>
                      <td><span className={`badge ${row.status === 'Active' ? 'b-active' : 'b-draft'}`}>{row.status}</span></td>
                      <td className="num">₹{row.amount.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer & Pagination */}
          {!loading && data.length > 0 && (
            <div className="grid-footer" style={{ borderTop: '1px solid var(--g200)', background: 'var(--g50)', padding: '12px 16px', margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 11, color: 'var(--g500)' }}>
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data.length)} of {data.length} records
                </span>
                <Paginator page={page} totalPages={totalPages} onPage={setPage} />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}