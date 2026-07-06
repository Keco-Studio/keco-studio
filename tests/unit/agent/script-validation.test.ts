import { sanitizeLlmOutput, validateScriptStructure } from '../../../src/lib/agent/script-validation';

describe('sanitizeLlmOutput', () => {
  it('strips a leading code fence with language tag', () => {
    expect(sanitizeLlmOutput('```text\n【Start｜x】\nline')).toBe('【Start｜x】\nline');
  });

  it('strips a trailing code fence', () => {
    expect(sanitizeLlmOutput('【Start｜x】\nline\n```')).toBe('【Start｜x】\nline');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeLlmOutput('   hello   ')).toBe('hello');
  });
});

describe('validateScriptStructure', () => {
  it('returns no errors for a valid linear script', () => {
    const errors = validateScriptStructure({
      lines: [
        { label: 'Start' },
        { label: '' },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('flags zero-prefixed labels', () => {
    const errors = validateScriptStructure({ lines: [{ label: '01' }] });
    expect(errors.some((e) => e.includes('zero'))).toBe(true);
  });

  it('allows numeric scene IDs like 004', () => {
    const errors = validateScriptStructure({ lines: [{ label: '004' }] });
    expect(errors).toEqual([]);
  });

  it('flags option jumps with no matching label', () => {
    const errors = validateScriptStructure({
      lines: [
        { label: 'Start', option0_next: 'O9' },
        { label: 'O1' },
      ],
    });
    expect(errors.some((e) => e.includes('O9'))).toBe(true);
  });

  it('accepts option jumps that match an existing label', () => {
    const errors = validateScriptStructure({
      lines: [
        { label: 'Start', option0_next: 'O1' },
        { label: 'O1' },
      ],
    });
    expect(errors).toEqual([]);
  });
});
