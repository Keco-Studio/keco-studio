import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  tryParseExplicitStory,
  tryParseHierarchicalBranchStory,
  tryParseNaturalBranchStory,
  tryParseMenuBranchStory,
  tryParseScenarioDecisionStory,
} from './explicitParser';
import { segmentStorySource } from './sourceSegments';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);
const rainyFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/rainy-manor-story.txt'),
  'utf8'
);
const busStopFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/hierarchical-bus-stop-story.txt'),
  'utf8'
);
const corridorFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/hierarchical-corridor-story.txt'),
  'utf8'
);
const careerFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/hierarchical-career-story.txt'),
  'utf8'
);
const layeredBookstoreFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/layered-bookstore-story.txt'),
  'utf8'
);
const interviewFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/scenario-interview-story.txt'),
  'utf8'
);
const menuBranchFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/menu-branch-story.txt'),
  'utf8'
);

describe('explicit story parser', () => {
  it('parses nested labels, choices, commands, and merge jumps without an LLM', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source);

    expect(plan).not.toBeNull();
    expect(plan!.entryNodeId).toBe('Start');
    expect(plan!.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'O1', fromNodeId: 'Start', targetNodeId: 'O1' }),
      expect.objectContaining({ id: 'O2', fromNodeId: 'Start', targetNodeId: 'O2' }),
      expect.objectContaining({ id: 'O1A', fromNodeId: 'O1', targetNodeId: 'O1A_END' }),
      expect.objectContaining({ id: 'O1B', fromNodeId: 'O1', targetNodeId: 'O1B_END' }),
      expect.objectContaining({ id: 'O2A', fromNodeId: 'O2', targetNodeId: 'O2A_END' }),
      expect.objectContaining({ id: 'O2B', fromNodeId: 'O2', targetNodeId: 'O2B_END' }),
    ]));
    expect(plan!.nodes.filter((node) => node.nextNodeId === 'Oend').map((node) => node.id))
      .toEqual(['O1A_END', 'O1B_END', 'O2A_END', 'O2B_END']);
    expect(plan!.nodes.find((node) => node.id === 'Oend')?.nextNodeId).toBe('');
  });

  it('uses exact choice segments and server-owned command ids', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source)!;
    const commandsById = new Map(source.commands.map((command) => [command.id, command]));
    const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));

    expect(plan.choices.map((choice) => choice.textSegmentIds.map((id) => segmentsById.get(id)?.text)))
      .toEqual([
        ['Take the left path.'],
        ['Take the right path.'],
        ['Answer "I do not know".'],
        ['Walk on without answering.'],
        ['Give your real name.'],
        ['Give a false name.'],
      ]);
    expect(plan.choices.map((choice) => choice.commandIds.map((id) => commandsById.get(id)?.source)))
      .toEqual([
        ['$trust+=1'],
        ['$trust+=2'],
        ['$trust+=1'],
        ['$trust-=1'],
        ['$trust+=2'],
        ['$trust-=2'],
      ]);
  });

  it('keeps structural branch descriptions out of visible node content', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source)!;
    const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));
    const content = plan.nodes.flatMap((node) =>
      node.contentSegmentIds.map((segmentId) => segmentsById.get(segmentId)?.text)
    );

    expect(content).not.toContain('Left trail');
    expect(content).not.toContain('The old man nods');
    expect(content).toEqual(expect.arrayContaining([
      'You are awake. Pick a path.',
      'Young one, where do you come from?',
      'You have arrived. Trust: [trust].',
    ]));
  });

  it('returns null for prose without explicit branch structure', () => {
    const source = segmentStorySource('On a rainy night, a traveler enters an old manor.', 'fixture');
    expect(tryParseExplicitStory(source)).toBeNull();
  });

  it('returns null for duplicate explicit labels', () => {
    const source = segmentStorySource([
      'Guide: Choose.',
      'O1: Left. (jump O1)',
      'O1 branch [O1 | First stop]',
      'Narrator: The end.',
      'O1 branch [O1 | Second stop]',
      'Narrator: The end again.',
    ].join('\n'), 'fixture');

    expect(tryParseExplicitStory(source)).toBeNull();
  });

  it('parses top-level and nested bus-stop choices under separate owners', () => {
    const source = segmentStorySource(busStopFixture, 'bus');
    const plan = tryParseHierarchicalBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const choiceByText = new Map(plan?.choices.map((choice) => [
      choice.textSegmentIds.map((id) => segmentText.get(id)).join(''),
      choice,
    ]));

    expect(plan).not.toBeNull();
    expect(choiceByText.get('主动搭话')?.fromNodeId).toBe(choiceByText.get('沉默旁观')?.fromNodeId);
    expect(choiceByText.get('主动借伞')?.fromNodeId).toBe(choiceByText.get('温柔宽慰')?.fromNodeId);
    expect(choiceByText.get('主动借伞')?.fromNodeId).not.toBe(choiceByText.get('主动搭话')?.fromNodeId);
  });

  it('parses three successive decision groups in the corridor screenplay', () => {
    const source = segmentStorySource(corridorFixture, 'corridor');
    const plan = tryParseHierarchicalBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const ownerGroups = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      ownerGroups.set(choice.fromNodeId, [...(ownerGroups.get(choice.fromNodeId) ?? []), text]);
    }

    expect(plan).not.toBeNull();
    expect([...ownerGroups.values()]).toEqual(expect.arrayContaining([
      ['理性判断', '直觉先行'],
      ['触碰黑镜', '绕行黑镜'],
      ['信任日记，按原序开门', '怀疑日记，按补注顺序调整'],
    ]));
  });

  it('keeps a named action separate from the following dialogue', () => {
    const source = segmentStorySource([
      '苏晚：我们必须选择。',
      '分支点 A：理性判断',
      '林默：（合上日记）不行。',
      '→ 结局一：等待审批。',
      '分支点 B：直觉先行',
      '林默：（长叹一口气）好吧。',
      '→ 结局二：立刻出发。',
    ].join('\n'), 'actions');
    const plan = tryParseHierarchicalBranchStory(source)!;
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const actionNode = plan.nodes.find((node) => (
      node.contentSegmentIds.some((id) => segmentText.get(id) === '合上日记')
    ));
    const dialogueNode = plan.nodes.find((node) => (
      node.contentSegmentIds.some((id) => segmentText.get(id) === '不行。')
    ));

    expect(actionNode).toMatchObject({ type: 'narration' });
    expect(segmentText.get(actionNode?.speakerSegmentId ?? '')).toBe('林默');
    expect(dialogueNode).toMatchObject({ type: 'dialogue' });
    expect(actionNode?.nextNodeId).toBe(dialogueNode?.id);
  });

  it('parses wrapped three-level choices and merges every leaf into the summary act', () => {
    const source = segmentStorySource(careerFixture, 'career');
    const plan = tryParseHierarchicalBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const ownerGroups = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      ownerGroups.set(choice.fromNodeId, [...(ownerGroups.get(choice.fromNodeId) ?? []), text]);
    }
    const summary = plan?.nodes.find((node) => node.contentSegmentIds.some((id) => (
      segmentText.get(id)?.includes('殊途同归')
    )));
    const incomingSummaryNodes = plan?.nodes.filter((node) => node.nextNodeId === summary?.id) ?? [];

    expect(plan).not.toBeNull();
    expect([...ownerGroups.values()]).toEqual(expect.arrayContaining([
      ['选择宏图资本，挑战终面', '选择启航咨询，接受录用'],
      ['接受“快速晋升”项目', '选择稳健的“行业研究”岗位'],
      ['坚持专业操守，拒绝“注水”', '顺应公司文化，学会“包装”'],
    ]));
    expect(summary).toBeDefined();
    expect(incomingSummaryNodes).toHaveLength(4);
  });

  it('parses successive layered choices and keeps the final epilogue reachable', () => {
    const source = segmentStorySource(layeredBookstoreFixture, 'bookstore');
    const plan = tryParseHierarchicalBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const decisions = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      decisions.set(choice.fromNodeId, [...(decisions.get(choice.fromNodeId) ?? []), text]);
    }

    expect(plan).not.toBeNull();
    expect([...decisions.values()]).toEqual(expect.arrayContaining([
      ['温和主动问询', '安静留白陪伴'],
      ['理性剖析利弊', '共情治愈安抚'],
      ['取舍开导', '落地劝解'],
      ['温柔共情宽慰', '温柔兜底劝解'],
    ]));

    const nodesById = new Map(plan!.nodes.map((node) => [node.id, node]));
    const choicesByOwner = new Map<string, typeof plan.choices>();
    for (const choice of plan!.choices) {
      choicesByOwner.set(choice.fromNodeId, [
        ...(choicesByOwner.get(choice.fromNodeId) ?? []),
        choice,
      ]);
    }
    const reachable = new Set<string>();
    const pending = [plan!.entryNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (reachable.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;
      reachable.add(nodeId);
      if (node.nextNodeId) pending.push(node.nextNodeId);
      for (const choice of choicesByOwner.get(nodeId) ?? []) pending.push(choice.targetNodeId);
    }
    expect(reachable.size).toBe(plan!.nodes.length);
  });

  it('parses successive hypothetical interview decisions and rejoins the main line', () => {
    const source = segmentStorySource(interviewFixture, 'interview');
    const plan = tryParseScenarioDecisionStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const ownerGroups = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      ownerGroups.set(choice.fromNodeId, [...(ownerGroups.get(choice.fromNodeId) ?? []), text]);
    }

    expect(plan).not.toBeNull();
    expect([...ownerGroups.values()]).toEqual(expect.arrayContaining([
      ['技术深度回答', '技术瓶颈回答'],
      ['诚实回答', '如果李明谎称主动辞职'],
      ['坚持底线', '如果李明立刻妥协', '如果李明强硬拒绝'],
    ]));
    expect(new Set(plan?.nodes.map((node) => node.id)).size).toBe(plan?.nodes.length);
  });

  it('parses lettered menu options into sibling branches with one final merge', () => {
    const source = segmentStorySource(menuBranchFixture, 'menu');
    const plan = tryParseMenuBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const choices = plan?.choices.map((choice) => ({
      text: choice.textSegmentIds.map((id) => segmentText.get(id)).join(''),
      owner: choice.fromNodeId,
      target: choice.targetNodeId,
    })) ?? [];
    const epilogue = plan?.nodes.find((node) => node.contentSegmentIds.some((id) => (
      segmentText.get(id)?.includes('最终尾声')
    )));

    expect(choices.map((choice) => choice.text)).toEqual([
      '立刻前往钟楼', '先查阅更多历史档案', '询问陈教授更多细节',
    ]);
    expect(new Set(choices.map((choice) => choice.owner)).size).toBe(1);
    expect(plan?.nodes.filter((node) => node.nextNodeId === epilogue?.id)).toHaveLength(3);
  });

  it('parses numeric menu labels and a common ending into sibling branches', () => {
    const source = segmentStorySource([
      '林浩：你想怎么调查？',
      '[请选择]',
      '1. 调查钟楼',
      '2、查阅档案',
      '[选择 1：调查钟楼]',
      '林浩进入钟楼。',
      '[选择 2：查阅档案]',
      '林浩进入档案馆。',
      '[共同结局]',
      '林浩找到了真相。',
    ].join('\n'), 'numeric-menu');
    const plan = tryParseMenuBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const choices = plan?.choices.map((choice) => (
      choice.textSegmentIds.map((id) => segmentText.get(id)).join('')
    ));
    const epilogue = plan?.nodes.find((node) => node.contentSegmentIds.some((id) => (
      segmentText.get(id) === '共同结局'
    )));

    expect(choices).toEqual(['调查钟楼', '查阅档案']);
    expect(plan?.nodes.filter((node) => node.nextNodeId === epilogue?.id)).toHaveLength(2);
  });

  it('keeps multiple menu decisions independent even when option codes repeat', () => {
    const source = segmentStorySource([
      '林浩：先决定调查方向。',
      '【选项出现】',
      'A：去钟楼',
      'B：去档案馆',
      '【选择A - 去钟楼】',
      '林浩来到钟楼。',
      '【选择B - 去档案馆】',
      '林浩来到档案馆。',
      '【共同结局】',
      '林浩带着线索回到广场。',
      '【选项出现】',
      'A：公开证据',
      'B：继续保密',
      '【选择A - 公开证据】',
      '林浩公开了档案。',
      '【选择B - 继续保密】',
      '林浩暂时保密。',
      '【最终尾声】',
      '真相终于被记录。',
    ].join('\n'), 'multi-menu');
    const plan = tryParseMenuBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const decisions = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      decisions.set(choice.fromNodeId, [...(decisions.get(choice.fromNodeId) ?? []), text]);
    }

    expect([...decisions.values()]).toEqual(expect.arrayContaining([
      ['去钟楼', '去档案馆'],
      ['公开证据', '继续保密'],
    ]));
    expect(plan).not.toBeNull();
  });


  it('parses unambiguous numbered natural branches without a Converter call', () => {
    const source = segmentStorySource(rainyFixture, 'rainy');
    const plan = tryParseNaturalBranchStory(source);

    expect(plan).not.toBeNull();
    expect(plan!.entryNodeId).toBe('Node1');
    expect(plan!.nodes).toHaveLength(24);
    expect(plan!.choices).toEqual([
      expect.objectContaining({
        id: 'Choice1', fromNodeId: 'Node8', targetNodeId: 'Node9',
      }),
      expect.objectContaining({
        id: 'Choice2', fromNodeId: 'Node8', targetNodeId: 'Node17',
      }),
    ]);
    expect(plan!.nodes.find((node) => node.id === 'Node16')?.nextNodeId).toBe('');
    expect(plan!.nodes.find((node) => node.id === 'Node24')?.nextNodeId).toBe('');
  });

  it('groups natural Chinese sibling branches under one decision', () => {
    const source = segmentStorySource([
      '【\u5f00\u573a\u5bf9\u8bdd】',
      '\u5973\u4e3b：\u5b85\u5185\u6709\u4e24\u5904\u843d\u811a\u5904，\u516c\u5b50\u60f3\u9009\u54ea\u4e00\u5904？',
      '【\u89e6\u53d1\u5206\u652f\u9009\u62e9】',
      '\u5206\u652f\u4e00：\u9009\u62e9【\u4e1c\u4fa7\u5ba2\u623f】（\u5b89\u7a33\u8c28\u614e\u7ebf）',
      '\u7537\u4e3b：\u6211\u9009\u4e1c\u4fa7\u5ba2\u623f。',
      '【\u5206\u652f\u4e00\u7ed3\u5c40：\u5b89\u7a33\u7ed3\u5c40】',
      '\u4e00\u591c\u5b89\u7136\u65e0\u68a6。',
      '\u5206\u652f\u4e8c：\u9009\u62e9【\u897f\u4fa7\u9601\u697c】（\u597d\u5947\u63a2\u9669\u7ebf）',
      '\u7537\u4e3b：\u6211\u9009\u897f\u4fa7\u9601\u697c。',
      '【\u5973\u4e3b\u7684\u56de\u5fc6】',
      '\u4e8c\u5341\u5e74\u524d\u7684\u5f80\u4e8b\u6d6e\u73b0。',
      '【\u5206\u652f\u4e8c\u7ed3\u5c40：\u7f81\u7eca\u7ed3\u5c40】',
      '\u4f60\u5931\u53bb\u4e86\u4e00\u6bb5\u8bb0\u5fc6。',
    ].join('\n'), 'ancient-house');

    const plan = tryParseNaturalBranchStory(source);

    expect(plan).not.toBeNull();
    expect(plan!.choices).toEqual([
      expect.objectContaining({ fromNodeId: 'Node3', targetNodeId: 'Node4' }),
      expect.objectContaining({ fromNodeId: 'Node3', targetNodeId: 'Node7' }),
    ]);
    expect(plan!.nodes.find((node) => node.id === 'Node6')?.nextNodeId).toBe('');
  });

  it('leaves duplicate natural branch ordinals for the Converter', () => {
    const source = segmentStorySource([
      'Guide: Choose.',
      'Branch 1: Choose [Left] (first group)',
      'Left ending.',
      'Branch 1: Choose [Again] (nested or second group)',
      'Again ending.',
    ].join('\n'), 'fixture');

    expect(tryParseNaturalBranchStory(source)).toBeNull();
  });
});
