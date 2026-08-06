import { describe, expect, it } from '@jest/globals';
import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import { buildDeterministicStoryPlotPlan } from './deterministicBuilder';

const ref = { sourceId: 'story', unitId: 'story:0', start: 0, end: 1 };

function node(input: Partial<StoryNode> & Pick<StoryNode, 'label' | 'type' | 'content'>): StoryNode {
  return {
    commands: [],
    options: [],
    sourceRefs: [ref],
    ...input,
  };
}

describe('deterministic plot grouping', () => {
  it('groups headings and branch targets while keeping choices on edges', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Background',
      nodes: [
        node({ label: 'Background', type: 'scene', content: '\u5267\u60c5\u80cc\u666f', next: 'Opening' }),
        node({ label: 'Opening', type: 'scene', content: '\u5f00\u573a\u5bf9\u8bdd', next: 'Decision' }),
        node({
          label: 'Decision', type: 'dialogue', content: '\u5982\u4f55\u51b3\u65ad？', speaker: '\u4f60',
          options: [
            { text: '\u7a33\u5b88\u6d3e\u8def\u7ebf', target: 'Stable', commands: [], sourceRefs: [ref] },
            { text: '\u5fe0\u541b\u8def\u7ebf', target: 'Loyal', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Stable', type: 'narration', content: '\u62f1\u624b', speaker: '\u4f60', next: 'StableLine' }),
        node({ label: 'StableLine', type: 'dialogue', content: '\u81e3\u4ee5\u4e3a\u5f53\u629a\u6c11。', speaker: '\u4f60' }),
        node({ label: 'Loyal', type: 'narration', content: '\u518d\u62dc', speaker: '\u4f60', next: 'LoyalLine' }),
        node({ label: 'LoyalLine', type: 'dialogue', content: '\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14。', speaker: '\u4f60' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.map((plot) => [plot.title, plot.storyNodeIds])).toEqual([
      ['\u5267\u60c5\u80cc\u666f', ['Background']],
      ['\u5f00\u573a\u5bf9\u8bdd', ['Opening', 'Decision']],
      ['\u7a33\u5b88\u6d3e\u8def\u7ebf', ['Stable', 'StableLine']],
      ['\u5fe0\u541b\u8def\u7ebf', ['Loyal', 'LoyalLine']],
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Background', toPlotNodeId: 'Opening', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Stable', optionText: '\u7a33\u5b88\u6d3e\u8def\u7ebf', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Loyal', optionText: '\u5fe0\u541b\u8def\u7ebf', optionIndex: 1 },
    ]));
  });

  it('folds a safe decision into its preceding plot while keeping routes and merge separate', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Opening',
      nodes: [
        node({ label: 'Opening', type: 'scene', content: '\u5f00\u573a', next: 'Decision' }),
        node({
          label: 'Decision', type: 'dialogue', content: '\u5982\u4f55\u9009\u62e9？', speaker: '\u4f60',
          options: [
            { text: '\u4e70\u82b1', target: 'Buy', commands: [], sourceRefs: [ref] },
            { text: '\u4e0d\u4e70', target: 'Skip', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Buy', type: 'narration', content: '\u963f\u57ce\u4e70\u82b1。', next: 'Merge' }),
        node({ label: 'Skip', type: 'narration', content: '\u963f\u57ce\u6682\u65f6\u6ca1\u4e70。', next: 'Merge' }),
        node({ label: 'Merge', type: 'narration', content: '\u4e00\u4e2a\u6708\u540e，\u4ed6\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.map((plot) => [plot.id, plot.storyNodeIds])).toEqual([
      ['Opening', ['Opening', 'Decision']],
      ['Buy', ['Buy']],
      ['Skip', ['Skip']],
      ['Merge', ['Merge']],
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Buy', optionText: '\u4e70\u82b1', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Skip', optionText: '\u4e0d\u4e70', optionIndex: 1 },
      { fromPlotNodeId: 'Buy', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Skip', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
    ]));
    expect(result.nodes.find((plot) => plot.id === 'Merge')?.title).toBe('\u6700\u7ec8\u6c47\u805a');
  });

  it('uses an original bracketed heading and removes only its outer brackets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Finale',
      nodes: [
        node({
          label: 'Finale',
          type: 'scene',
          content: '【\u7ed3\u5c40A：\u82f1\u96c4\u7684“\u6c89\u9ed8”（\u949f\u697c）】',
        }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes[0]?.title).toBe('\u7ed3\u5c40A：\u82f1\u96c4\u7684“\u6c89\u9ed8”（\u949f\u697c）');
  });

  it('groups visible character profiles under a character introduction title', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Characters',
      nodes: [
        node({ label: 'Characters', type: 'scene', content: '\u4eba\u7269：', next: 'Lin' }),
        node({ label: 'Lin', type: 'narration', content: '\u6797\u6653（\u5973，23\u5c81）：\u5e94\u5c4a\u6bd5\u4e1a\u751f。', next: 'Li' }),
        node({ label: 'Li', type: 'narration', content: '\u674e\u660e（\u7537，28\u5c81）：\u804c\u573a\u8001\u6cb9\u6761。', next: 'ActOne' }),
        node({ label: 'ActOne', type: 'scene', content: '\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes[0]).toEqual({
      id: 'Characters',
      title: '\u4eba\u7269\u4ecb\u7ecd',
      storyNodeIds: ['Characters', 'Lin', 'Li'],
    });
  });

  it('does not project an automatic fallthrough between sibling choice targets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: '\u4e70\u4e0d\u4e70？', speaker: '\u963f\u57ce',
          options: [
            { text: '\u4e70', target: 'Buy', commands: [], sourceRefs: [ref] },
            { text: '\u4e0d\u4e70', target: 'Skip', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Buy', type: 'narration', content: '\u963f\u57ce\u4e70\u82b1。', next: 'Skip' }),
        node({ label: 'Skip', type: 'narration', content: '\u963f\u57ce\u4e0d\u4e70\u82b1。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Buy', optionText: '\u4e70', optionIndex: 0 },
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Skip', optionText: '\u4e0d\u4e70', optionIndex: 1 },
    ]));
    expect(result.edges).not.toContainEqual({
      fromPlotNodeId: 'Buy', toPlotNodeId: 'Skip', optionText: null, optionIndex: null,
    });
  });

  it('uses an explicit ending name as the branch plot title', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Opening',
      nodes: [
        node({
          label: 'Opening', type: 'scene', content: '\u7b2c\u4e00\u5e55',
          options: [{ text: '\u4e70', target: 'Buy', commands: [], sourceRefs: [ref] }],
        }),
        node({ label: 'Buy', type: 'narration', content: '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。', next: 'BuyEnd' }),
        node({ label: 'BuyEnd', type: 'narration', content: '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】\u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'BuyEnd')?.title).toBe('\u82b1\u9999\u5f15\u8def');
  });

  it('groups branch plots by graph path when their source rows are discontiguous', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Opening',
      nodes: [
        node({
          label: 'Opening', type: 'scene', content: '\u7b2c\u4e00\u5e55',
          options: [
            { text: '\u4e70。', target: 'BuyStart', commands: [], sourceRefs: [ref] },
            { text: '\u4e0d\u4e70。', target: 'SkipStart', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'BuyStart', type: 'narration', content: '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。', next: 'BuyEnding' }),
        node({ label: 'BuyEnding', type: 'narration', content: '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】\u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。', next: 'BuyReturn' }),
        node({ label: 'SkipStart', type: 'narration', content: '\u963f\u57ce\u6682\u65f6\u6ca1\u6709\u4e70\u82b1。', next: 'SkipEnding' }),
        node({ label: 'SkipEnding', type: 'narration', content: '【\u7ed3\u5c40：\u82b1\u9999\u8fdf\u5230】\u963f\u57ce\u540e\u6765\u8865\u4e70\u4e86\u82b1。', next: 'SkipReturn' }),
        node({ label: 'SharedAct', type: 'scene', content: '\u7b2c\u4e8c\u5e55：\u6c47\u805a', next: 'SharedFinal' }),
        node({ label: 'BuyReturn', type: 'narration', content: '\u6765\u81ea\u5206\u652f A \u7684\u963f\u57ce\u62ff\u51fa\u5e72\u67af\u7684\u6800\u5b50\u82b1。', next: 'SharedAct' }),
        node({ label: 'SkipReturn', type: 'narration', content: '\u6765\u81ea\u5206\u652f B \u7684\u963f\u57ce\u4e70\u4e86\u5341\u628a\u82b1。', next: 'SharedAct' }),
        node({ label: 'SharedFinal', type: 'narration', content: '\u963f\u57ce\u62ff\u7740\u82b1\u6c47\u5165\u4eba\u6d41。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.map((plot) => [plot.title, plot.storyNodeIds])).toEqual([
      ['\u7b2c\u4e00\u5e55', ['Opening']],
      ['\u4e70。', ['BuyStart']],
      ['\u82b1\u9999\u5f15\u8def', ['BuyEnding', 'BuyReturn']],
      ['\u4e0d\u4e70。', ['SkipStart']],
      ['\u82b1\u9999\u8fdf\u5230', ['SkipEnding', 'SkipReturn']],
      ['\u7b2c\u4e8c\u5e55：\u6c47\u805a', ['SharedAct', 'SharedFinal']],
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'BuyStart', optionText: '\u4e70。', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'SkipStart', optionText: '\u4e0d\u4e70。', optionIndex: 1 },
      { fromPlotNodeId: 'BuyStart', toPlotNodeId: 'BuyEnding', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'BuyEnding', toPlotNodeId: 'SharedAct', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'SkipStart', toPlotNodeId: 'SkipEnding', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'SkipEnding', toPlotNodeId: 'SharedAct', optionText: null, optionIndex: null },
    ]));
  });
});
