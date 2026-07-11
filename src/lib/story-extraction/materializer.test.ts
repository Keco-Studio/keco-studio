import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import type { StoryExtraction } from './schema';
import { materializeStoryExtraction } from './materializer';

const sourceText = [
  '七号：我们必须选择一条路线。',
  '- 前往能源舱。选择时执行 $resolve+=1。',
  '这里开始能源路线。',
  '你进入能源舱。',
  '你抵达撤离平台。',
].join('\n');

function extraction(): StoryExtraction {
  return {
    version: 3,
    entryNodeId: 'start',
    structuralUnitIds: ['fixture:2'],
    nodes: [
      {
        id: 'start',
        type: 'dialogue',
        speaker: '七号',
        content: '我们必须选择一条路线。',
        sourceUnitIds: ['fixture:0'],
        commandSources: [],
        nextNodeId: '',
        choices: [{
          text: '前往能源舱。',
          targetNodeId: 'energy',
          sourceUnitIds: ['fixture:1'],
          commandSources: ['$resolve+=1'],
        }],
      },
      {
        id: 'energy',
        type: 'narration',
        speaker: '',
        content: '你进入能源舱。',
        sourceUnitIds: ['fixture:3'],
        commandSources: [],
        nextNodeId: 'end',
        choices: [],
      },
      {
        id: 'end',
        type: 'narration',
        speaker: '',
        content: '你抵达撤离平台。',
        sourceUnitIds: ['fixture:4'],
        commandSources: [],
        nextNodeId: '',
        choices: [],
      },
    ],
  };
}

function materialize(value: StoryExtraction = extraction()) {
  return materializeStoryExtraction(
    value,
    segmentStorySource(sourceText, 'fixture')
  );
}

describe('full story extraction materializer', () => {
  it('materializes LLM-created nodes, choices, refs, and canonical commands', () => {
    const document = materialize();

    expect(document.entryLabel).toBe('start');
    expect(document.nodes[0]).toMatchObject({
      label: 'start',
      type: 'dialogue',
      speaker: '七号',
      content: '我们必须选择一条路线。',
      sourceRefs: [{ sourceId: 'fixture', unitId: 'fixture:0' }],
      options: [{
        text: '前往能源舱。',
        target: 'energy',
        commands: [{
          source: '$resolve+=1',
          variable: 'resolve',
          operator: '+=',
          value: 1,
        }],
      }],
    });
  });

  it('rejects an unknown source unit', () => {
    const value = extraction();
    value.nodes[0].sourceUnitIds = ['fixture:99'];
    expect(() => materialize(value)).toThrow(/unknown source unit/i);
  });

  it('rejects duplicate visible or structural unit ownership', () => {
    const value = extraction();
    value.structuralUnitIds.push('fixture:0');
    expect(() => materialize(value)).toThrow(/assigned more than once/i);
  });

  it('rejects an omitted source unit', () => {
    const value = extraction();
    value.structuralUnitIds = [];
    expect(() => materialize(value)).toThrow(/not assigned/i);
  });

  it('rejects invented or paraphrased visible content', () => {
    const value = extraction();
    value.nodes[1].content = '你修好了整个空间站。';
    expect(() => materialize(value)).toThrow(/not traceable/i);
  });

  it('rejects a changed source command', () => {
    const value = extraction();
    value.nodes[0].choices[0].commandSources = ['$resolve+=9'];
    expect(() => materialize(value)).toThrow(/command.*not found/i);
  });

  it('rejects a source command owned more than once', () => {
    const value = extraction();
    value.nodes[0].commandSources = ['$resolve+=1'];
    expect(() => materialize(value)).toThrow(/command.*more than once/i);
  });

  it('rejects unresolved and unreachable graph nodes', () => {
    const unresolved = extraction();
    unresolved.nodes[0].choices[0].targetNodeId = 'missing';
    expect(() => materialize(unresolved)).toThrow(/target.*does not exist/i);

    const unreachable = extraction();
    unreachable.nodes[0].choices = [];
    unreachable.nodes[0].nextNodeId = 'end';
    expect(() => materialize(unreachable)).toThrow(/unreachable.*energy/i);
  });

  it('rejects choice fallthrough and automatic cycles', () => {
    const fallthrough = extraction();
    fallthrough.nodes[0].nextNodeId = 'energy';
    expect(() => materialize(fallthrough)).toThrow(/choices.*automatic/i);

    const cycle = extraction();
    cycle.nodes[1].nextNodeId = 'energy';
    expect(() => materialize(cycle)).toThrow(/automatic cycle/i);
  });
});
