import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type {
  KecoAdminOverview,
  KecoAdminUser,
  KecoAdminUserStatus,
} from '@/lib/types/kecoAdmin';
import {
  readKecoAdminCredits,
  type KecoAdminCredits,
} from '@/lib/server/kecoAdminCredits';

/** First-page size for Auth Admin listUsers; enough for the current account scale. */
const USERS_PER_PAGE = 100;

/** GoTrue Admin payloads include banned_until; auth-js User types omit it. */
type AuthAdminUser = User & { banned_until?: string | null };

type CreditUserValue = KecoAdminCredits['users'][string];

const ZERO_USER_CREDITS: Readonly<CreditUserValue> = Object.freeze({
  allocated: 0,
  used: 0,
  remaining: 0,
  overage: 0,
  deepseekTokens: 0,
  incompleteCount: 0,
});

function readBannedUntil(user: User): string | undefined {
  const bannedUntil = (user as AuthAdminUser).banned_until;
  return typeof bannedUntil === 'string' ? bannedUntil : undefined;
}

function resolveStatus(user: User, now: Date): KecoAdminUserStatus {
  const bannedUntil = readBannedUntil(user);
  if (!bannedUntil) return 'active';

  const bannedAt = Date.parse(bannedUntil);
  if (!Number.isFinite(bannedAt)) return 'active';
  return bannedAt > now.getTime() ? 'suspended' : 'active';
}

function mapAuthUser(
  user: User,
  now: Date,
  credits: CreditUserValue,
): KecoAdminUser {
  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    status: resolveStatus(user, now),
    creditAllocated: credits.allocated,
    creditUsed: credits.used,
    creditRemaining: credits.remaining,
    creditOverage: credits.overage,
    deepseekTokens: credits.deepseekTokens,
    creditUsageIncompleteCount: credits.incompleteCount,
  };
}

export async function readKecoAdminOverview(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<KecoAdminOverview> {
  const currentTime = now();
  const [authResult, credits] = await Promise.all([
    client.auth.admin.listUsers({
      page: 1,
      perPage: USERS_PER_PAGE,
    }),
    readKecoAdminCredits(client),
  ]);
  const { data, error } = authResult;

  if (error) {
    throw new Error('Unable to read the account total');
  }

  const total = 'total' in data ? data.total : undefined;
  if (!Number.isInteger(total) || Number(total) < 0) {
    throw new Error('Supabase returned an invalid account total');
  }

  const users = Array.isArray(data.users)
    ? data.users.map((user) => mapAuthUser(
      user,
      currentTime,
      credits.users[user.id] ?? ZERO_USER_CREDITS,
    ))
    : [];

  const creditUsage = {
    allocated: credits.allocated,
    used: credits.used,
    remaining: credits.remaining,
    overage: credits.overage,
    deepseekTokens: credits.deepseekTokens,
    incompleteCount: credits.incompleteCount,
    trackedFrom: credits.trackedFrom,
  };

  return {
    totalUsers: total as number,
    creditUsage,
    refreshedAt: currentTime.toISOString(),
    users,
  };
}
