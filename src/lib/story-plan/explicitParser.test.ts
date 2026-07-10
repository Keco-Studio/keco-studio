import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { tryParseExplicitStory } from './explicitParser';
import { segmentStorySource } from './sourceSegments';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
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
        ['走左边。'],
        ['走右边。'],
        ['回答“我不知道”。'],
        ['不回答直接走。'],
        ['报真名。'],
        ['报假名。'],
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

    expect(content).not.toContain('左边小路');
    expect(content).not.toContain('老人点头');
    expect(content).toEqual(expect.arrayContaining([
      '你醒了。选一条路。',
      '年轻人，你从哪来？',
      '你到了。信任值: [trust]。',
    ]));
  });

  it('returns null for prose without explicit branch structure', () => {
    const source = segmentStorySource('雨夜里，旅人走进一座古宅。', 'fixture');
    expect(tryParseExplicitStory(source)).toBeNull();
  });

  it('returns null for duplicate explicit labels', () => {
    const source = segmentStorySource([
      '引导：选择。',
      'O1: 左边。 (jump O1)',
      'O1 branch [O1 | 第一处]',
      '旁白：结束。',
      'O1 branch [O1 | 第二处]',
      '旁白：再次结束。',
    ].join('\n'), 'fixture');

    expect(tryParseExplicitStory(source)).toBeNull();
  });
});
