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
      'Characters：',
      'Lin Mo：Which path to take？',
      'A：Left path。',
      'B：Right path。',
      'Lin Mo takes the left path。',
      'Lin Mo takes the right path。',
    ].join('\n'), 'semantic-role-conflict');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [
        'semantic-role-conflict:0',
        'semantic-role-conflict:2',
      ],
      decisions: [{
        id: 'd0', ownerUnitId: 'semantic-role-conflict:1', options: [
          { id: 'oa', sourceUnitId: 'semantic-role-conflict:2', text: 'Left path。' },
          { id: 'ob', sourceUnitId: 'semantic-role-conflict:3', text: 'Right path。' },
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

    expect(document.nodes.map((node) => node.content)).toContain('Characters：');
    expect(enumeratePaths(document)).toHaveLength(2);
  });

  it('patches only affected unit history membership without mutating the candidate', () => {
    const candidate = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [
          { id: 'o0', sourceUnitId: 'u1', text: 'Left' },
          { id: 'o1', sourceUnitId: 'u2', text: 'Right' },
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
      'Wang Dake：How to write？',
      'Choose A：Confess。',
      'Wang Dake tells the truth。',
    ].join('\n'), 'semantic-alias');
    const messages = buildSemanticLineageMessages(source);
    const input = JSON.parse(messages[1].content as string);
    const parsed = parseSemanticLineageForSource({
      version: 3,
      structuralUnitIds: [],
      decisions: [{
        id: 'd0', ownerUnitId: 'u0',
        options: [{ id: 'o0', sourceUnitId: 'u1', text: 'Confess。' }],
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
      'Wang Dake：How to write the weekly report？',
      'Choose A：Make things up。',
      'Choose B：Hardline confession。',
      'Wang Dake：How to respond AI Warning？',
      'Choose A1：Confront。',
      'A1 prior ending。',
      'Choose A2：Turn in。',
      'A2 prior ending。',
      'Wang Dake：How to respond to unexpected fame？',
      'Choose B1：Reform。',
      'B1 prior ending。',
      'Choose B2：Apologize。',
      'B2 prior ending。',
      'All routes arrive at the same award ceremony。',
      'From A1 inner monologue。',
      'From A2 inner monologue。',
      'From B1 inner monologue。',
      'From B2 inner monologue。',
      'Subtitle：All jokes eventually reunite。',
    ].join('\n'), 'semantic-history');
    const structure = parseSemanticLineage({
      version: 3,
      structuralUnitIds: [],
      decisions: [
        {
          id: 'd-root', ownerUnitId: 'semantic-history:0',
          options: [
            { id: 'o-a', sourceUnitId: 'semantic-history:1', text: 'Make things up。' },
            { id: 'o-b', sourceUnitId: 'semantic-history:2', text: 'Hardline confession。' },
          ],
        },
        {
          id: 'd-a', ownerUnitId: 'semantic-history:3',
          options: [
            { id: 'o-a1', sourceUnitId: 'semantic-history:4', text: 'Confront。' },
            { id: 'o-a2', sourceUnitId: 'semantic-history:6', text: 'Turn in。' },
          ],
        },
        {
          id: 'd-b', ownerUnitId: 'semantic-history:8',
          options: [
            { id: 'o-b1', sourceUnitId: 'semantic-history:9', text: 'Reform。' },
            { id: 'o-b2', sourceUnitId: 'semantic-history:11', text: 'Apologize。' },
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
      const path = paths.find((candidatePath) => candidatePath.includes(`From ${marker} inner monologue`));
      expect(path).toContain('All routes arrive at the same award ceremony');
      expect(path).toContain('All jokes eventually reunite');
      expect(path).not.toMatch(new RegExp(`From (?!${marker})[AB][12] inner monologue`));
    }
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
