import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
const serviceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/services/scriptConversionService.ts'),
  'utf8'
);

describe('scriptConversionService audited plan facade', () => {
  it('exports the minimal story-plan resolver', () => {
    expect(serviceSource).toContain("@/lib/story-plan/conversion");
    expect(serviceSource).toContain('resolveStoryPlanForImport as resolveStoryForImport');
  });

  it('does not retain the obsolete standard-text LLM pipeline', () => {
    expect(serviceSource).not.toContain('completeLlm');
    expect(serviceSource).not.toContain('resolveScriptTextForImport');
    expect(serviceSource).not.toContain('standard format');
    expect(serviceSource).not.toContain("@/lib/story-ir/conversion");
  });
});
