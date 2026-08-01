/**
 * Client-side Logger Utility — captures frontend errors & sends to backend logger
 */
export function logFrontendError(error, context = {}) {
  try {
    const payload = {
      timestamp: new Date().toLocaleString(),
      level: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : '',
      url: window.location.href,
      ...context,
    };

    fetch('/api/admin/logger/frontend-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    }).catch(() => {});
  } catch (e) {
    // Silent catch
  }
}

// Global window error listener setup
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    logFrontendError(event.error || event.message, { source: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logFrontendError(event.reason || 'Unhandled Promise Rejection', { source: 'unhandledrejection' });
  });
}
