import { describe, expect, it } from '@jest/globals';
import { parseStoryDocument } from './schema';

const ref = { sourceId: 'source', unitId: 'source:0', start: 0, end: 5 };

function option(index: number) {
  return {
    text: `Choice ${index}`,
    target: `O${index}`,
    commands: [],
    sourceRefs: [ref],
  };
}

const validNode = {
  label: 'Start',
  type: 'dialogue' as const,
  speaker: 'Guide',
  content: 'Begin',
  commands: [],
  options: [],
  sourceRefs: [ref],
};

describe('Story IR schema', () => {
  it('parses a strict version-one document', () => {
    expect(parseStoryDocument({
      version: 1,
      entryLabel: 'Start',
      nodes: [validNode],
    }).entryLabel).toBe('Start');
  });

  it('accepts nested safe labels and more than three options', () => {
    const nodes = [
      { ...validNode, options: Array.from({ length: 12 }, (_, index) => option(index + 1)) },
      ...Array.from({ length: 12 }, (_, index) => ({
        ...validNode,
        label: `O${index + 1}_END`,
        content: `Ending ${index + 1}`,
      })),
    ];

    expect(() => parseStoryDocument({ version: 1, entryLabel: 'Start', nodes })).not.toThrow();
  });

  it.each(['1bad', '_bad', 'bad label', `A${'x'.repeat(64)}`])(
    'rejects unsafe label %s',
    (label) => {
      expect(() => parseStoryDocument({
        version: 1,
        entryLabel: 'Start',
        nodes: [{ ...validNode, label }],
      })).toThrow(/label/i);
    }
  );

  it('rejects unknown properties', () => {
    expect(() => parseStoryDocument({
      version: 1,
      entryLabel: 'Start',
      nodes: [{ ...validNode, surprise: true }],
    })).toThrow();
  });

  it('defaults only omitted empty structural collections', () => {
    const parsed = parseStoryDocument({
      version: 1,
      entryLabel: 'Start',
      nodes: [{
        label: 'Start',
        type: 'system',
        content: '',
        sourceRefs: [ref],
        options: [{
          text: 'Choice 1',
          target: 'O1',
          sourceRefs: [ref],
        }],
      }, {
        label: 'O1',
        type: 'narration',
        content: 'End',
        sourceRefs: [ref],
      }],
    });

    expect(parsed.nodes[0].commands).toEqual([]);
    expect(parsed.nodes[0].options[0].commands).toEqual([]);
    expect(parsed.nodes[1].commands).toEqual([]);
    expect(parsed.nodes[1].options).toEqual([]);
  });

  it('rejects prototype-pollution keys before schema parsing', () => {
    const dangerous = JSON.parse(JSON.stringify({
      version: 1,
      entryLabel: 'Start',
      nodes: [validNode],
    }).replace('"version"', '"__proto__":{"polluted":true},"version"'));

    expect(() => parseStoryDocument(dangerous)).toThrow(/unsafe json key/i);
  });
});
