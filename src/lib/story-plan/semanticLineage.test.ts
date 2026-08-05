import { describe, expect, it } from '@jest/globals';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import { materializeStoryExtraction } from '@/lib/story-extraction/materializer';
import { segmentStorySource } from './sourceSegments';
import {
  AI_SEMANTIC_LINEAGE_TOOL,
  applySemanticLineagePatch,
  buildSemanticLineageMessages,
  materializeSemanticLineage,
  parseSemanticLineage,
  parseSemanticLineagePatch,
  parseSemanticLineageForSource,
} from './semanticLineage';

describe('semantic lineage story compiler', () => {
  it('resolves claimed structural and option units by their source roles', () => {
    const source = segmentStorySource([
      '人物：',
      '林默：走哪条路？',
      'A：左路。',
      'B：右路。',
      '林默走上左路。',
      '林默走上右路。',
    ].join('\n'), 'semantic-role-conflict');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [
        'semantic-role-conflict:0',
        'semantic-role-conflict:2',
      ],
      decisions: [{
        id: 'd0', ownerUnitId: 'semantic-role-conflict:1', options: [
          { id: 'oa', sourceUnitId: 'semantic-role-conflict:2', text: '左路。' },
          { id: 'ob', sourceUnitId: 'semantic-role-conflict:3', text: '右路。' },
        ],
      }],
      histories: [
        { id: 'ha', optionIds: ['oa'] },
        { id: 'hb', optionIds: ['ob'] },
      ],
      unitClaims: [
        { sourceUnitId: 'semantic-role-conflict:0', historyIds: ['ha', 'hb'] },
        { sourceUnitId: 'semantic-role-conflict:1', historyIds: ['ha', 'hb'] },
        { sourceUnitId: 'semantic-role-conflict:2', historyIds: ['ha'] },
        { sourceUnitId: 'semantic-role-conflict:4', historyIds: ['ha'] },
        { sourceUnitId: 'semantic-role-conflict:5', historyIds: ['hb'] },
      ],
    });

    const candidate = materializeSemanticLineage(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(candidate.plan, candidate.source),
      candidate.source
    );

    expect(document.nodes.map((node) => node.content)).toContain('人物：');
    expect(enumeratePaths(document)).toHaveLength(2);
  });

  it('patches only affected unit history membership without mutating the candidate', () => {
    const candidate = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [
          { id: 'o0', sourceUnitId: 'u1', text: '左' },
          { id: 'o1', sourceUnitId: 'u2', text: '右' },
        ],
      }],
      histories: [
        { id: 'h0', optionIds: ['o0'] },
        { id: 'h1', optionIds: ['o1'] },
      ],
      unitClaims: [{ sourceUnitId: 'u3', historyIds: ['h0'] }],
    });
    const patch = parseSemanticLineagePatch({ operations: [{
      action: 'set_unit_histories', unitId: 'u3', historyIds: ['h1'],
    }] });

    const repaired = applySemanticLineagePatch(candidate, patch, [{
      message: 'Wrong branch ownership', unitIds: ['u3'], nodeIds: [],
    }]);

    expect(candidate.unitClaims[0].historyIds).toEqual(['h0']);
    expect(repaired.unitClaims[0].historyIds).toEqual(['h1']);
  });

  it('uses compact source aliases in the semantic AI contract', () => {
    const source = segmentStorySource([
      '王大可：怎么写？',
      '选择 A：坦白。',
      '王大可说了实话。',
    ].join('\n'), 'semantic-alias');
    const messages = buildSemanticLineageMessages(source);
    const input = JSON.parse(messages[1].content as string);
    const parsed = parseSemanticLineageForSource({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [{ id: 'o0', sourceUnitId: 'u1', text: '坦白。' }],
      }],
      histories: [{ id: 'h0', optionIds: ['o0'] }],
      unitClaims: [
        { sourceUnitId: 'u0', historyIds: ['h0'] },
        { sourceUnitId: 'u2', historyIds: ['h0'] },
      ],
    }, source);

    expect(AI_SEMANTIC_LINEAGE_TOOL.function.name).toBe('submit_branch_structure');
    expect(input.task).toBe('PLAN_SEMANTIC_LINEAGE');
    expect(input.sourceUnits.map((unit: { id: string }) => unit.id)).toEqual(['u0', 'u1', 'u2']);
    expect(parsed.decisions[0].ownerUnitId).toBe('semantic-alias:0');
    expect(parsed.unitClaims[1].sourceUnitId).toBe('semantic-alias:2');
  });

  it('keeps history variants isolated through shared pre-variant content', () => {
    const source = segmentStorySource([
      '王大可：周报怎么写？',
      '选择 A：胡编乱造。',
      '选择 B：硬刚坦白。',
      '王大可：如何应对 AI 警告？',
      '选择 A1：对质。',
      'A1 的前置结局。',
      '选择 A2：自首。',
      'A2 的前置结局。',
      '王大可：如何回应意外走红？',
      '选择 B1：改革。',
      'B1 的前置结局。',
      '选择 B2：道歉。',
      'B2 的前置结局。',
      '所有路线来到同一场颁奖典礼。',
      '来自 A1 的内心独白。',
      '来自 A2 的内心独白。',
      '来自 B1 的内心独白。',
      '来自 B2 的内心独白。',
      '字幕：所有笑话最终都会重逢。',
    ].join('\n'), 'semantic-history');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [
        {
          id: 'd-root', ownerUnitId: 'semantic-history:0',
          options: [
            { id: 'o-a', sourceUnitId: 'semantic-history:1', text: '胡编乱造。' },
            { id: 'o-b', sourceUnitId: 'semantic-history:2', text: '硬刚坦白。' },
          ],
        },
        {
          id: 'd-a', ownerUnitId: 'semantic-history:3',
          options: [
            { id: 'o-a1', sourceUnitId: 'semantic-history:4', text: '对质。' },
            { id: 'o-a2', sourceUnitId: 'semantic-history:6', text: '自首。' },
          ],
        },
        {
          id: 'd-b', ownerUnitId: 'semantic-history:8',
          options: [
            { id: 'o-b1', sourceUnitId: 'semantic-history:9', text: '改革。' },
            { id: 'o-b2', sourceUnitId: 'semantic-history:11', text: '道歉。' },
          ],
        },
      ],
      histories: [
        { id: 'h-a1', optionIds: ['o-a', 'o-a1'] },
        { id: 'h-a2', optionIds: ['o-a', 'o-a2'] },
        { id: 'h-b1', optionIds: ['o-b', 'o-b1'] },
        { id: 'h-b2', optionIds: ['o-b', 'o-b2'] },
      ],
      unitClaims: [
        { sourceUnitId: 'semantic-history:0', historyIds: ['h-a1', 'h-a2', 'h-b1', 'h-b2'] },
        { sourceUnitId: 'semantic-history:3', historyIds: ['h-a1', 'h-a2'] },
        { sourceUnitId: 'semantic-history:5', historyIds: ['h-a1'] },
        { sourceUnitId: 'semantic-history:7', historyIds: ['h-a2'] },
        { sourceUnitId: 'semantic-history:8', historyIds: ['h-b1', 'h-b2'] },
        { sourceUnitId: 'semantic-history:10', historyIds: ['h-b1'] },
        { sourceUnitId: 'semantic-history:12', historyIds: ['h-b2'] },
        { sourceUnitId: 'semantic-history:13', historyIds: ['h-a1', 'h-a2', 'h-b1', 'h-b2'] },
        { sourceUnitId: 'semantic-history:14', historyIds: ['h-a1'] },
        { sourceUnitId: 'semantic-history:15', historyIds: ['h-a2'] },
        { sourceUnitId: 'semantic-history:16', historyIds: ['h-b1'] },
        { sourceUnitId: 'semantic-history:17', historyIds: ['h-b2'] },
        { sourceUnitId: 'semantic-history:18', historyIds: ['h-a1', 'h-a2', 'h-b1', 'h-b2'] },
      ],
    });

    const candidate = materializeSemanticLineage(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(candidate.plan, candidate.source),
      candidate.source
    );
    const paths = enumeratePaths(document).map((path) => path.join('\n'));

    expect(paths).toHaveLength(4);
    for (const marker of ['A1', 'A2', 'B1', 'B2']) {
      const path = paths.find((candidatePath) => candidatePath.includes(`来自 ${marker} 的内心独白`));
      expect(path).toContain('所有路线来到同一场颁奖典礼');
      expect(path).toContain('所有笑话最终都会重逢');
      expect(path).not.toMatch(new RegExp(`来自 (?!${marker})[AB][12] 的内心独白`));
    }
  });

  it('merges sibling routes before a later independent decision', () => {
    const source = segmentStorySource([
      '苏禾：先怎么回应？',
      '选择 A：温和问询。',
      '选择 B：安静陪伴。',
      '分支 A（温和问询）',
      '苏禾主动询问他的烦恼。',
      '分支 B（安静陪伴）',
      '苏禾安静地留在一旁。',
      '【并行分支统一汇入：中段固定剧情】',
      '江屿终于说出了毕业的迷茫。',
      '苏禾：接下来从哪个角度开导？',
      '选择 1：理性分析。',
      '苏禾帮他梳理利弊。',
      '选择 2：共情安抚。',
      '苏禾温柔地理解他的不安。',
      '【所有分支统一汇聚：最终结局】',
      '江屿最终释怀。',
    ].join('\n'), 'semantic-middle-merge');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [
        'semantic-middle-merge:3', 'semantic-middle-merge:5',
        'semantic-middle-merge:7', 'semantic-middle-merge:14',
      ],
      decisions: [
        { id: 'd0', ownerUnitId: 'semantic-middle-merge:0', options: [
          { id: 'oa', sourceUnitId: 'semantic-middle-merge:1', text: '温和问询。' },
          { id: 'ob', sourceUnitId: 'semantic-middle-merge:2', text: '安静陪伴。' },
        ] },
        { id: 'd1', ownerUnitId: 'semantic-middle-merge:9', options: [
          { id: 'o1', sourceUnitId: 'semantic-middle-merge:10', text: '理性分析。' },
          { id: 'o2', sourceUnitId: 'semantic-middle-merge:12', text: '共情安抚。' },
        ] },
      ],
      histories: [
        { id: 'ha1', optionIds: ['oa', 'o1'] },
        { id: 'ha2', optionIds: ['oa', 'o2'] },
        { id: 'hb1', optionIds: ['ob', 'o1'] },
        { id: 'hb2', optionIds: ['ob', 'o2'] },
      ],
      unitClaims: [
        { sourceUnitId: 'semantic-middle-merge:0', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
        { sourceUnitId: 'semantic-middle-merge:4', historyIds: ['ha1', 'ha2'] },
        { sourceUnitId: 'semantic-middle-merge:6', historyIds: ['hb1', 'hb2'] },
        { sourceUnitId: 'semantic-middle-merge:8', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
        { sourceUnitId: 'semantic-middle-merge:9', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
        { sourceUnitId: 'semantic-middle-merge:11', historyIds: ['ha1', 'hb1'] },
        { sourceUnitId: 'semantic-middle-merge:13', historyIds: ['ha2', 'hb2'] },
        { sourceUnitId: 'semantic-middle-merge:15', historyIds: ['ha1', 'ha2', 'hb1', 'hb2'] },
      ],
    });

    const candidate = materializeSemanticLineage(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(candidate.plan, candidate.source),
      candidate.source
    );
    const shared = document.nodes.find((node) => node.content.includes('毕业的迷茫'));
    const incoming = document.nodes.filter((node) => node.next === shared?.label);

    expect(shared).toBeDefined();
    expect(incoming).toHaveLength(2);
    expect(enumeratePaths(document)).toHaveLength(4);
  });

  it('treats a final merge control heading as structural and merges into its first story unit', () => {
    const source = segmentStorySource([
      '林浩：从哪里调查？',
      'A：前往钟楼。',
      'B：查阅档案。',
      '【选择A - 前往钟楼】',
      '林浩在钟楼找到了勋章。',
      '【选择B - 查阅档案】',
      '林浩在档案中找到了哨子的记录。',
      '【最终尾声 - 所有分支汇聚】',
      '无论选择哪条路，林浩最终都站在地下密室中。',
      '字幕：现在，我们听到了。',
    ].join('\n'), 'semantic-final-heading');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: ['semantic-final-heading:3', 'semantic-final-heading:5'],
      decisions: [{
        id: 'd0', ownerUnitId: 'semantic-final-heading:0', options: [
          { id: 'oa', sourceUnitId: 'semantic-final-heading:1', text: '前往钟楼。' },
          { id: 'ob', sourceUnitId: 'semantic-final-heading:2', text: '查阅档案。' },
        ],
      }],
      histories: [
        { id: 'ha', optionIds: ['oa'] },
        { id: 'hb', optionIds: ['ob'] },
      ],
      unitClaims: [
        { sourceUnitId: 'semantic-final-heading:0', historyIds: ['ha', 'hb'] },
        { sourceUnitId: 'semantic-final-heading:4', historyIds: ['ha'] },
        { sourceUnitId: 'semantic-final-heading:6', historyIds: ['hb'] },
        { sourceUnitId: 'semantic-final-heading:7', historyIds: ['ha', 'hb'] },
        { sourceUnitId: 'semantic-final-heading:8', historyIds: ['ha', 'hb'] },
        { sourceUnitId: 'semantic-final-heading:9', historyIds: ['ha', 'hb'] },
      ],
    });

    const candidate = materializeSemanticLineage(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(candidate.plan, candidate.source),
      candidate.source
    );

    expect(document.nodes.map((node) => node.content))
      .not.toContain('【最终尾声 - 所有分支汇聚】');
    expect(document.nodes.filter((node) => (
      node.content.includes('最终都站在地下密室')
    ))).toHaveLength(1);
    expect(enumeratePaths(document)).toHaveLength(2);
  });
});

function enumeratePaths(document: ReturnType<typeof materializeStoryExtraction>): string[][] {
  const nodes = new Map(document.nodes.map((node) => [node.label, node]));
  const walk = (nodeId: string, seen: Set<string>): string[][] => {
    const node = nodes.get(nodeId);
    if (!node || seen.has(nodeId)) return [];
    const nextSeen = new Set(seen).add(nodeId);
    if (node.options.length > 0) {
      return node.options.flatMap((option) => walk(option.target, nextSeen)
        .map((path) => [node.content, ...path]));
    }
    if (node.next) return walk(node.next, nextSeen).map((path) => [node.content, ...path]);
    return [[node.content]];
  };
  return walk(document.entryLabel, new Set());
}
