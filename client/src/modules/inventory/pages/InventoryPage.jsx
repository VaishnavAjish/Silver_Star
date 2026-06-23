import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import Paginator from '../../../shared/components/Paginator';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useInventorySync } from '../../../shared/hooks/useModuleSync';
import { useClipboard } from '../../../core/context/ClipboardContext';
import { exportToCSV, printTable } from '../../../shared/utils/exportUtils';
import ColumnLayoutPanel from '../../../core/layout/ColumnLayoutPanel';
import useResizableColumns from '../../../shared/hooks/useResizableColumns';
import {
  Search, Package, RefreshCw, GitBranch, GitMerge,
  MoreVertical, X, Filter, ChevronLeft, ChevronRight,
  CheckSquare, Square, Share2, Download, Printer, Columns, Send, ChevronDown,
  History, RotateCcw, CheckCircle
} from 'lucide-react';
import DatePicker from '../../../shared/components/DatePicker';
import StockTransferHistoryModal from '../../../shared/components/Modals/StockTransferHistoryModal';
import SplitLotPage from './SplitLotPage';
import LotIssuePage from './LotIssuePage';
import MixLotsPage from './MixLotsPage';
import { getAllowedActions } from '../utils/actionMatrix';

const ALL_COLS = [
  { key: 'item_name', label: 'Item' },
  { key: 'lot_op_id', label: 'Lot ID', width: 90, num: true },
  { key: 'lot_code', label: 'Lot Name', width: 120 },
  { key: 'parent_lot_name', label: 'Parent Lot', width: 110 },
  { key: 'root_lot_name', label: 'Root Lot', width: 110 },
  { key: 'category', label: 'Category', width: 90 },
  { key: 'current_process_name', label: 'Process', width: 130 },
  { key: 'operation_type', label: 'Op. Type', width: 80 },
  { key: 'split_level', label: 'Level', width: 55 },
  { key: 'status', label: 'Status', width: 90 },
  { key: 'qty', label: 'Qty', width: 65, num: true },
  { key: 'unit', label: 'Unit', width: 50 },
  { key: 'weight', label: 'Weight', width: 75, num: true },
  { key: 'rate', label: 'Rate (₹)', width: 90, num: true },
  { key: 'total_value', label: 'Value (₹)', width: 105, num: true },
  { key: 'source_module', label: 'Location', width: 130 },
  { key: 'dept_location_name', label: 'Department Name', width: 100 },
  { key: 'vendor_name', label: 'Vendor', width: 100 },
  { key: 'batch_no', label: 'Batch', width: 80 },
  { key: 'purchase_date', label: 'Date', width: 90 },
  { key: 'genealogy_path', label: 'Genealogy', width: 180 },
  { key: 'dim_length', label: 'Length', width: 65, num: true },
  { key: 'dim_depth', label: 'Depth', width: 65, num: true },
  { key: 'dim_height', label: 'Height', width: 65, num: true },
  { key: 'dim_preview', label: 'Dimensions', width: 130 },
];
const COL_MAP = Object.fromEntries(ALL_COLS.map(c => [c.key, c]));

import { SYSTEM_TEMPLATES, initActiveTemplateId, loadUserTemplates, loadColOverrides } from '../../../shared/utils/templateUtils';

const COL_TO_SORT = {
  item_name: 'name',
  lot_op_id: 'lot_op_id',
  lot_code: 'lot_name',
  qty: 'qty',
  weight: 'weight',
  total_value: 'value',
  rate: 'value',
  location_name:    'location',
  source_module:    'dept',
  dept_location_name: 'dept_loc',
  vendor_name: 'vendor',
  status: 'status',
  operation_type: 'op_type',
  split_level: 'level',
  purchase_date: 'date',
  dim_length: 'dim_length',
  dim_depth: 'dim_depth',
  dim_height: 'dim_height',
};

const catBadge = { seed: 'b-stock', gas: 'b-draft', consumable: 'b-process', rough: 'b-cancelled', growth_run: 'b-completed' };
const opBadge = { purchase: 'b-active', split: 'b-draft', mix: 'b-process', issue: 'b-draft', return: 'b-stock' };
const statusCls = s =>
  s === 'IN STOCK' ? 'b-stock' :
    s === 'IN PROCESS' ? 'b-process' :
      s === 'CONSUMED' ? 'b-inactive' :
        s === 'SOLD' ? 'b-active' :
          s === 'DAMAGED' ? 'b-cancelled' :
            s === 'ARCHIVED' ? 'b-draft' : 'b-inactive';

const CHIPS = [
  { label: 'Active', key: 'status', value: 'IN STOCK' },
  { label: 'In Process', key: 'status', value: 'IN PROCESS' },
  { label: 'Damaged', key: 'status', value: 'DAMAGED' },
  { label: 'Consumed', key: 'status', value: 'CONSUMED' },
  { label: 'Split History', key: 'split_only', value: 'true' },
  { label: 'Mixed Lots', key: 'mix_only', value: 'true' },
];

const PAGE_SIZE = 500;

export default function InventoryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [urlParams, setUrlParams] = useSearchParams();

  const [search, setSearch] = useState(urlParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(urlParams.get('q') || '');
  const [catFilter, setCatFilter] = useState(urlParams.get('cat') || '');
  const [statusFilt, setStatusFilt] = useState(urlParams.get('status') || '');
  const [opType, setOpType] = useState(urlParams.get('op') || '');
  const [processFilter, setProcessFilter] = useState(urlParams.get('process') || '');
  const [sortBy, setSortBy] = useState(urlParams.get('sort') || 'lot_op_id');
  const [sortDir, setSortDir] = useState(urlParams.get('sort_dir') || 'desc');
  const [dateFrom, setDateFrom] = useState(urlParams.get('from') || '');
  const [dateTo, setDateTo] = useState(urlParams.get('to') || '');
  const [mixOnly, setMixOnly] = useState(urlParams.get('mix') === 'true');
  const [splitOnly, setSplitOnly] = useState(urlParams.get('split') === 'true');
  const [vendorFilter, setVendorFilter] = useState(urlParams.get('vendor') || '');
  const [locationFilter, setLocationFilter] = useState(urlParams.get('location_id') || '');
  const [accountBaseFilter, setAccountBaseFilter] = useState(urlParams.get('account_base_id') || '');
  const [qtyMin, setQtyMin] = useState(urlParams.get('qty_min') || '');
  const [qtyMax, setQtyMax] = useState(urlParams.get('qty_max') || '');
  const [weightMin, setWeightMin] = useState(urlParams.get('wt_min') || '');
  const [weightMax, setWeightMax] = useState(urlParams.get('wt_max') || '');
  const [page, setPage] = useState(parseInt(urlParams.get('page') || '1'));

  const [activeTemplateId, setActiveTemplateId] = useState(initActiveTemplateId);
  const [userTemplates, setUserTemplates] = useState(loadUserTemplates);
  const [colOverrides, setColOverrides] = useState(loadColOverrides);
  const [defaultTemplateId, setDefaultTemplateId] = useState(
    () => localStorage.getItem('inv_default_template') || 'basic'
  );

  const [dbTemplates, setDbTemplates] = useState([]);
  const fetchTemplates = useCallback(async () => {
    try {
      // Migrate old localStorage templates
      const oldLocalStr = localStorage.getItem('inv_templates');
      const migrated = localStorage.getItem('inv_templates_migrated');
      if (oldLocalStr && !migrated) {
        try {
          const oldTemplates = JSON.parse(oldLocalStr);
          if (Array.isArray(oldTemplates)) {
            for (const t of oldTemplates) {
              await api.post('/api/inventory-templates', {
                name: t.label || 'Migrated Template',
                columns_config: t.cols || [],
                filters_config: t.filters || {}
              }).catch(() => {});
            }
          }
          localStorage.setItem('inv_templates_migrated', 'true');
        } catch (e) { console.error('Migration failed', e); }
      }

      const res = await api.get('/api/inventory-templates');
      if (Array.isArray(res)) {
        setDbTemplates(res);
        setUserTemplates(res.map(t => ({
          id: t.id.toString(),
          label: t.name,
          cols: t.columns_config,
          filters: t.filters_config,
          isSystem: false,
          isGlobal: t.is_global,
          author: t.first_name ? `${t.first_name} ${t.last_name || ''}`.trim() : null
        })));
      }
    } catch (err) { console.error(err); }
  }, [api]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const [showLayoutPanel, setShowLayoutPanel] = useState(false);
  const [mixSelected, setMixSelected] = useState(new Set());
  const [actionMenu, setActionMenu] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [accountBases, setAccountBases] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ qty: 0, value: 0 });
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const [pendingLotIds, setPendingLotIds] = useState(new Set());
  const [activeModal, setActiveModal] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [actionsOpen]);

  const debounceRef = useRef(null);
  const searchRef = useRef(null);
  const gridWrapRef = useRef(null);
  useResizableColumns(gridWrapRef, 'inventory');
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => gridWrapRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });
  
  const { addMultiple, items: clipboardItems, openStockTransferModal } = useClipboard();
  const location = useLocation();
  const currentPath = location.pathname;
  const isClipboardMode = currentPath.includes('clipboard-data') || urlParams.get('clipboard_mode') === 'true';

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (window.getSelection().toString().trim()) return;
        const active = document.activeElement;
        if (['INPUT', 'TEXTAREA'].includes(active.tagName) && active.type !== 'checkbox') return;
        const selectedLots = data.filter(r => mixSelected.has(r.id));
        if (selectedLots.length > 0) {
          e.preventDefault();
          const lotsToCopy = selectedLots;

          const clipboardSet = new Set(clipboardItems.filter(c => c.entity_type === 'inventory').map(c => String(c.entity_id)));
          const newLotsToCopy = lotsToCopy.filter(lot => !clipboardSet.has(String(lot.id)));

          if (newLotsToCopy.length === 0) {
            toast('Already in clipboard');
          } else {
            const itemsToAdd = newLotsToCopy.map(lot => ({
              entity_type: 'inventory',
              entity_id: lot.id,
              label: lot.lot_code || lot.lot_number || `Lot ${lot.lot_op_id}`,
              ...lot
            }));
            addMultiple(itemsToAdd);
            if (newLotsToCopy.length < lotsToCopy.length) {
              toast(`Added ${newLotsToCopy.length} lots. (${lotsToCopy.length - newLotsToCopy.length} already in clipboard)`);
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mixSelected, data, addMultiple, clipboardItems]);

  const allTemplates = useMemo(
    () => [...Object.values(SYSTEM_TEMPLATES), ...userTemplates],
    [userTemplates]
  );

  const activeColKeys = useMemo(() => {
    if (colOverrides[activeTemplateId]) return colOverrides[activeTemplateId];
    const sys = SYSTEM_TEMPLATES[activeTemplateId];
    if (sys) return sys.cols;
    const usr = userTemplates.find(t => t.id === activeTemplateId);
    if (usr) return usr.cols;
    return SYSTEM_TEMPLATES.basic.cols;
  }, [activeTemplateId, colOverrides, userTemplates]);

  const activeCols = useMemo(
    () => activeColKeys.map(k => COL_MAP[k]).filter(Boolean),
    [activeColKeys]
  );

  useEffect(() => {
    api.get('/api/inventory/filters/active')
      .then(r => {
        setLocations(r.locations || []);
        setAccountBases(r.accountBases || []);
        setVendors(r.vendors || []);
        setProcesses(r.processes || []);
      })
      .catch(() => { });
  }, []);
  const syncUrl = useCallback((overrides = {}) => {
    const state = {
      q: search, cat: catFilter, status: statusFilt, op: opType, process: processFilter,
      sort: sortBy, sort_dir: sortDir !== 'desc' ? sortDir : '',
      from: dateFrom, to: dateTo,
      mix: mixOnly ? 'true' : '', split: splitOnly ? 'true' : '',
      vendor: vendorFilter, location_id: locationFilter, account_base_id: accountBaseFilter,
      qty_min: qtyMin, qty_max: qtyMax, wt_min: weightMin, wt_max: weightMax,
      page: page > 1 ? String(page) : '',
      ...overrides,
    };
    const p = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) p.set(k, v); });
    setUrlParams(p, { replace: true });
  }, [search, catFilter, statusFilt, opType, processFilter, sortBy, sortDir, dateFrom, dateTo,
    mixOnly, splitOnly, vendorFilter, locationFilter, accountBaseFilter, qtyMin, qtyMax, weightMin, weightMax, page]);

  const loadRef = useRef(0);

  const load = useCallback(async (append = false) => {
    const currentLoad = ++loadRef.current;
    setLoading(true);
    try {
      if (isClipboardMode) {
        const cData = clipboardItems.filter(c => c.entity_type === 'inventory').map(c => ({ ...c, id: c.entity_id }));
        setData(cData);
        setTotal(cData.length);
        setTotals({
          qty: cData.reduce((sum, item) => sum + (parseFloat(item.qty) || 0), 0),
          value: cData.reduce((sum, item) => sum + (parseFloat(item.total_value) || 0), 0)
        });
        return;
      }

      const ps = PAGE_SIZE;
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      // Multi-select filters: only apply if NOT all options selected
      const ALL_STATUSES = ['IN STOCK','IN PROCESS','CONSUMED','SOLD','DAMAGED','ARCHIVED'];
      const ALL_CATS = ['seed','gas','consumable','rough','growth_run'];
      const ALL_OPS = ['purchase','split','mix','issue','return'];
      const statusVals = statusFilt ? statusFilt.split(',').filter(Boolean) : [];
      const catVals = catFilter ? catFilter.split(',').filter(Boolean) : [];
      const opVals = opType ? opType.split(',').filter(Boolean) : [];
      const statusIsAll = statusVals.length === 0 || statusVals.length >= ALL_STATUSES.length;
      const catIsAll = catVals.length === 0 || catVals.length >= ALL_CATS.length;
      const opIsAll = opVals.length === 0 || opVals.length >= ALL_OPS.length;
      if (!catIsAll && catVals.length === 1) p.set('category', catVals[0]);
      if (!statusIsAll && statusVals.length === 1) p.set('status', statusVals[0]);
      if (!opIsAll && opVals.length === 1) p.set('operation_type', opVals[0]);
      if (sortBy) p.set('sort_by', sortBy);
      if (sortDir) p.set('sort_dir', sortDir);
      if (dateFrom) p.set('date_from', dateFrom);
      if (dateTo) p.set('date_to', dateTo);
      if (mixOnly) p.set('mix_only', 'true');
      if (splitOnly) p.set('split_only', 'true');
      if (processFilter) p.set('process_type', processFilter);
      if (vendorFilter) p.set('vendor_id', vendorFilter);
      if (locationFilter) p.set('location_id', locationFilter);
      if (accountBaseFilter) p.set('account_base_id', accountBaseFilter);
      if (qtyMin !== '') p.set('qty_min', qtyMin);
      if (qtyMax !== '') p.set('qty_max', qtyMax);
      if (weightMin !== '') p.set('weight_min', weightMin);
      if (weightMax !== '') p.set('weight_max', weightMax);
      p.set('page', String(page));
      p.set('pageSize', String(ps));
      const res = await api.get(`/api/inventory?${p}`);
      if (currentLoad !== loadRef.current) return;
      const newRows = res.data || [];
      setData(newRows);
      setTotal(res.total || 0);
      setTotals(res.totals || { qty: 0, value: 0 });
    } catch { }
    finally { setLoading(false); }
  }, [page, search, catFilter, statusFilt, opType, processFilter, sortBy, sortDir,
    dateFrom, dateTo, mixOnly, splitOnly, vendorFilter, locationFilter, accountBaseFilter, qtyMin, qtyMax, weightMin, weightMax, isClipboardMode, clipboardItems]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { syncUrl(); }, [search, catFilter, statusFilt, opType, processFilter, sortBy, sortDir,
    dateFrom, dateTo, mixOnly, splitOnly, vendorFilter, locationFilter, accountBaseFilter, qtyMin, qtyMax, weightMin, weightMax, page]);

  const loadPending = useCallback(async () => {
    try {
      const res = await api.get('/api/stock-transfer/pending');
      const all = res.data || res || [];
      const ids = new Set();
      all
        .filter(t => t.status?.toLowerCase() === 'pending')
        .forEach(t => (t.lots || []).forEach(l => ids.add(l.lot_id)));
      setPendingLotIds(ids);
    } catch {}
  }, [api]);



  useEffect(() => {
    loadPending();
    const handleTransferUpdated = () => { loadPending(); load(); };
    window.addEventListener('pending_transfers_updated', handleTransferUpdated);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') { load(); loadPending(); }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pending_transfers_updated', handleTransferUpdated);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadPending, load]);

  useInventorySync(() => {
    load();
    loadPending();
  });

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    try { await load(); } finally { setSpinning(false); }
  }, [load]);

  useEffect(() => {
    const close = () => setActionMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const fset = setter => v => { setter(v); setPage(1); };

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSearch = v => { setSearchInput(v); };
  const handleSearchClear = () => {
    if (searchRef.current) searchRef.current.value = '';
    setSearchInput('');
  };

  const applyChip = chip => {
    if (chip.key === 'status') {
      fset(setStatusFilt)(statusFilt === chip.value ? '' : chip.value);
      setMixOnly(false); setSplitOnly(false);
    } else if (chip.key === 'split_only') {
      fset(setSplitOnly)(!splitOnly);
      setMixOnly(false); setStatusFilt('');
    } else if (chip.key === 'mix_only') {
      fset(setMixOnly)(!mixOnly);
      setSplitOnly(false); setStatusFilt('');
    }
  };

  const isChipActive = chip => {
    if (chip.key === 'status') return statusFilt === chip.value;
    if (chip.key === 'split_only') return splitOnly;
    if (chip.key === 'mix_only') return mixOnly;
    return false;
  };

  const clearAllFilters = () => {
    if (searchRef.current) searchRef.current.value = '';
    setSearch(''); setSearchInput(''); setCatFilter(''); setStatusFilt(''); setOpType(''); setProcessFilter('');
    setSortBy(''); setSortDir('desc'); setDateFrom(''); setDateTo('');
    setMixOnly(false); setSplitOnly(false);
    setVendorFilter(''); setLocationFilter(''); setAccountBaseFilter('');
    setQtyMin(''); setQtyMax(''); setWeightMin(''); setWeightMax('');
    setPage(1);
  };

  const sortActive = sortBy !== 'lot_op_id';
  const hasFilters = !!(search || catFilter || statusFilt || opType || processFilter || sortActive ||
    dateFrom || dateTo || mixOnly || splitOnly ||
    vendorFilter || locationFilter || accountBaseFilter || qtyMin || qtyMax || weightMin || weightMax);

  const handleSortClick = colKey => {
    const apiKey = COL_TO_SORT[colKey];
    if (!apiKey) return;
    if (sortBy === apiKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(apiKey);
      setSortDir('desc');
    }
    setPage(1);
  };

  const handleColKeysChange = keys => {
    const next = { ...colOverrides, [activeTemplateId]: keys };
    setColOverrides(next);
    localStorage.setItem('inv_col_overrides_v2', JSON.stringify(next));
  };

  const handleTemplateSelect = id => {
    setActiveTemplateId(id);
    localStorage.setItem('inv_active_template_v2', id);
    const tmpl = allTemplates.find(t => t.id === id);
    if (tmpl && tmpl.filters) {
      const f = tmpl.filters;
      setSearch(f.search || ''); setSearchInput(f.search || '');
      setCatFilter(f.catFilter || ''); setStatusFilt(f.statusFilt || '');
      setOpType(f.opType || ''); setProcessFilter(f.processFilter || '');
      setSortBy(f.sortBy || 'lot_op_id'); setSortDir(f.sortDir || 'desc');
      setDateFrom(f.dateFrom || ''); setDateTo(f.dateTo || '');
      setMixOnly(!!f.mixOnly); setSplitOnly(!!f.splitOnly);
      setVendorFilter(f.vendorFilter || ''); setLocationFilter(f.locationFilter || '');
      setAccountBaseFilter(f.accountBaseFilter || '');
      setQtyMin(f.qtyMin || ''); setQtyMax(f.qtyMax || '');
      setWeightMin(f.weightMin || ''); setWeightMax(f.weightMax || '');
    }
  };

  const getCurrentFilters = () => ({
    search, catFilter, statusFilt, opType, processFilter, sortBy, sortDir, 
    dateFrom, dateTo, mixOnly, splitOnly, vendorFilter, locationFilter, 
    accountBaseFilter, qtyMin, qtyMax, weightMin, weightMax
  });

  const handleSaveAsNew = async name => {
    const res = await toast.promise(api.post('/api/inventory-templates', {
      name,
      columns_config: activeColKeys,
      filters_config: getCurrentFilters(),
      is_global: false
    }), { loading: 'Saving template...', success: 'Template saved', error: 'Failed to save' });
    if (res) {
      await fetchTemplates();
      handleTemplateSelect(res.id.toString());
    }
  };

  const handleUpdateTemplate = async id => {
    const isUser = userTemplates.find(t => t.id === id);
    if (!isUser) return;
    const res = await toast.promise(api.put(`/api/inventory-templates/${id}`, {
      columns_config: activeColKeys,
      filters_config: getCurrentFilters()
    }), { loading: 'Updating...', success: 'Template updated', error: 'Failed to update' });
    if (res) {
      const nextOverrides = { ...colOverrides };
      delete nextOverrides[id];
      setColOverrides(nextOverrides);
      localStorage.setItem('inv_col_overrides_v2', JSON.stringify(nextOverrides));
      fetchTemplates();
    }
  };

  const handleDeleteTemplate = async id => {
    if (SYSTEM_TEMPLATES[id]) return;
    await toast.promise(api.delete(`/api/inventory-templates/${id}`), {
      loading: 'Deleting...', success: 'Template deleted', error: 'Failed to delete'
    });
    await fetchTemplates();
    if (activeTemplateId === id) handleTemplateSelect(defaultTemplateId || 'basic');
  };

  const handleDuplicateTemplate = async id => {
    const tmpl = allTemplates.find(t => t.id === id);
    if (!tmpl) return;
    const cols = colOverrides[id] || tmpl.cols || SYSTEM_TEMPLATES.basic.cols;
    const filters = tmpl.filters || getCurrentFilters();
    const res = await toast.promise(api.post('/api/inventory-templates', {
      name: `${tmpl.label} (copy)`,
      columns_config: cols,
      filters_config: filters,
      is_global: false
    }), { loading: 'Duplicating...', success: 'Template duplicated', error: 'Failed to duplicate' });
    if (res) {
      await fetchTemplates();
      handleTemplateSelect(res.id.toString());
    }
  };

  const handleRenameTemplate = async (id, newName) => {
    if (SYSTEM_TEMPLATES[id]) return;
    await toast.promise(api.put(`/api/inventory-templates/${id}`, { name: newName }), {
      loading: 'Renaming...', success: 'Template renamed', error: 'Failed to rename'
    });
    fetchTemplates();
  };

  const handleSetDefault = id => {
    setDefaultTemplateId(id);
    localStorage.setItem('inv_default_template', id);
  };

  const toggleMix = (id, e) => {
    e?.stopPropagation();
    const row = data.find(r => r.id === id);
    if (row && row.status !== 'IN STOCK') return;
    setMixSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectedLots = data.filter(r => mixSelected.has(r.id));
  const selectedTransferRows = useMemo(() => data.filter(r => mixSelected.has(r.id)), [data, mixSelected]);
  const mixItemIds = [...new Set(selectedLots.map(r => r.item_id))];
  const mixValid = mixSelected.size >= 2 && mixItemIds.length === 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allVisibleSelected = data.length > 0 && data.every(r => mixSelected.has(r.id));
  const someVisibleSelected = data.some(r => mixSelected.has(r.id));

  const handleHeaderSelect = useCallback(() => {
    if (allVisibleSelected) {
      setMixSelected(prev => {
        const next = new Set(prev);
        data.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setMixSelected(prev => {
        const next = new Set(prev);
        data.filter(r => r.status === 'IN STOCK').forEach(r => next.add(r.id));
        return next;
      });
    }
  }, [allVisibleSelected, data]);

  const handleExport = async (format) => {
    setExporting(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      const _ALL_STATUSES = ['IN STOCK','IN PROCESS','CONSUMED','SOLD','DAMAGED','ARCHIVED'];
      const _ALL_CATS = ['seed','gas','consumable','rough','growth_run'];
      const _ALL_OPS = ['purchase','split','mix','issue','return'];
      const _statusVals = statusFilt ? statusFilt.split(',').filter(Boolean) : [];
      const _catVals = catFilter ? catFilter.split(',').filter(Boolean) : [];
      const _opVals = opType ? opType.split(',').filter(Boolean) : [];
      if (_catVals.length > 0 && _catVals.length < _ALL_CATS.length) p.set('category', _catVals[0]);
      if (_statusVals.length > 0 && _statusVals.length < _ALL_STATUSES.length) p.set('status', _statusVals[0]);
      if (_opVals.length > 0 && _opVals.length < _ALL_OPS.length) p.set('operation_type', _opVals[0]);
      if (sortBy) p.set('sort_by', sortBy);
      if (sortDir) p.set('sort_dir', sortDir);
      if (dateFrom) p.set('date_from', dateFrom);
      if (dateTo) p.set('date_to', dateTo);
      if (mixOnly) p.set('mix_only', 'true');
      if (splitOnly) p.set('split_only', 'true');
      if (vendorFilter) p.set('vendor_id', vendorFilter);
      if (qtyMin !== '') p.set('qty_min', qtyMin);
      if (qtyMax !== '') p.set('qty_max', qtyMax);
      if (weightMin !== '') p.set('weight_min', weightMin);
      if (weightMax !== '') p.set('weight_max', weightMax);
      p.set('limit', '5000'); p.set('offset', '0');
      const res = await api.get(`/api/inventory?${p}`);
      const rows = res.data || [];

      const headers = activeCols.map(c => c.label);
      const csvRows = rows.map(row => activeCols.map(col => {
        const v = row[col.key];
        if (col.key === 'lot_code') return row.lot_code || row.lot_number;
        if (col.key === 'purchase_date') return v ? new Date(v).toLocaleDateString('en-IN') : '';
        if (col.key === 'genealogy_path') return v || '';
        if (col.key === 'weight') return parseFloat(v || 0) > 0 ? parseFloat(v).toFixed(4) : '';
        if (col.key === 'dim_preview') {
          const l = row.dim_length, d = row.dim_depth, h = row.dim_height;
          if (l == null && d == null && h == null) return '';
          const fv = x => x != null ? parseFloat(x) : '?';
          return `${fv(l)} x ${fv(d)} x ${fv(h)}${row.dim_unit ? ' ' + row.dim_unit : ''}`;
        }
        if (col.key === 'lot_op_id') return v != null ? String(v) : '';
        if (col.key === 'parent_lot_name' || col.key === 'root_lot_name') return v || '';
        if (col.key === 'dim_length' || col.key === 'dim_depth' || col.key === 'dim_height')
          return v != null ? String(parseFloat(v)) : '';
        return v != null ? String(v) : '';
      }));

      const subtitle = `${total} records · Exported ${new Date().toLocaleString('en-IN')}`;
      if (format === 'csv') {
        exportToCSV(`inventory-${new Date().toISOString().split('T')[0]}.csv`, headers, csvRows);
      } else {
        printTable('Inventory Report', subtitle, headers, csvRows);
      }
    } catch { }
    finally { setExporting(false); }
  };

  const renderCell = (col, row) => {
    switch (col.key) {
      case 'item_name':
        return <span style={{ fontWeight: 600, color: 'var(--g900)' }}>{row.item_name || '—'}</span>;
      case 'lot_op_id':
        return row.lot_op_id != null
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)', letterSpacing: 1 }}>{row.lot_op_id}</span>
          : '—';
      case 'lot_code':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="cell-link" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
              {row.lot_code || row.lot_number}
            </span>
            {pendingLotIds.has(row.id) && (
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', fontWeight: 600, whiteSpace: 'nowrap' }}>
                In Transfer
              </span>
            )}
          </span>
        );
      case 'parent_lot_name':
        return row.parent_lot_name
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)' }}>{row.parent_lot_name}</span>
          : '—';
      case 'root_lot_name':
        return row.root_lot_name
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g600)' }}>{row.root_lot_name}</span>
          : '—';
      case 'category': {
        const cat = row.category || row.item_category;
        return cat
          ? <span className={`badge ${catBadge[cat] || 'b-draft'}`}>{cat}</span>
          : '—';
      }
      case 'current_process_name':
        return row.status === 'IN PROCESS' && row.current_process_name
          ? <span className="badge" style={{ background: '#E0F2FE', color: '#0369A1', borderColor: '#BAE6FD' }}>{row.current_process_name}</span>
          : '—';
      case 'source_module':
        return (row.location_name || row.dept_location_name)
          ? <span style={{ fontSize: 11, color: 'var(--g700)', fontWeight: 500 }}>{row.location_name || row.dept_location_name}</span>
          : row.source_module
            ? <span style={{ fontSize: 11, color: 'var(--g500)', fontWeight: 400 }}>{row.source_module.charAt(0).toUpperCase() + row.source_module.slice(1)}</span>
            : '—';
      case 'dept_location_name':
        return row.dept_location_name
          ? <span style={{ fontSize: 11, color: 'var(--g700)', fontWeight: 500 }}>{row.dept_location_name}</span>
          : '—';
      case 'operation_type':
        return row.operation_type
          ? <span className={`badge ${opBadge[row.operation_type] || 'b-draft'}`}>{row.operation_type}</span>
          : '—';
      case 'status':
        return <span className={`badge ${statusCls(row.status)}`}>{row.status}</span>;
      case 'split_level':
        return row.split_level != null ? `L${row.split_level}` : '—';
      case 'qty':
        return <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{row.qty}</span>;
      case 'weight':
        return row.weight && parseFloat(row.weight) > 0
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{parseFloat(row.weight).toFixed(4)}</span>
          : '—';
      case 'rate':
        return <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>₹{Number(row.rate || 0).toLocaleString('en-IN')}</span>;
      case 'total_value':
        return <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 }}>₹{Number(row.total_value || 0).toLocaleString('en-IN')}</span>;
      case 'purchase_date':
        return row.purchase_date ? new Date(row.purchase_date).toLocaleDateString('en-IN') : '—';
      case 'genealogy_path': {
        const gp = row.genealogy_path;
        if (!gp) return '—';
        const display = gp.length > 28 ? '…' + gp.slice(-24) : gp;
        return <span title={gp} style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--g500)' }}>{display}</span>;
      }
      case 'dim_length':
        return row.dim_length != null
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{parseFloat(row.dim_length)}</span>
          : '—';
      case 'dim_depth':
        return row.dim_depth != null
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{parseFloat(row.dim_depth)}</span>
          : '—';
      case 'dim_height':
        return row.dim_height != null
          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{parseFloat(row.dim_height)}</span>
          : '—';
      case 'dim_preview': {
        const l = row.dim_length, d = row.dim_depth, h = row.dim_height;
        if (l == null && d == null && h == null) return '—';
        const fv = v => v != null ? parseFloat(v) : '?';
        const unit = row.dim_unit || '';
        return (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g700)' }}>
            {fv(l)} × {fv(d)} × {fv(h)}{unit ? ` ${unit}` : ''}
          </span>
        );
      }
      default:
        return row[col.key] != null ? String(row[col.key]) : '—';
    }
  };

  const menuItems = row => {
    const isIP = row.status === 'IN PROCESS';
    const mixCked = mixSelected.has(row.id);
    const perms = getAllowedActions(row);
    
    return [
      { label: 'Open Workspace', icon: <Package size={11} />, fn: () => navigate(`/inventory/lots/${row.id}`) },
      perms.canViewHistory && { label: 'View History', icon: <History size={11} />, fn: () => navigate(`/inventory/lots/${row.id}?tab=history`) },
      perms.canViewLineage && { label: 'View Lineage', icon: <Share2 size={11} />, fn: () => navigate(`/inventory/${row.id}/lineage`) },
      perms.canIssueProcess && { label: 'Issue to Process', icon: <Send size={11} />, fn: () => setActiveModal({ type: 'issue', lotId: row.id }), color: 'var(--brand)' },
      perms.canGrowthAgain && { label: 'Growth Again', icon: <RotateCcw size={11} />, fn: () => navigate('/manufacturing/control-tower'), color: 'var(--brand)' },
      perms.canGrowthOutput && { label: 'Growth Output', icon: <Package size={11} />, fn: () => navigate('/manufacturing/growth-output'), color: 'var(--brand)' },
      perms.canTransfer && { label: 'Stock Transfer', icon: <Send size={11} />, fn: () => openStockTransferModal([row], () => { setSelectedTransferRows([]); load(); }), color: 'var(--brand-dark)' },
      perms.canSplit && { label: 'Split Lot', icon: <GitBranch size={11} />, fn: () => setActiveModal({ type: 'split', lotId: row.id }), color: '#E65100' },
      perms.canMix && { label: mixCked ? 'Remove from Mix' : 'Mix Into…', icon: <GitMerge size={11} />, fn: () => toggleMix(row.id), color: 'var(--brand)' },
      perms.canCompleteGrowthRun && { label: 'Complete Growth Run', icon: <CheckCircle size={11} />, fn: () => toast('Please open lot workspace to complete Growth Run'), color: 'var(--brand)' },
      ...(isIP ? [
        { label: 'Process Issues', icon: <Package size={11} />, fn: () => navigate(`/inventory/process-issues?lot_id=${row.id}`), color: '#E65100' },
      ] : []),
    ].filter(Boolean);
  };

  return (
    <div className="grid-page animate-in" style={{ position: 'relative' }}>

      {/* ── Header ── */}

      {/* ── Toolbar ── */}
      <div className="filter-bar" style={{ background: '#fff' }}>
        {/* Search */}
        <div className="filter-field" style={{ width: 160 }}>
          <label className="filter-label">Search</label>
          <div className="grid-toolbar-search" style={{ margin: 0, width: '100%', height: 28, minWidth: 'auto', padding: '0 8px' }}>
            <Search size={12} style={{ marginRight: 4 }} />
            <input
              ref={searchRef}
              placeholder="Item, lot code, ID..."
              defaultValue={searchInput}
              onChange={e => handleSearch(e.target.value)}
              style={{ fontSize: 12, height: '100%' }}
            />
            {searchInput && (
              <button className="icon-btn" style={{ flexShrink: 0, padding: 2 }}
                onClick={handleSearchClear}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Category */}
        <div className="filter-field">
          <label className="filter-label">Category</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" multiple placeholder="All Categories" value={catFilter} onChange={e => fset(setCatFilter)(e.target.value)}>
              <option value="">All Categories</option>
              <option value="seed">Seeds</option>
              <option value="gas">Gases</option>
              <option value="consumable">Consumables</option>
              <option value="rough">Rough Diamonds</option>
              <option value="growth_run">Growth Runs</option>
            </SelectDropdown>
          </div>
        </div>

        {/* Status */}
        <div className="filter-field">
          <label className="filter-label">Status</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" multiple placeholder="All Statuses" value={statusFilt} onChange={e => fset(setStatusFilt)(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="IN STOCK">In Stock</option>
              <option value="IN PROCESS">In Process</option>
              <option value="CONSUMED">Consumed</option>
              <option value="SOLD">Sold</option>
              <option value="DAMAGED">Damaged</option>
              <option value="ARCHIVED">Archived</option>
            </SelectDropdown>
          </div>
        </div>

        {/* Process */}
        <div className="filter-field">
          <label className="filter-label">Process</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" placeholder="All Processes" value={processFilter} onChange={e => fset(setProcessFilter)(e.target.value)}>
              <option value="">All Processes</option>
              {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </SelectDropdown>
          </div>
        </div>

        {/* Op Type */}
        <div className="filter-field">
          <label className="filter-label">Op. Type</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" multiple placeholder="All Op. Types" value={opType} onChange={e => fset(setOpType)(e.target.value)}>
              <option value="">All Op. Types</option>
              <option value="purchase">Purchase</option>
              <option value="split">Split</option>
              <option value="mix">Mix</option>
              <option value="issue">Issue</option>
              <option value="return">Return</option>
            </SelectDropdown>
          </div>
        </div>

        {/* Location */}
        <div className="filter-field">
          <label className="filter-label">Location</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" placeholder="All Locations" value={locationFilter} onChange={e => fset(setLocationFilter)(e.target.value)}>
              <option value="">All Locations</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectDropdown>
          </div>
        </div>

        {/* Department */}
        <div className="filter-field">
          <label className="filter-label">Department</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" placeholder="All Departments" value={accountBaseFilter} onChange={e => fset(setAccountBaseFilter)(e.target.value)}>
              <option value="">All Departments</option>
              {accountBases.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </SelectDropdown>
          </div>
        </div>

        {/* Vendor */}
        <div className="filter-field">
          <label className="filter-label">Vendor</label>
          <div style={{ width: 120 }}>
            <SelectDropdown size="sm" placeholder="All Vendors" value={vendorFilter} onChange={e => fset(setVendorFilter)(e.target.value)}>
              <option value="">All Vendors</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </SelectDropdown>
          </div>
        </div>

        {/* Qty */}
        <div className="filter-field">
          <label className="filter-label">Qty</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" placeholder="min" value={qtyMin} onChange={e => fset(setQtyMin)(e.target.value)} style={{ width: 50, height: 28, padding: '0 6px', border: '1px solid var(--g300)', borderRadius: 'var(--radius)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <span style={{ color: 'var(--g400)' }}>–</span>
            <input type="number" placeholder="max" value={qtyMax} onChange={e => fset(setQtyMax)(e.target.value)} style={{ width: 50, height: 28, padding: '0 6px', border: '1px solid var(--g300)', borderRadius: 'var(--radius)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Weight (ct) */}
        <div className="filter-field">
          <label className="filter-label">Weight (ct)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" placeholder="min" value={weightMin} onChange={e => fset(setWeightMin)(e.target.value)} style={{ width: 50, height: 28, padding: '0 6px', border: '1px solid var(--g300)', borderRadius: 'var(--radius)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <span style={{ color: 'var(--g400)' }}>–</span>
            <input type="number" placeholder="max" value={weightMax} onChange={e => fset(setWeightMax)(e.target.value)} style={{ width: 50, height: 28, padding: '0 6px', border: '1px solid var(--g300)', borderRadius: 'var(--radius)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* From Date */}
        <div className="filter-field">
          <label className="filter-label">From Date</label>
          <div style={{ width: 110 }}>
            <DatePicker className="dp-sm" value={dateFrom} onChange={v => fset(setDateFrom)(v)} />
          </div>
        </div>

        {/* To Date */}
        <div className="filter-field">
          <label className="filter-label">To Date</label>
          <div style={{ width: 110 }}>
            <DatePicker className="dp-sm" value={dateTo} onChange={v => fset(setDateTo)(v)} />
          </div>
        </div>

      </div>

      {/* ── Quick chips + Actions ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 16px', flexWrap: 'wrap',
        background: 'var(--g50)', borderBottom: '1px solid var(--g200)',
        alignItems: 'center',
      }}>
        {CHIPS.map(chip => {
          const active = isChipActive(chip);
          return (
            <button
              key={chip.label}
              onClick={() => applyChip(chip)}
              style={{
                padding: '3px 10px', border: `1px solid ${active ? 'var(--brand)' : 'var(--g300)'}`,
                borderRadius: 12, fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                background: active ? 'var(--brand)' : '#fff',
                color: active ? '#fff' : 'var(--g600)',
                transition: 'all .1s',
              }}
            >
              {chip.label}
            </button>
          );
        })}
        {hasFilters && (
          <button onClick={clearAllFilters}
            style={{
              marginLeft: 4, padding: '3px 10px', border: '1px solid var(--g300)',
              borderRadius: 12, fontSize: 11, cursor: 'pointer', background: '#fff',
              color: '#C62828', display: 'flex', alignItems: 'center', gap: 3
            }}>
            <X size={10} /> Clear all
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={e => { e.stopPropagation(); setActionsOpen(v => !v); }}
            >
              Actions <ChevronDown size={11} />
            </button>
            {actionsOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 200, minWidth: 160,
                background: '#fff', border: '1px solid var(--g200)', borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,.12)', padding: '4px 0',
              }}>
                {(() => {
                  if (selectedTransferRows.length === 1) {
                    const lot = selectedTransferRows[0];
                    const perms = getAllowedActions(lot);
                    return [
                      perms.canViewHistory && { label: 'View History', icon: <History size={12} />, fn: () => navigate(`/inventory/lots/${lot.id}?tab=history`) },
                      perms.canViewLineage && { label: 'View Lineage', icon: <Share2 size={12} />, fn: () => navigate(`/inventory/${lot.id}/lineage`) },
                      perms.canIssueProcess && { label: 'Issue to Process', icon: <Send size={12} />, fn: () => setActiveModal({ type: 'issue', lotId: lot.id }), accent: true },
                      perms.canGrowthAgain && { label: 'Growth Again', icon: <RotateCcw size={12} />, fn: () => navigate('/manufacturing/control-tower'), accent: true },
                      perms.canGrowthOutput && { label: 'Growth Output', icon: <Package size={12} />, fn: () => navigate('/manufacturing/growth-output'), accent: true },
                      perms.canTransfer && { label: 'Stock Transfer', icon: <Send size={12} />, fn: () => openStockTransferModal([lot], () => { setSelectedTransferRows([]); load(); }), accent: true },
                      perms.canSplit && { label: 'Split Lot', icon: <GitBranch size={12} />, fn: () => setActiveModal({ type: 'split', lotId: lot.id }), accent: true },
                      perms.canMix && { label: 'Mix Into…', icon: <GitMerge size={12} />, fn: () => setActiveModal({ type: 'mix', lotIds: lot.id }), accent: true },
                      perms.canCompleteGrowthRun && { label: 'Complete Growth Run', icon: <CheckCircle size={12} />, fn: () => toast('Please open lot workspace to complete Growth Run'), accent: true },
                    ].filter(Boolean);
                  } else {
                    return [
                      { label: 'Issue to Process', icon: <Send size={12} />, fn: () => {}, disabled: true },
                      { label: 'Split Lot', icon: <GitBranch size={12} />, fn: () => {}, disabled: true },
                      { label: 'Mix Lots', icon: <GitMerge size={12} />, fn: () => setActiveModal({ type: 'mix', lotIds: selectedTransferRows.map(r => r.id).join(',') }), disabled: selectedTransferRows.length < 1, accent: true },
                      { label: 'Stock Transfer', icon: <Send size={12} />, fn: () => openStockTransferModal(selectedTransferRows, () => { setSelectedTransferRows([]); load(); }), disabled: selectedTransferRows.length < 1, accent: true },
                    ];
                  }
                })().map(({ label, icon, fn, disabled, accent }) => (
                  <div key={label}
                    onClick={() => { if (!disabled) { setActionsOpen(false); fn(); } }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px', fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
                      color: disabled ? 'var(--g400)' : accent ? 'var(--brand-dark)' : 'var(--g700)',
                      opacity: disabled ? 0.6 : 1
                    }}
                    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--g100)'; }}
                    onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = ''; }}
                  >
                    {icon} {label}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ width: 130 }}>
            <SelectDropdown size="sm" value={activeTemplateId} onChange={e => handleTemplateSelect(e.target.value)}>
              {allTemplates.map(tmpl => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.label}{tmpl.id === defaultTemplateId ? ' ★' : ''}
                </option>
              ))}
            </SelectDropdown>
          </div>

          <button className="icon-btn" title="Columns & Templates"
            onClick={() => setShowLayoutPanel(v => !v)}
            style={{ color: showLayoutPanel ? 'var(--brand)' : undefined }}>
            <Columns size={16} />
          </button>

          <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('csv')} title="Export CSV">
            <Download size={13} /> CSV
          </button>
          <button className="btn btn-sm" disabled={exporting} onClick={() => handleExport('print')} title="Print / PDF">
            <Printer size={13} /> Print
          </button>

          <button className="icon-btn" title="Refresh" onClick={handleRefresh} disabled={spinning}
            style={spinning ? { animation: 'spin 0.7s linear infinite' } : undefined}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="grid-wrap" ref={gridWrapRef} style={{ overflowAnchor: 'none' }}>
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <div className="spinner" />
          </div>
        ) : data.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <Package size={32} />
            <p>No inventory records match your filters.</p>
            {hasFilters && (
              <button className="btn btn-sm" onClick={clearAllFilters}>Clear Filters</button>
            )}
          </div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 36, textAlign: 'center' }} title="Select for mix">
                  {data.length > 0 && (
                    <span onClick={handleHeaderSelect} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      {allVisibleSelected ? (
                        <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                      ) : someVisibleSelected ? (
                        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13 }}>
                          <Square size={13} style={{ color: 'var(--brand)', position: 'absolute' }} />
                          <span style={{ width: 7, height: 2, background: 'var(--brand)', borderRadius: 1, position: 'absolute' }} />
                        </span>
                      ) : (
                        <Square size={13} style={{ color: 'var(--g300)' }} />
                      )}
                    </span>
                  )}
                </th>

                {activeCols.map(col => {
                  const sortKey = COL_TO_SORT[col.key];
                  const isSorted = sortKey && sortBy === sortKey;
                  return (
                    <th key={col.key} style={{ width: col.width, cursor: sortKey ? 'pointer' : undefined, userSelect: 'none' }}
                      onClick={() => handleSortClick(col.key)}>
                      {col.label}
                      {isSorted && (
                        <span style={{ marginLeft: 3, fontSize: 9, opacity: 0.7 }}>
                          {sortDir === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </th>
                  );
                })}
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const vItems = rowVirtualizer.getVirtualItems();
                if (!vItems.length) return null;
                const totalSize = rowVirtualizer.getTotalSize();
                const paddingTop = vItems[0].start;
                const paddingBottom = totalSize - vItems[vItems.length - 1].end;
                const colCount = activeCols.length + 2;
                return (
                  <>
                    {paddingTop > 0 && <tr><td colSpan={colCount} style={{ height: paddingTop, padding: 0 }} /></tr>}
                    {vItems.map(vRow => {
                      const row = data[vRow.index];
                      const mixCked = mixSelected.has(row.id);
                      const hasPending = pendingLotIds.has(row.id);
                      return (
                        <tr key={row.id}
                          onDoubleClick={() => navigate(`/inventory/lots/${row.id}`)}
                          onClick={() => toggleMix(row.id)}
                          style={{ background: mixCked ? '#F3E5F5' : hasPending ? '#FFFBEB' : undefined, cursor: row.status === 'IN STOCK' ? 'pointer' : 'default' }}>

                          <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <span onClick={e => toggleMix(row.id, e)} style={{ cursor: row.status === 'IN STOCK' ? 'pointer' : 'not-allowed' }}>
                              {mixCked
                                ? <CheckSquare size={13} style={{ color: 'var(--brand)' }} />
                                : <Square size={13} style={{ color: row.status === 'IN STOCK' ? 'var(--g300)' : 'var(--g400)' }} />}
                            </span>
                          </td>

                          {activeCols.map(col => (
                            <td key={col.key} style={{ textAlign: col.num ? 'right' : undefined }}>
                              {renderCell(col, row)}
                            </td>
                          ))}

                          <td style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                            <button className="icon-btn" style={{ padding: '2px 4px' }}
                              onClick={e => { e.stopPropagation(); setActionMenu(prev => prev === row.id ? null : row.id); }}>
                              <MoreVertical size={13} />
                            </button>
                            {actionMenu === row.id && (
                              <div style={{
                                position: 'absolute', right: 0, top: '100%', zIndex: 100,
                                background: '#fff', border: '1px solid var(--g200)',
                                borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
                                minWidth: 180, padding: '4px 0',
                              }}>
                                {menuItems(row).map(({ label, icon, fn, color }) => (
                                  <div key={label}
                                    onClick={() => { setActionMenu(null); fn(); }}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      padding: '7px 14px', fontSize: 12, cursor: 'pointer',
                                      color: color || 'var(--g700)'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--g100)'}
                                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                                    {icon} {label}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paddingBottom > 0 && <tr><td colSpan={colCount} style={{ height: paddingBottom, padding: 0 }} /></tr>}
                  </>
                );
              })()}
            </tbody>
          </table>

        )}
      </div>

      {/* ── Footer ── */}
      <div className="grid-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--g500)' }}>
            Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total} records
          </span>
          <Paginator page={page} totalPages={totalPages} onPage={p => { setPage(p); document.querySelector('.grid-wrap')?.scrollTo(0, 0); }} />
        </div>
        <span>
          {total} lots &nbsp;|&nbsp;
          Total qty: {totals.qty.toLocaleString('en-IN', { maximumFractionDigits: 4 })} &nbsp;|&nbsp;
          ₹{totals.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* ── Column & Template Panel (right side overlay) ── */}
      {showLayoutPanel && (
        <ColumnLayoutPanel
          allCols={ALL_COLS}
          activeColKeys={activeColKeys}
          onColKeysChange={handleColKeysChange}
          allTemplates={allTemplates}
          activeTemplateId={activeTemplateId}
          onTemplateSelect={handleTemplateSelect}
          onSaveAsNew={handleSaveAsNew}
          onUpdateTemplate={handleUpdateTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onDuplicateTemplate={handleDuplicateTemplate}
          onRenameTemplate={handleRenameTemplate}
          onSetDefault={handleSetDefault}
          defaultTemplateId={defaultTemplateId}
          onClose={() => setShowLayoutPanel(false)}
        />
      )}

      <StockTransferHistoryModal
        open={showTransferHistory}
        onClose={() => setShowTransferHistory(false)}
      />

      {/* ════ POPUP MODALS ════ */}
      {activeModal && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)} style={{ zIndex: 1000 }}>
          <div className="modal" style={{ width: '90vw', height: '90vh', maxWidth: 1300, padding: 0, display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--brand-dark)' }}>
                {activeModal.type === 'split' ? 'Split Lot' : 'Issue to Process'}
              </div>
              <button className="icon-btn" onClick={() => setActiveModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
              {activeModal.type === 'split' && <SplitLotPage lotId={activeModal.lotId} isModal onComplete={() => { setActiveModal(null); load(); }} onCancel={() => setActiveModal(null)} />}
              {activeModal.type === 'issue' && <LotIssuePage initialLotId={activeModal.lotId} isModal onComplete={() => { setActiveModal(null); load(); }} onCancel={() => setActiveModal(null)} />}
              {activeModal.type === 'mix' && <MixLotsPage initialLotIds={activeModal.lotIds} isModal onComplete={() => { setActiveModal(null); load(); }} onCancel={() => setActiveModal(null)} />}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
