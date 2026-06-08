import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TabPanel from '../tabs/TabPanel';
import { useAuth } from '../context/AuthContext';
import { useTabs, TabProvider, TabBar } from '../tabs';
import {
  Leaf, LayoutDashboard, Package, FileText, Settings as Cog, Database, BarChart3, LogOut,
  ChevronRight, Gem, Building2, Search, User, Warehouse, Receipt, Send, RotateCcw, Clock,
  ShoppingCart, CreditCard, HandCoins, BookOpen, TrendingUp, Calculator, Users, Landmark,
  TrendingDown, GitBranch, GitMerge, Layers, ShieldCheck, Cpu, ClipboardList, ArrowLeft, Share2
} from 'lucide-react';
import GlobalCreateMenu from '@features/quick-create/GlobalCreateMenu';
import CommandPalette from '@features/command-palette/CommandPalette';
import GlobalScanInput from '@features/scan/GlobalScanInput';
import { resolveRouteMatch } from '../../router';
import { NotificationCenter } from '../../shared/components/NotificationCenter';
import Modal from '../../shared/components/Modal';

export const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', module: 'dashboard' },
  { label: 'Clipboard', icon: ClipboardList, path: '/clipboard' },
  {
    label: 'Inventory', icon: Warehouse, module: 'inventory', children: [
      { label: 'All Inventory', path: '/inventory' },
      { label: 'Opening Entry', path: '/inventory/opening', editorOnly: true },
      { label: 'Closing Entry', path: '/inventory/closing', editorOnly: true },
      { label: 'Mix Lots', path: '/inventory/mix', editorOnly: true },
      { label: 'Stock Transfer', path: '/inventory/stock-transfer', editorOnly: true },
      { label: 'Lot Movements', path: '/lot-movements' },
      { label: 'Process Issues', path: '/inventory/process-issues' },
      { label: 'Start Process', path: '/inventory/process-issues/new', editorOnly: true },
    ]
  },
  {
    label: 'Rough Diamonds', icon: Gem, module: 'rough', children: [
      { label: 'Rough Growth', path: '/rough-growth' },
      { label: 'Growth Runs', path: '/growth-runs' },
      { label: 'Growth Output', path: '/manufacturing/growth-output', editorOnly: true },
    ]
  },
  {
    label: 'Manufacturing', icon: Cpu, module: 'manufacturing', children: [
      { label: 'Control Tower', path: '/manufacturing/control-tower' },
    ]
  },
  {
    label: 'Purchase', icon: ShoppingCart, module: 'purchase', children: [
      { label: 'Vendors', path: '/vendors' },
      { label: 'Purchase Notes', path: '/purchase-notes' },
      { label: 'New Purchase Note', path: '/purchase-notes/new', editorOnly: true },
      { label: 'Expenses', path: '/expenses' },
    ]
  },
  {
    label: 'Sales', icon: FileText, module: 'sales', children: [
      { label: 'Invoices', path: '/invoices' },
      { label: 'New Invoice', path: '/invoices/new', editorOnly: true },
      { label: 'Customers', path: '/customers' },
    ]
  },
  {
    label: 'Accounting', icon: Building2, module: 'accounting', children: [
      { label: 'Chart of Accounts', path: '/accounts' },
      { label: 'Payments', path: '/payments' },
      { label: 'Receipts', path: '/receipts' },
      { label: 'Bank Deposits', path: '/bank-deposits' },
      { label: 'Journal Entries', path: '/journal-entries' },
      { label: 'Bank Reconciliation', path: '/reports/bank-reconciliation' },
    ]
  },
  {
    label: 'Fixed Assets', icon: Landmark, module: 'assets', children: [
      { label: 'Asset List', path: '/assets' },
      { label: 'Manual Entry', path: '/assets/new', editorOnly: true },
      { label: 'Depreciation Runs', path: '/depreciation-runs' },
      { label: 'New Depreciation Run', path: '/depreciation-runs/new', editorOnly: true },
      { label: 'Fixed Asset Register', path: '/reports/fixed-asset-register' },
      { label: 'Depreciation Schedule', path: '/reports/depreciation-schedule' },
    ]
  },
  {
    label: 'Reports', icon: BarChart3, module: 'reports', children: [
      { label: 'Ledger', path: '/ledger' },
      { label: 'Trial Balance', path: '/trial-balance' },
      { label: 'Profit & Loss', path: '/pnl' },
      { label: 'Balance Sheet', path: '/balance-sheet' },
      { label: 'Costing Report', path: '/costing' },
      { label: 'Accounts Receivable', path: '/reports/accounts-receivable' },
      { label: 'Accounts Payable', path: '/reports/accounts-payable' },
      { label: 'Cost Center P&L', path: '/reports/cost-center' },
    ]
  },
  {
    label: 'Management', icon: Database, module: 'management', children: [
      { label: 'Process Master', path: '/manufacturing/process-master' },
      { label: 'Items Master', path: '/items' },
      { label: 'Machines', path: '/machines' },
      { label: 'Departments', path: '/departments' },
      { label: 'Locations', path: '/locations' },
      { label: 'UOM', path: '/uom' },
      { label: 'Expense Categories', path: '/expense-categories' },
      { label: 'Asset Categories', path: '/fixed-asset-categories' },
    ]
  },
  { label: 'Admin Panel', icon: ShieldCheck, path: '/admin/users', adminOnly: true },
];

const ROOT_PATHS = new Set([
  '/', '/inventory', '/invoices', '/purchase-notes', '/expenses',
  '/rough-growth', '/accounts', '/journal-entries',
  '/payments', '/receipts', '/bank-deposits', '/depreciation-runs',
  '/lot-movements', '/inventory/process-issues',
  '/vendors', '/customers', '/assets',
  '/ledger', '/trial-balance', '/pnl', '/costing', '/balance-sheet',
  '/fixed-asset-categories', '/items', '/machines', '/departments',
  '/locations', '/uom', '/expense-categories', '/asset-templates',
  '/manufacturing/control-tower', '/manufacturing/process-master',
  '/reports/fixed-asset-register', '/reports/depreciation-schedule',
  '/reports/accounts-receivable', '/reports/accounts-payable',
  '/reports/bank-reconciliation', '/reports/cost-center',
  '/admin/users', '/clipboard',
]);

export function flattenNav(items) {
  const result = [];
  for (const item of items) {
    if (item.children) {
      for (const child of item.children) {
        if (child.path) result.push({ ...child, icon: item.icon });
      }
    } else if (item.path) {
      result.push(item);
    }
  }
  return result;
}

function SidebarItem({ item, onNavigate }) {
  const [open, setOpen] = useState(null);
  const location = useLocation();
  const { hasPermission } = useAuth();

  useEffect(() => { setOpen(null); }, [location.pathname]);

  if (!item.children) {
    const isActive = location.pathname === item.path;
    return (
      <div className="nav-item">
        <div
          className={`nav-hdr${isActive ? ' active' : ''}`}
          onClick={(e) => onNavigate(item, null, e)}
          onAuxClick={(e) => { if (e.button === 1) onNavigate(item, null, e); }}
        >
          <item.icon className="icon" size={16} />
          {item.label}
        </div>
      </div>
    );
  }

  // Hide editor-only children when user lacks create/edit permission on the module
  const canMutate = !item.module ||
    hasPermission(item.module, 'create') ||
    hasPermission(item.module, 'edit');
  const visibleChildren = item.children.filter(c => !c.editorOnly || canMutate);
  const isActive = visibleChildren.some(c =>
    c.path && (location.pathname === c.path || location.pathname.startsWith(c.path + '/'))
  );
  const isOpen = open ?? isActive;

  return (
    <div className="nav-item">
      <div
        className={`nav-hdr ${isOpen ? 'expanded' : ''}`}
        onClick={() => setOpen(prev => (prev ?? isActive) ? false : true)}
      >
        <item.icon className="icon" size={16} />
        {item.label}
        <ChevronRight className="arrow" size={10} />
      </div>
      <div className={`nav-sub ${isOpen ? 'open' : ''}`}>
        {visibleChildren.map(child => (
          child.disabled ? (
            <span key={child.path} style={{ display: 'block', padding: '6px 14px 6px 42px', color: 'var(--g400)', fontSize: 12, cursor: 'default' }}>
              {child.label}
            </span>
          ) : (
            <div
              key={child.path}
              className={location.pathname === child.path || location.pathname.startsWith(child.path + '/') ? 'active' : ''}
              onClick={(e) => onNavigate(child, item, e)}
              onAuxClick={(e) => { if (e.button === 1) onNavigate(child, item, e); }}
              style={{ cursor: 'pointer', display: 'block', padding: '6px 14px 6px 42px', fontSize: 12 }}
            >
              {child.label}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function LayoutInner() {
  const { user, logout, hasPermission } = useAuth();
  const { openTab, closeTab, switchTab, closeOtherTabs, closeAllTabs, closeTabsToRight, reorderTabs, patchTabs, tabs, activeTabId } = useTabs();
  const navigate = useNavigate();
  const location = useLocation();

  const pageNames = {
    '/': 'Dashboard', '/accounts': 'Chart of Accounts', '/journal-entries': 'Journal Entries',
    '/journal-entries/new': 'New Journal Entry', '/bank-deposits': 'Bank Deposits',
    '/bank-deposits/new': 'New Bank Deposit', '/items': 'Item Master', '/vendors': 'Vendors',
    '/machines': 'Machine Master', '/departments': 'Department Master', '/locations': 'Location Master',
    '/uom': 'Units of Measure', '/expense-categories': 'Expense Categories',
    '/inventory': 'All Inventory', '/inventory/clipboard-data': 'Clipboard Data', '/inventory/opening': 'Inventory Opening Entry',
    '/inventory/closing': 'Inventory Closing Entry', '/inventory/mix': 'Mix Lots',
    '/lot-movements': 'Lot Movements',
    '/inventory/process-issues': 'Process Issues',
    '/inventory/stock-transfer': 'Stock Transfer',
    '/inventory/process-issues/new': 'Start Process',
    '/purchase-notes': 'Purchase Notes', '/purchase-notes/new': 'New Purchase Note',
    '/expenses': 'Expenses', '/expenses/new': 'New Expense', '/rough-growth': 'Rough Growth',
    '/growth-runs': 'Growth Runs', '/manufacturing/growth-output': 'Growth Output',
    '/invoices': 'Rough Invoices', '/invoices/new': 'New Invoice', '/customers': 'Customers',
    '/payments': 'Payments', '/payments/new': 'New Payment', '/receipts': 'Receipts', '/receipts/new': 'New Receipt', '/ledger': 'Account Ledger', '/trial-balance': 'Trial Balance',
    '/pnl': 'Profit & Loss', '/costing': 'Costing Report', '/balance-sheet': 'Balance Sheet',
    '/fixed-asset-categories': 'Fixed Asset Categories',
    '/asset-templates': 'Asset Templates',
    '/assets': 'Fixed Assets', '/assets/new': 'Manual Asset Entry',
    '/depreciation-runs': 'Depreciation Runs', '/depreciation-runs/new': 'New Depreciation Run',
    '/reports/fixed-asset-register': 'Fixed Asset Register',
    '/reports/depreciation-schedule': 'Depreciation Schedule',
    '/reports/accounts-receivable': 'Accounts Receivable',
    '/reports/accounts-payable': 'Accounts Payable',
    '/reports/transactions': 'Transactions Report',
    '/reports/cost-center-transactions': 'Cost Center Transactions',
    '/reports/bank-reconciliation': 'Bank Reconciliation',
    '/reports/cost-center': 'Cost Center P&L',
    '/manufacturing/control-tower': 'Manufacturing Control Tower',
    '/manufacturing/process-master': 'Process Master',
    '/admin/users': 'Admin Panel',
    '/clipboard': 'Clipboard',
  };

  const lastActiveTabRef = useRef(activeTabId);
  const lastLocationRef = useRef(location.pathname);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Build reverse path → icon map
  const pathIconMap = useMemo(() => {
    const map = {};
    for (const item of flattenNav(NAV)) {
      if (item.path) map[item.path] = item.icon;
    }
    return map;
  }, []);

  useEffect(() => {
    // Phase 33: legacy deep link. /rough-growth/new no longer exists. Redirect
    // imperatively BEFORE any tab is opened (a mounted <Navigate> would loop in
    // the keep-alive tab system). Short-circuits before the open-tab logic below.
    if (location.pathname === '/rough-growth/new') {
      lastLocationRef.current = '/manufacturing/growth-output';
      navigate('/manufacturing/growth-output', { replace: true });
      return;
    }

    const active = tabs.find(t => t.id === activeTabId);

    // Scenario A: Active tab was switched by the user (via tabs UI)
    if (activeTabId !== lastActiveTabRef.current) {
      lastActiveTabRef.current = activeTabId;
      const active = tabs.find(t => t.id === activeTabId);
      const targetPath = active?.path || active?.id;
      if (targetPath && targetPath !== location.pathname) {
        lastLocationRef.current = targetPath;
        navigate(targetPath, { replace: true });
      }
      return;
    }

    // Scenario B: URL was changed (via navigate, back button, etc.)
    if (location.pathname !== lastLocationRef.current) {
      lastLocationRef.current = location.pathname;
      const matchedTab = tabs.find(t => t.path === location.pathname);

      if (matchedTab) {
        if (matchedTab.id !== activeTabId) {
          lastActiveTabRef.current = matchedTab.id;
          switchTab(matchedTab.id);
        }
      } else if (pageNames[location.pathname] && location.pathname !== '/') {
        openTab({
          id: location.pathname,
          name: pageNames[location.pathname],
          icon: pathIconMap[location.pathname],
          path: location.pathname,
          closable: true,
        });
      } else if (location.pathname !== '/') {
        const match = resolveRouteMatch(location.pathname);
        if (match && match.routePath && match.routePath.includes(':')) {
          let tabName = 'Workspace';
          let icon = FileText;
          if (match.routePath === '/inventory/lots/:id') {
            tabName = `Lot #${match.params.id}`;
            icon = Package;
          } else if (match.routePath === '/inventory/:lotId/split') {
            tabName = `Split #${match.params.lotId}`;
            icon = GitBranch;
          } else if (match.routePath === '/inventory/:lotId/lineage') {
            tabName = `Lineage #${match.params.lotId}`;
            icon = Share2;
          }
          openTab({
            id: location.pathname,
            name: tabName,
            icon: icon,
            path: location.pathname,
            closable: true,
          });
        } else {
          const segments = location.pathname.split('/').filter(Boolean);
          const lastSegment = segments[segments.length - 1];
          const isNumericId = /^\d+$/.test(lastSegment);
          if (isNumericId && segments.length >= 2) {
            const parentPath = '/' + segments.slice(0, -1).join('/');
            const parentName = pageNames[parentPath];
            if (parentName) {
              openTab({
                id: location.pathname,
                name: `${parentName} #${lastSegment}`,
                icon: pathIconMap[parentPath],
                path: location.pathname,
                closable: true,
              });
            }
          }
        }
      }
    }
  }, [activeTabId, tabs, location.pathname, switchTab, openTab, pathIconMap, navigate]);

  // Restore icons for persisted tabs that lost them after JSON.stringify
  useEffect(() => {
    patchTabs(prev => prev.map(t => ({
      ...t,
      icon: t.icon || pathIconMap[t.path] || null
    })));
  }, []);

  const handleNavigate = (item, parent, e) => {
    if (!item.path) return;
    const icon = item.icon || parent?.icon || FileText;
    
    // Open a new tab if holding Ctrl/Middle-click OR if the tab is already open
    const isAlreadyOpen = tabs.some(t => t.path === item.path);
    const forceNew = e && (e.ctrlKey || e.metaKey || e.button === 1);
    
    const isNewTab = isAlreadyOpen || forceNew;
    const tabId = isNewTab ? `${item.path}-${Date.now()}` : item.path;

    openTab({
      id: tabId,
      name: item.label,
      icon: icon,
      path: item.path,
      closable: tabId !== '/',
    });
  };

  const contextMenuHandler = (action, tabId) => {
    switch (action) {
      case 'closeOthers': closeOtherTabs(tabId); break;
      case 'closeAll': closeAllTabs(); break;
      case 'closeRight': closeTabsToRight(tabId); break;
      default: break;
    }
  };

  const pageName = pageNames[location.pathname] || 'Silverstar Grow';

  const showBack = !ROOT_PATHS.has(location.pathname);

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Leaf size={16} /></div>
          <div>
            <div className="logo-text">SILVERSTAR</div>
            <div className="logo-sub">GROW UTILITY</div>
          </div>
        </div>
        <div className="sidebar-nav">
          {NAV
            .filter(item => {
              if (!item.adminOnly) return true;
              const r = String(user?.role || '').toLowerCase();
              return r === 'admin' || r === 'super_admin';
            })
            .filter(item => !item.module || hasPermission(item.module, 'view'))
            .map((item, i) => <SidebarItem key={i} item={item} onNavigate={handleNavigate} />)}
          <div className="nav-item" style={{ marginTop: 8, borderTop: '1px solid var(--sidebar-border)', paddingTop: 4 }}>
            <div className="nav-hdr" onClick={() => setShowLogoutConfirm(true)}>
              <LogOut className="icon" size={16} />
              Logout
            </div>
          </div>
        </div>
      </nav>

      <GlobalScanInput />
      <CommandPalette />
      <header className="topbar">
        <div className="topbar-title">
          {showBack && (
            <button
              onClick={() => {
                if (activeTabId && activeTabId !== '/') {
                  closeTab(activeTabId);
                } else {
                  navigate(-1);
                }
              }}
              title="Go back"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6,
                border: '1px solid var(--g300)', background: '#fff',
                cursor: 'pointer', flexShrink: 0, marginRight: 4,
                color: 'var(--g600)', transition: 'all .12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--g100)'; e.currentTarget.style.color = 'var(--g900)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = 'var(--g600)'; }}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <Leaf size={18} />
          {pageName}
        </div>
        <GlobalCreateMenu />
        <div className="topbar-right">
          {/* Real-Time Notification Bell */}
          <NotificationCenter />
          <div className="topbar-divider" />
          <span className="topbar-role">{user?.role}</span>
          <div className="topbar-user">
            <div className="topbar-avatar">{user?.full_name?.charAt(0) || user?.fullName?.charAt(0) || 'U'}</div>
            <span>{user?.full_name || user?.fullName}</span>
          </div>
        </div>
      </header>

      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={switchTab}
        onClose={closeTab}
        onReorder={reorderTabs}
        onContextMenu={contextMenuHandler}
      />

      <main className="main-content main-content--tabs">
        <div className="tab-content-area">
          {tabs.map(tab => (
            <TabPanel key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
          ))}
        </div>
      </main>

      <Modal
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        title="Confirm Logout"
        icon={<LogOut size={16} style={{ marginRight: 8, color: 'var(--red)' }} />}
        style={{ width: 400 }}
        footer={
          <>
            <button className="btn btn-text" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { logout(); navigate('/login'); }}>Logout</button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--g700)', lineHeight: '1.5' }}>
          Are you sure you want to log out of your session?
        </p>
      </Modal>
    </div>
  );
}

export default function Layout() {
  return (
    <TabProvider>
      <LayoutInner />
    </TabProvider>
  );
}
