import { describe, expect, it } from '@jest/globals';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';

describe('script conversion service facade', () => {
  it('returns validated Story IR for canonical scripts', async () => {
    const source = '【Start｜Opening】\n（Type1・Guide）Begin.';
    const result = await resolveStoryForImport(source);

    expect(result).toMatchObject({
      converted: false,
      document: { version: 1, entryLabel: 'Start' },
      audits: [],
      warnings: [],
    });
  });

  it('rejects empty source before model conversion', async () => {
    await expect(resolveStoryForImport('   ')).rejects.toThrow(/content/i);
  });
});
