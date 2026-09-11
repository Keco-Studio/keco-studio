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

  if (!Number.isInteger(data.total) || data.total < 0) {
    throw new Error('Supabase returned an invalid account total');
  }

  return {
    totalUsers: data.total,
    refreshedAt: now().toISOString(),
  };
}
