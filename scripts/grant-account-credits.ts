import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'node:path';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEDGER_COLUMNS = 'id,user_id,credit_delta,reason,reference_key,created_at';

const HELP = `Usage:
  npm run grant:account-credits -- --amount <positive integer> --reference <key> --reason <text>

Required environment variables:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  KECO_ADMIN_USER_ID`;

export type GrantAccountCreditsArguments =
  | { help: true }
  | { help: false; amount: number; reference: string; reason: string };

export type GrantAccountCreditsEnvironment = {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
};

export type GrantAccountCreditsInput = {
  userId: string;
  amount: number;
  reference: string;
  reason: string;
};

export type CreditLedgerEntry = {
  id: string;
  user_id: string;
  credit_delta: number;
  reason: string;
  reference_key: string;
  created_at: string;
};

type QueryResult<T> = Promise<{ data: T; error: unknown }>;

export type GrantAccountCreditsClient = {
  auth: {
    admin: {
      getUserById(userId: string): QueryResult<{ user: { id: string } | null }>;
    };
  };
  from(table: 'credit_ledger_entries'): {
    select(columns: string): {
      eq(column: 'reference_key', value: string): {
        maybeSingle(): QueryResult<CreditLedgerEntry | null>;
      };
    };
    insert(input: {
      user_id: string;
      credit_delta: number;
      reason: string;
      reference_key: string;
    }): Promise<{ error: unknown }>;
  };
};

export type GrantAccountCreditsResult = {
  status: 'created' | 'existing';
  entry: CreditLedgerEntry;
};

type CommandRuntime = {
  loadEnvironment(): Record<string, string | undefined>;
  createClient(url: string, serviceRoleKey: string): GrantAccountCreditsClient;
  writeOutput(message: string): void;
};

export function parsePositiveSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || !/^\d+$/.test(value)) {
    throw new Error('Amount must be a positive safe integer');
  }
  return parsed;
}

function validateText(value: string | undefined, name: string, maximumLength: number): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maximumLength) {
    throw new Error(`${name} must be at most ${maximumLength} characters`);
  }
  return normalized;
}

export function parseGrantAccountCreditsArguments(arguments_: readonly string[]): GrantAccountCreditsArguments {
  if (arguments_.includes('--help')) return { help: true };

  const values = new Map<string, string>();
  const supported = new Set(['--amount', '--reference', '--reason']);
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!supported.has(flag) || value === undefined || supported.has(value) || values.has(flag)) {
      throw new Error(HELP);
    }
    values.set(flag, value);
  }

  const rawAmount = values.get('--amount');
  if (rawAmount === undefined) throw new Error('--amount is required');

  return {
    help: false,
    amount: parsePositiveSafeInteger(rawAmount),
    reference: validateText(values.get('--reference'), '--reference', 160),
    reason: validateText(values.get('--reason'), '--reason', 256),
  };
}

function requiredEnvironmentValue(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parseGrantAccountCreditsEnvironment(
  environment: Record<string, string | undefined>,
): GrantAccountCreditsEnvironment {
  const supabaseUrl = requiredEnvironmentValue(environment, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requiredEnvironmentValue(environment, 'SUPABASE_SERVICE_ROLE_KEY');
  const userId = requiredEnvironmentValue(environment, 'KECO_ADMIN_USER_ID');
  if (!UUID_PATTERN.test(userId)) throw new Error('KECO_ADMIN_USER_ID must be a UUID');

  return { supabaseUrl, serviceRoleKey, userId: userId.toLowerCase() };
}

function validateGrantInput(input: GrantAccountCreditsInput): void {
  if (!UUID_PATTERN.test(input.userId)) throw new Error('Grant user ID must be a UUID');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('Grant amount must be a positive safe integer');
  }
  validateText(input.reference, 'Grant reference', 160);
  validateText(input.reason, 'Grant reason', 256);
}

function entryMatches(entry: CreditLedgerEntry, input: GrantAccountCreditsInput): boolean {
  return entry.user_id === input.userId
    && entry.credit_delta === input.amount
    && entry.reference_key === input.reference
    && entry.reason === input.reason;
}

async function readReference(
  client: GrantAccountCreditsClient,
  reference: string,
): Promise<CreditLedgerEntry | null> {
  try {
    const result = await client
      .from('credit_ledger_entries')
      .select(LEDGER_COLUMNS)
      .eq('reference_key', reference)
      .maybeSingle();
    if (result.error) throw new Error();
    return result.data;
  } catch {
    throw new Error('Unable to inspect the account Credit reference');
  }
}

function existingResult(
  entry: CreditLedgerEntry,
  input: GrantAccountCreditsInput,
): GrantAccountCreditsResult {
  if (!entryMatches(entry, input)) {
    throw new Error('The account Credit reference is already used by a different allocation');
  }
  return { status: 'existing', entry };
}

export async function grantAccountCredits(
  client: GrantAccountCreditsClient,
  input: GrantAccountCreditsInput,
): Promise<GrantAccountCreditsResult> {
  validateGrantInput(input);

  let authResult: Awaited<ReturnType<GrantAccountCreditsClient['auth']['admin']['getUserById']>>;
  try {
    authResult = await client.auth.admin.getUserById(input.userId);
  } catch {
    throw new Error('Auth user could not be confirmed');
  }
  if (authResult.error || !authResult.data.user) {
    throw new Error('Auth user could not be confirmed');
  }
  if (authResult.data.user.id !== input.userId) {
    throw new Error('Auth user identity mismatch');
  }

  const existing = await readReference(client, input.reference);
  if (existing) return existingResult(existing, input);

  let insertFailed = false;
  try {
    const result = await client.from('credit_ledger_entries').insert({
      user_id: input.userId,
      credit_delta: input.amount,
      reason: input.reason,
      reference_key: input.reference,
    });
    insertFailed = Boolean(result.error);
  } catch {
    insertFailed = true;
  }

  const confirmed = await readReference(client, input.reference);
  if (!confirmed) throw new Error('Unable to confirm the account Credit allocation');
  if (!entryMatches(confirmed, input)) {
    throw new Error('The account Credit reference is already used by a different allocation');
  }
  if (insertFailed) return { status: 'existing', entry: confirmed };
  return { status: 'created', entry: confirmed };
}

const defaultRuntime: CommandRuntime = {
  loadEnvironment() {
    return loadGrantAccountCreditsEnvironment();
  },
  createClient(url, serviceRoleKey) {
    return createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as GrantAccountCreditsClient;
  },
  writeOutput(message) {
    console.info(message);
  },
};

export function loadGrantAccountCreditsEnvironment(
  envPath = path.resolve(process.cwd(), '.env.local'),
): Record<string, string | undefined> {
  dotenv.config({ path: envPath, override: false, quiet: true });
  return process.env;
}

export async function runGrantAccountCreditsCommand(
  arguments_: readonly string[],
  runtime: CommandRuntime = defaultRuntime,
): Promise<void> {
  const parsedArguments = parseGrantAccountCreditsArguments(arguments_);
  if (parsedArguments.help === true) {
    runtime.writeOutput(HELP);
    return;
  }

  const environment = parseGrantAccountCreditsEnvironment(runtime.loadEnvironment());
  let client: GrantAccountCreditsClient;
  try {
    client = runtime.createClient(environment.supabaseUrl, environment.serviceRoleKey);
  } catch {
    throw new Error('Unable to initialize the account Credit client');
  }

  const result = await grantAccountCredits(client, {
    userId: environment.userId,
    amount: parsedArguments.amount,
    reference: parsedArguments.reference,
    reason: parsedArguments.reason,
  });
  runtime.writeOutput(
    `Account Credit allocation: status=${result.status}`
      + ` user_id=${result.entry.user_id.toLowerCase()}`
      + ` amount=${result.entry.credit_delta}`
      + ` reference=${result.entry.reference_key}`,
  );
}

if (path.basename(process.argv[1] ?? '') === 'grant-account-credits.ts') {
  runGrantAccountCreditsCommand(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account Credit allocation failed');
    process.exitCode = 1;
  });
}
