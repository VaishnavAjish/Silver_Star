/**
 * Global Frontend Logger Interceptor
 * Captures React unhandled exceptions and console.errors
 * Sends them to the backend Logger endpoint for the Super Admin to view
 */

const MAX_QUEUE = 50;
const FLUSH_INTERVAL = 3000;
let queue = [];
let timer = null;

function flushQueue() {
  if (queue.length === 0) return;
  const token = localStorage.getItem('token');
  if (!token) {
    // If not logged in, drop the logs (or keep a small buffer until logged in)
    // To prevent memory leaks, we clear it if unauthenticated.
    queue = [];
    return;
  }

  const payload = { logs: [...queue] };
  queue = [];

  fetch('/api/admin/logger/frontend-logs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }).catch(() => {
    // Silently fail if network is down to prevent loop
  });
}

function enqueueLog(level, message, stack = '') {
  queue.push({
    level,
    message: String(message),
    stack: stack ? String(stack) : '',
    timestamp: new Date().toLocaleString()
  });

  if (queue.length >= MAX_QUEUE) {
    queue = queue.slice(-MAX_QUEUE);
  }

  if (!timer) {
    timer = setTimeout(() => {
      flushQueue();
      timer = null;
    }, FLUSH_INTERVAL);
  }
}

// 1. Intercept Global Window Errors
window.addEventListener('error', (event) => {
  enqueueLog('ERROR', `Uncaught Error: ${event.message}`, event.error?.stack || '');
});

// 2. Intercept Promise Rejections
window.addEventListener('unhandledrejection', (event) => {
  enqueueLog('ERROR', `Unhandled Promise Rejection: ${event.reason?.message || event.reason}`, event.reason?.stack || '');
});

// 3. Intercept console.error
const originalConsoleError = console.error;
console.error = function (...args) {
  originalConsoleError.apply(console, args);
  // Extract error strings and stacks
  const messages = args.map(arg => {
    if (arg instanceof Error) return arg.message;
    return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
  }).join(' ');

  const stacks = args
    .filter(arg => arg instanceof Error && arg.stack)
    .map(arg => arg.stack)
    .join('\n');

  enqueueLog('ERROR', messages, stacks);
};

export default {
  enqueueLog,
  flushQueue
};
