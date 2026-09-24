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

type KecoAdminStorage = {
  usedBytes: number;
  users: Record<string, number>;
};

// PostgreSQL's uuid type accepts canonical 8-4-4-4-12 UUID values beyond RFC versions 1-5.
const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

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
  storageUsedBytes: number,
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
    storageUsedBytes,
  };
}

function readStorageBytes(value: unknown, field: string): number {
  let parsed: bigint;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid Keco Admin Storage field: ${field}`);
    }
    return value;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`Invalid Keco Admin Storage field: ${field}`);
  }
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid Keco Admin Storage field: ${field}`);
  }
  if (parsed > MAX_SAFE_BIGINT) {
    throw new Error(`Invalid Keco Admin Storage field: ${field}`);
  }
  return Number(parsed);
}

async function readKecoAdminStorage(client: SupabaseClient): Promise<KecoAdminStorage> {
  const { data, error } = await client
    .from('account_storage_quotas')
    .select('owner_id,used_bytes,logical_used_bytes');
  if (error || !Array.isArray(data)) {
    throw new Error('Unable to load Keco Admin Storage');
  }

  const users: Record<string, number> = {};
  let usedBytes = 0;
  for (const [index, row] of data.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid Keco Admin Storage row: ${index}`);
    }
    const candidate = row as Record<string, unknown>;
    const ownerId = candidate.owner_id;
    if (typeof ownerId !== 'string' || !DATABASE_UUID_PATTERN.test(ownerId) || ownerId in users) {
      throw new Error(`Invalid Keco Admin Storage owner: ${index}`);
    }
    const physicalBytes = readStorageBytes(candidate.used_bytes, `rows.${index}.used_bytes`);
    const logicalBytes = readStorageBytes(candidate.logical_used_bytes, `rows.${index}.logical_used_bytes`);
    if (physicalBytes > Number.MAX_SAFE_INTEGER - logicalBytes) {
      throw new Error(`Invalid Keco Admin Storage total: ${index}`);
    }
    const bytes = physicalBytes + logicalBytes;
    if (usedBytes > Number.MAX_SAFE_INTEGER - bytes) {
      throw new Error('Invalid Keco Admin Storage total');
    }
    users[ownerId] = bytes;
    usedBytes += bytes;
  }
  return { usedBytes, users };
}

export async function readKecoAdminOverview(
  client: SupabaseClient,
  now: () => Date = () => new Date(),
): Promise<KecoAdminOverview> {
  const currentTime = now();
  const [authResult, credits, storage] = await Promise.all([
    client.auth.admin.listUsers({
      page: 1,
      perPage: USERS_PER_PAGE,
    }),
    readKecoAdminCredits(client),
    readKecoAdminStorage(client),
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
      storage.users[user.id] ?? 0,
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
    storageUsage: { usedBytes: storage.usedBytes },
    refreshedAt: currentTime.toISOString(),
    users,
  };
}
