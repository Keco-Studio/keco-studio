import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import {
  tryParseExplicitStory,
  tryParseNaturalBranchStory,
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
