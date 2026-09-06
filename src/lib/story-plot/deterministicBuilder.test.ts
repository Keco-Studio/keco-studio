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

    expect(result.nodes[0]?.title).toBe('\u5f00\u573a');
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

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title).toBe('\u5267\u60c5 2');
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
          content: '\u573a\u666f：\u6b21\u65e5，\u9648\u963f\u59e8\u5bb6\u4e2d。\u9633\u5149\u900f\u8fc7\u7a97\u6237\u6d12\u5728\u8001\u5f0f\u7684\u7ea2\u6728\u5bb6\u5177\u4e0a，\u5899\u4e0a\u6302\u7740\u6cdb\u9ec4\u7684\u5168\u5bb6\u798f。',
        }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Aunt')?.title).toBe('\u9648\u963f\u59e8\u5bb6\u4e2d');
    expect(result.nodes.find((plot) => plot.id === 'Aunt')?.title)
      .not.toMatch(/^\u573a\u666f：/);
  });

  it('keeps the opening scene, character list, and first decision in one plot node', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Start',
      nodes: [
        node({ label: 'Start', type: 'scene', content: '\u573a\u666f：\u6df1\u591c\u4fbf\u5229\u5e97。', next: 'Cast' }),
        node({ label: 'Cast', type: 'scene', content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）', next: 'Store' }),
        node({
          label: 'Store', type: 'dialogue', content: '\u706f\u8fd8\u4eae\u7740。',
          options: [
            { text: '\u4e3b\u52a8\u642d\u8bdd', target: 'Talk', commands: [], sourceRefs: [ref] },
            { text: '\u6c89\u9ed8\u4e0d\u6253\u6270', target: 'Watch', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Talk', type: 'dialogue', content: '\u4e5f\u5728\u4e70\u4e1c\u897f\u5417？' }),
        node({ label: 'Watch', type: 'narration', content: '\u4f60\u7ad9\u5728\u8d27\u67b6\u540e\u770b\u7740。' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.find((plot) => plot.id === 'Start')?.storyNodeIds)
      .toEqual(['Start', 'Cast', 'Store']);
    expect(result.nodes.map((plot) => plot.id)).toEqual(['Start', 'Talk', 'Watch']);
    expect(result.nodes[0]?.title).toBe('\u6df1\u591c\u4fbf\u5229\u5e97');
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

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title).toBe('\u5267\u60c5 2');
    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title)
      .not.toBe('Tell the truth');
  });


});
