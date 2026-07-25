import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useDashboardSync } from '../../../shared/hooks/useModuleSync';
import { useAuth } from '../../../core/context/AuthContext';
import { NAVIGATION } from '../../../core/navigation/registry';
import { flattenLeaves } from '../../../core/navigation/selectors';
import { Leaf, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import WidgetCard from '../components/WidgetCard';
import WidgetSelectorModal from '../components/WidgetSelectorModal';

// Group Colors (same as original hardcoded logic)
const GROUP_COLORS = {
  'Inventory & Purchase': '#0D7C5F',
  'Sales': '#0D7C5F', // or #1565C0 based on specific ones, but let's use a mapping
  'Accounting': '#455A64',
  'Manufacturing': '#1565C0',
  'Management': '#E87722'
};
const FALLBACK_COLOR = '#1565C0';

function getShortcutColor(id, group) {
  if (id === 'payments' || id === 'rough-growth') return '#1565C0';
  if (id === 'purchase-notes') return '#E87722';
  if (id === 'expenses') return '#D32F2F';
  return GROUP_COLORS[group] || FALLBACK_COLOR;
}

// Quick-link card
function NavCard({ icon: Icon, label, path, color }) {
  const navigate = useNavigate();
  return (
    <div className="dash-card" style={{ borderLeftColor: color }} onClick={() => navigate(path)}>
      {Icon && <Icon size={16} />} {label}
    </div>
  );
}

// Shown while the widget config is loading from the server
function GridSkeleton() {
  return (
    <div className="widget-grid" style={{ marginBottom: 24 }}>
      {[200, 140, 140, 140, 140, 140].map((h, i) => (
        <div key={i} className={`widget-card${i === 0 ? ' widget-card--full' : ''}`} style={{ padding: 16 }}>
          <div className="wsk wsk-line" style={{ width: '42%', marginBottom: 10 }} />
          <div className="wsk" style={{ height: h - 48, borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const api      = useApi();
  
  useDashboardSync();

  const [widgets,       setWidgets]       = useState([]);
  const [catalog,       setCatalog]       = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [showCustomize, setShowCustomize] = useState(false);

  const fetchDashboardData = () => {
    Promise.all([
      api.get('/api/dashboard'),
      api.get('/api/dashboard/catalog')
    ])
      .then(([configRes, catalogRes]) => {
        // Intersect saved widget keys with authorized catalog widgets
        const authorizedWidgets = new Set(catalogRes.widgets || []);
        const validWidgets = (configRes.widgets || []).filter(w => authorizedWidgets.has(w.widget_key));
        
        // Append any newly authorized widgets that aren't in the saved config
        const existingKeys = new Set(validWidgets.map(w => w.widget_key));
        for (const widgetKey of authorizedWidgets) {
          if (!existingKeys.has(widgetKey)) {
            validWidgets.push({ widget_key: widgetKey, position: validWidgets.length, is_visible: false });
          }
        }
        
        setWidgets(validWidgets);
        setCatalog(catalogRes);
      })
      .catch(() => { toast.error('Failed to load dashboard data'); })
      .finally(() => setConfigLoading(false));
  };

  useEffect(() => {
    fetchDashboardData();
  }, [api]);

  const handleSaveLayout = async (updated) => {
    setWidgets(updated);
    setShowCustomize(false);
    try {
      await api.post('/api/dashboard', { widgets: updated });
      toast.success('Dashboard layout saved');
    } catch {
      toast.error('Failed to save layout');
    }
  };

  const visibleWidgets = widgets
    .filter(w => w.is_visible !== false)
    .sort((a, b) => a.position - b.position);

  // Group shortcuts
  const groupedShortcuts = useMemo(() => {
    if (!catalog || !catalog.shortcuts) return {};
    const leaves = flattenLeaves(NAVIGATION);
    
    // We map shortcut ids back to their dashboard group defined in the backend. 
    // Since the frontend doesn't have dashboardRegistry.js, we should ideally get the groups from the backend, 
    // but the API currently just returns an array of strings. We can map them based on NAVIGATION groups or manual logic.
    // Actually, it's cleaner to let the backend return `{ id, group }` instead of just `id`. 
    // Let's assume catalog.shortcuts is an array of IDs for now, and we manually group them.
    const GROUPS = {
      'Inventory & Purchase': ['all-inventory', 'stock-transfer', 'lot-movements', 'vendors', 'vendor-bills', 'purchase-notes', 'expenses'],
      'Manufacturing': ['control-tower', 'start-process', 'process-issues', 'process-return', 'rough-stock', 'growth-runs', 'rough-growth-legacy', 'machines', 'process-master'],
      'Sales': ['invoices', 'customers', 'receipts', 'payments'], // Merged some Accounting links logically
      'Accounting': ['chart-of-accounts', 'journal-entries', 'fund-utilization', 'ledger', 'pnl', 'bank-deposits', 'transfers', 'bank-reconciliation'],
      'Assets': ['asset-list', 'depreciation-runs', 'fixed-asset-register', 'depreciation-schedule']
    };

    const result = {};
    for (const [groupName, ids] of Object.entries(GROUPS)) {
      const authorizedInGroup = ids.filter(id => catalog.shortcuts.includes(id));
      if (authorizedInGroup.length > 0) {
        result[groupName] = authorizedInGroup.map(id => {
          const navEntry = leaves.find(l => l.id === id);
          return navEntry ? { ...navEntry, group: groupName } : null;
        }).filter(Boolean);
      }
    }
    return result;
  }, [catalog]);

  return (
    <div className="dash animate-in">

      {/* Header */}
      <div className="dash-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Leaf size={20} style={{ color: 'var(--brand)', flexShrink: 0 }} />
          <div>
            <div className="dash-title">Silverstar Diam Pvt. Ltd.</div>
            <div className="dash-sub" style={{ margin: 0 }}>
              Welcome back, {user?.full_name || user?.fullName}
            </div>
          </div>
        </div>
        <button className="btn" onClick={() => setShowCustomize(true)}>
          <Settings size={13} />
          Customize
        </button>
      </div>

      {/* Dynamic Nav Groups */}
      {!configLoading && Object.entries(groupedShortcuts).map(([group, shortcuts]) => (
        <div key={group} className="dash-section">
          <div className="dash-section-title">{group}</div>
          <div className="dash-cards">
            {shortcuts.map(sc => (
              <NavCard 
                key={sc.id} 
                icon={sc.icon} 
                label={sc.label} 
                path={sc.path} 
                color={getShortcutColor(sc.id, group)} 
              />
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 32 }} />

      {/* Widget grid */}
      {configLoading ? (
        <GridSkeleton />
      ) : visibleWidgets.length > 0 ? (
        <div className="widget-grid">
          {visibleWidgets.map(w => (
            <WidgetCard key={w.widget_key} widgetKey={w.widget_key} />
          ))}
        </div>
      ) : (
        <div className="dash-empty-state">
          <Settings size={28} style={{ color: 'var(--g400)' }} />
          <p>No widgets enabled — click <strong>Customize</strong> to add some.</p>
        </div>
      )}



      {showCustomize && (
        <WidgetSelectorModal
          widgets={widgets}
          onSave={handleSaveLayout}
          onClose={() => setShowCustomize(false)}
        />
      )}
    </div>
  );
}
