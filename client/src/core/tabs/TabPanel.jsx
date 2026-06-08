import { Suspense, useMemo } from 'react';
import { UNSAFE_RouteContext } from 'react-router-dom';
import { TabErrorBoundary } from './ContentArea';
import { resolveRouteMatch } from '../../router';

function PanelFallback() {
  return (
    <div className="loading-screen" style={{ height: 200 }}>
      <div className="spinner" />
      <p>Loading...</p>
    </div>
  );
}

export default function TabPanel({ tab, isActive }) {
  const actualPath = tab.path || tab.id;
  const match = resolveRouteMatch(actualPath);

  const routeCtx = useMemo(() => {
    if (!match || Object.keys(match.params).length === 0) return null;
    return {
      outlet: null,
      isDataRoute: false,
      matches: [{
        params: match.params,
        pathname: actualPath,
        pathnameBase: actualPath,
        route: { path: match.routePath, element: null, children: undefined },
      }],
    };
  }, [match, actualPath]);

  if (!match) return null;

  const inner = (
    <div
      className={`tab-panel${isActive ? ' tab-panel-active' : ''}`}
      aria-hidden={!isActive}
    >
      <TabErrorBoundary>
        <Suspense fallback={<PanelFallback />}>
          <match.Component />
        </Suspense>
      </TabErrorBoundary>
    </div>
  );

  return routeCtx
    ? <UNSAFE_RouteContext.Provider value={routeCtx}>{inner}</UNSAFE_RouteContext.Provider>
    : inner;
}
