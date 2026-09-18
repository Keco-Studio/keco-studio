import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountCreditSummary } from '@/lib/types/accountCredits';

const SUMMARY_FIELDS = [
  'allocated',
  'used',
  'remaining',
  'overage',
  'deepseekTokens',
  'incompleteCount',
  'trackedFrom',
] as const;

function readCreditAmount(value: unknown, field: string): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`Invalid account Credit field: ${field}`);
  }
  return value;
}

function readCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid account Credit field: ${field}`);
  }
  return Number(value);
}

function readSummary(data: unknown): AccountCreditSummary {
  if (
    !data
    || typeof data !== 'object'
    || Array.isArray(data)
    || Object.keys(data).length !== SUMMARY_FIELDS.length
    || !SUMMARY_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(data, field))
  ) {
    throw new Error('Invalid account Credit summary');
  }

  const summary = data as Record<string, unknown>;
  const trackedFrom = summary.trackedFrom;
  if (typeof trackedFrom !== 'string' || !Number.isFinite(Date.parse(trackedFrom))) {
    throw new Error('Invalid account Credit field: trackedFrom');
  }

  return {
    allocated: readCreditAmount(summary.allocated, 'allocated'),
    used: readCreditAmount(summary.used, 'used'),
    remaining: readCreditAmount(summary.remaining, 'remaining'),
    overage: readCreditAmount(summary.overage, 'overage'),
    deepseekTokens: readCount(summary.deepseekTokens, 'deepseekTokens'),
    incompleteCount: readCount(summary.incompleteCount, 'incompleteCount'),
    trackedFrom,
  };
}

export async function readOwnAccountCredits(client: SupabaseClient): Promise<AccountCreditSummary> {
  const { data, error } = await client.rpc('account_credit_summary');
  if (error) {
    throw new Error('Unable to load account Credits');
  }
  return readSummary(data);
}
