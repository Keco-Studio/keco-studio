import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import { readOwnAccountCredits } from '@/lib/server/accountCredits';

const validSummary = {
  allocated: 100,
  used: 40,
  remaining: 60,
  overage: 0,
  deepseekTokens: 120,
  incompleteCount: 2,
  trackedFrom: '2026-09-17T00:00:00.000Z',
};

function clientFor(data: unknown, error: unknown = null) {
  return { rpc: jest.fn().mockResolvedValue({ data, error }) };
}

describe('readOwnAccountCredits', () => {
  it('returns an exact valid account credit summary from the parameterless RPC', async () => {
    const client = clientFor(validSummary);

    await expect(readOwnAccountCredits(client as never)).resolves.toEqual(validSummary);
    expect(client.rpc).toHaveBeenCalledWith('account_credit_summary');
  });

  it.each([
    ['negative', 'allocated', -1],
    ['fractional', 'used', 1.5],
    ['unsafe', 'remaining', Number.MAX_SAFE_INTEGER + 1],
    ['missing', 'overage', undefined],
    ['non-numeric', 'deepseekTokens', '120'],
    ['negative incomplete count', 'incompleteCount', -1],
  ])('rejects a %s account Credit count field', async (_label, field, value) => {
    const summary = { ...validSummary, [field]: value };

    await expect(readOwnAccountCredits(clientFor(summary) as never)).rejects.toThrow(
      `Invalid account Credit field: ${field}`,
    );
  });

  it('rejects malformed timestamps and unexpected response fields', async () => {
    await expect(readOwnAccountCredits(clientFor({
      ...validSummary,
      trackedFrom: 'not-a-timestamp',
    }) as never)).rejects.toThrow('Invalid account Credit field: trackedFrom');

    await expect(readOwnAccountCredits(clientFor({
      ...validSummary,
      extra: 'not part of the contract',
    }) as never)).rejects.toThrow('Invalid account Credit summary');
  });

  it('rejects RPC errors and null response data', async () => {
    await expect(readOwnAccountCredits(clientFor(validSummary, { message: 'RPC failed' }) as never))
      .rejects.toThrow('Unable to load account Credits');
    await expect(readOwnAccountCredits(clientFor(null) as never))
      .rejects.toThrow('Invalid account Credit summary');
  });
});
