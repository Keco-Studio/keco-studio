import { describe, expect, it } from '@jest/globals';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import { segmentStorySource } from './sourceSegments';
import {
  applyExplicitNestedBranchGraph,
  recoverExplicitNestedBranchChoices,
} from './explicitNestedBranches';

const source = segmentStorySource([
  '【\u66b4\u96e8\u5f00\u573a】',
  '\u5206\u652f\u4e00：\u4e3b\u52a8\u642d\u8bdd（\u53ef\u5d4c\u5957\u4e8c\u7ea7\u5206\u652f）',
  '\u6797\u91ce：\u540c\u5b66，\u9700\u8981\u5e2e\u5fd9\u5417？',
  '\u5c0f\u96e8：\u6211\u7684\u4f1e\u574f\u4e86。',
  '\u5d4c\u5957\u5206\u652fA1：\u4e3b\u52a8\u501f\u4f1e → \u7ed3\u5c40\u4e00（\u6696\u5fc3\u540c\u884c）',
  '\u6797\u91ce：\u6211\u9001\u4f60\u56de\u5bb6。',
  '\u5d4c\u5957\u5206\u652fA2：\u6e29\u67d4\u5bbd\u6170 → \u7ed3\u5c40\u4e8c（\u5584\u610f\u7559\u767d）',
  '\u6797\u91ce：\u5b89\u5fc3\u7b49\u96e8\u505c。',
  '\u5206\u652f\u4e8c：\u6c89\u9ed8\u65c1\u89c2 → \u7ed3\u5c40\u4e09（\u64e6\u80a9\u964c\u8def）',
  '【\u6797\u91ce\u6ca1\u6709\u51fa\u58f0\u6253\u6270】',
].join('\n'), 'rain');

const content: StoryContentExtraction = {
  version: 3,
  structuralUnitIds: ['rain:1', 'rain:4', 'rain:6', 'rain:8'],
  nodes: [
    { id: 'opening', type: 'scene', presentationType: 4, speaker: '', content: '\u66b4\u96e8\u5f00\u573a', sourceUnitIds: ['rain:0'] },
    { id: 'active_1', type: 'dialogue', presentationType: 1, speaker: '\u6797\u91ce', content: '\u540c\u5b66，\u9700\u8981\u5e2e\u5fd9\u5417？', sourceUnitIds: ['rain:2'] },
    { id: 'active_2', type: 'dialogue', presentationType: 2, speaker: '\u5c0f\u96e8', content: '\u6211\u7684\u4f1e\u574f\u4e86。', sourceUnitIds: ['rain:3'] },
    { id: 'a1', type: 'dialogue', presentationType: 1, speaker: '\u6797\u91ce', content: '\u6211\u9001\u4f60\u56de\u5bb6。', sourceUnitIds: ['rain:5'] },
    { id: 'a2', type: 'dialogue', presentationType: 1, speaker: '\u6797\u91ce', content: '\u5b89\u5fc3\u7b49\u96e8\u505c。', sourceUnitIds: ['rain:7'] },
    { id: 'silent', type: 'scene', presentationType: 4, speaker: '', content: '\u6797\u91ce\u6ca1\u6709\u51fa\u58f0\u6253\u6270', sourceUnitIds: ['rain:9'] },
  ],
  choices: [
    { id: 'a1_choice', text: '\u4e3b\u52a8\u501f\u4f1e', sourceUnitIds: ['rain:4'] },
    { id: 'a2_choice', text: '\u6e29\u67d4\u5bbd\u6170', sourceUnitIds: ['rain:6'] },
    { id: 'silent_choice', text: '\u6c89\u9ed8\u65c1\u89c2', sourceUnitIds: ['rain:8'] },
  ],
};

describe('explicit nested branch hierarchy', () => {
  it('recovers a missing top-level branch choice from its source marker', () => {
    const recovered = recoverExplicitNestedBranchChoices(source, content);

    expect(recovered.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '\u4e3b\u52a8\u642d\u8bdd', sourceUnitIds: ['rain:1'] }),
      expect.objectContaining({ text: '\u6c89\u9ed8\u65c1\u89c2', sourceUnitIds: ['rain:8'] }),
    ]));
    expect(recovered.structuralUnitIds).not.toContain('rain:1');
  });

  it('forces top-level and nested choices onto different decision owners', () => {
    const recovered = recoverExplicitNestedBranchChoices(source, content);
    const activeChoice = recovered.choices.find((choice) => choice.text === '\u4e3b\u52a8\u642d\u8bdd')!;
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'opening',
      nodeLinks: recovered.nodes.map((node) => `${node.id}->`),
      choiceLinks: recovered.choices.map((choice) => `${choice.id}->opening->${
        choice.text === '\u6c89\u9ed8\u65c1\u89c2' ? 'silent' : choice.text === '\u6e29\u67d4\u5bbd\u6170' ? 'a2' : 'a1'
      }`),
      commandLinks: [],
    };

    const repaired = applyExplicitNestedBranchGraph(source, recovered, graph);

    expect(repaired.choiceLinks).toEqual(expect.arrayContaining([
      `${activeChoice.id}->opening->active_1`,
      'silent_choice->opening->silent',
      'a1_choice->active_2->a1',
      'a2_choice->active_2->a2',
    ]));
  });
});
