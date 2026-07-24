import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateAiMappingCandidates } from '@/lib/server/simulationFieldMappingService';
import { SIM_FIELDS } from '@/lib/simulation/data';

describe('simulation AI field mapping', () => {
  it('uses a non-streaming LLM request for short structured mapping output', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'src/lib/server/simulationFieldMappingService.ts',
    ), 'utf8');
    expect(source).toContain('completeLlmNonStreaming');
  });

  it('reports truncated model JSON as an invalid LLM response', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'src/app/api/simulation/field-mapping/route.ts',
    ), 'utf8');
    expect(source).toContain('error instanceof SyntaxError');
    expect(source).toContain("return 'llm_invalid_response'");
  });

  it('accepts only known, type-compatible, one-to-one AI mappings', () => {
    const columns = [
      { id: 'skill_key', label: 'Ability code', valueType: 'string' as const },
      { id: 'rank', label: 'Upgrade rank', valueType: 'number' as const },
      { id: 'price', label: 'Required points', valueType: 'number' as const },
      { id: 'flag', label: 'Enabled', valueType: 'boolean' as const },
    ];

    expect(validateAiMappingCandidates(
      SIM_FIELDS.skillc,
      columns,
      [
        { canonicalFieldId: 'skillId', studioColumnId: 'skill_key' },
        { canonicalFieldId: 'lv', studioColumnId: 'rank' },
        { canonicalFieldId: 'cost', studioColumnId: 'price' },
        { canonicalFieldId: 'cost', studioColumnId: 'flag' },
        { canonicalFieldId: 'unknown', studioColumnId: 'price' },
        { canonicalFieldId: 'cost', studioColumnId: 'missing' },
      ],
    )).toEqual({ skillId: 'skill_key', lv: 'rank', cost: 'price' });
  });

  it('does not let AI reuse one Studio column for multiple canonical fields', () => {
    expect(validateAiMappingCandidates(
      SIM_FIELDS.characters,
      [{ id: 'identifier', label: 'Identifier', valueType: 'string' }],
      [
        { canonicalFieldId: 'id', studioColumnId: 'identifier' },
        { canonicalFieldId: 'name', studioColumnId: 'identifier' },
      ],
    )).toEqual({ id: 'identifier' });
  });
});
