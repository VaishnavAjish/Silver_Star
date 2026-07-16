import { useEffect, useState, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TabPanel from '../tabs/TabPanel';
import { useAuth } from '../context/AuthContext';
import { useTabs, TabProvider, TabBar } from '../tabs';
import {
  Leaf, LayoutDashboard, Package, FileText, Settings as Cog, Database, BarChart3, LogOut,
  ChevronRight, ChevronLeft, Gem, Building2, Search, User, Warehouse, Receipt, Send, RotateCcw, Clock,
  ShoppingCart, CreditCard, HandCoins, BookOpen, TrendingUp, Calculator, Users, Landmark,
  TrendingDown, GitBranch, GitMerge, Layers, ShieldCheck, Cpu, ClipboardList, ArrowLeft, Share2
} from 'lucide-react';
import GlobalCreateMenu from '@features/quick-create/GlobalCreateMenu';
import CommandPalette from '@features/command-palette/CommandPalette';
import GlobalScanInput from '@features/scan/GlobalScanInput';
import { resolveRouteMatch } from '../../router';
import { NotificationCenter } from '../../shared/components/NotificationCenter';
import Modal from '../../shared/components/Modal';
import packageJson from '../../../../package.json';
import { NAVIGATION } from '../navigation/registry';
import { filterNavigation, flattenLeaves } from '../navigation/selectors';
import HeaderShortcuts from '@features/shortcuts/HeaderShortcuts';

// The central registry is the single source of truth. These re-exports keep
// historical importers (e.g. the command palette) working while they migrate to
// importing from core/navigation directly.
export const NAV = NAVIGATION;
export function flattenNav(items) { return flattenLeaves(items); }

const ROOT_PATHS = new Set([
  '/', '/inventory', '/invoices', '/purchase-notes', '/expenses',
  '/rough-growth', '/accounts', '/journal-entries',
  '/payments', '/receipts', '/bank-deposits', '/depreciation-runs', '/transfers',
  '/lot-movements', '/inventory/process-issues',
  '/vendors', '/customers', '/assets',
  '/ledger', '/trial-balance', '/pnl', '/costing', '/balance-sheet',
  '/fixed-asset-categories', '/cost-centers', '/cost-center-corrections', '/cost-center-reports', '/items', '/machines', '/departments',
  '/locations', '/uom', '/expense-categories', '/asset-templates',
  '/manufacturing/control-tower', '/manufacturing/process-master',
  '/reports/fixed-asset-register', '/reports/depreciation-schedule',
  '/reports/accounts-receivable', '/reports/accounts-payable',
  '/reports/bank-reconciliation', '/reports/cost-center',
  '/reports/fund-utilization',
  '/admin/users', '/clipboard',
]);

// Sidebar item. Permission filtering happens UPSTREAM via filterNavigation, so
// this component only renders. Groups are accessible <button>s with
// aria-expanded; compact mode is icon-only with tooltips (a group header in
// compact mode opens its first child).
function SidebarItem({ item, onNavigate, compact, collapsedSet, onToggleCollapse }) {
  const location = useLocation();

  // Direct link (no children)
  if (!item.children) {
    const isActive = location.pathname === item.path;
    return (
      <div className="nav-item">
        <button
          type="button"
          className={`nav-hdr${isActive ? ' active' : ''}`}
          title={compact ? item.label : undefined}
          aria-label={item.label}
          onClick={(e) => onNavigate(item, null, e)}
          onAuxClick={(e) => { if (e.button === 1) onNavigate(item, null, e); }}
        >
          <item.icon className="icon" size={16} />
          {!compact && item.label}
        </button>
      </div>
    );
  }

  const children = item.children;
  const isActive = children.some(c =>
    c.path && (location.pathname === c.path || location.pathname.startsWith(c.path + '/'))
  );
  // Default expanded; user may collapse. An active section always shows open.
  const expanded = compact ? false : (!collapsedSet.has(item.id) || isActive);

  const onHeader = (e) => {
    if (compact) {
      // Compact: jump to the first child for fast access.
      const first = children[0];
      if (first) onNavigate(first, item, e);
    } else {
      onToggleCollapse(item.id);
    }
  };

  return (
    <div className="nav-item">
      <button
        type="button"
        className={`nav-hdr ${expanded ? 'expanded' : ''}${isActive ? ' parent-active' : ''}`}
        aria-expanded={compact ? undefined : expanded}
        title={compact ? item.label : undefined}
        aria-label={item.label}
        onClick={onHeader}
      >
        <item.icon className="icon" size={16} />
        {!compact && item.label}
        {!compact && <ChevronRight className="arrow" size={10} />}
      </button>
      {!compact && (
        <div className={`nav-sub ${expanded ? 'open' : ''}`}>
          {children.map(child => (
            <button
              type="button"
              key={child.path}
              className={location.pathname === child.path || location.pathname.startsWith(child.path + '/') ? 'active' : ''}
              onClick={(e) => onNavigate(child, item, e)}
              onAuxClick={(e) => { if (e.button === 1) onNavigate(child, item, e); }}
              style={{ cursor: 'pointer', display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px 6px 42px', fontSize: 12, background: 'none', border: 'none', font: 'inherit', color: 'inherit' }}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayoutInner() {
  const { user, logout, hasPermission, hasRole } = useAuth();

  // Sidebar UI state (device-local): compact icon-only mode + remembered
  // collapsed sections. Stored in localStorage for instant first paint.
  const [compact, setCompact] = useState(() => localStorage.getItem('nav.compact') === '1');
  const [collapsedSet, setCollapsedSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('nav.collapsed') || '[]')); }
    catch { return new Set(); }
  });
  const toggleCompact = () => setCompact(v => { const n = !v; localStorage.setItem('nav.compact', n ? '1' : '0'); return n; });
  const toggleCollapse = (id) => setCollapsedSet(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem('nav.collapsed', JSON.stringify([...next]));
    return next;
  });

  // One shared, permission-filtered navigation tree for the sidebar. Empty
  // groups are dropped by the selector.
  const visibleNav = useMemo(
    () => filterNavigation(NAVIGATION, { hasPermission, hasRole }),
    [user, hasPermission, hasRole]
  );
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
    '/bills': 'Vendor Bills', '/bills/new': 'New Vendor Bill',
    '/purchase-notes': 'Purchase Notes', '/purchase-notes/new': 'New Purchase Note',
    '/expenses': 'Expenses', '/expenses/new': 'New Expense', '/rough-growth': 'Rough Growth',
    '/growth-runs': 'Growth Runs',
    '/invoices': 'Rough Invoices', '/invoices/new': 'New Invoice', '/customers': 'Customers',
    '/payments': 'Payments', '/payments/new': 'New Payment', '/receipts': 'Receipts', '/receipts/new': 'New Receipt', '/ledger': 'Account Ledger', '/trial-balance': 'Trial Balance',
    '/pnl': 'Profit & Loss', '/costing': 'Costing Report', '/balance-sheet': 'Balance Sheet',
    '/fixed-asset-categories': 'Fixed Asset Categories',
    '/cost-centers': 'Cost Centres',
    '/cost-center-corrections': 'Cost Centre Corrections',
    '/cost-center-reports': 'Cost Centre Reports',
    '/asset-templates': 'Asset Templates',
    '/assets': 'Fixed Assets', '/assets/new': 'Manual Asset Entry',
    '/depreciation-runs': 'Depreciation Runs', '/depreciation-runs/new': 'New Depreciation Run',
    '/transfers': 'Transfers', '/transfers/new': 'New Transfer',
    '/reports/fixed-asset-register': 'Fixed Asset Register',
    '/reports/depreciation-schedule': 'Depreciation Schedule',
    '/reports/accounts-receivable': 'Accounts Receivable',
    '/reports/accounts-payable': 'Accounts Payable',
    '/reports/transactions': 'Transactions Report',
    '/reports/cost-center-transactions': 'Cost Center Transactions',
    '/reports/bank-reconciliation': 'Bank Reconciliation',
    '/reports/cost-center': 'Cost Center P&L',
    '/reports/fund-utilization': 'Fund Utilization',
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
      lastLocationRef.current = '/inventory/process-issues';
      navigate('/inventory/process-issues', { replace: true });
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
    <div className={`app-layout ${compact ? 'compact' : ''}`}>
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Leaf size={16} /></div>
          {!compact && (
            <div>
              <div className="logo-text">SILVERSTAR</div>
              <div className="logo-sub">GROW UTILITY</div>
            </div>
          )}
        </div>
        <div className="sidebar-nav">
          {visibleNav.map((item) => (
            <SidebarItem
              key={item.id}
              item={item}
              onNavigate={handleNavigate}
              compact={compact}
              collapsedSet={collapsedSet}
              onToggleCollapse={toggleCollapse}
            />
          ))}
          <div className="nav-item" style={{ marginTop: 8, borderTop: '1px solid var(--sidebar-border)', paddingTop: 4 }}>
            <div className="nav-hdr" onClick={() => setShowLogoutConfirm(true)} title={compact ? 'Logout' : undefined}>
              <LogOut className="icon" size={16} />
              {!compact && 'Logout'}
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'space-between', padding: compact ? '12px 0' : '8px 12px' }}>
          <button
            type="button"
            onClick={toggleCompact}
            title={compact ? 'Expand sidebar' : 'Compact sidebar'}
            aria-label={compact ? 'Expand sidebar' : 'Compact sidebar'}
            aria-pressed={compact}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontSize: 11, fontWeight: 700, padding: compact ? 8 : 0 }}
          >
            {compact ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!compact && 'Compact'}
          </button>
          {!compact && (
            <span style={{ fontSize: 11, color: 'var(--brand)', fontFamily: 'var(--mono)', fontWeight: 800 }}>
              v{packageJson.version}
            </span>
          )}
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
        <HeaderShortcuts />
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
