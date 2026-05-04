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
