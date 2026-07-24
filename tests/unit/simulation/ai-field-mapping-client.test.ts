import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { requestAiFieldMappings } from '@/lib/simulation/aiFieldMappingClient';

describe('simulation AI field mapping client', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the Supabase access token to the authenticated mapping API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ mappings: { id: 'studio-id' } }),
    } as Response);
    const requestWithToken = requestAiFieldMappings as unknown as (
      role: 'characters',
      columns: readonly [{ id: string; label: string; valueType: 'string' }],
      accessToken: string,
    ) => Promise<unknown>;

    await requestWithToken(
      'characters',
      [{ id: 'studio-id', label: 'Character ID', valueType: 'string' }],
      'session-token',
    );

    expect(fetchMock).toHaveBeenCalledWith('/api/simulation/field-mapping', expect.objectContaining({
      headers: {
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      },
    }));
  });

  it('reuses a mapping for the same role and Studio columns', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ mappings: { name: 'cache-column' } }),
    } as Response);
    const columns = [{ id: 'cache-column', label: 'Display name', valueType: 'string' as const }];

    const first = await requestAiFieldMappings('characters', columns, 'session-token');
    const second = await requestAiFieldMappings('characters', columns, 'session-token');

    expect(first).toEqual({ name: 'cache-column' });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
