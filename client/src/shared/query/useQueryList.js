import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '../../core/context/AuthContext';
import { useDedup, STALE_TIMES, GC_TIMES } from './QueryProvider';

function getToken() {
  try {
    const raw = localStorage.getItem('sg_auth');
    if (!raw) return null;
    return JSON.parse(raw).token;
  } catch { return null; }
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.body || options.body instanceof FormData) {
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('sg_auth');
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function buildKey(url, params) {
  if (!params) return [url];
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    if (params[k] != null) acc[k] = params[k];
    return acc;
  }, {});
  return [url, sorted];
}

export function useQueryList(url, params = {}, options = {}) {
  const queryKey = buildKey(url, params);
  const dedupClient = useDedup();

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => dedupClient.dedup(
      JSON.stringify(queryKey),
      () => apiFetch(`${url}?${new URLSearchParams(params)}`, { signal })
    ),
    placeholderData: keepPreviousData,
    staleTime: options.staleTime ?? STALE_TIMES.LIST,
    gcTime: options.gcTime ?? GC_TIMES.LIST,
    retry: options.retry ?? 1,
    enabled: options.enabled ?? true,
  });
}

export function useQueryDetail(url, id, options = {}) {
  const queryKey = [url, id];
  const dedupClient = useDedup();

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => dedupClient.dedup(
      JSON.stringify(queryKey),
      () => apiFetch(`${url}/${id}`, { signal })
    ),
    staleTime: options.staleTime ?? STALE_TIMES.DETAIL,
    gcTime: options.gcTime ?? GC_TIMES.DETAIL,
    retry: options.retry ?? 1,
    enabled: options.enabled ?? (id != null),
  });
}

export function useQueryTree(url, options = {}) {
  const queryKey = [url, 'tree'];
  const dedupClient = useDedup();

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => dedupClient.dedup(
      JSON.stringify(queryKey),
      () => apiFetch(url, { signal })
    ),
    staleTime: options.staleTime ?? STALE_TIMES.MASTER_DATA,
    gcTime: options.gcTime ?? GC_TIMES.MASTER_DATA,
    retry: 2,
  });
}

export function useMutationAction(method, url, options = {}) {
  const queryClient = useQueryClient();
  const dedupClient = useDedup();

  return useMutation({
    mutationFn: async (body) => {
      dedupClient.flush();
      const fetchOptions = {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      if (body && method !== 'delete') {
        fetchOptions.body = JSON.stringify(body);
      }
      return apiFetch(url, fetchOptions);
    },
    onSuccess: (data, variables) => {
      options.onSuccess?.(data, variables);
      if (options.invalidate !== false) {
        const invalidations = options.invalidateQueries ?? [];
        const patterns = invalidations.length > 0
          ? invalidations
          : [[url]];
        patterns.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      }
    },
    onError: (err) => {
      options.onError?.(err);
    },
    retry: options.retry ?? 0,
  });
}

export function usePaginatedQuery(url, params = {}, options = {}) {
  const { page = 1, pageSize = 100, ...rest } = params;
  const queryKey = buildKey(url, { page, pageSize, ...rest });
  const dedupClient = useDedup();

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => dedupClient.dedup(
      JSON.stringify(queryKey),
      () => apiFetch(`${url}?${new URLSearchParams({ page, limit: pageSize, ...rest })}`, { signal })
    ),
    placeholderData: keepPreviousData,
    staleTime: options.staleTime ?? STALE_TIMES.LIST,
    gcTime: options.gcTime ?? GC_TIMES.LIST,
  });
}
