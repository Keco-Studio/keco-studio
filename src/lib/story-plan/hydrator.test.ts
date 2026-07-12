import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { tryParseExplicitStory } from './explicitParser';
import { hydrateStoryDocument } from './hydrator';
import { segmentStorySource } from './sourceSegments';

const fixture = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/import-script/nested-trust-story.txt'),
  'utf8'
);

describe('story plan hydration', () => {
  it('hydrates exact content, role mappings, choices, commands, and jumps', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source)!;
    const document = hydrateStoryDocument(plan, source, {
      光球: { id: 'guide-id', type: 1 },
    });

    expect(document.entryLabel).toBe('Start');
    expect(document.nodes[0]).toMatchObject({
      label: 'Start',
      type: 'dialogue',
      speaker: 'guide-id',
      content: '你醒了。选一条路。',
      options: [
        expect.objectContaining({
          text: '走左边。',
          target: 'O1',
          commands: [expect.objectContaining({
            source: '$trust+=1',
            variable: 'trust',
            operator: '+=',
            value: 1,
          })],
        }),
        expect.objectContaining({ text: '走右边。', target: 'O2' }),
      ],
    });
    expect(document.nodes.find((node) => node.label === 'O1A_END')?.next).toBe('Oend');
    expect(document.nodes.find((node) => node.label === 'Oend')).toMatchObject({
      speaker: 'guide-id',
      content: '你到了。信任值: [trust]。',
    });
  });

  it('constructs canonical source refs from server-owned units', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source)!;
    const document = hydrateStoryDocument(plan, source);
    const start = document.nodes[0];

    expect(start.sourceRefs).toEqual([{
      sourceId: 'fixture',
      unitId: 'fixture:0',
      start: 0,
      end: '光球： “你醒了。选一条路。”'.length,
    }]);
    expect(start.options[0].commands[0].sourceRefs[0]).toMatchObject({
      sourceId: 'fixture',
      unitId: 'fixture:1',
    });
  });

  it('does not hydrate structural branch descriptions as visible content', () => {
    const source = segmentStorySource(fixture, 'fixture');
    const plan = tryParseExplicitStory(source)!;
    const document = hydrateStoryDocument(plan, source);
    const contents = document.nodes.map((node) => node.content);

    expect(contents).not.toContain('左边小路');
    expect(contents).not.toContain('老人点头');
  });

  it('adds a shared terminal node so independent endings cannot fall through', () => {
    const source = segmentStorySource([
      '引导：选择。',
      '分支一：选择【Left】（left path）',
      'Left ending.',
      '分支二：选择【Right】（right path）',
      'Right ending.',
    ].join('\n'), 'fixture');
    const speaker = source.segments.find((segment) => segment.kind === 'speaker')!;
    const dialogue = source.segments.find((segment) => segment.kind === 'dialogue')!;
    const leftChoice = source.segments.find((segment) => segment.kind === 'choice_text' && segment.text === 'Left')!;
    const rightChoice = source.segments.find((segment) => segment.kind === 'choice_text' && segment.text === 'Right')!;
    const narrations = source.segments.filter((segment) => segment.kind === 'narration');
    const document = hydrateStoryDocument({
      version: 2,
      entryNodeId: 'Start',
      nodes: [
        {
          id: 'Start', type: 'dialogue', speakerSegmentId: speaker.id,
          contentSegmentIds: [dialogue.id], commandIds: [], nextNodeId: '',
        },
        {
          id: 'LeftEnd', type: 'narration', speakerSegmentId: '',
          contentSegmentIds: [narrations[0].id], commandIds: [], nextNodeId: '',
        },
        {
          id: 'RightEnd', type: 'narration', speakerSegmentId: '',
          contentSegmentIds: [narrations[1].id], commandIds: [], nextNodeId: '',
        },
      ],
      choices: [
        {
          id: 'LeftChoice', fromNodeId: 'Start', textSegmentIds: [leftChoice.id],
          targetNodeId: 'LeftEnd', commandIds: [],
        },
        {
          id: 'RightChoice', fromNodeId: 'Start', textSegmentIds: [rightChoice.id],
          targetNodeId: 'RightEnd', commandIds: [],
        },
      ],
    }, source);

    expect(document.nodes.find((node) => node.label === 'LeftEnd')?.next).toBe('StoryEnd');
    expect(document.nodes.find((node) => node.label === 'RightEnd')?.next).toBe('StoryEnd');
    expect(document.nodes.at(-1)).toMatchObject({
      label: 'StoryEnd',
      type: 'system',
      content: '',
      options: [],
    });
  });
});
