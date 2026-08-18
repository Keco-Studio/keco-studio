import { describe, expect, it } from '@jest/globals';
import { renderGddV2Markdown } from './renderer';
import { countReadableCharacters, validateGddQuality } from './quality';
import type { DocumentV2 } from './contracts';

const document: DocumentV2 = {
  version: 2,
  id: 'warmth-gdd',
  title: '街角暖光',
  versionLabel: '1.0',
  gameType: '情感陪伴模拟',
  targetPlatforms: ['移动端', 'PC'],
  premise: '玩家在城市街角遇见流浪猫，并通过持续而克制的陪伴建立信任。',
  blueprint: { version: 2, nodes: [{ id: 'overview', label: '游戏概述', depth: 0, group: 'core' }] },
  numericRegistry: { version: 2, entries: [{ id: 'bond.base', value: 5, label: '基础羁绊' }] },
  sections: [{
    id: 'overview', title: '游戏概述', depth: 0, blocks: [
      { kind: 'paragraph', id: 'overview-p', text: '温柔但有责任重量的陪伴体验。' },
      { kind: 'flow', id: 'overview-flow', steps: [{ id: 'step-a', text: '进入街角' }, { id: 'step-b', text: '观察并互动' }] },
      { kind: 'data-table', id: 'overview-table', columns: ['行为', '基础值'], rows: [['喂食', '5']] },
      { kind: 'formula', id: 'overview-formula', expression: '实际增量 = 基础值 × 天气系数', numericRefs: ['bond.base'] },
      { kind: 'example', id: 'overview-example', title: '计算例', body: '晴天喂食时，基础值为 5。', numericRefs: ['bond.base'] },
      { kind: 'quote', id: 'overview-quote', text: '它不是被你养大，而是选择了你。', cite: '设计哲学' },
    ],
  }],
  assumptions: [],
};

describe('v2 GDD renderer and deterministic quality', () => {
  it('renders natural numbered Markdown blocks without provenance', () => {
    const markdown = renderGddV2Markdown(document);
    expect(markdown).toContain('# 街角暖光');
    expect(markdown).toContain('## 1. 游戏概述');
    expect(markdown).toContain('| 行为 | 基础值 |');
    expect(markdown).toContain('实际增量 = 基础值 × 天气系数');
    expect(markdown).toContain('> —— 设计哲学');
    expect(markdown).not.toMatch(/Provenance/i);
  });

  it('renders assumptions only when present', () => {
    expect(renderGddV2Markdown(document)).not.toContain('待确认事项');
    expect(renderGddV2Markdown({ ...document, assumptions: ['目标平台尚未确认。'] })).toContain('## 待确认事项');
  });

  it('reports deterministic structural issues', () => {
    expect(countReadableCharacters(renderGddV2Markdown(document))).toBeGreaterThan(20);
    expect(validateGddQuality(document, 'professional')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'length' }),
      expect.objectContaining({ code: 'section-count' }),
    ]));
    expect(validateGddQuality({ ...document, sections: [{ ...document.sections[0], blocks: [] }] }, 'quick'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'empty-section' })]));
  });
});
