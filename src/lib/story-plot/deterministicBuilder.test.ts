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
        node({ label: 'Opening', type: 'scene', content: '开场', next: 'Decision' }),
        node({
          label: 'Decision', type: 'dialogue', content: '如何选择？', speaker: '你',
          options: [
            { text: '买花', target: 'Buy', commands: [], sourceRefs: [ref] },
            { text: '不买', target: 'Skip', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Buy', type: 'narration', content: '阿城买花。', next: 'Merge' }),
        node({ label: 'Skip', type: 'narration', content: '阿城暂时没买。', next: 'Merge' }),
        node({ label: 'Merge', type: 'narration', content: '一个月后，他再次来到地铁口。' }),
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
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Buy', optionText: '买花', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Skip', optionText: '不买', optionIndex: 1 },
      { fromPlotNodeId: 'Buy', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Skip', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
    ]));
    expect(result.nodes.find((plot) => plot.id === 'Merge')?.title).toBe('最终汇聚');
  });

  it('uses an original bracketed heading and removes only its outer brackets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Finale',
      nodes: [
        node({
          label: 'Finale',
          type: 'scene',
          content: '【结局A：英雄的“沉默”（钟楼）】',
        }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes[0]?.title).toBe('结局A：英雄的“沉默”（钟楼）');
  });

  it('groups visible character profiles under a character introduction title', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Characters',
      nodes: [
        node({ label: 'Characters', type: 'scene', content: '人物：', next: 'Lin' }),
        node({ label: 'Lin', type: 'narration', content: '林晓（女，23岁）：应届毕业生。', next: 'Li' }),
        node({ label: 'Li', type: 'narration', content: '李明（男，28岁）：职场老油条。', next: 'ActOne' }),
        node({ label: 'ActOne', type: 'scene', content: '第一幕：抉择之夜' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes[0]).toEqual({
      id: 'Characters',
      title: '人物介绍',
      storyNodeIds: ['Characters', 'Lin', 'Li'],
    });
  });

  it('does not project an automatic fallthrough between sibling choice targets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: '买不买？', speaker: '阿城',
          options: [
            { text: '买', target: 'Buy', commands: [], sourceRefs: [ref] },
            { text: '不买', target: 'Skip', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Buy', type: 'narration', content: '阿城买花。', next: 'Skip' }),
        node({ label: 'Skip', type: 'narration', content: '阿城不买花。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Buy', optionText: '买', optionIndex: 0 },
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Skip', optionText: '不买', optionIndex: 1 },
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
          label: 'Opening', type: 'scene', content: '第一幕',
          options: [{ text: '买', target: 'Buy', commands: [], sourceRefs: [ref] }],
        }),
        node({ label: 'Buy', type: 'narration', content: '阿城买下两把花。', next: 'BuyEnd' }),
        node({ label: 'BuyEnd', type: 'narration', content: '【结局：花香引路】阿城获得了工作机会。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'BuyEnd')?.title).toBe('花香引路');
  });

  it('groups branch plots by graph path when their source rows are discontiguous', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Opening',
      nodes: [
        node({
          label: 'Opening', type: 'scene', content: '第一幕',
          options: [
            { text: '买。', target: 'BuyStart', commands: [], sourceRefs: [ref] },
            { text: '不买。', target: 'SkipStart', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'BuyStart', type: 'narration', content: '阿城买下两把花。', next: 'BuyEnding' }),
        node({ label: 'BuyEnding', type: 'narration', content: '【结局：花香引路】阿城获得了工作机会。', next: 'BuyReturn' }),
        node({ label: 'SkipStart', type: 'narration', content: '阿城暂时没有买花。', next: 'SkipEnding' }),
        node({ label: 'SkipEnding', type: 'narration', content: '【结局：花香迟到】阿城后来补买了花。', next: 'SkipReturn' }),
        node({ label: 'SharedAct', type: 'scene', content: '第二幕：汇聚', next: 'SharedFinal' }),
        node({ label: 'BuyReturn', type: 'narration', content: '来自分支 A 的阿城拿出干枯的栀子花。', next: 'SharedAct' }),
        node({ label: 'SkipReturn', type: 'narration', content: '来自分支 B 的阿城买了十把花。', next: 'SharedAct' }),
        node({ label: 'SharedFinal', type: 'narration', content: '阿城拿着花汇入人流。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.map((plot) => [plot.title, plot.storyNodeIds])).toEqual([
      ['第一幕', ['Opening']],
      ['买。', ['BuyStart']],
      ['花香引路', ['BuyEnding', 'BuyReturn']],
      ['不买。', ['SkipStart']],
      ['花香迟到', ['SkipEnding', 'SkipReturn']],
      ['第二幕：汇聚', ['SharedAct', 'SharedFinal']],
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'BuyStart', optionText: '买。', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'SkipStart', optionText: '不买。', optionIndex: 1 },
      { fromPlotNodeId: 'BuyStart', toPlotNodeId: 'BuyEnding', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'BuyEnding', toPlotNodeId: 'SharedAct', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'SkipStart', toPlotNodeId: 'SkipEnding', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'SkipEnding', toPlotNodeId: 'SharedAct', optionText: null, optionIndex: null },
    ]));
  });
});
