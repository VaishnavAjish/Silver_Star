import { useState, useEffect } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { WIDGET_REGISTRY } from './widgetRegistry';
import { renderWidget } from './DashboardWidgets';
import AccessRestricted from '../../../shared/components/AccessRestricted';

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function Skeleton({ size }) {
  if (size === 'full') {
    return (
      <div>
        <div className="wsk wsk-line" style={{ width: '45%', marginBottom: 8 }} />
        <div className="wsk wsk-chart" />
      </div>
    );
  }
  return (
    <div>
      <div className="wsk" style={{ height: 64, borderRadius: 8, marginBottom: 10 }} />
      <div className="wsk wsk-line" style={{ width: '75%', marginBottom: 6 }} />
      <div className="wsk wsk-line" style={{ width: '55%' }} />
    </div>
  );
}

// ─── WidgetCard ───────────────────────────────────────────────────────────────

export default function WidgetCard({ widgetKey }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const api  = useApi();
  const meta = WIDGET_REGISTRY[widgetKey];

  const loadData = (showSpinner = false) => {
    let active = true;
    if (showSpinner) { setLoading(true); setError(null); }
    
    const endpoint = widgetKey === 'operator_operations' 
      ? '/api/dashboard/operator-summary' 
      : `/api/dashboard/widget/${widgetKey}`;

    api.get(endpoint)
      .then(res  => { 
        if (active) { 
          setData(widgetKey === 'operator_operations' ? res : res.data); 
          setError(null); 
          setLoading(false); 
        } 
      })
      .catch(err => { 
        if (active) { 
          if (err.status === 404) {
            setData({ _gracefulEmpty: true });
            setError(null);
          } else {
            setError(err); 
          }
          setLoading(false); 
        } 
      });
    return () => { active = false; };
  };

  useEffect(() => {
    return loadData(true);
  }, [widgetKey]); // eslint-disable-line react-hooks/exhaustive-deps


  if (!meta) return null;
  const Icon = meta.icon;
  const isFull = meta.size === 'full';

  return (
    <div className={`widget-card${isFull ? ' widget-card--full' : ''}`}>
      {/* Card header */}
      <div className="wc-hdr">
        <div className="wc-icon" style={{ background: meta.color }}>
          <Icon size={14} />
        </div>
        <div className="wc-titles">
          <div className="wc-title">{meta.title}</div>
          <div className="wc-desc">{meta.description}</div>
        </div>
      </div>

      {/* Card body */}
      <div className="wc-body">
        {loading && <Skeleton size={meta.size} />}
        {!loading && error?.status === 403 && <AccessRestricted />}
        {!loading && error && error.status !== 403 && <div className="wd-error">Could not load — {error.message}</div>}
        {!loading && !error && data != null && (data._gracefulEmpty ? <div className="wd-empty">0 (No data)</div> : renderWidget(widgetKey, data))}
        {!loading && !error && data == null && <div className="wd-empty">No data available</div>}
      </div>
    </div>
  );
}
