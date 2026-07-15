/**
 * Regression guards for issue #159 parser data loss and misclassification.
 */

import { describe, expect, it } from '@jest/globals';
import { classifyLine } from './classifier';
import { findDialogueColon } from './colon';
import { parseText } from './parser';

describe('Script parser issue #159 regressions', () => {
  it('surfaces a warning when a dialogue has more options than the output schema can store', () => {
    const script = parseText(`Narrator：Choose a direction
- Choice A
- Choice B
- Choice C
- Choice D`);

    const optionLine = script.lines.find((line) => line.option0);
    expect(optionLine?.option0).toBe('Choice A');
    expect(optionLine?.option1).toBe('Choice B');
    expect(optionLine?.option2).toBe('Choice C');
    expect((script as { warnings?: string[] }).warnings).toEqual([
      expect.stringContaining('Choice D'),
    ]);
  });

  it('parses smart-quoted dialogue content like straight-quoted content', () => {
    const script = parseText('Atana：“I chose A”\nAI：‘Acknowledged’');

    expect(script.lines.find((line) => line.name === 'Atana')?.content).toBe('I chose A');
    expect(script.lines.find((line) => line.name === 'AI')?.content).toBe('Acknowledged');
  });

  it('merges multi-line smart-quoted dialogue until the matching closing quote', () => {
    const script = parseText(`Atana：“first line
second line”`);

    expect(script.lines.find((line) => line.name === 'Atana')?.content).toBe('first line\nsecond line');
  });

  it('keeps time-like colons as narration content instead of speaker delimiters', () => {
    const script = parseText('12:30 the alarm went off');

    const narration = script.lines.find((line) => line.content === '12:30 the alarm went off');
    expect(narration).toBeDefined();
    expect(script.lines.find((line) => line.name === '12')).toBeUndefined();
  });

  it('classifies dialogue with a leading timestamp and later separator colon', () => {
    const node = classifyLine('12:30: spoken words');

    expect(node).toMatchObject({
      _type: 'dialogue',
      name: '12:30',
      content: 'spoken words',
    });
  });

  it('finds the first non-time colon as the dialogue separator', () => {
    expect(findDialogueColon('12:30: spoken words')).toBe('12:30'.length);
    expect(findDialogueColon('08:00 to 12:30: spoken words')).toBe('08:00 to 12:30'.length);
    expect(findDialogueColon('12:30')).toBe(-1);
  });

  it('parses dialogue with multiple leading time-like colons before the separator', () => {
    const script = parseText('08:00 to 12:30: spoken words');

    expect(script.lines).toContainEqual(
      expect.objectContaining({
        name: '08:00 to 12:30',
        content: 'spoken words',
      })
    );
  });

  it('uses a full-width separator after a leading half-width time token', () => {
    const script = parseText('12:30：spoken words');

    expect(script.lines).toContainEqual(
      expect.objectContaining({
        name: '12:30',
        content: 'spoken words',
      })
    );
  });
});
