import { describe, expect, it } from '@jest/globals';
import {
  isGddGenerationInputV2,
  parseArtifactsV2,
  parseBlueprintOutlineV2,
  parseDocumentV2,
  parseGenerationInputV2,
  parseNumericRegistryV2,
  parseReviewV2,
  parseSectionV2,
  parseTypedBlockV2,
} from './contracts';

const validRegistry = {
  version: 2,
  entries: [
    { id: 'economy.gold', value: 120, label: 'Starting gold' },
    { id: 'economy.xp', value: 42, label: 'Starting xp' },
  ],
};

const validBlocks = [
  { kind: 'paragraph', id: 'intro', text: 'This is the opening paragraph.' },
  { kind: 'bullet-list', id: 'bullet-list', items: ['First', 'Second'] },
  {
    kind: 'data-table',
    id: 'economy-table',
    columns: ['Name', 'Value'],
    rows: [
      ['Gold', '120'],
      ['XP', '42'],
    ],
  },
  {
    kind: 'formula',
    id: 'formula',
    expression: 'economy.gold + economy.xp',
    numericRefs: ['economy.gold', 'economy.xp'],
  },
  {
    kind: 'example',
    id: 'example',
    title: 'Example use',
    body: 'Start with 120 gold.',
    numericRefs: ['economy.gold'],
  },
  {
    kind: 'flow',
    id: 'flow',
    steps: [
      { id: 'step-1', text: 'Start' },
      { id: 'step-2', text: 'Finish' },
    ],
  },
  { kind: 'quote', id: 'quote', text: 'The whole is more than the sum of its parts.', cite: 'Aristotle' },
] as const;

const validBlueprint = {
  version: 2,
  nodes: [
    { id: 'root', label: 'Root', depth: 0, group: 'document' },
    { id: 'core-loop', label: 'Core loop', depth: 1, parentId: 'root', group: 'system' },
    { id: 'economy', label: 'Economy', depth: 2, parentId: 'core-loop', group: 'system' },
  ],
};

const validSection = {
  id: 'section-1',
  title: 'Core systems',
  depth: 1,
  parentId: 'root',
  blocks: validBlocks,
  numericRefs: ['economy.gold', 'economy.xp'],
};

const validDocument = {
  version: 2,
  id: 'gdd-1',
  title: 'Harbor Tactics GDD',
  blueprint: validBlueprint,
  sections: [validSection],
  numericRegistry: validRegistry,
};

const validReview = {
  version: 2,
  summary: 'Review-ready.',
  issues: [
    { id: 'issue-1', severity: 'warning', message: 'Clarify progression.' },
  ],
};

const validArtifacts = {
  version: 2,
  markdown: '# Harbor Tactics',
  outline: validBlueprint,
  review: validReview,
};

const validInput = {
  version: 2,
  projectId: 'project-1',
  projectName: 'Harbor Tactics',
  systemTitle: 'Tactical Systems',
  blueprint: validBlueprint,
  numericRegistry: validRegistry,
  sections: [validSection],
  document: validDocument,
  review: validReview,
  artifacts: validArtifacts,
};

describe('GDD generation v2 contracts', () => {
  it('parses a strict structured generation input', () => {
    expect(parseGenerationInputV2(validInput)).toEqual(validInput);
    expect(isGddGenerationInputV2(validInput)).toBe(true);
  });

  it('parses the structured subdocuments', () => {
    expect(parseBlueprintOutlineV2(validBlueprint)).toEqual(validBlueprint);
    expect(parseNumericRegistryV2(validRegistry)).toEqual(validRegistry);
    expect(parseSectionV2(validSection)).toEqual(validSection);
    expect(parseDocumentV2(validDocument)).toEqual(validDocument);
    expect(parseReviewV2(validReview)).toEqual(validReview);
    expect(parseArtifactsV2(validArtifacts)).toEqual(validArtifacts);
  });

  it.each([
    ['duplicate blueprint ids', { ...validBlueprint, nodes: [...validBlueprint.nodes, { ...validBlueprint.nodes[0] }] }],
    ['bad parent hierarchy', { ...validBlueprint, nodes: [{ ...validBlueprint.nodes[0], depth: 1 }] }],
    ['duplicate numeric ids', { ...validRegistry, entries: [...validRegistry.entries, { ...validRegistry.entries[0] }] }],
    ['bad data-table row width', {
      ...validSection,
      blocks: [{ ...validBlocks[2], rows: [['Gold']] }],
    }],
  ])('rejects %s', (_label, value) => {
    expect(() => {
      if (_label === 'duplicate blueprint ids' || _label === 'bad parent hierarchy') return parseBlueprintOutlineV2(value);
      if (_label === 'duplicate numeric ids') return parseNumericRegistryV2(value);
      return parseSectionV2(value);
    }).toThrow();
  });

  it('rejects a document with numeric refs missing from the registry', () => {
    expect(() => parseDocumentV2({
      ...validDocument,
      sections: [{ ...validSection, numericRefs: ['unknown.metric'] }],
    })).toThrow();
  });

  it('rejects artifacts with duplicate review issue ids', () => {
    expect(() => parseArtifactsV2({
      ...validArtifacts,
      review: {
        ...validReview,
        issues: [
          ...validReview.issues,
          { ...validReview.issues[0] },
        ],
      },
    })).toThrow();
  });

  it('rejects unsupported versions and unknown keys', () => {
    expect(() => parseGenerationInputV2({ ...validInput, version: 3 })).toThrow();
    expect(() => parseGenerationInputV2({ ...validInput, surprise: true })).toThrow();
  });

  it.each([
    ['paragraph', { kind: 'paragraph', id: 'p', text: '' }],
    ['bullet-list', { kind: 'bullet-list', id: 'b', items: [] }],
    ['data-table', { kind: 'data-table', id: 't', columns: ['Name'], rows: [['A', 'B']] }],
    ['formula', { kind: 'formula', id: 'f', expression: 'x', numericRefs: ['missing'] }],
    ['example', { kind: 'example', id: 'e', title: 'Example', body: 'Example body.', numericRefs: ['missing'] }],
    ['flow', { kind: 'flow', id: 'f2', steps: [] }],
    ['quote', { kind: 'quote', id: 'q', text: '', cite: 'Someone' }],
  ])('rejects invalid %s blocks', (_label, block) => {
    expect(() => parseTypedBlockV2(block)).toThrow();
  });
});
