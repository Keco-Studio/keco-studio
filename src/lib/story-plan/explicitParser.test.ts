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

// Scripts written in Chinese are stored as JSON so their characters stay
// escaped on disk; `lines` round-trips to the exact original text.
function readEscapedScriptFixture(name: string): string {
  const raw = fs.readFileSync(
    path.join(process.cwd(), `tests/fixtures/import-script/${name}.json`),
    'utf8'
  );
  return (JSON.parse(raw) as { lines: string[] }).lines.join('\n');
}

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);
const rainyFixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/rainy-manor-story.txt'),
  'utf8'
);
const busStopFixture = readEscapedScriptFixture('hierarchical-bus-stop-story');
const corridorFixture = readEscapedScriptFixture('hierarchical-corridor-story');
const careerFixture = readEscapedScriptFixture('hierarchical-career-story');
const layeredBookstoreFixture = readEscapedScriptFixture('layered-bookstore-story');
const interviewFixture = readEscapedScriptFixture('scenario-interview-story');
const menuBranchFixture = readEscapedScriptFixture('menu-branch-story');

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
    expect(choiceByText.get('\u4e3b\u52a8\u642d\u8bdd')?.fromNodeId).toBe(choiceByText.get('\u6c89\u9ed8\u65c1\u89c2')?.fromNodeId);
    expect(choiceByText.get('\u4e3b\u52a8\u501f\u4f1e')?.fromNodeId).toBe(choiceByText.get('\u6e29\u67d4\u5bbd\u6170')?.fromNodeId);
    expect(choiceByText.get('\u4e3b\u52a8\u501f\u4f1e')?.fromNodeId).not.toBe(choiceByText.get('\u4e3b\u52a8\u642d\u8bdd')?.fromNodeId);
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
      ['\u7406\u6027\u5224\u65ad', '\u76f4\u89c9\u5148\u884c'],
      ['\u89e6\u78b0\u9ed1\u955c', '\u7ed5\u884c\u9ed1\u955c'],
      ['\u4fe1\u4efb\u65e5\u8bb0，\u6309\u539f\u5e8f\u5f00\u95e8', '\u6000\u7591\u65e5\u8bb0，\u6309\u8865\u6ce8\u987a\u5e8f\u8c03\u6574'],
    ]));
  });

  it('keeps a named action separate from the following dialogue', () => {
    const source = segmentStorySource([
      '\u82cf\u665a：\u6211\u4eec\u5fc5\u987b\u9009\u62e9。',
      '\u5206\u652f\u70b9 A：\u7406\u6027\u5224\u65ad',
      '\u6797\u9ed8：（\u5408\u4e0a\u65e5\u8bb0）\u4e0d\u884c。',
      '→ \u7ed3\u5c40\u4e00：\u7b49\u5f85\u5ba1\u6279。',
      '\u5206\u652f\u70b9 B：\u76f4\u89c9\u5148\u884c',
      '\u6797\u9ed8：（\u957f\u53f9\u4e00\u53e3\u6c14）\u597d\u5427。',
      '→ \u7ed3\u5c40\u4e8c：\u7acb\u523b\u51fa\u53d1。',
    ].join('\n'), 'actions');
    const plan = tryParseHierarchicalBranchStory(source)!;
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const actionNode = plan.nodes.find((node) => (
      node.contentSegmentIds.some((id) => segmentText.get(id) === '\u5408\u4e0a\u65e5\u8bb0')
    ));
    const dialogueNode = plan.nodes.find((node) => (
      node.contentSegmentIds.some((id) => segmentText.get(id) === '\u4e0d\u884c。')
    ));

    expect(actionNode).toMatchObject({ type: 'narration' });
    expect(segmentText.get(actionNode?.speakerSegmentId ?? '')).toBe('\u6797\u9ed8');
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
      segmentText.get(id)?.includes('\u6b8a\u9014\u540c\u5f52')
    )));
    const incomingSummaryNodes = plan?.nodes.filter((node) => node.nextNodeId === summary?.id) ?? [];

    expect(plan).not.toBeNull();
    expect([...ownerGroups.values()]).toEqual(expect.arrayContaining([
      ['\u9009\u62e9\u5b8f\u56fe\u8d44\u672c，\u6311\u6218\u7ec8\u9762', '\u9009\u62e9\u542f\u822a\u54a8\u8be2，\u63a5\u53d7\u5f55\u7528'],
      ['\u63a5\u53d7“\u5feb\u901f\u664b\u5347”\u9879\u76ee', '\u9009\u62e9\u7a33\u5065\u7684“\u884c\u4e1a\u7814\u7a76”\u5c97\u4f4d'],
      ['\u575a\u6301\u4e13\u4e1a\u64cd\u5b88，\u62d2\u7edd“\u6ce8\u6c34”', '\u987a\u5e94\u516c\u53f8\u6587\u5316，\u5b66\u4f1a“\u5305\u88c5”'],
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
      ['\u6e29\u548c\u4e3b\u52a8\u95ee\u8be2', '\u5b89\u9759\u7559\u767d\u966a\u4f34'],
      ['\u7406\u6027\u5256\u6790\u5229\u5f0a', '\u5171\u60c5\u6cbb\u6108\u5b89\u629a'],
      ['\u53d6\u820d\u5f00\u5bfc', '\u843d\u5730\u529d\u89e3'],
      ['\u6e29\u67d4\u5171\u60c5\u5bbd\u6170', '\u6e29\u67d4\u515c\u5e95\u529d\u89e3'],
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
      ['\u6280\u672f\u6df1\u5ea6\u56de\u7b54', '\u6280\u672f\u74f6\u9888\u56de\u7b54'],
      ['\u8bda\u5b9e\u56de\u7b54', '\u5982\u679c\u674e\u660e\u8c0e\u79f0\u4e3b\u52a8\u8f9e\u804c'],
      ['\u575a\u6301\u5e95\u7ebf', '\u5982\u679c\u674e\u660e\u7acb\u523b\u59a5\u534f', '\u5982\u679c\u674e\u660e\u5f3a\u786c\u62d2\u7edd'],
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
      segmentText.get(id)?.includes('\u6700\u7ec8\u5c3e\u58f0')
    )));

    expect(choices.map((choice) => choice.text)).toEqual([
      '\u7acb\u523b\u524d\u5f80\u949f\u697c', '\u5148\u67e5\u9605\u66f4\u591a\u5386\u53f2\u6863\u6848', '\u8be2\u95ee\u9648\u6559\u6388\u66f4\u591a\u7ec6\u8282',
    ]);
    expect(new Set(choices.map((choice) => choice.owner)).size).toBe(1);
    expect(plan?.nodes.filter((node) => node.nextNodeId === epilogue?.id)).toHaveLength(3);
  });

  it('parses numeric menu labels and a common ending into sibling branches', () => {
    const source = segmentStorySource([
      '\u6797\u6d69：\u4f60\u60f3\u600e\u4e48\u8c03\u67e5？',
      '[\u8bf7\u9009\u62e9]',
      '1. \u8c03\u67e5\u949f\u697c',
      '2、\u67e5\u9605\u6863\u6848',
      '[\u9009\u62e9 1：\u8c03\u67e5\u949f\u697c]',
      '\u6797\u6d69\u8fdb\u5165\u949f\u697c。',
      '[\u9009\u62e9 2：\u67e5\u9605\u6863\u6848]',
      '\u6797\u6d69\u8fdb\u5165\u6863\u6848\u9986。',
      '[\u5171\u540c\u7ed3\u5c40]',
      '\u6797\u6d69\u627e\u5230\u4e86\u771f\u76f8。',
    ].join('\n'), 'numeric-menu');
    const plan = tryParseMenuBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const choices = plan?.choices.map((choice) => (
      choice.textSegmentIds.map((id) => segmentText.get(id)).join('')
    ));
    const epilogue = plan?.nodes.find((node) => node.contentSegmentIds.some((id) => (
      segmentText.get(id) === '\u5171\u540c\u7ed3\u5c40'
    )));

    expect(choices).toEqual(['\u8c03\u67e5\u949f\u697c', '\u67e5\u9605\u6863\u6848']);
    expect(plan?.nodes.filter((node) => node.nextNodeId === epilogue?.id)).toHaveLength(2);
  });

  it('keeps multiple menu decisions independent even when option codes repeat', () => {
    const source = segmentStorySource([
      '\u6797\u6d69：\u5148\u51b3\u5b9a\u8c03\u67e5\u65b9\u5411。',
      '【\u9009\u9879\u51fa\u73b0】',
      'A：\u53bb\u949f\u697c',
      'B：\u53bb\u6863\u6848\u9986',
      '【\u9009\u62e9A - \u53bb\u949f\u697c】',
      '\u6797\u6d69\u6765\u5230\u949f\u697c。',
      '【\u9009\u62e9B - \u53bb\u6863\u6848\u9986】',
      '\u6797\u6d69\u6765\u5230\u6863\u6848\u9986。',
      '【\u5171\u540c\u7ed3\u5c40】',
      '\u6797\u6d69\u5e26\u7740\u7ebf\u7d22\u56de\u5230\u5e7f\u573a。',
      '【\u9009\u9879\u51fa\u73b0】',
      'A：\u516c\u5f00\u8bc1\u636e',
      'B：\u7ee7\u7eed\u4fdd\u5bc6',
      '【\u9009\u62e9A - \u516c\u5f00\u8bc1\u636e】',
      '\u6797\u6d69\u516c\u5f00\u4e86\u6863\u6848。',
      '【\u9009\u62e9B - \u7ee7\u7eed\u4fdd\u5bc6】',
      '\u6797\u6d69\u6682\u65f6\u4fdd\u5bc6。',
      '【\u6700\u7ec8\u5c3e\u58f0】',
      '\u771f\u76f8\u7ec8\u4e8e\u88ab\u8bb0\u5f55。',
    ].join('\n'), 'multi-menu');
    const plan = tryParseMenuBranchStory(source);
    const segmentText = new Map(source.segments.map((segment) => [segment.id, segment.text]));
    const decisions = new Map<string, string[]>();
    for (const choice of plan?.choices ?? []) {
      const text = choice.textSegmentIds.map((id) => segmentText.get(id)).join('');
      decisions.set(choice.fromNodeId, [...(decisions.get(choice.fromNodeId) ?? []), text]);
    }

    expect([...decisions.values()]).toEqual(expect.arrayContaining([
      ['\u53bb\u949f\u697c', '\u53bb\u6863\u6848\u9986'],
      ['\u516c\u5f00\u8bc1\u636e', '\u7ee7\u7eed\u4fdd\u5bc6'],
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
