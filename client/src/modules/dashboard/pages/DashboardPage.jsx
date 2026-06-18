import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../../shared/hooks/useApi';
import { useAuth } from '../../../core/context/AuthContext';
import {
  Leaf, Settings, Warehouse, ShoppingCart, Receipt,
  FileText, Send, Gem, Building2,
  BookOpen, BarChart3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import WidgetCard from '../components/WidgetCard';
import WidgetSelectorModal from '../components/WidgetSelectorModal';

// Quick-link card (same as original)
function NavCard({ icon: Icon, label, path, color }) {
  const navigate = useNavigate();
  return (
    <div className="dash-card" style={{ borderLeftColor: color }} onClick={() => navigate(path)}>
      <Icon size={16} /> {label}
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

  const [widgets,       setWidgets]       = useState([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [showCustomize, setShowCustomize] = useState(false);

  const fetchWidgets = () => {
    api.get('/api/dashboard')
      .then(res => setWidgets(res.widgets || []))
      .catch(() => { toast.error('Failed to load dashboard layout'); })
      .finally(() => setConfigLoading(false));
  };

  useEffect(() => {
    fetchWidgets();
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

      {/* Quick-access nav */}
      <div className="dash-section">
        <div className="dash-section-title">Inventory & Purchase</div>
        <div className="dash-cards">
          <NavCard icon={Warehouse}    label="All Inventory"  path="/inventory"      color="#0D7C5F" />
          <NavCard icon={ShoppingCart} label="Purchase Notes" path="/purchase-notes" color="#E87722" />
          <NavCard icon={Receipt}      label="Expenses"       path="/expenses"        color="#D32F2F" />
        </div>
      </div>

      <div className="dash-section">
        <div className="dash-section-title">Sales</div>
        <div className="dash-cards">
          <NavCard icon={FileText} label="Invoices" path="/invoices"  color="#0D7C5F" />
          <NavCard icon={Receipt}  label="Receipts" path="/receipts"  color="#0D7C5F" />
          <NavCard icon={Send}     label="Payments" path="/payments"  color="#1565C0" />
        </div>
      </div>

      <div className="dash-section">
        <div className="dash-section-title">Accounting</div>
        <div className="dash-cards">
          <NavCard icon={Building2} label="Chart of Accounts" path="/accounts"        color="#455A64" />
          <NavCard icon={BookOpen}  label="Journal Entries"   path="/journal-entries" color="#455A64" />
          <NavCard icon={BarChart3} label="P&L Report"        path="/pnl"             color="#455A64" />
        </div>
      </div>

      <div className="dash-section">
        <div className="dash-section-title">Rough Diamonds</div>
        <div className="dash-cards">
          <NavCard icon={Gem} label="Rough Growth" path="/rough-growth" color="#1565C0" />
        </div>
      </div>

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
