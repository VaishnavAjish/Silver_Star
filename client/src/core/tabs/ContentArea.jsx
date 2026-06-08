import { Component, Suspense } from 'react';

export class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="tab-error">
          <div className="tab-error-icon">⚠</div>
          <h3>Something went wrong</h3>
          <p>{this.state.error?.message || 'An unexpected error occurred'}</p>
          <button className="btn" onClick={this.handleReload}>Reload Tab</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PanelFallback() {
  return (
    <div className="loading-screen" style={{ height: 200 }}>
      <div className="spinner" />
      <p>Loading tab...</p>
    </div>
  );
}

export default function ContentArea({ tabs, activeTabId, componentMap, resolveComponent }) {
  const getComponent = (tabId) => {
    if (componentMap?.[tabId]) return componentMap[tabId];
    if (resolveComponent) return resolveComponent(tabId);
    return null;
  };

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const Component = activeTab ? getComponent(activeTab.id) : null;

  return (
    <div className="tab-content-area">
      {activeTab && (
        <div
          key={activeTab.id}
          className="tab-panel tab-panel-active"
          role="tabpanel"
          aria-hidden="false"
          aria-labelledby={`tab-${activeTab.id}`}
        >
          {Component ? (
            <TabErrorBoundary key={`${activeTab.id}-${activeTab.refreshKey || 0}`}>
              <Suspense fallback={<PanelFallback />}>
                <Component />
              </Suspense>
            </TabErrorBoundary>
          ) : (
            <div className="tab-panel-placeholder">
              <p>{activeTab.name}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
