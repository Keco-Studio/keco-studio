import {
  grantAccountCredits,
  parseGrantAccountCreditsArguments,
  parseGrantAccountCreditsEnvironment,
  parsePositiveSafeInteger,
  runGrantAccountCreditsCommand,
} from '../../../scripts/grant-account-credits';

const USER_ID = '4f87e932-3567-4aac-b08f-a5d8f0fdd08f';
const OTHER_USER_ID = 'af7cfaf2-2722-4e90-b680-97b5c087939a';
const REFERENCE = 'initial-admin-allocation-2026-09-17';
const REASON = 'Initial account allocation';

type LedgerRow = {
  id: string;
  user_id: string;
  credit_delta: number;
  reason: string;
  reference_key: string;
  created_at: string;
};

function ledgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: '31d5a412-e43d-45df-9868-1d22418d3186',
    user_id: USER_ID,
    credit_delta: 100_000_000,
    reason: REASON,
    reference_key: REFERENCE,
    created_at: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

function buildClient(options: {
  entries?: LedgerRow[];
  authUserId?: string | null;
  authError?: boolean;
} = {}) {
  const entries = [...(options.entries ?? [])];
  const authLookups: string[] = [];

  const client = {
    auth: {
      admin: {
        async getUserById(userId: string) {
          authLookups.push(userId);
          return {
            data: { user: options.authUserId === null ? null : { id: options.authUserId ?? userId } },
            error: options.authError ? { message: 'Auth lookup failed' } : null,
          };
        },
      },
    },
    from(table: string) {
      if (table !== 'credit_ledger_entries') throw new Error(`Unexpected table: ${table}`);
      return {
        select() {
          return {
            eq(column: string, value: string) {
              if (column !== 'reference_key') throw new Error(`Unexpected filter: ${column}`);
              return {
                async maybeSingle() {
                  return { data: entries.find(entry => entry.reference_key === value) ?? null, error: null };
                },
              };
            },
          };
        },
        async insert(input: Omit<LedgerRow, 'id' | 'created_at'>) {
          entries.push(ledgerRow({
            user_id: input.user_id,
            credit_delta: input.credit_delta,
            reason: input.reason,
            reference_key: input.reference_key,
          }));
          return { error: null };
        },
      };
    },
  };

  return { client, entries, authLookups };
}

const grantInput = {
  userId: USER_ID,
  amount: 100_000_000,
  reference: REFERENCE,
  reason: REASON,
};

describe('grant account Credits operator command', () => {
  describe('parsePositiveSafeInteger', () => {
    it('accepts a positive safe integer', () => {
      expect(parsePositiveSafeInteger('100000000')).toBe(100_000_000);
    });

    it.each(['0', '-1', '1.5', '9007199254740992', 'not-a-number'])(
      'rejects %s',
      value => {
        expect(() => parsePositiveSafeInteger(value)).toThrow('positive safe integer');
      },
    );
  });

  describe('pure input parsing', () => {
    it('parses the explicit operator arguments', () => {
      expect(parseGrantAccountCreditsArguments([
        '--amount', '100000000',
        '--reference', REFERENCE,
        '--reason', REASON,
      ])).toEqual({
        help: false,
        amount: 100_000_000,
        reference: REFERENCE,
        reason: REASON,
      });
    });

    it.each([
      [],
      ['--amount', '100000000', '--reference', REFERENCE],
      ['--amount', '100000000', '--reason', REASON],
      ['--reference', REFERENCE, '--reason', REASON],
      ['--amount', '100000000', '--reference', REFERENCE, '--reason', REASON, '--unknown'],
    ].map(arguments_ => ({ arguments_ })))('rejects missing or unknown arguments: $arguments_', ({ arguments_ }) => {
      expect(() => parseGrantAccountCreditsArguments(arguments_)).toThrow();
    });

    it('recognizes help without requiring mutation arguments', () => {
      expect(parseGrantAccountCreditsArguments(['--help'])).toEqual({ help: true });
    });

    it('requires all environment variables and parses the Auth UUID', () => {
      expect(parseGrantAccountCreditsEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        KECO_ADMIN_USER_ID: USER_ID,
      })).toEqual({
        supabaseUrl: 'https://project.supabase.co',
        serviceRoleKey: 'service-role-secret',
        userId: USER_ID,
      });

      expect(() => parseGrantAccountCreditsEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        KECO_ADMIN_USER_ID: 'not-a-uuid',
      })).toThrow('KECO_ADMIN_USER_ID');
      expect(() => parseGrantAccountCreditsEnvironment({})).toThrow('NEXT_PUBLIC_SUPABASE_URL');
    });
  });

  it('confirms the target identity through Supabase Auth', async () => {
    const { client, entries, authLookups } = buildClient({ authUserId: OTHER_USER_ID });

    await expect(grantAccountCredits(client, grantInput)).rejects.toThrow('Auth user identity mismatch');
    expect(authLookups).toEqual([USER_ID]);
    expect(entries).toHaveLength(0);
  });

  it('rejects a missing Auth user without inserting a ledger entry', async () => {
    const { client, entries } = buildClient({ authUserId: null });

    await expect(grantAccountCredits(client, grantInput)).rejects.toThrow('Auth user could not be confirmed');
    expect(entries).toHaveLength(0);
  });

  it('treats an identical existing reference as an idempotent success', async () => {
    const existing = ledgerRow();
    const { client, entries } = buildClient({ entries: [existing] });

    await expect(grantAccountCredits(client, grantInput)).resolves.toEqual({
      status: 'existing',
      entry: existing,
    });
    expect(entries).toEqual([existing]);
  });

  it.each([
    ['user', { user_id: OTHER_USER_ID }],
    ['amount', { credit_delta: 99_999_999 }],
    ['reason', { reason: 'Different allocation' }],
  ])('rejects reference reuse with a mismatched %s', async (_field, overrides) => {
    const { client, entries } = buildClient({ entries: [ledgerRow(overrides)] });

    await expect(grantAccountCredits(client, grantInput)).rejects.toThrow('reference is already used');
    expect(entries).toHaveLength(1);
  });

  it('inserts one missing entry and confirms it by rereading the reference', async () => {
    const { client, entries } = buildClient();

    await expect(grantAccountCredits(client, grantInput)).resolves.toEqual({
      status: 'created',
      entry: ledgerRow(),
    });
    expect(entries).toEqual([ledgerRow()]);
  });

  it('prints help before loading environment variables or constructing a client', async () => {
    const output: string[] = [];

    await runGrantAccountCreditsCommand(['--help'], {
      loadEnvironment: () => { throw new Error('environment must not load'); },
      createClient: () => { throw new Error('client must not be constructed'); },
      writeOutput: message => output.push(message),
    });

    expect(output.join('\n')).toContain('grant:account-credits');
  });

  it('does not print the service role credential', async () => {
    const secret = 'service-role-secret-that-must-not-be-logged';
    const output: string[] = [];
    const { client } = buildClient();

    await runGrantAccountCreditsCommand([
      '--amount', '100000000',
      '--reference', REFERENCE,
      '--reason', REASON,
    ], {
      loadEnvironment: () => ({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: secret,
        KECO_ADMIN_USER_ID: USER_ID,
      }),
      createClient: () => client,
      writeOutput: message => output.push(message),
    });

    expect(output.join('\n')).not.toContain(secret);
    expect(output.join('\n')).toContain(REFERENCE);
  });
});
