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
      /* RBAC Brick 7 — tell a REVOKED session apart from an EXPIRED one.
       *
       * An expired access token is routine: refresh, retry, the user notices
       * nothing. A session the server deliberately invalidated is not. Its
       * refresh token was revoked in the same transaction, so attempting a
       * refresh is guaranteed to fail — and doing it anyway costs a wasted round
       * trip and replaces the server's clear explanation ("Your access settings
       * changed") with a generic "Session expired".
       *
       * The body is read exactly once here, and every branch below terminates,
       * so it can never be read twice.
       */
      const sessionBody = await res.json().catch(() => null);
      const sessionCode = sessionBody?.code;

      if (sessionCode === 'SESSION_INVALIDATED' || sessionCode === 'ACCOUNT_DISABLED') {
        auth?.logout?.();
        const sessionErr = new Error(
          sessionBody?.error || 'Your access settings changed. Please sign in again.',
        );
        sessionErr.status = 401;
        sessionErr.code = sessionCode;
        throw sessionErr;
      }

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
          /* The original code let a token-less refresh response fall out of this
             block and continue to the generic handling below, which would then
             try to read `res` a second time. Since the 401 branch now consumes
             the body, that path has to end here explicitly rather than
             continuing on to a guaranteed "body already read" failure. */
          if (!refreshData?.token) {
            auth?.logout?.();
            const err = new Error('Session expired');
            err.status = 401;
            throw err;
          }

          auth.setNewToken(refreshData.token);
          const retryHeaders = { ...headers, Authorization: `Bearer ${refreshData.token}` };
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
          try {
            const retryRes = await fetch(url, { ...options, headers: retryHeaders, signal: retryController.signal });
            if (retryRes.status === 401) {
              auth?.logout?.();
              const err = new Error('Session expired');
              err.status = 401;
              throw err;
            }
            if (retryRes.status === 204) return null;
            if (!retryRes.ok) {
              const body = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
              /* Carries `status` and `code` like the non-retry path below. Without
                 them a 409 STALE_PERMISSION_VERSION that happened to arrive on a
                 retried request would reach the caller as a bare message, and the
                 User Card would report it as an ordinary save failure instead of
                 a stale-write conflict. */
              const err = new Error(body.error || `HTTP ${retryRes.status}`);
              err.status = retryRes.status;
              if (body.code) err.code = body.code;
              if (body.domain) err.domain = body.domain;
              throw err;
            }
            return retryRes.json();
          } finally {
            clearTimeout(retryTimeoutId);
          }
        } catch (err) {
          /* Only a genuine authentication failure ends the session. The previous
             code caught EVERYTHING here — so a 409 or a 500 on the retried
             request logged the user out and reported "Session expired", losing
             the real error. Anything that is not an auth failure is rethrown
             untouched, with its status and code intact. */
          if (err?.status && err.status !== 401) throw err;
          auth?.logout?.();
          const sessionErr = new Error('Session expired');
          sessionErr.status = 401;
          throw sessionErr;
        }
      } else {
        auth?.logout?.();
        const err = new Error('Session expired');
        err.status = 401;
        throw err;
      }
    }
    if (res.status === 204) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const errorObj = new Error(err.error || `HTTP ${res.status}`);
      errorObj.status = res.status;
      /* RBAC Brick 7: the stable machine-readable code the server sends with
         stale-write (409) and security responses. Callers branch on this, never
         on the message text. */
      if (err.code) errorObj.code = err.code;
      if (err.domain) errorObj.domain = err.domain;
      throw errorObj;
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
