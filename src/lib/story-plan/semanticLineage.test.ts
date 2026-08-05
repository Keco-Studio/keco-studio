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
      '\u4eba\u7269：',
      '\u6797\u9ed8：\u8d70\u54ea\u6761\u8def？',
      'A：\u5de6\u8def。',
      'B：\u53f3\u8def。',
      '\u6797\u9ed8\u8d70\u4e0a\u5de6\u8def。',
      '\u6797\u9ed8\u8d70\u4e0a\u53f3\u8def。',
    ].join('\n'), 'semantic-role-conflict');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [
        'semantic-role-conflict:0',
        'semantic-role-conflict:2',
      ],
      decisions: [{
        id: 'd0', ownerUnitId: 'semantic-role-conflict:1', options: [
          { id: 'oa', sourceUnitId: 'semantic-role-conflict:2', text: '\u5de6\u8def。' },
          { id: 'ob', sourceUnitId: 'semantic-role-conflict:3', text: '\u53f3\u8def。' },
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

    expect(document.nodes.map((node) => node.content)).toContain('\u4eba\u7269：');
    expect(enumeratePaths(document)).toHaveLength(2);
  });

  it('patches only affected unit history membership without mutating the candidate', () => {
    const candidate = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [
          { id: 'o0', sourceUnitId: 'u1', text: '\u5de6' },
          { id: 'o1', sourceUnitId: 'u2', text: '\u53f3' },
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
      '\u738b\u5927\u53ef：\u600e\u4e48\u5199？',
      '\u9009\u62e9 A：\u5766\u767d。',
      '\u738b\u5927\u53ef\u8bf4\u4e86\u5b9e\u8bdd。',
    ].join('\n'), 'semantic-alias');
    const messages = buildSemanticLineageMessages(source);
    const input = JSON.parse(messages[1].content as string);
    const parsed = parseSemanticLineageForSource({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [{ id: 'o0', sourceUnitId: 'u1', text: '\u5766\u767d。' }],
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
      '\u738b\u5927\u53ef：\u5468\u62a5\u600e\u4e48\u5199？',
      '\u9009\u62e9 A：\u80e1\u7f16\u4e71\u9020。',
      '\u9009\u62e9 B：\u786c\u521a\u5766\u767d。',
      '\u738b\u5927\u53ef：\u5982\u4f55\u5e94\u5bf9 AI \u8b66\u544a？',
      '\u9009\u62e9 A1：\u5bf9\u8d28。',
      'A1 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u9009\u62e9 A2：\u81ea\u9996。',
      'A2 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u738b\u5927\u53ef：\u5982\u4f55\u56de\u5e94\u610f\u5916\u8d70\u7ea2？',
      '\u9009\u62e9 B1：\u6539\u9769。',
      'B1 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u9009\u62e9 B2：\u9053\u6b49。',
      'B2 \u7684\u524d\u7f6e\u7ed3\u5c40。',
      '\u6240\u6709\u8def\u7ebf\u6765\u5230\u540c\u4e00\u573a\u9881\u5956\u5178\u793c。',
      '\u6765\u81ea A1 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea A2 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea B1 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u6765\u81ea B2 \u7684\u5185\u5fc3\u72ec\u767d。',
      '\u5b57\u5e55：\u6240\u6709\u7b11\u8bdd\u6700\u7ec8\u90fd\u4f1a\u91cd\u9022。',
    ].join('\n'), 'semantic-history');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [
        {
          id: 'd-root', ownerUnitId: 'semantic-history:0',
          options: [
            { id: 'o-a', sourceUnitId: 'semantic-history:1', text: '\u80e1\u7f16\u4e71\u9020。' },
            { id: 'o-b', sourceUnitId: 'semantic-history:2', text: '\u786c\u521a\u5766\u767d。' },
          ],
        },
        {
          id: 'd-a', ownerUnitId: 'semantic-history:3',
          options: [
            { id: 'o-a1', sourceUnitId: 'semantic-history:4', text: '\u5bf9\u8d28。' },
            { id: 'o-a2', sourceUnitId: 'semantic-history:6', text: '\u81ea\u9996。' },
          ],
        },
        {
          id: 'd-b', ownerUnitId: 'semantic-history:8',
          options: [
            { id: 'o-b1', sourceUnitId: 'semantic-history:9', text: '\u6539\u9769。' },
            { id: 'o-b2', sourceUnitId: 'semantic-history:11', text: '\u9053\u6b49。' },
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
      const path = paths.find((candidatePath) => candidatePath.includes(`\u6765\u81ea ${marker} \u7684\u5185\u5fc3\u72ec\u767d`));
      expect(path).toContain('\u6240\u6709\u8def\u7ebf\u6765\u5230\u540c\u4e00\u573a\u9881\u5956\u5178\u793c');
      expect(path).toContain('\u6240\u6709\u7b11\u8bdd\u6700\u7ec8\u90fd\u4f1a\u91cd\u9022');
      expect(path).not.toMatch(new RegExp(`\u6765\u81ea (?!${marker})[AB][12] \u7684\u5185\u5fc3\u72ec\u767d`));
    }
  });

  it('merges sibling routes before a later independent decision', () => {
    const source = segmentStorySource([
      '\u82cf\u79be：\u5148\u600e\u4e48\u56de\u5e94？',
      '\u9009\u62e9 A：\u6e29\u548c\u95ee\u8be2。',
      '\u9009\u62e9 B：\u5b89\u9759\u966a\u4f34。',
      '\u5206\u652f A（\u6e29\u548c\u95ee\u8be2）',
      '\u82cf\u79be\u4e3b\u52a8\u8be2\u95ee\u4ed6\u7684\u70e6\u607c。',
      '\u5206\u652f B（\u5b89\u9759\u966a\u4f34）',
      '\u82cf\u79be\u5b89\u9759\u5730\u7559\u5728\u4e00\u65c1。',
      '【\u5e76\u884c\u5206\u652f\u7edf\u4e00\u6c47\u5165：\u4e2d\u6bb5\u56fa\u5b9a\u5267\u60c5】',
      '\u6c5f\u5c7f\u7ec8\u4e8e\u8bf4\u51fa\u4e86\u6bd5\u4e1a\u7684\u8ff7\u832b。',
      '\u82cf\u79be：\u63a5\u4e0b\u6765\u4ece\u54ea\u4e2a\u89d2\u5ea6\u5f00\u5bfc？',
      '\u9009\u62e9 1：\u7406\u6027\u5206\u6790。',
      '\u82cf\u79be\u5e2e\u4ed6\u68b3\u7406\u5229\u5f0a。',
      '\u9009\u62e9 2：\u5171\u60c5\u5b89\u629a。',
      '\u82cf\u79be\u6e29\u67d4\u5730\u7406\u89e3\u4ed6\u7684\u4e0d\u5b89。',
      '【\u6240\u6709\u5206\u652f\u7edf\u4e00\u6c47\u805a：\u6700\u7ec8\u7ed3\u5c40】',
      '\u6c5f\u5c7f\u6700\u7ec8\u91ca\u6000。',
    ].join('\n'), 'semantic-middle-merge');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [
        'semantic-middle-merge:3', 'semantic-middle-merge:5',
        'semantic-middle-merge:7', 'semantic-middle-merge:14',
      ],
      decisions: [
        { id: 'd0', ownerUnitId: 'semantic-middle-merge:0', options: [
          { id: 'oa', sourceUnitId: 'semantic-middle-merge:1', text: '\u6e29\u548c\u95ee\u8be2。' },
          { id: 'ob', sourceUnitId: 'semantic-middle-merge:2', text: '\u5b89\u9759\u966a\u4f34。' },
        ] },
        { id: 'd1', ownerUnitId: 'semantic-middle-merge:9', options: [
          { id: 'o1', sourceUnitId: 'semantic-middle-merge:10', text: '\u7406\u6027\u5206\u6790。' },
          { id: 'o2', sourceUnitId: 'semantic-middle-merge:12', text: '\u5171\u60c5\u5b89\u629a。' },
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
    const shared = document.nodes.find((node) => node.content.includes('\u6bd5\u4e1a\u7684\u8ff7\u832b'));
    const incoming = document.nodes.filter((node) => node.next === shared?.label);

    expect(shared).toBeDefined();
    expect(incoming).toHaveLength(2);
    expect(enumeratePaths(document)).toHaveLength(4);
  });

  it('treats a final merge control heading as structural and merges into its first story unit', () => {
    const source = segmentStorySource([
      '\u6797\u6d69：\u4ece\u54ea\u91cc\u8c03\u67e5？',
      'A：\u524d\u5f80\u949f\u697c。',
      'B：\u67e5\u9605\u6863\u6848。',
      '【\u9009\u62e9A - \u524d\u5f80\u949f\u697c】',
      '\u6797\u6d69\u5728\u949f\u697c\u627e\u5230\u4e86\u52cb\u7ae0。',
      '【\u9009\u62e9B - \u67e5\u9605\u6863\u6848】',
      '\u6797\u6d69\u5728\u6863\u6848\u4e2d\u627e\u5230\u4e86\u54e8\u5b50\u7684\u8bb0\u5f55。',
      '【\u6700\u7ec8\u5c3e\u58f0 - \u6240\u6709\u5206\u652f\u6c47\u805a】',
      '\u65e0\u8bba\u9009\u62e9\u54ea\u6761\u8def，\u6797\u6d69\u6700\u7ec8\u90fd\u7ad9\u5728\u5730\u4e0b\u5bc6\u5ba4\u4e2d。',
      '\u5b57\u5e55：\u73b0\u5728，\u6211\u4eec\u542c\u5230\u4e86。',
    ].join('\n'), 'semantic-final-heading');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: ['semantic-final-heading:3', 'semantic-final-heading:5'],
      decisions: [{
        id: 'd0', ownerUnitId: 'semantic-final-heading:0', options: [
          { id: 'oa', sourceUnitId: 'semantic-final-heading:1', text: '\u524d\u5f80\u949f\u697c。' },
          { id: 'ob', sourceUnitId: 'semantic-final-heading:2', text: '\u67e5\u9605\u6863\u6848。' },
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
      .not.toContain('【\u6700\u7ec8\u5c3e\u58f0 - \u6240\u6709\u5206\u652f\u6c47\u805a】');
    expect(document.nodes.filter((node) => (
      node.content.includes('\u6700\u7ec8\u90fd\u7ad9\u5728\u5730\u4e0b\u5bc6\u5ba4')
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
