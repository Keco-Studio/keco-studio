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
