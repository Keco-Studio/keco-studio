'use client';

import { useQuery } from '@tanstack/react-query';

export function useKecoAdminAccess(userId?: string) {
  return useQuery({
    queryKey: ['keco-admin-access', userId],
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const response = await fetch('/api/keco-admin/access', {
          cache: 'no-store',
        });
        if (!response.ok) return false;

        const body = (await response.json()) as { isAdmin?: unknown };
        return body.isAdmin === true;
      } catch {
        return false;
      }
    },
  });
}
