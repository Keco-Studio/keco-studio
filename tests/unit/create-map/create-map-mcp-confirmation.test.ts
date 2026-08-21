import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));
import {
  MapGenerationConfirmationError,
  signMapGenerationConfirmation,
  verifyMapGenerationConfirmation,
  type MapGenerationConfirmationBinding,
} from '@/lib/server/createMapGenerationConfirmation';

const now = 1_787_260_000_000;
const secret = 'map-confirmation-unit-test-secret-at-least-32-bytes';
const binding: MapGenerationConfirmationBinding = {
  purpose: 'submit',
  userId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  mapId: '33333333-3333-4333-8333-333333333333',
  revisionId: '44444444-4444-4444-8444-444444444444',
  assetId: '55555555-5555-4555-8555-555555555555',
  generationId: '66666666-6666-4666-8666-666666666666',
  planFingerprint: 'a'.repeat(64),
};

const dependencies = { secret, now: () => now };

describe('Create Map generation confirmation', () => {
  it('round-trips canonical claims with a ten-minute expiry', () => {
    const token = signMapGenerationConfirmation(binding, dependencies);
    expect(verifyMapGenerationConfirmation(token, binding, dependencies)).toEqual({
      version: 1,
      ...binding,
      issuedAt: now,
      expiresAt: now + 10 * 60 * 1000,
    });
  });

  it('rejects expiry at the exact boundary', () => {
    const token = signMapGenerationConfirmation(binding, dependencies);
    expect(() => verifyMapGenerationConfirmation(token, binding, {
      secret,
      now: () => now + 10 * 60 * 1000,
    })).toThrow(expect.objectContaining({ code: 'MAP_CONFIRMATION_EXPIRED' }));
  });

  it('rejects tampering and malformed tokens without echoing sensitive values', () => {
    const token = signMapGenerationConfirmation(binding, dependencies);
    for (const candidate of [`${token.slice(0, -1)}x`, 'not-a-token', `${token}.extra`]) {
      try {
        verifyMapGenerationConfirmation(candidate, binding, dependencies);
        throw new Error('Expected verification to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(MapGenerationConfirmationError);
        expect(error).toMatchObject({ code: 'MAP_CONFIRMATION_MISMATCH' });
        expect(String((error as Error).message)).not.toContain(candidate);
        expect(String((error as Error).message)).not.toContain(secret);
      }
    }
  });

  it.each([
    ['purpose', 'replace-unknown'],
    ['userId', '77777777-7777-4777-8777-777777777777'],
    ['projectId', '77777777-7777-4777-8777-777777777777'],
    ['mapId', '77777777-7777-4777-8777-777777777777'],
    ['revisionId', '77777777-7777-4777-8777-777777777777'],
    ['assetId', '77777777-7777-4777-8777-777777777777'],
    ['generationId', '77777777-7777-4777-8777-777777777777'],
    ['planFingerprint', 'b'.repeat(64)],
  ] as const)('rejects a changed %s binding', (field, value) => {
    const token = signMapGenerationConfirmation(binding, dependencies);
    expect(() => verifyMapGenerationConfirmation(token, {
      ...binding,
      [field]: value,
    }, dependencies)).toThrow(expect.objectContaining({
      code: 'MAP_CONFIRMATION_MISMATCH',
    }));
  });
});
