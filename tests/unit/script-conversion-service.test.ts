import { jest } from '@jest/globals';

jest.mock('@/lib/agent/llm-client', () => ({
  completeLlm: jest.fn(),
}));

import { completeLlm } from '@/lib/agent/llm-client';
import {
  resolveScriptTextForImport,
  canImportScriptDirectly,
  looksLikeStructuredScript,
} from '@/lib/services/scriptConversionService';
import { parseText } from '@/lib/script-parser';

const mockedCompleteLlm = completeLlm as jest.MockedFunction<typeof completeLlm>;

const STANDARD_SCRIPT = `【Start｜Afternoon, small apartment】
（Type3・Narrator）The room is quiet.
（Type1・Atana）Hello.
（Type2・AI）Welcome back.`;

describe('canImportScriptDirectly', () => {
  it('returns true for valid standard script text', () => {
    expect(canImportScriptDirectly(STANDARD_SCRIPT)).toBe(true);
  });

  it('returns false for unstructured prose', () => {
    expect(looksLikeStructuredScript('Once upon a time, Atana woke up and made coffee.')).toBe(false);
    expect(canImportScriptDirectly('Once upon a time, Atana woke up and made coffee.')).toBe(false);
  });

  it('allows natural dialogue format without LLM conversion', () => {
    const natural = 'Atana: Hello there.\nAI: Welcome back.';
    expect(looksLikeStructuredScript(natural)).toBe(true);
    expect(canImportScriptDirectly(natural)).toBe(true);
  });

  it('keeps role-map types for directly imported natural dialogue', () => {
    const natural = 'Atana: Hello there.\nAI: Welcome back.';
    const roleMap = {
      Atana: { id: '', type: 1 },
      AI: { id: '', type: 2 },
    };

    expect(canImportScriptDirectly(natural, roleMap)).toBe(true);

    const script = parseText(natural, roleMap);
    expect(script.lines.find((line) => line.name === 'AI')?.type).toBe(2);
  });

  it('imports RPG scene format directly without LLM conversion', () => {
    const rpg = `South Figaro [004]
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

[The group arrives in South Figaro, encountering a strange individual.]

Locke: Right, ignore us...`;
    expect(looksLikeStructuredScript(rpg)).toBe(true);
    expect(canImportScriptDirectly(rpg)).toBe(true);
  });
});

describe('resolveScriptTextForImport', () => {
  beforeEach(() => {
    mockedCompleteLlm.mockReset();
  });

  it('returns source text unchanged when already importable', async () => {
    const result = await resolveScriptTextForImport(STANDARD_SCRIPT);
    expect(result).toEqual({
      fullText: STANDARD_SCRIPT,
      converted: false,
      warnings: [],
    });
    expect(mockedCompleteLlm).not.toHaveBeenCalled();
  });

  it('converts prose via LLM before import', async () => {
    mockedCompleteLlm.mockResolvedValue(STANDARD_SCRIPT);

    const result = await resolveScriptTextForImport(
      'Atana said hello. The AI replied with a welcome.'
    );

    expect(mockedCompleteLlm).toHaveBeenCalledTimes(1);
    expect(result.converted).toBe(true);
    expect(result.fullText).toBe(STANDARD_SCRIPT);
    expect(result.warnings).toEqual([]);
  });

  it('throws when source text is empty', async () => {
    await expect(resolveScriptTextForImport('   ')).rejects.toThrow(/content/i);
  });
});
