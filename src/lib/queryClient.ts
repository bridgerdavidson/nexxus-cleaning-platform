import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: 'always',
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error: unknown) => {
          const code = (error as { code?: string } | null | undefined)?.code ?? '';
          if (code.startsWith('PGRST') || code.startsWith('42')) return false;
          return failureCount < 1;
        },
        retryDelay: 500,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Single shared QueryClient for the browser tab's lifetime. This app has no
 * SSR data-fetching through TanStack Query (no dehydrate/hydrate boundary;
 * every query fetches client-side after mount), so one instance is safe here
 * and lets plain, non-React modules reach the same cache a component would
 * via useQueryClient(). Needed by the billing 402 net (src/lib/billing/
 * frozenResponse.ts): a stale-tab write that gets refused has to invalidate
 * the cached billing state from billing-api.ts / apiFetch.ts, neither of
 * which run inside a component.
 *
 * LayoutWrapper's `useState(() => getQueryClient())` is what actually mounts
 * this instance in the provider; nothing else should call `new QueryClient()`
 * directly.
 */
let sharedQueryClient: QueryClient | undefined;
export function getQueryClient(): QueryClient {
  if (!sharedQueryClient) sharedQueryClient = makeQueryClient();
  return sharedQueryClient;
}
