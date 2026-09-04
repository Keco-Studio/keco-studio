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
  it('accepts summarized titles and rejects option copies, 台词, and 分支 N', async () => {
    const complete = jest.fn(async () => JSON.stringify({
      nodes: [
        { id: 'Start', title: '暴雨公交亭' },
        { id: 'Talk', title: '主动搭话' },
        { id: 'Watch', title: '亭外看雨' },
      ],
    }));

    const titles = await summarizePlotTitlesWithAi([
      { id: 'Start', contents: ['场景：暴雨突袭的街边公交亭。'] },
      { id: 'Talk', contents: ['你好，也在躲雨吗？'], incomingOption: '主动搭话' },
      { id: 'Watch', contents: ['他站在亭外看雨。'], incomingOption: '沉默旁观' },
    ], complete);

    expect(titles.get('Start')).toBe('暴雨公交亭');
    expect(titles.has('Talk')).toBe(false);
    expect(titles.get('Watch')).toBe('亭外看雨');
  });

  it('retries after rejecting an option copy until the beat title lands', async () => {
    const complete = jest.fn(async (_messages: unknown) => {
      if (complete.mock.calls.length === 1) {
        return JSON.stringify({
          nodes: [
            { id: 'Start', title: '暴雨公交亭' },
            { id: 'Talk', title: '主动搭话' },
          ],
        });
      }
      return JSON.stringify({
        nodes: [{ id: 'Talk', title: '雨中询问' }],
      });
    });

    const titles = await summarizePlotTitlesWithAi([
      { id: 'Start', contents: ['场景：暴雨突袭的街边公交亭。'] },
      { id: 'Talk', contents: ['你好，也在躲雨吗？'], incomingOption: 'A选项（主动搭话）' },
    ], complete);

    expect(titles.get('Start')).toBe('暴雨公交亭');
    expect(titles.get('Talk')).toBe('雨中询问');
    const secondUser = JSON.parse((complete.mock.calls[1]?.[0] as { content: string }[])[1]?.content ?? '{}');
    expect(secondUser.chapters.map((chapter: { id: string }) => chapter.id)).toEqual(['Talk']);
    expect(secondUser.rejectedTitles).toEqual([{ id: 'Talk', title: '主动搭话' }]);
  });

  it('requires one title per chapter id, in any order', () => {
    expect(() => parsePlotTitles({
      nodes: [{ id: 'Talk', title: '雨中搭话' }],
    }, ['Start', 'Talk'])).toThrow(/exactly once/i);
    expect(parsePlotTitles({
      nodes: [
        { id: 'Talk', title: '雨中搭话' },
        { id: 'Start', title: '暴雨公交亭' },
      ],
    }, ['Start', 'Talk'])).toEqual(new Map([
      ['Talk', '雨中搭话'],
      ['Start', '暴雨公交亭'],
    ]));
  });

  it('retitles a plot plan when placeholders are still in use', async () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Start',
      nodes: [
        node({ label: 'Start', type: 'scene', content: '场景：暴雨突袭的街边公交亭。', next: 'Talk' }),
        node({ label: 'Talk', type: 'dialogue', content: '他把伞递了过去。' }),
      ],
    };
    const plan = await retitleStoryPlotPlanWithAi(document, {
      version: 1,
      entryPlotNodeId: 'Start',
      nodes: [
        { id: 'Start', title: '开场', storyNodeIds: ['Start'] },
        { id: 'Talk', title: '分支 3', storyNodeIds: ['Talk'] },
      ],
      edges: [{
        fromPlotNodeId: 'Start',
        toPlotNodeId: 'Talk',
        optionText: '主动借伞',
        optionIndex: 0,
      }],
    }, async () => JSON.stringify({
      nodes: [
        { id: 'Start', title: '暴雨公交亭' },
        { id: 'Talk', title: '雨中借伞' },
      ],
    }));

    expect(plan.nodes.map((node) => node.title)).toEqual(['暴雨公交亭', '雨中借伞']);
    expect(plan.nodes.some((node) => node.title === '主动借伞')).toBe(false);
  });
});
