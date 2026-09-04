import { describe, expect, it, jest } from '@jest/globals';
import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import {
  parsePlotTitles,
  retitleStoryPlotPlanWithAi,
  summarizePlotTitlesWithAi,
} from './titleSummarizer';

const ref = { sourceId: 'story', unitId: 'story:0', start: 0, end: 1 };

function node(input: Partial<StoryNode> & Pick<StoryNode, 'label' | 'type' | 'content'>): StoryNode {
  return { commands: [], options: [], sourceRefs: [ref], ...input };
}

describe('AI plot title summarizer', () => {
  it('accepts summarized titles and rejects option copies, \u53f0\u8bcd, and \u5206\u652f N', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      nodes: [
        { id: 'Start', title: '\u66b4\u96e8\u516c\u4ea4\u4ead' },
        { id: 'Talk', title: '\u4e3b\u52a8\u642d\u8bdd' },
        { id: 'Watch', title: '\u4ead\u5916\u770b\u96e8' },
      ],
    }));

    const titles = await summarizePlotTitlesWithAi([
      { id: 'Start', contents: ['\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead。'] },
      { id: 'Talk', contents: ['\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？'], incomingOption: '\u4e3b\u52a8\u642d\u8bdd' },
      { id: 'Watch', contents: ['\u4ed6\u7ad9\u5728\u4ead\u5916\u770b\u96e8。'], incomingOption: '\u6c89\u9ed8\u65c1\u89c2' },
    ], complete);

    expect(titles.get('Start')).toBe('\u66b4\u96e8\u516c\u4ea4\u4ead');
    expect(titles.has('Talk')).toBe(false);
    expect(titles.get('Watch')).toBe('\u4ead\u5916\u770b\u96e8');
  });

  it('retries after rejecting an option copy until the beat title lands', async () => {
    const complete = jest.fn(async (_messages: unknown) => {
      if (complete.mock.calls.length === 1) {
        return JSON.stringify({
          nodes: [
            { id: 'Start', title: '\u66b4\u96e8\u516c\u4ea4\u4ead' },
            { id: 'Talk', title: '\u4e3b\u52a8\u642d\u8bdd' },
          ],
        });
      }
      return JSON.stringify({
        nodes: [{ id: 'Talk', title: '\u96e8\u4e2d\u8be2\u95ee' }],
      });
    });

    const titles = await summarizePlotTitlesWithAi([
      { id: 'Start', contents: ['\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead。'] },
      { id: 'Talk', contents: ['\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？'], incomingOption: 'A\u9009\u9879（\u4e3b\u52a8\u642d\u8bdd）' },
    ], complete);

    expect(titles.get('Start')).toBe('\u66b4\u96e8\u516c\u4ea4\u4ead');
    expect(titles.get('Talk')).toBe('\u96e8\u4e2d\u8be2\u95ee');
    const secondUser = JSON.parse((complete.mock.calls[1]?.[0] as { content: string }[])[1]?.content ?? '{}');
    expect(secondUser.chapters.map((chapter: { id: string }) => chapter.id)).toEqual(['Talk']);
    expect(secondUser.rejectedTitles).toEqual([{ id: 'Talk', title: '\u4e3b\u52a8\u642d\u8bdd' }]);
  });

  it('requires one title per chapter id, in any order', () => {
    expect(() => parsePlotTitles({
      nodes: [{ id: 'Talk', title: '\u96e8\u4e2d\u642d\u8bdd' }],
    }, ['Start', 'Talk'])).toThrow(/exactly once/i);
    expect(parsePlotTitles({
      nodes: [
        { id: 'Talk', title: '\u96e8\u4e2d\u642d\u8bdd' },
        { id: 'Start', title: '\u66b4\u96e8\u516c\u4ea4\u4ead' },
      ],
    }, ['Start', 'Talk'])).toEqual(new Map([
      ['Talk', '\u96e8\u4e2d\u642d\u8bdd'],
      ['Start', '\u66b4\u96e8\u516c\u4ea4\u4ead'],
    ]));
  });

  it('retitles a plot plan when placeholders are still in use', async () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Start',
      nodes: [
        node({ label: 'Start', type: 'scene', content: '\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead。', next: 'Talk' }),
        node({ label: 'Talk', type: 'dialogue', content: '\u4ed6\u628a\u4f1e\u9012\u4e86\u8fc7\u53bb。' }),
      ],
    };
    const plan = await retitleStoryPlotPlanWithAi(document, {
      version: 1,
      entryPlotNodeId: 'Start',
      nodes: [
        { id: 'Start', title: '\u5f00\u573a', storyNodeIds: ['Start'] },
        { id: 'Talk', title: '\u5206\u652f 3', storyNodeIds: ['Talk'] },
      ],
      edges: [{
        fromPlotNodeId: 'Start',
        toPlotNodeId: 'Talk',
        optionText: '\u4e3b\u52a8\u501f\u4f1e',
        optionIndex: 0,
      }],
    }, async () => JSON.stringify({
      nodes: [
        { id: 'Start', title: '\u66b4\u96e8\u516c\u4ea4\u4ead' },
        { id: 'Talk', title: '\u96e8\u4e2d\u501f\u4f1e' },
      ],
    }));

    expect(plan.nodes.map((node) => node.title)).toEqual(['\u66b4\u96e8\u516c\u4ea4\u4ead', '\u96e8\u4e2d\u501f\u4f1e']);
    expect(plan.nodes.some((node) => node.title === '\u4e3b\u52a8\u501f\u4f1e')).toBe(false);
  });
});
