/**
 * Regression guards for issue #159 parser data loss and misclassification.
 */

import { describe, expect, it } from '@jest/globals';
import { parseText } from './parser';

describe('Script parser issue #159 regressions', () => {
  it('surfaces a warning when a dialogue has more options than the output schema can store', () => {
    const script = parseText(`旁白：选择一个方向
- 选择A
- 选择B
- 选择C
- 选择D`);

    const optionLine = script.lines.find((line) => line.option0);
    expect(optionLine?.option0).toBe('选择A');
    expect(optionLine?.option1).toBe('选择B');
    expect(optionLine?.option2).toBe('选择C');
    expect((script as { warnings?: string[] }).warnings).toEqual([
      expect.stringContaining('选择D'),
    ]);
  });

  it('parses smart-quoted dialogue content like straight-quoted content', () => {
    const script = parseText('阿塔那：“我选择了A”\nAI：‘收到’');

    expect(script.lines.find((line) => line.name === '阿塔那')?.content).toBe('我选择了A');
    expect(script.lines.find((line) => line.name === 'AI')?.content).toBe('收到');
  });

  it('merges multi-line smart-quoted dialogue until the matching closing quote', () => {
    const script = parseText(`阿塔那：“第一行
第二行”`);

    expect(script.lines.find((line) => line.name === '阿塔那')?.content).toBe('第一行\n第二行');
  });

  it('keeps time-like colons as narration content instead of speaker delimiters', () => {
    const script = parseText('12:30 闹钟响了');

    const narration = script.lines.find((line) => line.content === '12:30 闹钟响了');
    expect(narration).toBeDefined();
    expect(script.lines.find((line) => line.name === '12')).toBeUndefined();
  });
});
