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

    expect(result.nodes[0]?.title).toBe('EndingA：Hero“Silence”（Clock tower）');
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

  it('names a branch by its outcome instead of repeating the choice text', () => {
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

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title)
      .toBe('The alliance fractures after the confession.');
    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title)
      .not.toBe('Tell the truth');
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

    expect(result.nodes.find((plot) => plot.id === 'Truth')?.title).toBe('Branch 2');
  });


});
