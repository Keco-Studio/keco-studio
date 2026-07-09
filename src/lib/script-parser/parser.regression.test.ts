/**
 * Regression guards for issue #159 parser data loss and misclassification.
 */

import { describe, expect, it } from '@jest/globals';
import { classifyLine } from './classifier';
import { findDialogueColon } from './colon';
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

  it('classifies dialogue with a leading timestamp and later separator colon', () => {
    const node = classifyLine('12:30: 说话内容');

    expect(node).toMatchObject({
      _type: 'dialogue',
      name: '12:30',
      content: '说话内容',
    });
  });

  it('finds the first non-time colon as the dialogue separator', () => {
    expect(findDialogueColon('12:30: 说话内容')).toBe('12:30'.length);
    expect(findDialogueColon('08:00 到 12:30: 说话内容')).toBe('08:00 到 12:30'.length);
    expect(findDialogueColon('12:30')).toBe(-1);
  });

  it('parses dialogue with multiple leading time-like colons before the separator', () => {
    const script = parseText('08:00 到 12:30: 说话内容');

    expect(script.lines).toContainEqual(
      expect.objectContaining({
        name: '08:00 到 12:30',
        content: '说话内容',
      })
    );
  });

  it('uses a full-width separator after a leading half-width time token', () => {
    const script = parseText('12:30：说话内容');

    expect(script.lines).toContainEqual(
      expect.objectContaining({
        name: '12:30',
        content: '说话内容',
      })
    );
  });
});
