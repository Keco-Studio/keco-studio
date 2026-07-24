import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { completeLlmNonStreaming } from '@/lib/agent/llm-client';
import { suggestSimulationFieldMappings } from '@/lib/server/simulationFieldMappingService';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlmNonStreaming: jest.fn() }));

const mockedCompleteLlm = jest.mocked(completeLlmNonStreaming);

describe('simulation AI field mapping cache', () => {
  beforeEach(() => {
    mockedCompleteLlm.mockReset();
  });

  it('deduplicates concurrent requests and caches the validated mapping', async () => {
    mockedCompleteLlm.mockResolvedValue(JSON.stringify({
      mappings: [{ canonicalFieldId: 'name', studioColumnId: 'server-cache-column' }],
    }));
    const columns = [{
      id: 'server-cache-column',
      label: 'Display name',
      valueType: 'string' as const,
    }];

    const [first, second] = await Promise.all([
      suggestSimulationFieldMappings('characters', columns),
      suggestSimulationFieldMappings('characters', columns),
    ]);
    const third = await suggestSimulationFieldMappings('characters', columns);

    expect(first).toEqual({ name: 'server-cache-column' });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(mockedCompleteLlm).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxTokens: 2_000, thinking: 'disabled' }),
    );
  });

  it('retries once when the provider aborts before returning tool output', async () => {
    mockedCompleteLlm
      .mockRejectedValueOnce(new Error('LLM aborted before completing the response.'))
      .mockResolvedValueOnce(JSON.stringify({
        mappings: [{ canonicalFieldId: 'name', studioColumnId: 'abort-retry-column' }],
      }));

    await expect(suggestSimulationFieldMappings('characters', [{
      id: 'abort-retry-column',
      label: 'Character name',
      valueType: 'string',
    }])).resolves.toEqual({ name: 'abort-retry-column' });
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);
  });

  it('retries once when the model returns invalid mapping JSON', async () => {
    mockedCompleteLlm
      .mockResolvedValueOnce('{"mappings":')
      .mockResolvedValueOnce(JSON.stringify({
        mappings: [{ canonicalFieldId: 'name', studioColumnId: 'json-retry-column' }],
      }));

    await expect(suggestSimulationFieldMappings('characters', [{
      id: 'json-retry-column',
      label: 'Display name',
      valueType: 'string',
    }])).resolves.toEqual({ name: 'json-retry-column' });
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(2);
  });
});
