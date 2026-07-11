import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({ completeLlm: jest.fn() }));

import { completeLlm } from '@/lib/agent/llm-client';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;

describe('script conversion service facade', () => {
  beforeEach(() => mockedCompleteLlm.mockReset());

  it('returns validated Story IR for canonical scripts', async () => {
    mockedCompleteLlm.mockResolvedValueOnce(JSON.stringify({ verdict: 'pass', issues: [] }));
    const source = '【Start｜Opening】\n（Type1・Guide）Begin.';
    const result = await resolveStoryForImport(source);

    expect(result).toMatchObject({
      converted: false,
      document: { version: 1, entryLabel: 'Start' },
      audit: { verdict: 'pass', issues: [] },
      plan: null,
    });
    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(mockedCompleteLlm.mock.calls[0][1].toolName).toBe('submit_story_plan_audit');
  });

  it('rejects empty source before model conversion', async () => {
    await expect(resolveStoryForImport('   ')).rejects.toThrow(/content/i);
  });
});
