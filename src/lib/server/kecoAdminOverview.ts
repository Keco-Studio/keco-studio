import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type KecoAdminOverview = {
  totalUsers: number;
  refreshedAt: string;
};

export async function readKecoAdminOverview(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<KecoAdminOverview> {
  const { data, error } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });

  if (error) {
    throw new Error('Unable to read the account total');
  }

  const total = 'total' in data ? data.total : undefined;
  if (!Number.isInteger(total) || Number(total) < 0) {
    throw new Error('Supabase returned an invalid account total');
  }

  return {
    totalUsers: total as number,
    refreshedAt: now().toISOString(),
  };
}
