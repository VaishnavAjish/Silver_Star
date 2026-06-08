import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTabs } from '../tabs/TabContext';

export default function TransactionHeader({
  title, subtitle, icon, badge, breadcrumbs,
  backTo, backLabel = 'Back', actions, auditMeta,
}) {
  const navigate = useNavigate();
  // Safe use of useTabs by checking context availability if possible, 
  // but it's guaranteed to be within TabProvider here
  const { closeTab, openTab, activeTabId } = useTabs();

  const handleBack = () => {
    if (!backTo) return;
    if (typeof backTo === 'function') {
      backTo();
    } else {
      if (activeTabId) {
        closeTab(activeTabId);
      }
      openTab({ id: backTo, name: backLabel, path: backTo, closable: true });
      navigate(backTo);
    }
  };

  const hasCrumbRow = (breadcrumbs && breadcrumbs.length > 0) || backTo || auditMeta;

  return (
    <div className="txn-hdr">
      {hasCrumbRow && (
        <div className="txn-hdr-top">
          {backTo && (
            <button className="btn btn-sm" onClick={handleBack} style={{ padding: '3px 8px', flexShrink: 0 }}>
              <ChevronLeft size={13} /> {backLabel}
            </button>
          )}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="txn-breadcrumb">
              {breadcrumbs.map((bc, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <span className="txn-bc-sep">›</span>}
                  {bc.href
                    ? <Link to={bc.href}>{bc.label}</Link>
                    : <span className="txn-bc-cur">{bc.label}</span>
                  }
                </span>
              ))}
            </nav>
          )}
          {auditMeta && (
            <span style={{ fontSize: 11, color: 'var(--g400)', marginLeft: 'auto', flexShrink: 0 }}>
              {auditMeta}
            </span>
          )}
        </div>
      )}
      {(badge || subtitle || actions) && (
        <div className="txn-hdr-main">
          <div className="txn-title-block">
            {badge && (
              <div className="txn-title" style={{ padding: '2px 0' }}>
                <span className={`badge ${badge.className || 'b-draft'}`}>{badge.label}</span>
              </div>
            )}
            {subtitle && <div className="txn-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="txn-hdr-actions">{actions}</div>}
        </div>
      )}
    </div>
  );
}
