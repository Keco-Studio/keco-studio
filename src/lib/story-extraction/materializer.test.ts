import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import { parseStoryExtraction, type StoryExtraction } from './schema';
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
    choices: [{
      id: 'go_energy',
      fromNodeId: 'start',
      text: '前往能源舱。',
      targetNodeId: 'energy',
      sourceUnitIds: ['fixture:1'],
      commandSources: ['$resolve+=1'],
    }],
    nodes: [
      {
        id: 'start',
        type: 'dialogue',
        speaker: '七号',
        content: '我们必须选择一条路线。',
        sourceUnitIds: ['fixture:0'],
        commandSources: [],
        nextNodeId: '',
      },
      {
        id: 'energy',
        type: 'narration',
        speaker: '',
        content: '你进入能源舱。',
        sourceUnitIds: ['fixture:3'],
        commandSources: [],
        nextNodeId: 'end',
      },
      {
        id: 'end',
        type: 'narration',
        speaker: '',
        content: '你抵达撤离平台。',
        sourceUnitIds: ['fixture:4'],
        commandSources: [],
        nextNodeId: '',
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

  it('normalizes redundant structural ownership when visible evidence uses the unit', () => {
    const value = extraction();
    value.structuralUnitIds.push('fixture:0');
    expect(materialize(value).nodes[0].content).toBe('我们必须选择一条路线。');
  });

  it('allows distinct branch outcomes to cite different text from the same source unit', () => {
    const text = [
      '请选择处理方式。',
      '- 手动关闭。',
      '- 远程关闭。',
      '手动关闭时反应堆恢复稳定；远程关闭时备用灯全部熄灭。',
    ].join('\n');
    const source = segmentStorySource(text, 'shared');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      choices: [
        { id: 'manual_choice', fromNodeId: 'start', text: '手动关闭。', targetNodeId: 'manual', sourceUnitIds: ['shared:1'], commandSources: [] },
        { id: 'remote_choice', fromNodeId: 'start', text: '远程关闭。', targetNodeId: 'remote', sourceUnitIds: ['shared:2'], commandSources: [] },
      ],
      nodes: [
        {
          id: 'start', type: 'narration', speaker: '', content: '请选择处理方式。',
          sourceUnitIds: ['shared:0'], commandSources: [], nextNodeId: '',
        },
        {
          id: 'manual', type: 'narration', speaker: '', content: '手动关闭时反应堆恢复稳定',
          sourceUnitIds: ['shared:3'], commandSources: [], nextNodeId: '',
        },
        {
          id: 'remote', type: 'narration', speaker: '', content: '远程关闭时备用灯全部熄灭',
          sourceUnitIds: ['shared:3'], commandSources: [], nextNodeId: '',
        },
      ],
    };

    expect(materializeStoryExtraction(value, source).nodes).toHaveLength(3);
  });

  it('rejects an omitted source unit', () => {
    const value = extraction();
    value.structuralUnitIds = [];
    expect(() => materialize(value)).toThrow(/not assigned/i);
  });

  it('classifies an omitted pure merge marker as structural evidence', () => {
    const text = '你抵达平台。\n最终合流：';
    const source = segmentStorySource(text, 'merge');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'end',
      structuralUnitIds: [],
      nodes: [{
        id: 'end', type: 'narration', speaker: '', content: '你抵达平台。',
        sourceUnitIds: ['merge:0'], commandSources: [], nextNodeId: '',
      }],
      choices: [],
    };

    expect(materializeStoryExtraction(value, source).nodes).toHaveLength(1);
  });

  it('removes structural choice prompts and moves their choices to the preceding node', () => {
    const text = '请选择路线。\n这里有两个选择：\n- 左边。\n左边结局。';
    const source = segmentStorySource(text, 'prompt');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: '请选择路线。', sourceUnitIds: ['prompt:0'], commandSources: [], nextNodeId: 'marker' },
        { id: 'marker', type: 'narration', speaker: '', content: '这里有两个选择：', sourceUnitIds: ['prompt:1'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: '左边结局。', sourceUnitIds: ['prompt:3'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go_left', fromNodeId: 'marker', text: '左边。', targetNodeId: 'left', sourceUnitIds: ['prompt:2'], commandSources: [] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'left']);
    expect(document.nodes[0]).toMatchObject({
      options: [{ text: '左边。', target: 'left' }],
    });
  });

  it('removes branch-command metadata nodes and redirects their incoming choice', () => {
    const text = '请选择路线。\n如果选择左边，选择发生时让 $trust+=1。\n你进入左路。';
    const source = segmentStorySource(text, 'metadata');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: '请选择路线。', sourceUnitIds: ['metadata:0'], commandSources: [], nextNodeId: '' },
        { id: 'metadata', type: 'narration', speaker: '', content: '如果选择左边，选择发生时让 $trust+=1', sourceUnitIds: ['metadata:1'], commandSources: [], nextNodeId: 'left' },
        { id: 'left', type: 'narration', speaker: '', content: '你进入左路。', sourceUnitIds: ['metadata:2'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go_left', fromNodeId: 'start', text: '左边', targetNodeId: 'metadata', sourceUnitIds: ['metadata:1'], commandSources: ['metadata:1'] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes.map((node) => node.label)).toEqual(['start', 'left']);
    expect(document.nodes[0].options[0].target).toBe('left');
  });

  it('rejects invented or paraphrased visible content', () => {
    const value = extraction();
    value.nodes[1].content = '你修好了整个空间站。';
    expect(() => materialize(value)).toThrow(/not traceable/i);
  });

  it('rejects a changed source command', () => {
    const value = extraction();
    value.choices[0].commandSources = ['$resolve+=9'];
    expect(() => materialize(value)).toThrow(/command.*not found/i);
  });

  it('canonicalizes a command source unit id when it contains one exact command', () => {
    const value = extraction();
    value.choices[0].commandSources = ['fixture:1'];

    expect(materialize(value).nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
  });

  it('extracts one exact command from a model-added source suffix', () => {
    const value = extraction();
    value.choices[0].commandSources = ['$resolve+=1|fixture:1'];

    expect(materialize(value).nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
  });

  it('repairs a wrong option ref only when text and command units are deterministic', () => {
    const text = [
      '请选择路线。',
      '你可以先去能源舱，也可以先去资料舱。',
      '如果选择前往能源舱，选择时执行 $resolve+=1。',
      '你进入能源舱。',
    ].join('\n');
    const source = segmentStorySource(text, 'split-evidence');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: ['split-evidence:2'],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: '请选择路线。', sourceUnitIds: ['split-evidence:0'], commandSources: [], nextNodeId: '' },
        { id: 'energy', type: 'narration', speaker: '', content: '你进入能源舱。', sourceUnitIds: ['split-evidence:3'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{
        id: 'go_energy',
        fromNodeId: 'start',
        text: '你可以先去能源舱',
        targetNodeId: 'energy',
        sourceUnitIds: ['split-evidence:2'],
        commandSources: ['$resolve+=1|split-evidence:2'],
      }],
    };

    const option = materializeStoryExtraction(value, source).nodes[0].options[0];
    expect(option.sourceRefs.map((ref) => ref.unitId)).toEqual([
      'split-evidence:1',
      'split-evidence:2',
    ]);
    expect(option.commands[0].sourceRefs[0].unitId).toBe('split-evidence:2');
  });

  it('removes choice-control and command metadata from visible option text', () => {
    const value = extraction();
    value.choices[0].text = '如果你选择前往能源舱，选择发生时让 $resolve+=1';
    value.choices[0].commandSources = ['$resolve+=1|fixture:1'];

    expect(materialize(value).nodes[0].options[0].text).toBe('前往能源舱');
  });

  it('adds the exact command unit to a choice source when the text and command are split', () => {
    const text = '选择能源舱。\n执行 $resolve+=1。\n能源舱结局。';
    const source = segmentStorySource(text, 'split');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: '选择能源舱。', sourceUnitIds: ['split:0'], commandSources: [], nextNodeId: '' },
        { id: 'end', type: 'narration', speaker: '', content: '能源舱结局。', sourceUnitIds: ['split:2'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'go', fromNodeId: 'start', text: '能源舱', targetNodeId: 'end', sourceUnitIds: ['split:0'], commandSources: ['$resolve+=1'] }],
    };

    expect(materializeStoryExtraction(value, source).nodes[0].options[0].commands[0].value).toBe(1);
  });

  it('distinguishes identical command text by the owner source unit', () => {
    const text = [
      '请选择路线。',
      '左路。 $trust+=1',
      '右路。 $trust+=1',
      '你抵达左侧终点。',
      '你抵达右侧终点。',
    ].join('\n');
    const source = segmentStorySource(text, 'same-command');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'start',
      structuralUnitIds: [],
      nodes: [
        { id: 'start', type: 'narration', speaker: '', content: '请选择路线。', sourceUnitIds: ['same-command:0'], commandSources: [], nextNodeId: '' },
        { id: 'left', type: 'narration', speaker: '', content: '你抵达左侧终点。', sourceUnitIds: ['same-command:3'], commandSources: [], nextNodeId: '' },
        { id: 'right', type: 'narration', speaker: '', content: '你抵达右侧终点。', sourceUnitIds: ['same-command:4'], commandSources: [], nextNodeId: '' },
      ],
      choices: [
        { id: 'go_left', fromNodeId: 'start', text: '左路。', targetNodeId: 'left', sourceUnitIds: ['same-command:1'], commandSources: ['$trust+=1'] },
        { id: 'go_right', fromNodeId: 'start', text: '右路。', targetNodeId: 'right', sourceUnitIds: ['same-command:2'], commandSources: ['$trust+=1'] },
      ],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes[0].options.map((option) => option.commands[0].sourceRefs[0].unitId))
      .toEqual(['same-command:1', 'same-command:2']);
  });

  it('infers an empty source unit list only from unique exact visible evidence', () => {
    const value = extraction();
    value.nodes[1].sourceUnitIds = [];
    const parsed = parseStoryExtraction(value);

    expect(materialize(parsed).nodes[1].sourceRefs[0].unitId).toBe('fixture:3');
  });

  it('converts one synthetic Continue choice into an automatic transition', () => {
    const text = '第一行。\n第二行。';
    const source = segmentStorySource(text, 'continue');
    const value: StoryExtraction = {
      version: 3,
      entryNodeId: 'first',
      structuralUnitIds: [],
      nodes: [
        { id: 'first', type: 'narration', speaker: '', content: '第一行。', sourceUnitIds: ['continue:0'], commandSources: [], nextNodeId: '' },
        { id: 'second', type: 'narration', speaker: '', content: '第二行。', sourceUnitIds: ['continue:1'], commandSources: [], nextNodeId: '' },
      ],
      choices: [{ id: 'continue', fromNodeId: 'first', text: '继续', targetNodeId: 'second', sourceUnitIds: ['continue:0'], commandSources: [] }],
    };

    const document = materializeStoryExtraction(value, source);
    expect(document.nodes[0].next).toBe('second');
    expect(document.nodes[0].options).toEqual([]);
  });

  it('rejects a source command owned more than once', () => {
    const value = extraction();
    value.nodes[0].commandSources = ['$resolve+=1'];
    expect(() => materialize(value)).toThrow(/command.*more than once/i);
  });

  it('removes a duplicated choice-trigger command from that choice target node', () => {
    const value = extraction();
    value.nodes[1].commandSources = ['fixture:1'];

    const document = materialize(value);
    expect(document.nodes[0].options[0].commands[0].source).toBe('$resolve+=1');
    expect(document.nodes[1].commands).toEqual([]);
    expect(document.nodes[1].sourceRefs.map((ref) => ref.unitId)).toEqual(['fixture:3']);
  });

  it('rejects unresolved and unreachable graph nodes', () => {
    const unresolved = extraction();
    unresolved.choices[0].targetNodeId = 'missing';
    expect(() => materialize(unresolved)).toThrow(/target.*does not exist/i);

    const unreachable = extraction();
    unreachable.choices = [];
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
