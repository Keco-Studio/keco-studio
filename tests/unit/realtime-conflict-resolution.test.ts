import { describe, expect, it } from '@jest/globals';
import { resolveConflict } from '@/lib/realtime/conflict-resolution';

describe('resolveConflict', () => {
  it('uses server updatedAt instead of client wall-clock timestamps', () => {
    const result = resolveConflict(
      {
        assetId: 'asset-1',
        propertyKey: 'field-1',
        userId: 'local-user',
        updatedAt: '2026-07-07T10:00:02.000Z',
        timestamp: 1_000,
      },
      {
        assetId: 'asset-1',
        propertyKey: 'field-1',
        userId: 'remote-user',
        updatedAt: '2026-07-07T10:00:01.000Z',
        timestamp: 9_999_999,
      }
    );

    expect(result.winner).toBe('local');
    expect(result.reason).toBe('updatedAt');
  });

  it('chooses the newer server updatedAt for remote conflicts', () => {
    const result = resolveConflict(
      {
        assetId: 'asset-1',
        propertyKey: 'field-1',
        userId: 'local-user',
        updatedAt: '2026-07-07T10:00:01.000Z',
      },
      {
        assetId: 'asset-1',
        propertyKey: 'field-1',
        userId: 'remote-user',
        updatedAt: '2026-07-07T10:00:02.000Z',
      }
    );

    expect(result.winner).toBe('remote');
    expect(result.reason).toBe('updatedAt');
  });

  it('has a stable tie-breaker when monotonic keys are equal', () => {
    const local = {
      assetId: 'asset-1',
      propertyKey: 'field-1',
      userId: 'user-a',
      updatedAt: '2026-07-07T10:00:01.000Z',
    };
    const remote = {
      assetId: 'asset-1',
      propertyKey: 'field-1',
      userId: 'user-b',
      updatedAt: '2026-07-07T10:00:01.000Z',
    };

    expect(resolveConflict(local, remote)).toEqual(resolveConflict(local, remote));
    expect(resolveConflict(local, remote).reason).toBe('tieBreaker');
  });
});
