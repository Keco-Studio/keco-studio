import { describe, expect, it } from '@jest/globals';
import type { SourceUnit, StoryDocument, StoryNode } from './schema';
import { validateStoryDocument } from './validator';

const units: SourceUnit[] = [
  { id: 'src:0', sourceId: 'src', text: 'Guide: Begin', start: 0, end: 12, authoritative: true },
  { id: 'src:1', sourceId: 'src', text: 'O1: Continue ($trust+=1, jump O1)', start: 13, end: 48, authoritative: true },
  { id: 'src:2', sourceId: 'src', text: 'O1 branch [O1 | End]', start: 49, end: 69, authoritative: true },
];

const refs = units.map((unit) => ({
  sourceId: unit.sourceId,
  unitId: unit.id,
  start: unit.start,
  end: unit.end,
}));

const startNode: StoryNode = {
  label: 'Start',
  type: 'dialogue',
  speaker: 'Guide',
  content: 'Begin',
  commands: [],
  options: [{
    text: 'Continue',
    target: 'O1',
    commands: [{
      source: '$trust+=1',
      variable: 'trust',
      operator: '+=',
      value: 1,
      sourceRefs: [refs[1]],
    }],
    sourceRefs: [refs[1]],
  }],
  sourceRefs: [refs[0]],
};

const endNode: StoryNode = {
  label: 'O1',
  type: 'scene',
  content: 'End',
  commands: [],
  options: [],
  sourceRefs: [refs[2]],
};

function document(nodes: StoryNode[] = [startNode, endNode]): StoryDocument {
  return { version: 1, entryLabel: 'Start', nodes };
}

function issueTypes(value: StoryDocument, sourceUnits = units): string[] {
  return validateStoryDocument(value, sourceUnits).map((issue) => issue.type);
}

describe('Story IR deterministic validation', () => {
  it('accepts a fully traced reachable story', () => {
    expect(validateStoryDocument(document(), units)).toEqual([]);
  });

  it('rejects unresolved option targets', () => {
    const changed = { ...startNode, options: [{ ...startNode.options[0], target: 'Missing' }] };
    expect(issueTypes(document([changed, endNode]))).toContain('unresolved_target');
  });

  it('rejects duplicate labels', () => {
    expect(issueTypes(document([startNode, endNode, { ...endNode }]))).toContain('duplicate_label');
  });

  it('rejects unreachable nodes', () => {
    const isolated = { ...endNode, label: 'O2' };
    expect(issueTypes(document([startNode, isolated, endNode]))).toContain('unreachable_node');
  });

  it('rejects untraceable content', () => {
    const changed = { ...endNode, content: 'LLM explanation' };
    expect(issueTypes(document([startNode, changed]))).toContain('untraceable_content');
  });

  it('rejects variable command mutation', () => {
    const option = startNode.options[0];
    const changed = {
      ...startNode,
      options: [{
        ...option,
        commands: [{ ...option.commands[0], source: '$trust+=9', value: 9 }],
      }],
    };
    expect(issueTypes(document([changed, endNode]))).toContain('command_mutation');
  });

  it('rejects uncovered source units', () => {
    expect(issueTypes(document([startNode]), units)).toContain('omission');
  });

  it('can validate partial chunks without requiring external targets', () => {
    const partialUnits = units.slice(0, 2);
    expect(validateStoryDocument(document([startNode]), partialUnits, {
      allowUnresolvedTargets: true,
      allowUnreachableNodes: true,
    })).toEqual([]);
  });
});
