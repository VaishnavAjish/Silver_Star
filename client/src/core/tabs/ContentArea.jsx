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

  return (
    <div className="tab-content-area">
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const Component = getComponent(tab.id);
        return (
          <div
            key={tab.id}
            className={`tab-panel${isActive ? ' tab-panel-active' : ''}`}
            role="tabpanel"
            aria-hidden={!isActive}
            aria-labelledby={`tab-${tab.id}`}
          >
            {Component ? (
              <TabErrorBoundary key={`${tab.id}-${tab.refreshKey || 0}`}>
                <Suspense fallback={<PanelFallback />}>
                  <Component />
                </Suspense>
              </TabErrorBoundary>
            ) : (
              <div className="tab-panel-placeholder">
                <p>{tab.name}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
