import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KecoAdminCreditUsage } from '@/lib/types/kecoAdmin';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROOT_FIELDS = [
  'allocated',
  'used',
  'remaining',
  'overage',
  'deepseekTokens',
  'incompleteCount',
  'trackedFrom',
  'users',
] as const;

const USER_FIELDS = [
  'allocated',
  'used',
  'remaining',
  'overage',
  'deepseekTokens',
  'incompleteCount',
] as const;

type KecoAdminUserCredits = {
  allocated: number;
  used: number;
  remaining: number;
  overage: number;
  deepseekTokens: number;
  incompleteCount: number;
};

export type KecoAdminCredits = KecoAdminCreditUsage & {
  users: Record<string, KecoAdminUserCredits>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function readCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid Keco Admin Credit field: ${field}`);
  }
  return Number(value);
}

function readUserCreditUsage(
  value: unknown,
  userId: string,
): KecoAdminUserCredits {
  if (!isRecord(value) || !hasExactFields(value, USER_FIELDS)) {
    throw new Error(`Invalid Keco Admin Credit user: ${userId}`);
  }

  return {
    allocated: readCount(value.allocated, `users.${userId}.allocated`),
    used: readCount(value.used, `users.${userId}.used`),
    remaining: readCount(value.remaining, `users.${userId}.remaining`),
    overage: readCount(value.overage, `users.${userId}.overage`),
    deepseekTokens: readCount(value.deepseekTokens, `users.${userId}.deepseekTokens`),
    incompleteCount: readCount(
      value.incompleteCount,
      `users.${userId}.incompleteCount`,
    ),
  };
}

function readUserMap(value: unknown): Record<string, KecoAdminUserCredits> {
  if (!isRecord(value)) {
    throw new Error('Invalid Keco Admin Credit users');
  }

  return Object.fromEntries(Object.entries(value).map(([userId, usage]) => {
    if (!UUID_PATTERN.test(userId)) {
      throw new Error(`Invalid Keco Admin Credit user id: ${userId}`);
    }
    return [userId, readUserCreditUsage(usage, userId)];
  }));
}

function readCredits(data: unknown): KecoAdminCredits {
  if (!isRecord(data) || !hasExactFields(data, ROOT_FIELDS)) {
    throw new Error('Invalid Keco Admin Credit summary');
  }

  const trackedFrom = data.trackedFrom;
  if (typeof trackedFrom !== 'string' || !Number.isFinite(Date.parse(trackedFrom))) {
    throw new Error('Invalid Keco Admin Credit field: trackedFrom');
  }

  return {
    allocated: readCount(data.allocated, 'allocated'),
    used: readCount(data.used, 'used'),
    remaining: readCount(data.remaining, 'remaining'),
    overage: readCount(data.overage, 'overage'),
    deepseekTokens: readCount(data.deepseekTokens, 'deepseekTokens'),
    incompleteCount: readCount(data.incompleteCount, 'incompleteCount'),
    trackedFrom,
    users: readUserMap(data.users),
  };
}

export async function readKecoAdminCredits(
  client: SupabaseClient,
): Promise<KecoAdminCredits> {
  const { data, error } = await client.rpc('keco_admin_credit_summary');
  if (error) {
    throw new Error('Unable to load Keco Admin Credits');
  }
  return readCredits(data);
}
