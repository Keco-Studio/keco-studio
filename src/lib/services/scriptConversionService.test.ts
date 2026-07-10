import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { resolveStoryForImport } from './scriptConversionService';

const serviceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/services/scriptConversionService.ts'),
  'utf8'
);

describe('scriptConversionService Story IR facade', () => {
  it('directly resolves lossless legacy input as Story IR', async () => {
    const source = '【Start｜Opening】\n（Type1・Guide）Begin.';
    const result = await resolveStoryForImport(source);

    expect(result.converted).toBe(false);
    expect(result.document.entryLabel).toBe('Start');
  });

  it('does not retain the obsolete standard-text LLM pipeline', () => {
    expect(serviceSource).not.toContain('completeLlm');
    expect(serviceSource).not.toContain('resolveScriptTextForImport');
    expect(serviceSource).not.toContain('standard format');
  });
});
