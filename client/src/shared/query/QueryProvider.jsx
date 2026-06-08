import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useRef } from 'react';

const STALE_TIMES = {
  MASTER_DATA: 5 * 60 * 1000,
  DASHBOARD: 30 * 1000,
  LIST: 60 * 1000,
  DETAIL: 2 * 60 * 1000,
  REPORT: 30 * 1000,
};

const GC_TIMES = {
  MASTER_DATA: 30 * 60 * 1000,
  LIST: 10 * 60 * 1000,
  DETAIL: 15 * 60 * 1000,
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: STALE_TIMES.LIST,
        gcTime: GC_TIMES.LIST,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

const RequestDedupContext = createContext(null);

function createRequestDedup() {
  const inflight = new Map();
  return {
    async dedup(key, fetcher) {
      const existing = inflight.get(key);
      if (existing) return existing;
      const promise = fetcher().finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
      inflight.set(key, promise);
      return promise;
    },
    cancel(key) {
      inflight.delete(key);
    },
    flush() {
      inflight.clear();
    },
  };
}

export function SilverstarQueryProvider({ children }) {
  const queryClient = useMemo(() => createQueryClient(), []);
  const dedupRef = useRef(null);
  if (!dedupRef.current) dedupRef.current = createRequestDedup();
  const dedup = dedupRef.current;

  return (
    <QueryClientProvider client={queryClient}>
      <RequestDedupContext.Provider value={dedup}>
        {children}
      </RequestDedupContext.Provider>
    </QueryClientProvider>
  );
}

export function useDedup() {
  const ctx = useContext(RequestDedupContext);
  if (!ctx) throw new Error('useDedup must be used within SilverstarQueryProvider');
  return ctx;
}

export { STALE_TIMES, GC_TIMES };
