import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fetchGameDesignSystems, retryGddResourceJob } from './gameDesignSystemClient';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchGameDesignSystems', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads every bounded page using the server cursor', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        systems: [{ id: 'system-1' }],
        hasMore: true,
        nextOffset: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        systems: [{ id: 'system-2' }],
        hasMore: false,
        nextOffset: null,
      }));

    await expect(fetchGameDesignSystems()).resolves.toEqual([
      { id: 'system-1' },
      { id: 'system-2' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/game-design-systems?limit=100&offset=0',
      { cache: 'no-store' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/game-design-systems?limit=100&offset=1',
      { cache: 'no-store' },
    );
  });

  it('rejects a non-progressing server cursor', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      systems: [{ id: 'system-1' }],
      hasMore: true,
      nextOffset: 0,
    }));

    await expect(fetchGameDesignSystems()).rejects.toThrow(
      'Game Design System pagination did not advance.',
    );
  });

  it('stops after the defensive page limit', async () => {
    let offset = 0;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      offset += 1;
      return jsonResponse({
        systems: [{ id: `system-${offset}` }],
        hasMore: true,
        nextOffset: offset,
      });
    });

    await expect(fetchGameDesignSystems()).rejects.toThrow(
      'Game Design System pagination exceeded 100 pages.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });
});

describe('retryGddResourceJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries one resource inside its project and parent GDD path', async () => {
    const resource = { id: 'resource-1', kind: 'maps', status: 'queued', attempt_count: 0 };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ resource }));

    await expect(retryGddResourceJob('project-1', 'gdd-1', 'resource-1')).resolves.toEqual(resource);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/project-1/gdd-generation-jobs/gdd-1/resources/resource-1/retry',
      { method: 'POST' },
    );
  });
});
