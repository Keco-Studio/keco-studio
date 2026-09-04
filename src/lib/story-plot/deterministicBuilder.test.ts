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


  it('uses an original bracketed heading and removes only its outer brackets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Finale',
      nodes: [
        node({
          label: 'Finale',
          type: 'scene',
          content: '【EndingA：Hero“Silence”（Clock tower）】',
        }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes[0]?.title).toBe('开场');
  });


  it('does not project an automatic fallthrough between sibling choice targets', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: 'Buy or not？', speaker: 'A-Cheng',
          options: [
            { text: 'Buy', target: 'Buy', commands: [], sourceRefs: [ref] },
            { text: 'Do not buy', target: 'Skip', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Buy', type: 'narration', content: 'A-Cheng buys flowers。', next: 'Skip' }),
        node({ label: 'Skip', type: 'narration', content: 'A-Cheng skips the flowers。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Buy', optionText: 'Buy', optionIndex: 0 },
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Skip', optionText: 'Do not buy', optionIndex: 1 },
    ]));
    expect(result.edges).not.toContainEqual({
      fromPlotNodeId: 'Buy', toPlotNodeId: 'Skip', optionText: null, optionIndex: null,
    });
  });

  it('does not name a branch after the choice text', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: 'What will you reveal?',
          options: [{ text: 'Tell the truth', target: 'Truth', commands: [], sourceRefs: [ref] }],
        }),
        node({ label: 'Truth', type: 'narration', content: 'The alliance fractures after the confession.' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title).toBe('剧情 2');
    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title)
      .not.toBe('Tell the truth');
  });

  it('names a scene-setting branch with a short location title, not the full prose', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: 'Where will you go?',
          options: [
            { text: 'Visit Aunt Chen', target: 'Aunt', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({
          label: 'Aunt',
          type: 'scene',
          content: '场景：次日，陈阿姨家中。阳光透过窗户洒在老式的红木家具上，墙上挂着泛黄的全家福。',
        }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Aunt')?.title).toBe('陈阿姨家中');
    expect(result.nodes.find((plot) => plot.id === 'Aunt')?.title)
      .not.toMatch(/^场景：/);
  });

  it('keeps the opening scene, character list, and first decision in one plot node', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Start',
      nodes: [
        node({ label: 'Start', type: 'scene', content: '场景：深夜便利店。', next: 'Cast' }),
        node({ label: 'Cast', type: 'scene', content: '人物：路人（林野）、学生（小雨）', next: 'Store' }),
        node({
          label: 'Store', type: 'dialogue', content: '灯还亮着。',
          options: [
            { text: '主动搭话', target: 'Talk', commands: [], sourceRefs: [ref] },
            { text: '沉默不打扰', target: 'Watch', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Talk', type: 'dialogue', content: '也在买东西吗？' }),
        node({ label: 'Watch', type: 'narration', content: '你站在货架后看着。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Start')?.storyNodeIds)
      .toEqual(['Start', 'Cast', 'Store']);
    expect(result.nodes.map((plot) => plot.id)).toEqual(['Start', 'Talk', 'Watch']);
    expect(result.nodes[0]?.title).toBe('深夜便利店');
  });

  it('uses a stable branch fallback when the target content only repeats the option', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Decision',
      nodes: [
        node({
          label: 'Decision', type: 'dialogue', content: 'Choose.',
          options: [{ text: 'Tell the truth', target: 'Truth', commands: [], sourceRefs: [ref] }],
        }),
        node({ label: 'Truth', type: 'dialogue', content: 'Tell the truth' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title).toBe('剧情 2');
    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title)
      .not.toBe('Tell the truth');
  });


});
