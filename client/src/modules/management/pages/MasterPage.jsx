import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import DataGrid from '../../../shared/components/DataGrid';
import ColumnSettings from '../../../shared/components/ColumnSettings';
import ExportMenu from '../../../shared/components/ExportMenu';
import Modal from '../../../shared/components/Modal';
import FilterBar from '../../../shared/components/FilterBar';
import { MASTER_CONFIGS } from './MasterConfigsData';
import DatePicker from '../../../shared/components/DatePicker';
import { Download, Plus, Pencil, Trash2, Save, Upload, RefreshCw, Boxes, ChevronLeft, ChevronRight } from 'lucide-react';
import Paginator from '../../../shared/components/Paginator';
import toast from 'react-hot-toast';
import './master-page.css';

const PAGE_SIZE = 500;

export default function MasterPage({ configKey }) {
  const config = MASTER_CONFIGS[configKey];
  const api = useApi();
  const { canEdit } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [apiOptions, setApiOptions] = useState({});
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [colMgr, setColMgr] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const apiSelectFields = config.fields.filter(f => f.type === 'api-select');
    apiSelectFields.forEach(f => {
      api.get(f.apiUrl).then(res => {
        setApiOptions(prev => ({ ...prev, [f.name]: res.data || res }));
      }).catch(() => {});
    });
  }, [config]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      const q = filters.search ? String(filters.search).trim() : '';
      if (q) params.set('search', q);
      
      Object.entries(filters).forEach(([key, val]) => {
        if (key !== 'search' && val) {
          params.set(key, val);
        }
      });
      
      const res = await api.get(`${config.apiUrl}?${params}`);
      if (Array.isArray(res)) {
        setData(res);
        setTotal(res.length);
      } else {
        setData(res?.data || []);
        setTotal(res?.total ?? (res?.data?.length || 0));
      }
    } catch (err) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [config.apiUrl, filters, page]);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await loadData(); } finally { setSpinning(false); }
  }, [loadData]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [filters]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const delay = filters.search ? 300 : 0;
    debounceRef.current = setTimeout(() => loadData(), delay);
    return () => clearTimeout(debounceRef.current);
  }, [loadData, filters]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ ...config.defaults });
    setModalOpen(true);
  };

  const openDetails = (row) => {
    setDetailItem(row);
    setDetailOpen(true);
  };

  const openEdit = (row) => {
    if (!canEdit()) return;
    setEditItem(row);
    const formData = {};
    config.fields.forEach(f => { formData[f.name] = row[f.name] ?? ''; });
    setForm(formData);
    setModalOpen(true);
  };

  const detailsToEdit = () => {
    if (!canEdit()) return;
    setDetailOpen(false);
    setEditItem(detailItem);
    const formData = {};
    config.fields.forEach(f => { formData[f.name] = detailItem[f.name] ?? ''; });
    setForm(formData);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      // Normalize empty strings to null for number and date fields before submission.
      // openEdit maps DB nulls to '' for all fields; without this, '' reaches PostgreSQL
      // integer/date columns and causes "invalid input syntax for type integer: ''" errors.
      const payload = {};
      config.fields.forEach(f => {
        const v = form[f.name];
        payload[f.name] = (f.type === 'number' || f.type === 'date') && v === '' ? null : v;
      });

      if (editItem) {
        await api.put(`${config.apiUrl}/${editItem.id}`, payload);
        toast.success('Updated successfully');
      } else {
        await api.post(config.apiUrl, payload);
        toast.success('Created successfully');
      }
      setModalOpen(false);
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    try {
      await api.del(`${config.apiUrl}/${id}`);
      toast.success('Deleted');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const filterFields = useMemo(() => {
    const items = [];
    const KEYS = ['category', 'type', 'status'];
    KEYS.forEach(key => {
      const fieldDef = config.fields?.find(f => f.name === key);
      if (!fieldDef || fieldDef.type !== 'select') return;
      items.push({
        key,
        label: fieldDef.label,
        type: 'select',
        options: (fieldDef.options || []).map(o => ({ value: o, label: o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
      });
    });
    return [{ key: 'search', label: 'Search', type: 'text' }, ...items];
  }, [config]);

  const filteredData = useMemo(() => {
    let rows = data;
    const q = filters.search ? String(filters.search).toLowerCase() : '';
    if (q) {
      rows = rows.filter(r =>
        config.columns.some(c =>
          c.key !== '_actions' && String(r[c.key] ?? '').toLowerCase().includes(q)
        )
      );
    }
    const active = Object.entries(filters).filter(([k, v]) => k !== 'search' && v);
    if (active.length > 0) {
      rows = rows.filter(row => active.every(([key, val]) => String(row[key] ?? '') === val));
    }
    return rows.map((row, i) => ({ ...row, _sr_no: (page - 1) * PAGE_SIZE + i + 1 }));
  }, [data, filters, config.columns, page]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const openBulkUpload = () => {
    setBulkFile(null);
    setBulkResult(null);
    setBulkOpen(true);
  };

  const downloadVendorSample = () => {
    const csv = 'code,name\nV001,ABC Traders\nV002,XYZ Impex\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vendor-bulk-upload-sample.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkUpload = async () => {
    if (!bulkFile) {
      toast.error('Select a CSV or XLSX file');
      return;
    }

    const formData = new FormData();
    formData.append('file', bulkFile);
    setBulkLoading(true);
    try {
      const result = await api.post(`${config.apiUrl}/bulk-upload`, formData);
      setBulkResult(result);
      toast.success(`Inserted ${result.inserted}, skipped ${result.skipped}`);
      loadData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBulkLoading(false);
    }
  };

  const updateField = (name, value) => setForm(prev => ({ ...prev, [name]: value }));

  return (
    <div className="master-page-wrapper">

      <div className="master-filter-container">
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          onReset={() => setFilters({})}
          fields={filterFields}
        >
          <span className="grid-count">{total > 0 ? `${total} records` : '0 records'}</span>
          {colMgr && (
            <ColumnSettings
              columns={colMgr.columns}
              visibleColumns={colMgr.visibleColumns}
              toggleColumn={colMgr.toggleColumn}
              resetLayout={colMgr.resetLayout}
              mandatoryKeys={['_actions']}
            />
          )}
          <ExportMenu
            title={config.title}
            headers={config.columns.filter(c => c.key !== '_actions').map(c => c.label)}
            fetchRows={async () => {
              const res = await api.get(`${config.apiUrl}?limit=10000`);
              return (res.data || res).map(row =>
                config.columns.filter(c => c.key !== '_actions').map(c => {
                  const v = row[c.key];
                  return typeof c.render === 'function' ? (typeof c.render(v, row) === 'string' ? c.render(v, row) : v ?? '') : v ?? '';
                })
              );
            }}
          />
          {canEdit() && (
            <button
              className="btn btn-primary"
              onClick={openCreate}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '5px 12px', height: 30 }}
            >
              <Plus size={14} />
              New {config.title}
            </button>
          )}
          <button className="icon-btn" onClick={handleRefresh} disabled={spinning}
            style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <RefreshCw size={14} />
          </button>
        </FilterBar>
      </div>

      <div className="master-grid-container">
        <DataGrid
          embedded
          hideExport
          hideRefresh
          hideRecordCount
          columns={[
            { key: '_sr_no', label: 'SR No.', width: 65, numeric: true,
              render: (_, row) => row._sr_no },
            ...config.columns,
            ...(canEdit() ? [{ key: '_actions', label: 'Actions', width: 100,
              render: (_, row) => (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(row); }} onDoubleClick={e => e.stopPropagation()} title="Edit"><Pencil size={12} /></button>
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }} onDoubleClick={e => e.stopPropagation()} style={{ color: 'var(--red)' }} title="Delete"><Trash2 size={12} /></button>
                </div>
              )
            }] : [])
          ]}
          data={filteredData}
          loading={loading}
          onRefresh={loadData}
          onRowDoubleClick={openDetails}
          hideSearch
          storageKey={`master_${configKey}_cols_v5`}
          mandatoryKeys={['_actions']}
          hideColumnSettings
          onColumnManagerReady={setColMgr}
          fixedLayout
          pageSize={PAGE_SIZE}
          totalRecords={total}
        />
      </div>
      <Paginator page={page} totalPages={Math.ceil(total / PAGE_SIZE) || 1} onPage={setPage} />

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editItem ? `Edit ${config.title}` : `New ${config.title}`}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}><Save size={14} /> Save</button>
          </>
        }
      >
        <div className="master-modal-form" style={['machines', 'departments', 'locations', 'uom', 'expense-categories'].includes(configKey) ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } : { display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {config.fields.map(f => {
            const gridLayout = ['machines', 'departments', 'locations', 'uom', 'expense-categories'].includes(configKey);
            const boxStyle = gridLayout
              ? { display: 'flex', flexDirection: 'column', gap: 3, gridColumn: f.wide ? '1 / -1' : undefined }
              : { display: 'flex', flexDirection: 'column', gap: 3, minWidth: f.wide ? '100%' : 180, flex: 1 };
            const lblStyle = gridLayout
              ? { fontSize: 11, fontWeight: 600, color: 'var(--g600)', textTransform: 'uppercase', letterSpacing: '0.05em' }
              : {};
            return (
              <div key={f.name} style={boxStyle}>
                <label style={lblStyle}>{f.label} {f.required && <span style={{ color: 'var(--red)' }}>*</span>}</label>
                {f.type === 'checkbox' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={!!form[f.name]}
                      onChange={e => updateField(f.name, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--g600)' }}>{form[f.name] ? 'Yes' : 'No'}</span>
                  </div>
                ) : f.type === 'select' ? (
                  <SelectDropdown value={form[f.name] || ''} onChange={e => updateField(f.name, e.target.value)}>
                    <option value="">— Select —</option>
                    {f.options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </SelectDropdown>
                ) : f.type === 'api-select' ? (
                  <SelectDropdown value={form[f.name] ?? ''} onChange={e => updateField(f.name, e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">— Select —</option>
                    {(apiOptions[f.name] || []).map(o => (
                      <option key={o[f.optionValue]} value={o[f.optionValue]}>{o[f.optionLabel]}</option>
                    ))}
                  </SelectDropdown>
                ) : f.type === 'date' ? (
                  <DatePicker
                    value={form[f.name] || ''}
                    onChange={v => updateField(f.name, v)}
                    placeholder={f.placeholder || 'Select date'}
                  />
                ) : f.type === 'textarea' ? (
                  <textarea value={form[f.name] || ''} onChange={e => updateField(f.name, e.target.value)} rows={2} placeholder={f.placeholder} />
                ) : (
                  <input
                    type={f.type || 'text'}
                    value={form[f.name] ?? ''}
                    onChange={e => updateField(f.name, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                    placeholder={f.placeholder}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={`${config.title} Details`}
        footer={
          <>
            <button className="btn" onClick={() => setDetailOpen(false)}>Close</button>
            {canEdit() && (
              <button className="btn btn-primary" onClick={detailsToEdit}>
                <Pencil size={14} /> Edit
              </button>
            )}
          </>
        }
      >
        {detailItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {config.columns.map(c => {
              if (c.key === '_actions') return null;
              const val = detailItem[c.key];
              return (
                <div key={c.key} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.6 }}>
                  <span style={{ fontWeight: 600, minWidth: 140, color: 'var(--g600)' }}>{c.label}</span>
                  <span>
                    {c.render ? c.render(val, detailItem) : (val ?? '—')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {configKey === 'vendors' && (
        <Modal
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title="Bulk Upload Vendors"
          footer={
            <>
              <button className="btn" onClick={() => setBulkOpen(false)}>Close</button>
              <button className="btn btn-primary" onClick={handleBulkUpload} disabled={bulkLoading}>
                <Upload size={14} /> {bulkLoading ? 'Uploading...' : 'Upload'}
              </button>
            </>
          }
        >
          <div className="fg w" style={{ marginBottom: 12 }}>
            <label>CSV or XLSX File</label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={e => setBulkFile(e.target.files?.[0] || null)}
            />
          </div>
          <button className="btn" type="button" onClick={downloadVendorSample}>
            <Download size={14} /> Download Sample
          </button>

          {bulkResult && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--g200)', paddingTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                <strong>Total: {bulkResult.total_rows}</strong>
                <strong>Inserted: {bulkResult.inserted}</strong>
                <strong>Skipped: {bulkResult.skipped}</strong>
              </div>
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 120, overflow: 'auto', fontSize: 12, color: 'var(--red)' }}>
                  {bulkResult.errors.map((err, i) => (
                    <div key={`${err.row}-${i}`}>Row {err.row}: {err.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
