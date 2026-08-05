import { describe, expect, it } from '@jest/globals';
import type { StoryContentExtraction, StoryGraphExtraction } from '@/lib/story-extraction/pipeline';
import { segmentStorySource } from './sourceSegments';
import {
  applyExplicitNestedBranchGraph,
  recoverExplicitNestedBranchChoices,
} from './explicitNestedBranches';

const source = segmentStorySource([
  '【暴雨开场】',
  '分支一：主动搭话（可嵌套二级分支）',
  '林野：同学，需要帮忙吗？',
  '小雨：我的伞坏了。',
  '嵌套分支A1：主动借伞 → 结局一（暖心同行）',
  '林野：我送你回家。',
  '嵌套分支A2：温柔宽慰 → 结局二（善意留白）',
  '林野：安心等雨停。',
  '分支二：沉默旁观 → 结局三（擦肩陌路）',
  '【林野没有出声打扰】',
].join('\n'), 'rain');

const content: StoryContentExtraction = {
  version: 3,
  structuralUnitIds: ['rain:1', 'rain:4', 'rain:6', 'rain:8'],
  nodes: [
    { id: 'opening', type: 'scene', presentationType: 4, speaker: '', content: '暴雨开场', sourceUnitIds: ['rain:0'] },
    { id: 'active_1', type: 'dialogue', presentationType: 1, speaker: '林野', content: '同学，需要帮忙吗？', sourceUnitIds: ['rain:2'] },
    { id: 'active_2', type: 'dialogue', presentationType: 2, speaker: '小雨', content: '我的伞坏了。', sourceUnitIds: ['rain:3'] },
    { id: 'a1', type: 'dialogue', presentationType: 1, speaker: '林野', content: '我送你回家。', sourceUnitIds: ['rain:5'] },
    { id: 'a2', type: 'dialogue', presentationType: 1, speaker: '林野', content: '安心等雨停。', sourceUnitIds: ['rain:7'] },
    { id: 'silent', type: 'scene', presentationType: 4, speaker: '', content: '林野没有出声打扰', sourceUnitIds: ['rain:9'] },
  ],
  choices: [
    { id: 'a1_choice', text: '主动借伞', sourceUnitIds: ['rain:4'] },
    { id: 'a2_choice', text: '温柔宽慰', sourceUnitIds: ['rain:6'] },
    { id: 'silent_choice', text: '沉默旁观', sourceUnitIds: ['rain:8'] },
  ],
};

describe('explicit nested branch hierarchy', () => {
  it('recovers a missing top-level branch choice from its source marker', () => {
    const recovered = recoverExplicitNestedBranchChoices(source, content);

    expect(recovered.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '主动搭话', sourceUnitIds: ['rain:1'] }),
      expect.objectContaining({ text: '沉默旁观', sourceUnitIds: ['rain:8'] }),
    ]));
    expect(recovered.structuralUnitIds).not.toContain('rain:1');
  });

  it('forces top-level and nested choices onto different decision owners', () => {
    const recovered = recoverExplicitNestedBranchChoices(source, content);
    const activeChoice = recovered.choices.find((choice) => choice.text === '主动搭话')!;
    const graph: StoryGraphExtraction = {
      version: 3,
      entryNodeId: 'opening',
      nodeLinks: recovered.nodes.map((node) => `${node.id}->`),
      choiceLinks: recovered.choices.map((choice) => `${choice.id}->opening->${
        choice.text === '沉默旁观' ? 'silent' : choice.text === '温柔宽慰' ? 'a2' : 'a1'
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
