import { describe, expect, it } from '@jest/globals';
import type { StoryCommand } from './schema';
import {
  applyStoryCommands,
  interpolateVariables,
  parseNumericCommand,
  parseSingleNumericCommandFromText,
} from './commands';

const ref = { sourceId: 'source', unitId: 'source:0', start: 0, end: 10 };

function command(source: string): StoryCommand {
  return { ...parseNumericCommand(source), source, sourceRefs: [ref] };
}

describe('Story numeric commands', () => {
  it.each([
    ['$trust=2', 'trust', '=', 2],
    ['$trust+=2', 'trust', '+=', 2],
    ['$trust-=2', 'trust', '-=', 2],
    ['$trust*=2', 'trust', '*=', 2],
    ['$trust/=2', 'trust', '/=', 2],
    ['$ratio+=.5', 'ratio', '+=', 0.5],
  ] as const)('parses %s', (source, variable, operator, value) => {
    expect(parseNumericCommand(source)).toEqual({ variable, operator, value });
  });

  it('applies commands in order with missing variables defaulting to zero', () => {
    expect(applyStoryCommands({}, [
      command('$trust+=2'),
      command('$trust*=3'),
      command('$trust-=1'),
    ])).toEqual({ trust: 5 });
  });

  it('does not mutate the input variable state', () => {
    const state = { trust: 1 };
    expect(applyStoryCommands(state, [command('$trust+=1')])).toEqual({ trust: 2 });
    expect(state).toEqual({ trust: 1 });
  });

  it('interpolates known and missing variables', () => {
    expect(interpolateVariables('Trust: [trust], New: [newValue]', { trust: 2 }))
      .toBe('Trust: 2, New: 0');
  });

  it('rejects malformed and non-finite commands', () => {
    expect(() => parseNumericCommand('trust+=1')).toThrow(/invalid numeric command/i);
    expect(() => parseNumericCommand('$trust+=Infinity')).toThrow(/invalid numeric command/i);
  });

  it('extracts one numeric command from a structural source fragment', () => {
    expect(parseSingleNumericCommandFromText('($trust+=1; jump O1)')).toEqual({
      source: '$trust+=1',
      variable: 'trust',
      operator: '+=',
      value: 1,
    });
  });

  it('rejects source fragments containing multiple numeric commands', () => {
    expect(() => parseSingleNumericCommandFromText('($trust+=1; $courage+=2; jump O1)'))
      .toThrow(/invalid numeric command source/i);
  });

  it('stops on division by zero', () => {
    expect(() => applyStoryCommands({ trust: 2 }, [command('$trust/=0')])).toThrow(/zero/i);
  });
});
