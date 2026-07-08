'use client';

import '@ant-design/v5-patch-for-react-19';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Create the QueryClient instance with shared cache policy.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep data fresh for 2 minutes; no refetch occurs during staleTime.
            staleTime: 2 * 60 * 1000,
            // Keep inactive cached data for 5 minutes.
            gcTime: 5 * 60 * 1000,
            // Retry failed queries once.
            retry: 1,
            // Avoid frequent requests when the browser window regains focus.
            refetchOnWindowFocus: false,
            // Refresh when the network reconnects.
            refetchOnReconnect: true,
            // Do not refetch on mount when cached data is still available.
            refetchOnMount: false,
            // React Query deduplicates concurrent requests with the same queryKey.
            // This is the default behavior; keep it documented here for clarity.
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
