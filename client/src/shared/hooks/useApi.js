import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../core/context/AuthContext';
import { useDedup } from '../query/QueryProvider';

let refreshPromise = null;

function getTokenFallback() {
  return localStorage.getItem('sg_token') || null;
}

export function useApi() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const dedupClient = useDedup();

  const request = useCallback(async (url, options = {}) => {
    const token = auth?.token || getTokenFallback();
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    // Mutations (POST/PATCH/PUT/DELETE) get a tighter 15 s window so the user
    // hears back well before the server's own 25 s statement_timeout fires.
    // GET requests keep 30 s for large paginated queries.
    const isWrite = options.method && options.method !== 'GET';
    const timeoutMs = isWrite ? 15_000 : 30_000;

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(
          isWrite
            ? 'The server did not respond in time — the action may not have saved. Please refresh and try again.'
            : 'Server not responding — please check the backend is running'
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 401) {
      if (auth?.setNewToken) {
        if (!refreshPromise) {
          refreshPromise = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
            .then(r => {
              if (!r.ok) throw new Error('Refresh failed');
              return r.json();
            })
            .finally(() => { refreshPromise = null; });
        }
        try {
          const refreshData = await refreshPromise;
          if (refreshData?.token) {
            auth.setNewToken(refreshData.token);
            const retryHeaders = { ...headers, Authorization: `Bearer ${refreshData.token}` };
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
            try {
              const retryRes = await fetch(url, { ...options, headers: retryHeaders, signal: retryController.signal });
              if (retryRes.status === 401) throw new Error('Refresh token invalid on retry');
              if (retryRes.status === 204) return null;
              if (!retryRes.ok) {
                const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
                throw new Error(err.error || `HTTP ${retryRes.status}`);
              }
              return retryRes.json();
            } finally {
              clearTimeout(retryTimeoutId);
            }
          }
        } catch (err) {
          auth?.logout?.();
          throw new Error('Session expired');
        }
      } else {
        auth?.logout?.();
        throw new Error('Session expired');
      }
    }
    if (res.status === 204) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [auth]);

  const api = useMemo(() => ({
    get: (url, params) => {
      const qs = params ? `?${new URLSearchParams(params)}` : '';
      return dedupClient.dedup(`GET:${url}${qs}`, () => request(`${url}${qs}`, { method: 'GET' }));
    },
    post: (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) }),
    put: (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (url, body) => request(url, { method: 'PATCH', body: JSON.stringify(body) }),
    del: (url) => request(url, { method: 'DELETE' }),
    upload: (url, formData) => request(url, { method: 'POST', body: formData }),
    invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey] }),
    flushCache: () => dedupClient.flush(),
  }), [request, dedupClient, queryClient]);

  return api;
}

export default useApi;
