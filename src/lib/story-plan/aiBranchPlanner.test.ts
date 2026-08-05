import { describe, expect, it } from '@jest/globals';
import {
  AI_BRANCH_STRUCTURE_PROMPT,
  AI_BRANCH_PATCH_TOOL,
  applyAiBranchPatch,
  buildAiBranchPatchMessages,
  buildAiBranchPatchTool,
  buildAiBranchStructureMessages,
  buildStoryPlotPlanFromAiGroups,
  materializeAiBranchStructure,
  parseAiBranchStructure,
  parseAiBranchStructureForSource,
  parseAiBranchPatch,
} from './aiBranchPlanner';
import { segmentStorySource } from './sourceSegments';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import { materializeStoryExtraction } from '@/lib/story-extraction/materializer';
import { buildStoryAuditProjection } from './projection';

describe('AI branch structure planner', () => {
  it('applies a branch patch without rewriting untouched structure', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u7559\u4e0b\u5417？',
      '\u9009\u62e9 A：\u7559\u4e0b。',
      '\u6797\u8fdc\u63e1\u4f4f\u7236\u4eb2\u7684\u624b。',
      '\u7ed3\u5c40\u6807\u8bb0：【\u5373\u65f6\u6551\u8d4e】 —— \u7236\u4eb2\u9732\u51fa\u6700\u540e\u7684\u7b11\u5bb9。',
    ].join('\n'), 'patch-apply');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-apply:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-apply:1', text: '\u7559\u4e0b。',
          routeUnitIds: ['patch-apply:2'], nextUnitId: null,
        }],
      }],
      breakAfterUnitIds: ['patch-apply:2'],
    });
    const patch = parseAiBranchPatch({ operations: [{
      action: 'add_route_unit',
      optionRef: 'o0.0',
      unitId: 'patch-apply:3',
    }] });

    const repaired = applyAiBranchPatch(candidate, patch, source, [{
      message: 'Unreachable node Node4',
      unitIds: ['patch-apply:3'],
      nodeIds: ['Node4'],
    }]);

    expect(candidate.decisions[0].options[0].routeUnitIds).toEqual(['patch-apply:2']);
    expect(repaired.decisions[0].options[0].routeUnitIds).toEqual([
      'patch-apply:2', 'patch-apply:3',
    ]);
    expect(AI_BRANCH_PATCH_TOOL.function.name).toBe('submit_branch_patch');
    expect(() => applyAiBranchPatch(candidate, parseAiBranchPatch({ operations: [{
      action: 'add_route_unit', optionRef: 'missing', unitId: 'patch-apply:3',
    }] }), source, [{ message: 'Unreachable', unitIds: ['patch-apply:3'], nodeIds: [] }]))
      .toThrow(/option/i);
  });

  it('builds branch patch context with neighbors and current claims', () => {
    const source = segmentStorySource([
      '\u738b\u5927\u53ef\u9762\u5982\u571f\u8272，\u75af\u72c2\u53d1\u6d88\u606f。',
      '“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！\u6211\u9a6c\u4e0a\u91cd\u5199！”',
      '\u674e\u603b\u7ed9\u738b\u5927\u53ef\u52a0\u4e86\u7ee9\u6548\u5206。',
    ].join('\n'), 'patch-context');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-context:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-context:0', text: '\u75af\u72c2\u53d1\u6d88\u606f',
          routeUnitIds: ['patch-context:0', 'patch-context:2'], nextUnitId: null,
        }],
      }],
      breakAfterUnitIds: ['patch-context:2'],
    });
    const messages = buildAiBranchPatchMessages(source, [{
      message: 'Unreachable node Node2',
      unitIds: ['patch-context:1'], nodeIds: ['Node2'],
    }], candidate);
    const input = JSON.parse(messages[1].content as string);

    expect(input.task).toBe('REPAIR_BRANCH_STRUCTURE_WITH_PATCH');
    expect(input.affectedUnits[0]).toEqual(expect.objectContaining({
      id: 'u1',
      text: expect.stringContaining('\u674e\u603b\u6211\u9519\u4e86'),
      previousVisible: expect.objectContaining({ id: 'u0' }),
      nextVisible: expect.objectContaining({ id: 'u2' }),
    }));
  });

  it('addresses options uniquely when sibling options share one source unit', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u7559\u4e0b，\u8fd8\u662f\u79bb\u5f00？',
      '\u9009\u62e9：\u7559\u4e0b；\u79bb\u5f00。',
      '\u7ed3\u5c40\u6807\u8bb0：【\u5373\u65f6\u6551\u8d4e】 —— \u7236\u4eb2\u9732\u51fa\u6700\u540e\u7684\u7b11\u5bb9。',
    ].join('\n'), 'patch-option-ref');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-option-ref:0', mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'patch-option-ref:1', text: '\u7559\u4e0b',
            routeUnitIds: [], nextUnitId: null,
          },
          {
            sourceUnitId: 'patch-option-ref:1', text: '\u79bb\u5f00',
            routeUnitIds: [], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: [],
    });
    const messages = buildAiBranchPatchMessages(source, [{
      message: 'Unreachable node Node3',
      unitIds: ['patch-option-ref:2'], nodeIds: ['Node3'],
    }], candidate);
    const input = JSON.parse(messages[1].content as string);
    const patch = parseAiBranchPatch({ operations: [{
      action: 'set_next', optionRef: 'o0.1', targetUnitId: 'patch-option-ref:2',
    }] });

    expect(input.nearbyDecisions[0].options).toEqual([
      expect.objectContaining({ patchOptionRef: 'o0.0', text: '\u7559\u4e0b' }),
      expect.objectContaining({ patchOptionRef: 'o0.1', text: '\u79bb\u5f00' }),
    ]);
    expect(input.validationIssues[0].repairHint).toMatch(/nextUnitId|mergeUnitId/i);
    expect(applyAiBranchPatch(candidate, patch, source, [{
      message: 'Unreachable node Node3',
      unitIds: ['patch-option-ref:2'], nodeIds: ['Node3'],
    }]).decisions[0].options.map((option) => option.nextUnitId))
      .toEqual([null, 'patch-option-ref:2']);
  });

  it('rejects conflicting branch patch operations for the same relationship', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u7559\u4e0b\u5417？',
      '\u9009\u62e9 A：\u7559\u4e0b。',
      '\u6797\u8fdc\u63e1\u4f4f\u7236\u4eb2\u7684\u624b。',
    ].join('\n'), 'patch-conflict');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-conflict:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-conflict:1', text: '\u7559\u4e0b。',
          routeUnitIds: [], nextUnitId: null,
        }],
      }],
      breakAfterUnitIds: [],
    });
    const patch = parseAiBranchPatch({ operations: [
      {
        action: 'add_route_unit',
        optionRef: 'o0.0',
        unitId: 'patch-conflict:2',
      },
      {
        action: 'remove_route_unit',
        optionRef: 'o0.0',
        unitId: 'patch-conflict:2',
      },
    ] });

    expect(() => applyAiBranchPatch(candidate, patch, source, [{
      message: 'Unreachable node Node3',
      unitIds: ['patch-conflict:2'], nodeIds: ['Node3'],
    }])).toThrow(/conflict/i);
  });

  it('constrains patch option references to the previous candidate', () => {
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'owner', mergeUnitId: null,
        options: [
          { sourceUnitId: 'shared', text: 'A', routeUnitIds: [], nextUnitId: null },
          { sourceUnitId: 'shared', text: 'B', routeUnitIds: [], nextUnitId: null },
        ],
      }],
      breakAfterUnitIds: [],
    });
    const tool = buildAiBranchPatchTool(candidate);
    const parameters = tool.function.parameters as {
      properties: { operations: { items: { anyOf: Array<{
        properties?: { optionRef?: { enum?: string[] } };
      }> } } };
    };
    const optionEnums = parameters.properties.operations.items.anyOf
      .flatMap((operation) => operation.properties?.optionRef?.enum ?? []);

    expect(optionEnums).toEqual([
      'o0.0', 'o0.1',
      'o0.0', 'o0.1',
      'o0.0', 'o0.1',
    ]);
  });

  it('preserves option-specific continuations and independent endings', () => {
    const source = segmentStorySource([
      '\u65c5\u4eba：\u9009\u62e9\u54ea\u6761\u5c0f\u5f84？',
      '\u5206\u652f1-1：\u9752\u77f3\u5c0f\u5f84',
      '\u65c5\u4eba\u8d70\u5165\u9752\u77f3\u5c0f\u5f84。',
      '\u96fe\u4e2d\u865a\u5f71：\u89e6\u78b0\u77f3\u575b，\u6216\u8005\u8f6c\u8eab\u79bb\u53bb。',
      '\u5206\u652f2-1：\u89e6\u78b0\u77f3\u575b',
      '\u65c5\u4eba\u627e\u56de\u4e86\u8bb0\u5fc6。',
      '\u5206\u652f2-2：\u8f6c\u8eab\u8fd4\u56de',
      '\u65c5\u4eba\u88ab\u7275\u5f15\u81f3\u706f\u5f71\u5c0f\u5f84。',
      '\u5206\u652f1-2：\u706f\u5f71\u5c0f\u5f84',
      '\u65c5\u4eba\u8d70\u5165\u706f\u5f71\u5c0f\u5f84。',
      '\u5b88\u706f\u4eba：\u501f\u706f\u5bfb\u8def，\u6216\u8005\u706d\u706f\u5b89\u7720。',
      '\u5206\u652f2-3：\u501f\u706f\u524d\u884c',
      '\u65c5\u4eba\u76f4\u9762\u8bb0\u5fc6。',
      '\u5206\u652f2-4：\u7184\u706d\u94dc\u706f',
      '\u65c5\u4eba\u5fd8\u8bb0\u4e86\u8fc7\u5f80。',
      '【\u7ed3\u5c40A：\u6267\u5fc3\u800c\u5f52】',
      '【\u7ed3\u5c40B：\u5fd8\u5ddd\u65e0\u5fc6】',
    ].join('\n'), 'option-next');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'option-next:0',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'option-next:1', text: '\u9752\u77f3\u5c0f\u5f84',
              routeUnitIds: ['option-next:2', 'option-next:3'], nextUnitId: null,
            },
            {
              sourceUnitId: 'option-next:8', text: '\u706f\u5f71\u5c0f\u5f84',
              routeUnitIds: ['option-next:9', 'option-next:10'], nextUnitId: null,
            },
          ],
        },
        {
          ownerUnitId: 'option-next:3',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'option-next:4', text: '\u89e6\u78b0\u77f3\u575b',
              routeUnitIds: ['option-next:5'], nextUnitId: 'option-next:15',
            },
            {
              sourceUnitId: 'option-next:6', text: '\u8f6c\u8eab\u8fd4\u56de',
              routeUnitIds: ['option-next:7'], nextUnitId: 'option-next:9',
            },
          ],
        },
        {
          ownerUnitId: 'option-next:10',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'option-next:11', text: '\u501f\u706f\u524d\u884c',
              routeUnitIds: ['option-next:12'], nextUnitId: 'option-next:15',
            },
            {
              sourceUnitId: 'option-next:13', text: '\u7184\u706d\u94dc\u706f',
              routeUnitIds: ['option-next:14'], nextUnitId: 'option-next:16',
            },
          ],
        },
      ],
      breakAfterUnitIds: ['option-next:15', 'option-next:16'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const nodeForUnit = (unitId: string) => result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith(`${unitId}:`))
    ));

    expect(nodeForUnit('option-next:5')?.nextNodeId).toBe(nodeForUnit('option-next:15')?.id);
    expect(nodeForUnit('option-next:7')?.nextNodeId).toBe(nodeForUnit('option-next:9')?.id);
    expect(nodeForUnit('option-next:12')?.nextNodeId).toBe(nodeForUnit('option-next:15')?.id);
    expect(nodeForUnit('option-next:14')?.nextNodeId).toBe(nodeForUnit('option-next:16')?.id);
    expect(nodeForUnit('option-next:15')?.nextNodeId).toBe('');
    expect(nodeForUnit('option-next:16')?.nextNodeId).toBe('');
  });

  it('rejects a direct AI continuation that enters a sibling branch', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u6ca1\u6709\u4e70\u82b1。',
    ].join('\n'), 'direct-leak');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'direct-leak:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'direct-leak:1', text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['direct-leak:2'], nextUnitId: 'direct-leak:4',
          },
          {
            sourceUnitId: 'direct-leak:3', text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['direct-leak:4'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['direct-leak:4'],
    });

    const result = materializeAiBranchStructure(source, structure);

    expect(() => materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    )).toThrow(/sibling branch/i);
  });

  it('replays shared setup on each route before history-specific continuations', () => {
    const source = segmentStorySource([
      '\u9648\u9ed8：\u770b\u4e0d\u770b\u7b14\u8bb0\u672c？',
      '\u9009\u62e9 A：\u770b。',
      '\u9648\u9ed8\u770b\u5b8c\u4e86\u7b14\u8bb0\u672c。',
      '\u9009\u62e9 B：\u4e0d\u770b。',
      '\u9648\u9ed8\u70e7\u6389\u4e86\u7b14\u8bb0\u672c。',
      '\u4e24\u5e74\u540e，\u9648\u9ed8\u6765\u5230\u5893\u5730。',
      '\u9648\u9ed8：\u6797\u598d，\u6211\u6765\u770b\u4f60\u4e86。',
      '\u6765\u81ea\u5206\u652f A \u7684\u9648\u9ed8\u653e\u4e0b\u7eb8\u9e64。',
      '\u6765\u81ea\u5206\u652f B \u7684\u9648\u9ed8\u653e\u4e0b\u84dd\u8272\u7b14\u8bb0\u672c。',
      '\u98ce\u5439\u8fc7\u5893\u7891，\u7eb8\u5f20\u5fae\u5fae\u4f5c\u54cd。',
    ].join('\n'), 'history-replay');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: ['history-replay:5', 'history-replay:6'],
      decisions: [{
        ownerUnitId: 'history-replay:0',
        mergeUnitId: 'history-replay:9',
        options: [
          {
            sourceUnitId: 'history-replay:1', text: '\u770b。',
            routeUnitIds: [
              'history-replay:2', 'history-replay:5',
              'history-replay:6', 'history-replay:7',
            ],
            nextUnitId: 'history-replay:9',
          },
          {
            sourceUnitId: 'history-replay:3', text: '\u4e0d\u770b。',
            routeUnitIds: [
              'history-replay:4', 'history-replay:5',
              'history-replay:6', 'history-replay:8',
            ],
            nextUnitId: 'history-replay:9',
          },
        ],
      }],
      breakAfterUnitIds: ['history-replay:9'],
      plotGroups: [
        { title: '\u7b14\u8bb0\u672c\u7684\u9009\u62e9', sourceUnitIds: ['history-replay:0'] },
        { title: '\u8fdd\u80cc\u9057\u613f', sourceUnitIds: ['history-replay:2'] },
        { title: '\u5c0a\u91cd\u9057\u613f', sourceUnitIds: ['history-replay:4'] },
        { title: '\u5893\u5730\u91cd\u9022', sourceUnitIds: ['history-replay:5', 'history-replay:6'] },
        { title: '\u7eb8\u9e64\u4e0e\u89e3\u91ca\u4fe1', sourceUnitIds: ['history-replay:7'] },
        { title: '\u84dd\u8272\u7b14\u8bb0\u672c', sourceUnitIds: ['history-replay:8'] },
        { title: '\u98ce\u4e2d\u7ec8\u955c', sourceUnitIds: ['history-replay:9'] },
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );
    const nodesById = new Map(document.nodes.map((node) => [node.label, node]));
    const routeContent = (target: string): string[] => {
      const content: string[] = [];
      const seen = new Set<string>();
      let current = target;
      while (current && !seen.has(current)) {
        seen.add(current);
        const node = nodesById.get(current);
        if (!node) break;
        content.push(node.content);
        current = node.next ?? '';
      }
      return content;
    };
    const [routeA, routeB] = document.nodes[0].options.map((option) => (
      routeContent(option.target)
    ));

    expect(routeA).toEqual([
      '\u9648\u9ed8\u770b\u5b8c\u4e86\u7b14\u8bb0\u672c。',
      '\u4e24\u5e74\u540e，\u9648\u9ed8\u6765\u5230\u5893\u5730。',
      '\u6797\u598d，\u6211\u6765\u770b\u4f60\u4e86。',
      '\u6765\u81ea\u5206\u652f A \u7684\u9648\u9ed8\u653e\u4e0b\u7eb8\u9e64。',
      '\u98ce\u5439\u8fc7\u5893\u7891，\u7eb8\u5f20\u5fae\u5fae\u4f5c\u54cd。',
    ]);
    expect(routeB).toEqual([
      '\u9648\u9ed8\u70e7\u6389\u4e86\u7b14\u8bb0\u672c。',
      '\u4e24\u5e74\u540e，\u9648\u9ed8\u6765\u5230\u5893\u5730。',
      '\u6797\u598d，\u6211\u6765\u770b\u4f60\u4e86。',
      '\u6765\u81ea\u5206\u652f B \u7684\u9648\u9ed8\u653e\u4e0b\u84dd\u8272\u7b14\u8bb0\u672c。',
      '\u98ce\u5439\u8fc7\u5893\u7891，\u7eb8\u5f20\u5fae\u5fae\u4f5c\u54cd。',
    ]);
    const plot = buildStoryPlotPlanFromAiGroups(
      result.plan,
      result.source,
      structure.plotGroups ?? []
    );
    expect(plot.nodes.map((node) => node.title)).toEqual(expect.arrayContaining([
      '\u5893\u5730\u91cd\u9022', '\u5893\u5730\u91cd\u9022（\u8def\u5f84 1-2）',
    ]));
  });

  it('rejects sibling route overlap unless AI explicitly declares shared replay', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u600e\u4e48\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u6797\u8fdc\u62ff\u51fa\u4e86\u8c03\u67e5\u8bb0\u5f55。',
      '\u9009\u62e9 B：\u7528\u611f\u60c5\u5524\u9192。',
      '\u6797\u8fdc\u8bb2\u8d77\u4e86\u4ed6\u4eec\u5171\u540c\u7684\u5f80\u4e8b。',
    ].join('\n'), 'route-overlap');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'route-overlap:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'route-overlap:1', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
            routeUnitIds: ['route-overlap:2', 'route-overlap:4'], nextUnitId: null,
          },
          {
            sourceUnitId: 'route-overlap:3', text: '\u7528\u611f\u60c5\u5524\u9192。',
            routeUnitIds: ['route-overlap:4'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['route-overlap:2', 'route-overlap:4'],
    });

    expect(() => materializeAiBranchStructure(source, structure))
      .toThrow(/repeated.*shared replay|shared replay.*repeated/i);
  });

  it('rejects content from an explicit B part assigned only to option A', () => {
    const source = segmentStorySource([
      '\u9648\u9ed8：\u770b\u4e0d\u770b\u8fd9\u4e2a\u7b14\u8bb0\u672c？',
      '\u9009\u62e9 A：\u770b。',
      '\u9009\u62e9 B：\u4e0d\u770b。',
      '\u5206\u652f A（\u770b\u7b14\u8bb0\u672c）',
      '\u9648\u9ed8\u7ffb\u5f00\u4e86\u7b14\u8bb0\u672c。',
      '\u5206\u652f B（\u4e0d\u770b\u7b14\u8bb0\u672c）',
      '\u9648\u9ed8\u628a\u7b14\u8bb0\u672c\u6254\u8fdb\u58c1\u7089。',
      '\u706b\u82d7\u541e\u6ca1\u4e86\u5c01\u9762。',
    ].join('\n'), 'explicit-parts');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['explicit-parts:3', 'explicit-parts:5'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'explicit-parts:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'explicit-parts:1', text: '\u770b。',
            routeUnitIds: ['explicit-parts:4', 'explicit-parts:6'], nextUnitId: null,
          },
          {
            sourceUnitId: 'explicit-parts:2', text: '\u4e0d\u770b。',
            routeUnitIds: ['explicit-parts:7'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['explicit-parts:6', 'explicit-parts:7'],
    });

    expect(() => materializeAiBranchStructure(source, structure))
      .toThrow(/part B.*option A|option A.*part B/i);
  });

  it('allows a nested A1 option to use setup owned by its parent A part', () => {
    const source = segmentStorySource([
      '\u5206\u652f A（\u770b\u7b14\u8bb0\u672c）',
      '\u9648\u9ed8：\u6211\u8be5\u5982\u4f55\u9762\u5bf9\u771f\u76f8？',
      '\u9009\u62e9 A1：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u9648\u9ed8\u62ff\u51fa\u4e86\u5b8c\u6574\u7684\u8bb0\u5f55。',
    ].join('\n'), 'nested-parent-part');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['nested-parent-part:0'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'nested-parent-part:1',
        mergeUnitId: null,
        options: [{
          sourceUnitId: 'nested-parent-part:2', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
          routeUnitIds: ['nested-parent-part:3'], nextUnitId: null,
        }],
      }],
      breakAfterUnitIds: ['nested-parent-part:3'],
    });

    expect(() => materializeAiBranchStructure(source, structure)).not.toThrow();
  });

  it('moves a child-part unit claimed only by its parent option to the child option', () => {
    const source = segmentStorySource([
      '\u738b\u5927\u53ef：\u5468\u62a5\u600e\u4e48\u5199？',
      '\u9009\u62e9 A：\u80e1\u7f16\u4e71\u9020。',
      '\u9009\u62e9 B：\u786c\u521a\u5766\u767d。',
      '\u5206\u652f A（\u80e1\u7f16\u4e71\u9020）',
      '\u738b\u5927\u53ef：AI\u8bef\u5224\u4e86\u6211，\u600e\u4e48\u529e？',
      '\u9009\u62e9 A1：\u5bf9\u8d28AI\u7cfb\u7edf。',
      '\u9009\u62e9 A2：\u627f\u8ba4\u662fAI\u5199\u7684。',
      '\u5b50\u5206\u652f A1 \u7ed3\u5c40（\u5bf9\u8d28）：',
      '\u738b\u5927\u53ef\u88ab\u5b9e\u9645\u64cd\u4f5c\u8bb0\u5f55\u62c6\u7a7f。',
      '\u5b50\u5206\u652f A2 \u7ed3\u5c40（\u81ea\u9996）：',
      '\u738b\u5927\u53ef\u6210\u4e86\u5168\u516c\u53f8\u7684\u7b11\u8bdd。',
      '\u5206\u652f B（\u786c\u521a\u5766\u767d）',
      '\u738b\u5927\u53ef\u7684\u8bda\u5b9e\u5468\u62a5\u610f\u5916\u8d70\u7ea2。',
    ].join('\n'), 'descendant-route-repair');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'descendant-route-repair:3',
        'descendant-route-repair:7',
        'descendant-route-repair:9',
        'descendant-route-repair:11',
      ],
      sharedReplayUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'descendant-route-repair:0',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'descendant-route-repair:1',
              text: '\u9009\u62e9 A：\u80e1\u7f16\u4e71\u9020。',
              routeUnitIds: [
                'descendant-route-repair:4',
                'descendant-route-repair:8',
              ],
              nextUnitId: null,
            },
            {
              sourceUnitId: 'descendant-route-repair:2',
              text: '\u9009\u62e9 B：\u786c\u521a\u5766\u767d。',
              routeUnitIds: ['descendant-route-repair:12'],
              nextUnitId: null,
            },
          ],
        },
        {
          ownerUnitId: 'descendant-route-repair:4',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'descendant-route-repair:5',
              text: '\u9009\u62e9 A1：\u5bf9\u8d28AI\u7cfb\u7edf。',
              routeUnitIds: [],
              nextUnitId: null,
            },
            {
              sourceUnitId: 'descendant-route-repair:6',
              text: '\u9009\u62e9 A2：\u627f\u8ba4\u662fAI\u5199\u7684。',
              routeUnitIds: ['descendant-route-repair:10'],
              nextUnitId: null,
            },
          ],
        },
      ],
      breakAfterUnitIds: [
        'descendant-route-repair:8',
        'descendant-route-repair:10',
        'descendant-route-repair:12',
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const unitNode = result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => (
        segmentId.startsWith('descendant-route-repair:8:')
      ))
    ));
    const a1Choice = result.plan.choices.find((choice) => (
      choice.textSegmentIds.some((segmentId) => (
        segmentId.startsWith('descendant-route-repair:5:')
      ))
    ));

    expect(unitNode).toBeDefined();
    expect(a1Choice?.targetNodeId).toBe(unitNode?.id);
    expect(() => materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    )).not.toThrow();
  });

  it('rejects A2 part content assigned only to sibling option A1', () => {
    const source = segmentStorySource([
      '\u5206\u652f A（\u7ee7\u7eed\u8c03\u67e5）',
      '\u9648\u9ed8：\u6211\u8be5\u5982\u4f55\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A1：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u9009\u62e9 A2：\u7528\u611f\u60c5\u5524\u9192。',
      '\u5b50\u5206\u652f A1 \u7ed3\u5c40（\u7528\u4e8b\u5b9e\u8bc1\u660e）：',
      '\u9648\u9ed8\u62ff\u51fa\u4e86\u5b8c\u6574\u7684\u8bb0\u5f55。',
      '\u5b50\u5206\u652f A2 \u7ed3\u5c40（\u7528\u611f\u60c5\u5524\u9192）：',
      '\u9648\u9ed8\u8bb2\u8d77\u4e86\u4ed6\u4eec\u5171\u540c\u7684\u5f80\u4e8b。',
      '\u8fd9\u6bb5\u8bdd\u7ec8\u4e8e\u5524\u9192\u4e86\u5bf9\u65b9。',
    ].join('\n'), 'nested-sibling-parts');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'nested-sibling-parts:0', 'nested-sibling-parts:4', 'nested-sibling-parts:6',
      ],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'nested-sibling-parts:1',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'nested-sibling-parts:2', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
            routeUnitIds: ['nested-sibling-parts:5', 'nested-sibling-parts:7'], nextUnitId: null,
          },
          {
            sourceUnitId: 'nested-sibling-parts:3', text: '\u7528\u611f\u60c5\u5524\u9192。',
            routeUnitIds: ['nested-sibling-parts:8'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['nested-sibling-parts:7', 'nested-sibling-parts:8'],
    });

    expect(() => materializeAiBranchStructure(source, structure))
      .toThrow(/option A1.*part A2|part A2.*option A1/i);
  });

  it('replays explicit parent A setup shared by sibling options A1 and A2', () => {
    const source = segmentStorySource([
      '\u5206\u652f A（\u7ee7\u7eed\u8c03\u67e5）',
      '\u9648\u9ed8：\u6211\u8be5\u5982\u4f55\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A1：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u9009\u62e9 A2：\u7528\u611f\u60c5\u5524\u9192。',
      '\u9648\u9ed8\u5148\u8bf4\u660e\u4e86\u6574\u4ef6\u4e8b\u7684\u6765\u9f99\u53bb\u8109。',
      '\u5b50\u5206\u652f A1 \u7ed3\u5c40（\u4e8b\u5b9e\u8bc1\u660e）：',
      '\u9648\u9ed8\u62ff\u51fa\u4e86\u5b8c\u6574\u8bb0\u5f55。',
      '\u5b50\u5206\u652f A2 \u7ed3\u5c40（\u611f\u60c5\u5524\u9192）：',
      '\u9648\u9ed8\u8bb2\u8d77\u4e86\u4ed6\u4eec\u5171\u540c\u7684\u5f80\u4e8b。',
    ].join('\n'), 'parent-replay');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['parent-replay:0', 'parent-replay:5', 'parent-replay:7'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'parent-replay:1',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'parent-replay:2', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
            routeUnitIds: ['parent-replay:4', 'parent-replay:6'], nextUnitId: null,
          },
          {
            sourceUnitId: 'parent-replay:3', text: '\u7528\u611f\u60c5\u5524\u9192。',
            routeUnitIds: ['parent-replay:4', 'parent-replay:8'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['parent-replay:6', 'parent-replay:8'],
    });

    const result = materializeAiBranchStructure(source, structure);
    expect(result.source.units.filter((unit) => (
      unit.text === '\u9648\u9ed8\u5148\u8bf4\u660e\u4e86\u6574\u4ef6\u4e8b\u7684\u6765\u9f99\u53bb\u8109。'
    ))).toHaveLength(2);
  });

  it('keeps parent setup once when AI repeats it in descendant option A1', () => {
    const source = segmentStorySource([
      '\u9648\u9ed8：\u662f\u5426\u7ee7\u7eed\u8c03\u67e5？',
      '\u9009\u62e9 A：\u7ee7\u7eed。',
      '\u5206\u652f A（\u7ee7\u7eed\u8c03\u67e5）',
      '\u9648\u9ed8\u5148\u68b3\u7406\u4e86\u6240\u6709\u7ebf\u7d22。',
      '\u9648\u9ed8：\u63a5\u4e0b\u6765\u7528\u4ec0\u4e48\u65b9\u5f0f？',
      '\u9009\u62e9 A1：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u9648\u9ed8\u62ff\u51fa\u4e86\u5b8c\u6574\u8bb0\u5f55。',
    ].join('\n'), 'ancestor-overlap');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['ancestor-overlap:2'],
      sharedReplayUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'ancestor-overlap:0',
          mergeUnitId: null,
          options: [{
            sourceUnitId: 'ancestor-overlap:1', text: '\u7ee7\u7eed。',
            routeUnitIds: ['ancestor-overlap:3', 'ancestor-overlap:4'], nextUnitId: null,
          }],
        },
        {
          ownerUnitId: 'ancestor-overlap:4',
          mergeUnitId: null,
          options: [{
            sourceUnitId: 'ancestor-overlap:5', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
            routeUnitIds: ['ancestor-overlap:3', 'ancestor-overlap:6'], nextUnitId: null,
          }],
        },
      ],
      breakAfterUnitIds: ['ancestor-overlap:6'],
    });

    const result = materializeAiBranchStructure(source, structure);
    expect(result.source.units.filter((unit) => (
      unit.text === '\u9648\u9ed8\u5148\u68b3\u7406\u4e86\u6240\u6709\u7ebf\u7d22。'
    ))).toHaveLength(1);
  });

  it('moves post-choice preview dialogue from an ancestor route into the nested option', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u8d70，\u8fd8\u662f\u7559？',
      '\u9009\u62e9 B：\u79bb\u5f00。',
      '\u6797\u8fdc\u62d6\u7740\u884c\u674e\u8d70\u5230\u95e8\u53e3。',
      '\u6797\u8fdc：\u63a5\u4e0d\u63a5\u8fd9\u679a\u94f6\u5143？',
      '\u5d4c\u5957\u9009\u62e9 B1（\u63a5\u4e0b\u94f6\u5143，\u79bb\u5f00）：',
      '“\u7238，\u6211\u6536\u4e0b\u4e86。”',
      '\u5d4c\u5957\u9009\u62e9 B2（\u63a8\u56de\u94f6\u5143，\u7559\u4e0b）：',
      '“\u7238，\u6211\u4e0d\u8d70\u4e86。\u6211\u8d70\u4e0d\u4e86\u4e86。”',
      '\u5b50\u5206\u652f B1 \u7ed3\u5c40（\u63a5\u4e0b\u94f6\u5143，\u79bb\u5f00）：',
      '\u6797\u8fdc\u5e26\u7740\u94f6\u5143\u79bb\u5f00。',
      '\u5b50\u5206\u652f B2 \u7ed3\u5c40（\u63a8\u56de\u94f6\u5143，\u7559\u4e0b）：',
      '\u6797\u8fdc\u7559\u4e0b\u966a\u7236\u4eb2\u5403\u65e9\u996d。',
    ].join('\n'), 'nested-preview-owner');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['nested-preview-owner:8', 'nested-preview-owner:10'],
      sharedReplayUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'nested-preview-owner:0', mergeUnitId: null,
          options: [{
            sourceUnitId: 'nested-preview-owner:1', text: '\u79bb\u5f00',
            routeUnitIds: [
              'nested-preview-owner:2', 'nested-preview-owner:3',
              'nested-preview-owner:5', 'nested-preview-owner:7',
            ],
            nextUnitId: null,
          }],
        },
        {
          ownerUnitId: 'nested-preview-owner:3', mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'nested-preview-owner:4', text: '\u63a5\u4e0b\u94f6\u5143，\u79bb\u5f00',
              routeUnitIds: ['nested-preview-owner:9'], nextUnitId: null,
            },
            {
              sourceUnitId: 'nested-preview-owner:6', text: '\u63a8\u56de\u94f6\u5143，\u7559\u4e0b',
              routeUnitIds: ['nested-preview-owner:11'], nextUnitId: null,
            },
          ],
        },
      ],
      breakAfterUnitIds: ['nested-preview-owner:9', 'nested-preview-owner:11'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );
    const nodesByLabel = new Map(document.nodes.map((node) => [node.label, node]));
    const nestedOwner = document.nodes.find((node) => (
      node.content.includes('\u63a5\u4e0d\u63a5\u8fd9\u679a\u94f6\u5143')
    ));
    const optionB2 = nestedOwner?.options.find((option) => option.text.includes('\u63a8\u56de\u94f6\u5143'));
    const target = optionB2 ? nodesByLabel.get(optionB2.target) : undefined;

    expect(target?.content).toBe('“\u7238，\u6211\u4e0d\u8d70\u4e86。\u6211\u8d70\u4e0d\u4e86\u4e86。”');
  });

  it('assigns contiguous option preview dialogue before later branch body sections', () => {
    const source = segmentStorySource([
      '\u738b\u5927\u53ef：\u8be5\u600e\u4e48\u56de\u5e94？',
      '\u5d4c\u5957\u9009\u62e9 B1（\u987a\u52bf\u800c\u4e3a）：',
      '\u738b\u5927\u53ef\u7acb\u5373\u6572\u54cd\u4e86\u603b\u76d1\u7684\u95e8。',
      '\u5d4c\u5957\u9009\u62e9 B2（\u60ca\u614c\u5931\u63aa）：',
      '\u738b\u5927\u53ef\u9762\u5982\u571f\u8272，\u75af\u72c2\u53d1\u6d88\u606f。',
      '“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！”',
      '\u5b50\u5206\u652f B1 \u7ed3\u5c40（\u6539\u9769\u5148\u950b）：',
      '\u738b\u5927\u53ef\u63a8\u52a8\u4e86\u5468\u62a5\u6539\u9769。',
      '\u5b50\u5206\u652f B2 \u7ed3\u5c40（\u9053\u6b49\u7acb\u529f）：',
      '\u674e\u603b\u7ed9\u738b\u5927\u53ef\u52a0\u4e86\u7ee9\u6548\u5206。',
    ].join('\n'), 'option-previews');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['option-previews:6', 'option-previews:8'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'option-previews:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'option-previews:1', text: '\u987a\u52bf\u800c\u4e3a',
            routeUnitIds: ['option-previews:7'], nextUnitId: null,
          },
          {
            sourceUnitId: 'option-previews:3', text: '\u60ca\u614c\u5931\u63aa',
            routeUnitIds: ['option-previews:9'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['option-previews:7', 'option-previews:9'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const extraction = buildStoryExtractionFromPlan(result.plan, result.source);
    materializeStoryExtraction(extraction, result.source);
    const nodesById = new Map(result.plan.nodes.map((node) => [node.id, node]));
    const contentByNodeId = new Map(result.plan.nodes.map((node) => [
      node.id,
      node.contentSegmentIds.map((segmentId) => (
        result.source.segments.find((segment) => segment.id === segmentId)?.text ?? ''
      )).join(''),
    ]));
    const routeContents = (target: string): string[] => {
      const contents: string[] = [];
      const seen = new Set<string>();
      let current = target;
      while (current && !seen.has(current)) {
        seen.add(current);
        const node = nodesById.get(current);
        if (!node) break;
        contents.push(contentByNodeId.get(node.id) ?? '');
        current = node.nextNodeId;
      }
      return contents;
    };
    const [routeB1, routeB2] = result.plan.choices.map((choice) => (
      routeContents(choice.targetNodeId)
    ));

    expect(routeB1).toEqual(expect.arrayContaining([
      '\u738b\u5927\u53ef\u7acb\u5373\u6572\u54cd\u4e86\u603b\u76d1\u7684\u95e8。',
      '\u738b\u5927\u53ef\u63a8\u52a8\u4e86\u5468\u62a5\u6539\u9769。',
    ]));
    expect(routeB2).toEqual(expect.arrayContaining([
      '\u738b\u5927\u53ef\u9762\u5982\u571f\u8272，\u75af\u72c2\u53d1\u6d88\u606f。',
      '“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！”',
      '\u674e\u603b\u7ed9\u738b\u5927\u53ef\u52a0\u4e86\u7ee9\u6548\u5206。',
    ]));
    expect(routeB1).not.toContain('“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！”');
  });

  it('reassigns a misclaimed contiguous option preview to its source-order sibling', () => {
    const source = segmentStorySource([
      '\u738b\u5927\u53ef：\u8be5\u600e\u4e48\u56de\u5e94？',
      '\u5d4c\u5957\u9009\u62e9 B1（\u987a\u52bf\u800c\u4e3a）：',
      '\u738b\u5927\u53ef\u7acb\u5373\u6572\u54cd\u4e86\u603b\u76d1\u7684\u95e8。',
      '\u5d4c\u5957\u9009\u62e9 B2（\u60ca\u614c\u5931\u63aa）：',
      '\u738b\u5927\u53ef\u9762\u5982\u571f\u8272，\u75af\u72c2\u53d1\u6d88\u606f。',
      '“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！\u6211\u9a6c\u4e0a\u91cd\u5199！”',
      '\u5b50\u5206\u652f B1 \u7ed3\u5c40（\u6539\u9769\u5148\u950b）：',
      '\u738b\u5927\u53ef\u63a8\u52a8\u4e86\u5468\u62a5\u6539\u9769。',
      '\u5b50\u5206\u652f B2 \u7ed3\u5c40（\u9053\u6b49\u7acb\u529f）：',
      '\u674e\u603b\u7ed9\u738b\u5927\u53ef\u52a0\u4e86\u7ee9\u6548\u5206。',
    ].join('\n'), 'misclaimed-option-preview');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'misclaimed-option-preview:6',
        'misclaimed-option-preview:8',
      ],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'misclaimed-option-preview:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'misclaimed-option-preview:1', text: '\u987a\u52bf\u800c\u4e3a',
            routeUnitIds: [
              'misclaimed-option-preview:2',
              'misclaimed-option-preview:5',
              'misclaimed-option-preview:7',
            ],
            nextUnitId: null,
          },
          {
            sourceUnitId: 'misclaimed-option-preview:3', text: '\u60ca\u614c\u5931\u63aa',
            routeUnitIds: ['misclaimed-option-preview:9'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: [
        'misclaimed-option-preview:7',
        'misclaimed-option-preview:9',
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );
    const nodesByLabel = new Map(document.nodes.map((node) => [node.label, node]));
    const routeContent = (target: string): string[] => {
      const content: string[] = [];
      const seen = new Set<string>();
      let current = target;
      while (current && !seen.has(current)) {
        seen.add(current);
        const node = nodesByLabel.get(current);
        if (!node) break;
        content.push(node.content);
        current = node.next ?? '';
      }
      return content;
    };
    const decisionNode = document.nodes.find((node) => node.options.length > 0);
    const optionB1 = decisionNode?.options.find((option) => option.text.includes('\u987a\u52bf\u800c\u4e3a'));
    const optionB2 = decisionNode?.options.find((option) => option.text.includes('\u60ca\u614c\u5931\u63aa'));
    expect(optionB1).toBeDefined();
    expect(optionB2).toBeDefined();
    const routeB1 = routeContent(optionB1!.target);
    const routeB2 = routeContent(optionB2!.target);
    const apology = '“\u674e\u603b\u6211\u9519\u4e86！\u6211\u90a3\u662f\u60c5\u7eea\u53d1\u6cc4！\u60a8\u522b\u622a\u56fe\u4e86！\u6211\u9a6c\u4e0a\u91cd\u5199！”';

    expect(routeB1).not.toContain(apology);
    expect(routeB2).toEqual([
      '\u738b\u5927\u53ef\u9762\u5982\u571f\u8272，\u75af\u72c2\u53d1\u6d88\u606f。',
      apology,
      '\u674e\u603b\u7ed9\u738b\u5927\u53ef\u52a0\u4e86\u7ee9\u6548\u5206。',
    ]);
  });

  it('stops an option preview at an earlier explicit branch body marker', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u9009\u54ea\u6761\u8def？',
      '\u9009\u62e9 A：\u7559\u4e0b。',
      '\u963f\u57ce\u70b9\u4e86\u70b9\u5934。',
      '\u5206\u652f B \u6b63\u6587：',
      '\u963f\u57ce\u8f6c\u8eab\u79bb\u5f00。',
      '\u9009\u62e9 B：\u79bb\u5f00。',
    ].join('\n'), 'preview-body-boundary');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['preview-body-boundary:3'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'preview-body-boundary:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'preview-body-boundary:1', text: '\u7559\u4e0b',
            routeUnitIds: ['preview-body-boundary:2'], nextUnitId: null,
          },
          {
            sourceUnitId: 'preview-body-boundary:5', text: '\u79bb\u5f00',
            routeUnitIds: ['preview-body-boundary:4'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['preview-body-boundary:2', 'preview-body-boundary:4'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const optionA = result.plan.choices.find((choice) => choice.textSegmentIds.some((segmentId) => (
      segmentId.startsWith('preview-body-boundary:1:')
    )));
    const optionB = result.plan.choices.find((choice) => choice.textSegmentIds.some((segmentId) => (
      segmentId.startsWith('preview-body-boundary:5:')
    )));
    const nodeForUnit = (unitId: string) => result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith(`${unitId}:`))
    ));

    expect(optionA?.targetNodeId).toBe(nodeForUnit('preview-body-boundary:2')?.id);
    expect(optionB?.targetNodeId).toBe(nodeForUnit('preview-body-boundary:4')?.id);
  });

  it('cuts a nested A2 continuation that incorrectly enters top-level part B', () => {
    const source = segmentStorySource([
      '\u738b\u5927\u53ef：\u5468\u62a5\u600e\u4e48\u5199？',
      '\u9009\u62e9 A：\u80e1\u7f16\u4e71\u9020。',
      '\u9009\u62e9 B：\u786c\u521a\u5766\u767d。',
      '\u5206\u652f A（\u80e1\u7f16\u4e71\u9020）',
      '\u738b\u5927\u53ef：AI\u8bef\u5224\u4e86\u6211，\u600e\u4e48\u529e？',
      '\u9009\u62e9 A1：\u5bf9\u8d28AI\u7cfb\u7edf。',
      '\u9009\u62e9 A2：\u627f\u8ba4\u662fAI\u5199\u7684。',
      '\u5b50\u5206\u652f A1 \u7ed3\u5c40（\u5bf9\u8d28）：',
      '\u738b\u5927\u53ef\u88ab\u5b9e\u9645\u64cd\u4f5c\u8bb0\u5f55\u62c6\u7a7f。',
      '\u5b50\u5206\u652f A2 \u7ed3\u5c40（\u81ea\u9996）：',
      '\u738b\u5927\u53ef\u6210\u4e86\u5168\u516c\u53f8\u7684\u7b11\u8bdd。',
      '\u5206\u652f B（\u786c\u521a\u5766\u767d）',
      '\u738b\u5927\u53ef\u7684\u8bda\u5b9e\u5468\u62a5\u610f\u5916\u8d70\u7ea2。',
    ].join('\n'), 'cross-level-leak');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'cross-level-leak:3', 'cross-level-leak:7',
        'cross-level-leak:9', 'cross-level-leak:11',
      ],
      sharedReplayUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'cross-level-leak:0',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'cross-level-leak:1', text: '\u80e1\u7f16\u4e71\u9020。',
              routeUnitIds: ['cross-level-leak:4'], nextUnitId: null,
            },
            {
              sourceUnitId: 'cross-level-leak:2', text: '\u786c\u521a\u5766\u767d。',
              routeUnitIds: ['cross-level-leak:12'], nextUnitId: null,
            },
          ],
        },
        {
          ownerUnitId: 'cross-level-leak:4',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'cross-level-leak:5', text: '\u5bf9\u8d28AI\u7cfb\u7edf。',
              routeUnitIds: ['cross-level-leak:8'], nextUnitId: null,
            },
            {
              sourceUnitId: 'cross-level-leak:6', text: '\u627f\u8ba4\u662fAI\u5199\u7684。',
              routeUnitIds: ['cross-level-leak:10'], nextUnitId: 'cross-level-leak:12',
            },
          ],
        },
      ],
      breakAfterUnitIds: [
        'cross-level-leak:8', 'cross-level-leak:10', 'cross-level-leak:12',
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const nodeForUnit = (unitId: string) => result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith(`${unitId}:`))
    ));
    expect(nodeForUnit('cross-level-leak:10')?.nextNodeId).toBe('');
    expect(result.plan.choices.find((choice) => (
      choice.textSegmentIds.some((segmentId) => segmentId.startsWith('cross-level-leak:2:'))
    ))?.targetNodeId).toBe(nodeForUnit('cross-level-leak:12')?.id);
  });

  it('honors an explicit shared continuation over a contradictory terminal marker', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u600e\u4e48\u8bf4\u670d\u4ed6？',
      '\u9009\u62e9 A：\u7528\u4e8b\u5b9e\u8bc1\u660e。',
      '\u6797\u8fdc\u62ff\u51fa\u4e86\u8c03\u67e5\u8bb0\u5f55。',
      '\u9009\u62e9 B：\u7528\u611f\u60c5\u5524\u9192。',
      '\u6797\u8fdc\u8bb2\u8d77\u4e86\u4ed6\u4eec\u5171\u540c\u7684\u5f80\u4e8b。',
      '\u5b57\u5e55：\u4ed6\u4eec\u6700\u7ec8\u5728\u5f52\u9014\u4e0a\u91cd\u9022。',
    ].join('\n'), 'premature-break');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'premature-break:0',
        mergeUnitId: 'premature-break:5',
        options: [
          {
            sourceUnitId: 'premature-break:1', text: '\u7528\u4e8b\u5b9e\u8bc1\u660e。',
            routeUnitIds: ['premature-break:2'], nextUnitId: 'premature-break:5',
          },
          {
            sourceUnitId: 'premature-break:3', text: '\u7528\u611f\u60c5\u5524\u9192。',
            routeUnitIds: ['premature-break:4'], nextUnitId: 'premature-break:5',
          },
        ],
      }],
      breakAfterUnitIds: [
        'premature-break:2', 'premature-break:4', 'premature-break:5',
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const nodeForUnit = (unitId: string) => result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith(`${unitId}:`))
    ));

    expect(nodeForUnit('premature-break:2')?.nextNodeId)
      .toBe(nodeForUnit('premature-break:5')?.id);
    expect(nodeForUnit('premature-break:4')?.nextNodeId)
      .toBe(nodeForUnit('premature-break:5')?.id);
    expect(nodeForUnit('premature-break:5')?.nextNodeId).toBe('');
  });

  it('preserves AI plot titles and maps source-unit groups to Story nodes', () => {
    const source = segmentStorySource([
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n'), 'plot-groups');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'plot-groups:1',
        mergeUnitId: 'plot-groups:6',
        options: [
          { sourceUnitId: 'plot-groups:2', text: '\u9009\u62e9 A：\u4e70。', routeUnitIds: ['plot-groups:3'] },
          { sourceUnitId: 'plot-groups:4', text: '\u9009\u62e9 B：\u4e0d\u4e70。', routeUnitIds: ['plot-groups:5'] },
        ],
      }],
      plotGroups: [
        { title: '\u5730\u94c1\u53e3\u7684\u9009\u62e9', sourceUnitIds: ['plot-groups:0', 'plot-groups:1'] },
        { title: '\u4e70\u82b1\u8def\u7ebf', sourceUnitIds: ['plot-groups:3'] },
        { title: '\u653e\u5f03\u8def\u7ebf', sourceUnitIds: ['plot-groups:5'] },
        { title: '\u4e00\u4e2a\u6708\u540e\u7684\u91cd\u9022', sourceUnitIds: ['plot-groups:6'] },
      ],
    });
    const materialized = materializeAiBranchStructure(source, structure);
    const plot = buildStoryPlotPlanFromAiGroups(
      materialized.plan,
      materialized.source,
      structure.plotGroups ?? []
    );

    expect(plot.nodes.map((node) => node.title)).toEqual([
      '\u5730\u94c1\u53e3\u7684\u9009\u62e9', '\u4e70\u82b1\u8def\u7ebf', '\u653e\u5f03\u8def\u7ebf', '\u4e00\u4e2a\u6708\u540e\u7684\u91cd\u9022',
    ]);
    expect(plot.nodes.flatMap((node) => node.storyNodeIds)).toEqual([
      'Node1', 'Node2', 'Node3', 'Node4', 'Node5',
    ]);
    expect(plot.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Node3', toPlotNodeId: 'Node5', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Node4', toPlotNodeId: 'Node5', optionText: null, optionIndex: null },
    ]));
  });

  it('rejects duplicate visible Story-node ownership across AI plot groups', () => {
    const source = segmentStorySource('\u573a\u666f：\u5f00\u573a。\n\u963f\u57ce：\u7ee7\u7eed。', 'plot-duplicate');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [],
      plotGroups: [
        { title: '\u7b2c\u4e00\u7ec4', sourceUnitIds: ['plot-duplicate:0'] },
        { title: '\u91cd\u590d\u7ec4', sourceUnitIds: ['plot-duplicate:0', 'plot-duplicate:1'] },
      ],
    });
    const materialized = materializeAiBranchStructure(source, structure);

    expect(() => buildStoryPlotPlanFromAiGroups(
      materialized.plan,
      materialized.source,
      structure.plotGroups ?? []
    )).toThrow(/duplicate|more than once|exactly once/i);
  });

  it('rejects an AI plot group that mixes mutually exclusive sibling routes', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u6ca1\u6709\u4e70\u82b1。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n'), 'plot-mixed');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'plot-mixed:0',
        mergeUnitId: 'plot-mixed:5',
        options: [
          {
            sourceUnitId: 'plot-mixed:1', text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['plot-mixed:2'], nextUnitId: 'plot-mixed:5',
          },
          {
            sourceUnitId: 'plot-mixed:3', text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['plot-mixed:4'], nextUnitId: 'plot-mixed:5',
          },
        ],
      }],
      breakAfterUnitIds: ['plot-mixed:5'],
      plotGroups: [
        { title: '\u5730\u94c1\u53e3\u7684\u9009\u62e9', sourceUnitIds: ['plot-mixed:0'] },
        { title: '\u9519\u8bef\u6df7\u5408\u7684\u5206\u652f', sourceUnitIds: ['plot-mixed:2', 'plot-mixed:4'] },
        { title: '\u4e00\u4e2a\u6708\u540e', sourceUnitIds: ['plot-mixed:5'] },
      ],
    });
    const materialized = materializeAiBranchStructure(source, structure);

    expect(() => buildStoryPlotPlanFromAiGroups(
      materialized.plan,
      materialized.source,
      structure.plotGroups ?? []
    )).toThrow(/plot group.*mutually exclusive|sibling route/i);
  });

  it('materializes labeled choices without exposing the control prefix', () => {
    const source = segmentStorySource([
      '\u6797\u8fdc：\u4f60\u8981\u7559\u4e0b\u5417？',
      '\u9009\u62e9 A：\u7559\u4e0b。',
      '\u6797\u8fdc\u7559\u4e0b。',
      '\u9009\u62e9 B：\u79bb\u5f00。',
      '\u6797\u8fdc\u79bb\u5f00。',
    ].join('\n'), 'ai-branch');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'ai-branch:1', text: '\u9009\u62e9 A：\u7559\u4e0b。', fromUnitId: 'ai-branch:0', targetUnitId: 'ai-branch:2' },
        { sourceUnitId: 'ai-branch:3', text: '\u9009\u62e9 B：\u79bb\u5f00。', fromUnitId: 'ai-branch:0', targetUnitId: 'ai-branch:4' },
      ],
      jumps: [],
      breakAfterUnitIds: ['ai-branch:2', 'ai-branch:4'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const choiceTexts = result.plan.choices.map((choice) => (
      choice.textSegmentIds.map((id) => result.source.segments.find((segment) => segment.id === id)?.text).join('')
    ));

    expect(choiceTexts).toEqual(['\u7559\u4e0b。', '\u79bb\u5f00。']);
    expect(result.plan.choices.map((choice) => choice.targetNodeId)).toEqual(['Node2', 'Node3']);
  });

  it('sends source units and validation issues as planner input', () => {
    const source = segmentStorySource('\u6797\u8fdc：\u7ee7\u7eed。', 'ai-branch');
    const messages = buildAiBranchStructureMessages(source, [{
      message: 'Unreachable node end',
      unitIds: ['ai-branch:0'],
      nodeIds: ['end'],
    }]);
    const input = JSON.parse(messages[1].content as string);

    expect(input.sourceUnits).toEqual([{ id: 'u0', text: '\u6797\u8fdc：\u7ee7\u7eed。' }]);
    expect(input.validationIssues).toEqual([expect.objectContaining({
      message: 'Unreachable node end', unitIds: ['u0'], nodeIds: ['end'],
      repairHint: expect.stringContaining('u0'),
    })]);
  });

  it('gives the repair attempt an explicit instruction for an unreachable shared suffix', () => {
    const source = segmentStorySource([
      '\u5206\u652f\u5c3e\u58f0。',
      '\u5404\u8def\u7ebf\u7684\u4e0d\u540c\u5fc3\u58f0。',
      '\u5b57\u5e55：\u6240\u6709\u7b11\u8bdd\u6700\u7ec8\u90fd\u4f1a\u91cd\u9022。',
    ].join('\n'), 'repair-shared-suffix');
    const messages = buildAiBranchStructureMessages(source, [{
      message: 'Unreachable node Node105',
      unitIds: ['repair-shared-suffix:2'],
      nodeIds: ['Node105'],
    }]);
    const input = JSON.parse(messages[1].content as string);

    expect(input.validationIssues[0].repairHint).toMatch(/u2/);
    expect(input.validationIssues[0].repairHint).toMatch(/remove.*breakAfterUnitIds/i);
    expect(input.validationIssues[0].repairHint).toMatch(/nextUnitId|mergeUnitId/i);
  });

  it('sends explicit A and B part ownership and a targeted mismatch repair hint', () => {
    const source = segmentStorySource([
      '\u9648\u9ed8：\u770b\u4e0d\u770b？',
      '\u9009\u62e9 A：\u770b。',
      '\u9009\u62e9 B：\u4e0d\u770b。',
      '\u5206\u652f A（\u770b\u7b14\u8bb0\u672c）',
      '\u9648\u9ed8\u7ffb\u5f00\u7b14\u8bb0\u672c。',
      '\u5206\u652f B（\u4e0d\u770b\u7b14\u8bb0\u672c）',
      '\u9648\u9ed8\u628a\u7b14\u8bb0\u672c\u6295\u8fdb\u58c1\u7089。',
      '\u7b2c\u4e8c\u5e55：\u6c47\u805a',
      '\u4e24\u5e74\u540e，\u9648\u9ed8\u6765\u5230\u5893\u5730。',
      '\u6765\u81ea\u5206\u652f A【\u88ab\u62c6\u7a7f】\u7684\u9648\u9ed8：',
      '\u9648\u9ed8\u653e\u4e0b\u7eb8\u9e64。',
      '\u6765\u81ea\u5206\u652f B【\u88ab\u4fe1\u4efb】\u7684\u9648\u9ed8：',
      '\u9648\u9ed8\u653e\u4e0b\u84dd\u8272\u7b14\u8bb0\u672c。',
      '（\u6700\u540e\u4e00\u4e2a\u955c\u5934：\u98ce\u5439\u8fc7\u5893\u7891。）',
      '\u5b57\u5e55\u6d6e\u73b0。',
    ].join('\n'), 'part-hints');
    const messages = buildAiBranchStructureMessages(source, [{
      message: 'AI option A contains source u12 owned by explicit branch part B',
      unitIds: [],
      nodeIds: [],
    }]);
    const input = JSON.parse(messages[1].content as string);

    expect(input.branchPartHints).toEqual([
      { partCode: 'A', unitIds: ['u4', 'u10'] },
      { partCode: 'B', unitIds: ['u6', 'u12'] },
    ]);
    expect(input.validationIssues[0].repairHint).toMatch(/remove u12 from option A/i);
    expect(input.validationIssues[0].repairHint).toMatch(/option B/i);
  });

  it('ends explicit branch ownership at a shared middle-story boundary', () => {
    const source = segmentStorySource([
      '\u6797\u6eaa：\u600e\u4e48\u5b89\u6170\u4ed6？',
      '\u9009\u62e9 A：\u6e29\u67d4\u503e\u542c。',
      '\u9009\u62e9 B：\u5b89\u9759\u966a\u4f34。',
      '\u5206\u652f A（\u6e29\u67d4\u503e\u542c）',
      '\u6797\u6eaa\u8010\u5fc3\u542c\u5b8c\u4e86\u6545\u4e8b。',
      '\u5206\u652f B（\u5b89\u9759\u966a\u4f34）',
      '\u6797\u6eaa\u5b89\u9759\u5730\u966a\u5728\u4e00\u65c1。',
      '【\u5e76\u884c\u5206\u652f\u7edf\u4e00\u6c47\u5165：\u4e2d\u6bb5\u56fa\u5b9a\u5267\u60c5】',
      '（\u665a\u98ce\u5377\u8d77\u843d\u53f6，\u4e24\u4eba\u7ee7\u7eed\u5171\u540c\u7684\u5bf9\u8bdd。）',
    ].join('\n'), 'shared-middle-boundary');
    const input = JSON.parse(buildAiBranchStructureMessages(source)[1].content as string);

    expect(input.branchPartHints).toEqual([
      { partCode: 'A', unitIds: ['u4'] },
      { partCode: 'B', unitIds: ['u6'] },
    ]);
  });

  it('expands compact AI unit aliases back to canonical source ids', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u82b1\u5417？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e86\u82b1。',
      '\u4e00\u4e2a\u6708\u540e\u91cd\u9022。',
    ].join('\n'), 'canonical-source-with-long-id');

    const structure = parseAiBranchStructureForSource({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'u0',
        mergeUnitId: 'u3',
        options: [{
          sourceUnitId: 'u1', text: '\u9009\u62e9 A：\u4e70。',
          routeUnitIds: ['u2'], nextUnitId: 'u3',
        }],
      }],
      breakAfterUnitIds: ['u3'],
      plotGroups: [
        { title: '\u9009\u62e9', sourceUnitIds: ['u0'] },
        { title: '\u4e70\u82b1', sourceUnitIds: ['u2'] },
        { title: '\u91cd\u9022', sourceUnitIds: ['u3'] },
      ],
    }, source);

    expect(structure.decisions[0]).toEqual(expect.objectContaining({
      ownerUnitId: 'canonical-source-with-long-id:0',
      mergeUnitId: 'canonical-source-with-long-id:3',
      options: [expect.objectContaining({
        sourceUnitId: 'canonical-source-with-long-id:1',
        routeUnitIds: ['canonical-source-with-long-id:2'],
        nextUnitId: 'canonical-source-with-long-id:3',
      })],
    }));
    expect(structure.breakAfterUnitIds).toEqual(['canonical-source-with-long-id:3']);
    expect(structure.plotGroups?.[1].sourceUnitIds).toEqual([
      'canonical-source-with-long-id:2',
    ]);
  });

  it('marks server-recognized explicit choices in the planner input', () => {
    const source = segmentStorySource([
      '\u5973\u5e1d：\u4f60\u4e8c\u4eba，\u8c01\u5148\u8bf4？',
      '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf】',
      '\u4f60：\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。',
    ].join('\n'), 'explicit-hint');
    const messages = buildAiBranchStructureMessages(source);
    const input = JSON.parse(messages[1].content as string);

    expect(input.sourceUnits[1]).toEqual({
      id: 'u1',
      text: '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf】',
      explicitChoiceTexts: ['\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf'],
    });
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('explicitChoiceTexts');
  });

  it('sends the previous structure as a targeted repair request', () => {
    const source = segmentStorySource('\u963f\u57ce：\u4e70\u82b1\u5417？\n\u9009\u62e9 A：\u4e70。\n\u963f\u57ce\u4e70\u82b1。', 'repair');
    const previous = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [{
        sourceUnitId: 'repair:1', text: '\u9009\u62e9 A：\u4e70。',
        fromUnitId: 'repair:0', targetUnitId: 'repair:2',
      }],
      jumps: [],
      breakAfterUnitIds: ['repair:2'],
    });
    const messages = buildAiBranchStructureMessages(
      source,
      [{ message: 'Decision has only one option', nodeIds: ['Node1'] }],
      previous
    );
    const input = JSON.parse(messages[1].content as string);

    expect(input.task).toBe('REPAIR_BRANCH_STRUCTURE');
    expect(input.previousStructureCandidate).toEqual({
      ...previous,
      choices: [{
        sourceUnitId: 'u1', text: '\u9009\u62e9 A：\u4e70。',
        fromUnitId: 'u0', targetUnitId: 'u2',
      }],
      breakAfterUnitIds: ['u2'],
    });
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('change only the relationships required');
  });

  it('cuts an automatic fallthrough into a sibling target', () => {
    const source = segmentStorySource([
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
    ].join('\n'), 'leak');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'leak:2', text: '\u9009\u62e9 A：\u4e70。', fromUnitId: 'leak:1', targetUnitId: 'leak:3' },
        { sourceUnitId: 'leak:4', text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: 'leak:1', targetUnitId: 'leak:5' },
      ],
      jumps: [],
      breakAfterUnitIds: ['leak:5'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const [left, right] = result.plan.choices.map((choice) => choice.targetNodeId);

    expect(result.plan.nodes.find((node) => node.id === left)?.nextNodeId).not.toBe(right);
  });

  it('accepts sibling branches that separately enter a shared merge', () => {
    const source = segmentStorySource([
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n'), 'merge');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'merge:2', text: '\u9009\u62e9 A：\u4e70。', fromUnitId: 'merge:1', targetUnitId: 'merge:3' },
        { sourceUnitId: 'merge:4', text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: 'merge:1', targetUnitId: 'merge:5' },
      ],
      jumps: [{ fromUnitId: 'merge:3', targetUnitId: 'merge:6' }],
      breakAfterUnitIds: ['merge:6'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const mergeNode = result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((id) => id.startsWith('merge:6:'))
    ));

    expect(mergeNode).toBeDefined();
    expect(result.plan.nodes.filter((node) => node.nextNodeId === mergeNode?.id)).toHaveLength(2);
  });

  it('allows one-option owners when sibling ownership is not proven', () => {
    const source = segmentStorySource([
      '\u573a\u666f：\u5730\u94c1\u53e3。',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '\u963f\u57ce：\u8fd8\u662f\u4e0d\u4e70\u5417？',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u628a\u624b\u7f29\u4e86\u56de\u6765。',
    ].join('\n'), 'split-owner');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'split-owner:2', text: '\u9009\u62e9 A：\u4e70。', fromUnitId: 'split-owner:1', targetUnitId: 'split-owner:3' },
        { sourceUnitId: 'split-owner:5', text: '\u9009\u62e9 B：\u4e0d\u4e70。', fromUnitId: 'split-owner:4', targetUnitId: 'split-owner:6' },
      ],
      jumps: [],
      breakAfterUnitIds: ['split-owner:3', 'split-owner:6'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );
    expect(() => buildStoryAuditProjection(document)).not.toThrow();
  });

  it('maps hidden owner prompts backward and hidden branch labels forward', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u8bf7\u9009\u62e9\u4e00\u4e2a\u9009\u9879：',
      '\u9009\u62e9 A：\u4e70\u82b1。',
      '\u5206\u652f A \u6b63\u6587：',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
    ].join('\n'), 'hidden-control');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: ['hidden-control:1', 'hidden-control:3'],
      choices: [{
        sourceUnitId: 'hidden-control:2', text: '\u9009\u62e9 A：\u4e70\u82b1。',
        fromUnitId: 'hidden-control:1', targetUnitId: 'hidden-control:3',
      }],
      jumps: [],
      breakAfterUnitIds: ['hidden-control:4'],
    });

    const result = materializeAiBranchStructure(source, structure);

    expect(result.plan.choices).toEqual([
      expect.objectContaining({ fromNodeId: 'Node1', targetNodeId: 'Node2' }),
    ]);
  });

  it('states the sibling-path invariant and option-preview rule in the prompt', () => {
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('Never split sibling options across decisions');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('never emit only the last option');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('Branch-body labels');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('routeUnitIds');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('Do not make u1 or u3 visible nodes');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('branch-container act/scene headings');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('is not terminal when a later act explicitly continues');
  });

  it('treats omitted empty planner arrays as empty structure', () => {
    expect(parseAiBranchStructure({ version: 1 })).toEqual({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [],
      choices: [],
      jumps: [],
      breakAfterUnitIds: [],
    });
  });

  it('normalizes common near-contract field names and ignores explanation fields', () => {
    expect(parseAiBranchStructure({
      version: '1',
      structural_unit_ids: ['near:0'],
      choices: [{
        sourceUnit: 'near:1', label: '\u4e70\u82b1',
        ownerUnitId: 'near:0', targetUnit: 'near:2', explanation: 'reason',
      }],
      jumps: [{ from: 'near:2', to: 'near:3' }],
      terminalUnitIds: ['near:3'],
      explanation: 'extra',
    })).toEqual({
      version: 2,
      structuralUnitIds: ['near:0'],
      sharedReplayUnitIds: [],
      decisions: [],
      choices: [{
        sourceUnitId: 'near:1', text: '\u4e70\u82b1',
        fromUnitId: 'near:0', targetUnitId: 'near:2',
      }],
      jumps: [{ fromUnitId: 'near:2', targetUnitId: 'near:3' }],
      breakAfterUnitIds: ['near:3'],
    });
  });

  it('materializes grouped sibling routes without leaking through displaced shared prose', () => {
    const source = segmentStorySource([
      '\u7b2c\u4e00\u5e55',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u8fd9\u628a\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u5206\u652f A（\u4e70\u82b1）',
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】\u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u5206\u652f B（\u4e0d\u4e70\u82b1）',
      '\u963f\u57ce\u6682\u65f6\u6ca1\u6709\u4e70\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u8fdf\u5230】\u963f\u57ce\u540e\u6765\u8865\u4e70\u4e86\u82b1。',
      '\u7b2c\u4e8c\u5e55：\u6c47\u805a',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
      '\u6765\u81ea\u5206\u652f A \u7684\u963f\u57ce\u62ff\u51fa\u5e72\u67af\u7684\u6800\u5b50\u82b1。',
      '\u6765\u81ea\u5206\u652f B \u7684\u963f\u57ce\u4e70\u4e86\u5341\u628a\u82b1。',
      '\u963f\u57ce\u62ff\u7740\u82b1\u6c47\u5165\u4eba\u6d41。',
    ].join('\n'), 'grouped-routes');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['grouped-routes:3', 'grouped-routes:7'],
      decisions: [{
        ownerUnitId: 'grouped-routes:1',
        mergeUnitId: 'grouped-routes:10',
        options: [
          {
            sourceUnitId: 'grouped-routes:2',
            text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: [
              'grouped-routes:4',
              'grouped-routes:5',
              'grouped-routes:12',
            ],
          },
          {
            sourceUnitId: 'grouped-routes:6',
            text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: [
              'grouped-routes:8',
              'grouped-routes:9',
              'grouped-routes:13',
            ],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const choiceTargets = result.plan.choices.map((choice) => choice.targetNodeId);
    const nodesById = new Map(result.plan.nodes.map((node) => [node.id, node]));
    const contentsByNodeId = new Map(result.plan.nodes.map((node) => [
      node.id,
      node.contentSegmentIds.map((segmentId) => (
        result.source.segments.find((segment) => segment.id === segmentId)?.text ?? ''
      )).join(''),
    ]));
    const routeContents = (target: string) => {
      const contents: string[] = [];
      let current = target;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        contents.push(contentsByNodeId.get(current) ?? '');
        current = nodesById.get(current)?.nextNodeId ?? '';
      }
      return contents;
    };

    expect(routeContents(choiceTargets[0])).toEqual(expect.arrayContaining([
      '\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】\u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。',
      '\u6765\u81ea\u5206\u652f A \u7684\u963f\u57ce\u62ff\u51fa\u5e72\u67af\u7684\u6800\u5b50\u82b1。',
    ]));
    expect(routeContents(choiceTargets[0])).not.toContain('\u963f\u57ce\u6682\u65f6\u6ca1\u6709\u4e70\u82b1。');
    expect(routeContents(choiceTargets[0])).not.toContain('\u6765\u81ea\u5206\u652f B \u7684\u963f\u57ce\u4e70\u4e86\u5341\u628a\u82b1。');
    expect(routeContents(choiceTargets[1])).toEqual(expect.arrayContaining([
      '\u963f\u57ce\u6682\u65f6\u6ca1\u6709\u4e70\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u8fdf\u5230】\u963f\u57ce\u540e\u6765\u8865\u4e70\u4e86\u82b1。',
      '\u6765\u81ea\u5206\u652f B \u7684\u963f\u57ce\u4e70\u4e86\u5341\u628a\u82b1。',
    ]));
    expect(routeContents(choiceTargets[1])).not.toContain('\u963f\u57ce\u4e70\u4e0b\u4e24\u628a\u82b1。');
    expect(routeContents(choiceTargets[1])).not.toContain('\u6765\u81ea\u5206\u652f A \u7684\u963f\u57ce\u62ff\u51fa\u5e72\u67af\u7684\u6800\u5b50\u82b1。');
  });

  it('honors AI structural ownership for act headings that only organize branch routes', () => {
    const source = segmentStorySource([
      '\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c',
      '\u6797\u8fdc：\u660e\u65e9\u4e03\u70b9\u7684\u706b\u8f66，\u8d70，\u8fd8\u662f\u7559？',
      '\u9009\u62e9 A（\u7559\u4e0b）：',
      '\u6797\u8fdc：\u7238，\u6211\u4e0d\u8d70\u4e86。',
      '\u9009\u62e9 B（\u79bb\u5f00）：',
      '\u6797\u8fdc：\u9648\u59e8，\u6211\u771f\u7684\u5f97\u56de\u53bb。',
      '\u7b2c\u4e8c\u5e55：\u4e24\u79cd\u9009\u62e9，\u4e09\u79cd\u8d70\u5411',
      '\u5206\u652f A（\u6797\u8fdc\u9009\u62e9\u7559\u4e0b）',
      '\u6797\u8fdc\u7559\u4e0b\u7167\u987e\u7236\u4eb2。',
      '\u5206\u652f B（\u6797\u8fdc\u9009\u62e9\u79bb\u5f00）',
      '\u6797\u8fdc\u5e26\u7740\u94f6\u5143\u79bb\u5f00。',
      '\u7b2c\u4e09\u5e55：\u6c47\u805a\u4e0e\u5c3e\u58f0',
      '\u4e00\u5e74\u540e，\u6240\u6709\u5206\u652f\u5728\u7236\u4eb2\u7684\u846c\u793c\u6c47\u805a。',
    ].join('\n'), 'act-containers');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'act-containers:6',
        'act-containers:7',
        'act-containers:9',
        'act-containers:11',
      ],
      decisions: [{
        ownerUnitId: 'act-containers:1',
        mergeUnitId: 'act-containers:12',
        options: [
          {
            sourceUnitId: 'act-containers:2',
            text: '\u9009\u62e9 A（\u7559\u4e0b）：',
            routeUnitIds: ['act-containers:3', 'act-containers:8'],
          },
          {
            sourceUnitId: 'act-containers:4',
            text: '\u9009\u62e9 B（\u79bb\u5f00）：',
            routeUnitIds: ['act-containers:5', 'act-containers:10'],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const visibleContents = result.plan.nodes.map((node) => (
      node.contentSegmentIds.map((segmentId) => (
        result.source.segments.find((segment) => segment.id === segmentId)?.text ?? ''
      )).join('')
    ));

    expect(visibleContents).toContain('\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c');
    expect(visibleContents).not.toContain('\u7b2c\u4e8c\u5e55：\u4e24\u79cd\u9009\u62e9，\u4e09\u79cd\u8d70\u5411');
    expect(visibleContents).not.toContain('\u7b2c\u4e09\u5e55：\u6c47\u805a\u4e0e\u5c3e\u58f0');
    expect(result.plan.choices).toHaveLength(2);
    expect(new Set(result.plan.choices.map((choice) => choice.fromNodeId)).size).toBe(1);
  });

  it('asks the model for grouped route ownership and keeps ending summaries visible', () => {
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('routeUnitIds');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('same decision object');
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('Ending markers and ending summaries are visible story content');
  });

  it('coalesces split one-option decisions that share the same owner and merge', () => {
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'split:1',
          mergeUnitId: 'split:8',
          options: [{
            sourceUnitId: 'split:2',
            text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['split:4'],
          }],
        },
        {
          ownerUnitId: 'split:1',
          mergeUnitId: 'split:8',
          options: [{
            sourceUnitId: 'split:3',
            text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['split:6'],
          }],
        },
      ],
    });

    expect(structure.decisions).toEqual([{
      ownerUnitId: 'split:1',
      mergeUnitId: 'split:8',
      options: [
        {
          sourceUnitId: 'split:2',
          text: '\u9009\u62e9 A：\u4e70。',
          routeUnitIds: ['split:4'],
        },
        {
          sourceUnitId: 'split:3',
          text: '\u9009\u62e9 B：\u4e0d\u4e70。',
          routeUnitIds: ['split:6'],
        },
      ],
    }]);
  });

  it('accepts an empty exclusive route when the option goes directly to a merge', () => {
    expect(() => parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'direct:0',
        mergeUnitId: 'direct:4',
        options: [
          { sourceUnitId: 'direct:1', text: '\u7ee7\u7eed', routeUnitIds: [] },
          { sourceUnitId: 'direct:2', text: '\u7ed5\u884c', routeUnitIds: ['direct:3'] },
        ],
      }],
    })).not.toThrow();
  });

  it('gives nested decisions ownership of child route units repeated by a parent route', () => {
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'nested:0',
          mergeUnitId: 'nested:10',
          options: [
            {
              sourceUnitId: 'nested:1',
              text: '\u9009\u62e9 A',
              routeUnitIds: ['nested:2', 'nested:3', 'nested:5', 'nested:7', 'nested:8'],
            },
            {
              sourceUnitId: 'nested:9',
              text: '\u9009\u62e9 B',
              routeUnitIds: ['nested:9-body'],
            },
          ],
        },
        {
          ownerUnitId: 'nested:3',
          mergeUnitId: 'nested:8',
          options: [
            {
              sourceUnitId: 'nested:4',
              text: '\u9009\u62e9 A1',
              routeUnitIds: ['nested:5'],
            },
            {
              sourceUnitId: 'nested:6',
              text: '\u9009\u62e9 A2',
              routeUnitIds: ['nested:7'],
            },
          ],
        },
      ],
    });

    expect(structure.decisions[0].options[0].routeUnitIds).toEqual([
      'nested:2',
      'nested:3',
      'nested:8',
    ]);
  });

  it('promotes units repeated across sibling routes into a shared merge', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u6682\u65f6\u4e0d\u4e70。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
      '\u963f\u57ce\u62ff\u7740\u82b1\u6c47\u5165\u4eba\u6d41。',
    ].join('\n'), 'shared-overlap');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'shared-overlap:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'shared-overlap:1',
            text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['shared-overlap:2', 'shared-overlap:5', 'shared-overlap:6'],
          },
          {
            sourceUnitId: 'shared-overlap:3',
            text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['shared-overlap:4', 'shared-overlap:5', 'shared-overlap:6'],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const sharedNode = result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith('shared-overlap:5:'))
    ));

    expect(sharedNode).toBeDefined();
    expect(result.plan.nodes.filter((node) => node.nextNodeId === sharedNode?.id)).toHaveLength(2);
  });

  it('repairs misplaced option previews and preserves explicit endings in their routes', () => {
    const source = segmentStorySource([
      '\u7b2c\u4e00\u5e55',
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '（\u638f\u51fa\u5341\u5757\u94b1）\u5976\u5976，\u6211\u4e70\u4e24\u628a。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '（\u628a\u624b\u7f29\u56de\u6765）\u4e0b\u6b21\u5427，\u6211\u4eca\u5929\u94b1\u4e0d\u591f。',
      '\u5206\u652f A（\u4e70\u82b1）',
      '\u963f\u57ce\u9047\u5230\u4e86\u5c0f\u96c5，\u83b7\u5f97\u5de5\u4f5c\u673a\u4f1a。',
      '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】—— \u82b1\u88ab\u63d2\u5728\u65b0\u5de5\u4f4d\u4e0a。',
      '\u5206\u652f B（\u4e0d\u4e70\u82b1）',
      '\u963f\u57ce\u540e\u6765\u56de\u5934\u8865\u4e70\u4e86\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u8fdf\u5230】—— \u82b1\u88ab\u5e26\u56de\u5bb6\u653e\u5728\u7a97\u53f0\u4e0a。',
      '\u7b2c\u4e8c\u5e55：\u6c47\u805a',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
    ].join('\n'), 'screenshot-repair');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [
        'screenshot-repair:6',
        'screenshot-repair:8',
        'screenshot-repair:9',
        'screenshot-repair:11',
      ],
      decisions: [{
        ownerUnitId: 'screenshot-repair:1',
        mergeUnitId: 'screenshot-repair:12',
        options: [
          {
            sourceUnitId: 'screenshot-repair:2',
            text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: [
              'screenshot-repair:3',
              'screenshot-repair:5',
              'screenshot-repair:7',
            ],
          },
          {
            sourceUnitId: 'screenshot-repair:4',
            text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['screenshot-repair:10'],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const contentsByNodeId = new Map(result.plan.nodes.map((node) => [
      node.id,
      node.contentSegmentIds.map((segmentId) => (
        result.source.segments.find((segment) => segment.id === segmentId)?.text ?? ''
      )).join(''),
    ]));
    const nodesById = new Map(result.plan.nodes.map((node) => [node.id, node]));
    const routeContents = (target: string) => {
      const contents: string[] = [];
      let current = target;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        contents.push(contentsByNodeId.get(current) ?? '');
        current = nodesById.get(current)?.nextNodeId ?? '';
      }
      return contents;
    };
    const [buyTarget, skipTarget] = result.plan.choices.map((choice) => choice.targetNodeId);
    const buyContents = routeContents(buyTarget);
    const skipContents = routeContents(skipTarget);

    expect(buyContents).toEqual(expect.arrayContaining([
      '（\u638f\u51fa\u5341\u5757\u94b1）\u5976\u5976，\u6211\u4e70\u4e24\u628a。',
      '\u963f\u57ce\u9047\u5230\u4e86\u5c0f\u96c5，\u83b7\u5f97\u5de5\u4f5c\u673a\u4f1a。',
      '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】—— \u82b1\u88ab\u63d2\u5728\u65b0\u5de5\u4f4d\u4e0a。',
    ]));
    expect(buyContents).not.toContain('（\u628a\u624b\u7f29\u56de\u6765）\u4e0b\u6b21\u5427，\u6211\u4eca\u5929\u94b1\u4e0d\u591f。');
    expect(skipContents).toEqual(expect.arrayContaining([
      '（\u628a\u624b\u7f29\u56de\u6765）\u4e0b\u6b21\u5427，\u6211\u4eca\u5929\u94b1\u4e0d\u591f。',
      '\u963f\u57ce\u540e\u6765\u56de\u5934\u8865\u4e70\u4e86\u82b1。',
      '【\u7ed3\u5c40：\u82b1\u9999\u8fdf\u5230】—— \u82b1\u88ab\u5e26\u56de\u5bb6\u653e\u5728\u7a97\u53f0\u4e0a。',
    ]));
    expect(skipContents).not.toContain('（\u638f\u51fa\u5341\u5757\u94b1）\u5976\u5976，\u6211\u4e70\u4e24\u628a。');
  });

  it('coalesces one-option decisions with different owners when they share one merge', () => {
    const source = segmentStorySource([
      '\u573a\u666f\u4e00：\u671d\u5802',
      '\u5973\u5e1d：\u4e09\u7b56\u5f53\u524d，\u537f\u62e9\u5176\u4e00。',
      '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632】',
      '\u4e1e\u76f8\u9648\u8ff0\u5e03\u9632\u4e4b\u7b56。',
      '【\u5206\u652f\u9009\u62e9\u4e8c：\u56de\u5e94\u5973\u5e1d】',
      '\u4e1e\u76f8\u56de\u5e94\u5973\u5e1d。',
      '【\u5206\u652f\u9009\u62e9\u4e09：\u56de\u5e94\u5927\u5c06\u519b】',
      '\u4e1e\u76f8\u56de\u5e94\u5927\u5c06\u519b。',
      '【\u6700\u7ec8\u5c3e\u58f0 - \u6240\u6709\u5206\u652f\u6c47\u805a】',
      '\u53f2\u5b98\u843d\u7b14。',
    ].join('\n'), 'singleton-merge');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'singleton-merge:1',
          mergeUnitId: 'singleton-merge:8',
          options: [{
            sourceUnitId: 'singleton-merge:2',
            text: '\u7b54\u5e03\u9632',
            routeUnitIds: ['singleton-merge:3'],
          }],
        },
        {
          ownerUnitId: 'singleton-merge:3',
          mergeUnitId: 'singleton-merge:8',
          options: [{
            sourceUnitId: 'singleton-merge:4',
            text: '\u56de\u5e94\u5973\u5e1d',
            routeUnitIds: ['singleton-merge:5'],
          }],
        },
        {
          ownerUnitId: 'singleton-merge:5',
          mergeUnitId: 'singleton-merge:8',
          options: [{
            sourceUnitId: 'singleton-merge:6',
            text: '\u56de\u5e94\u5927\u5c06\u519b',
            routeUnitIds: ['singleton-merge:7'],
          }],
        },
      ],
    });

    const result = materializeAiBranchStructure(source, structure);

    expect(new Set(result.plan.choices.map((choice) => choice.fromNodeId)).size).toBe(1);
    expect(result.plan.choices).toHaveLength(3);
  });

  it('uses explicit source choices and discards hallucinated dialogue choices', () => {
    const source = segmentStorySource([
      '【\u5f00\u573a\u5bf9\u8bdd】',
      '\u5973\u5e1d：\u4f60\u4e8c\u4eba，\u8c01\u5148\u8bf4？',
      '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf】',
      '\u4f60：\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。',
      '【\u5267\u60c5\u8282\u70b9\u4e00：\u5973\u5e1d\u51b3\u65ad】',
      '\u5973\u5e1d：\u519b\u653f\u5e76\u884c。',
      '【\u5206\u652f\u9009\u62e9\u4e8c：\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf】',
      '\u4f60：\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14。',
      '【\u5267\u60c5\u8282\u70b9\u4e09：\u5bc6\u8bcf】',
      '\u5973\u5e1d：\u66ff\u6715\u5b88\u4f4f\u5e73\u8861。',
      '【\u5206\u652f\u9009\u62e9\u4e09：\u56de\u5e94\u5927\u5c06\u519b——\u7ed3\u76df\u8def\u7ebf】',
      '\u4f60：\u81e3\u4e0e\u5c06\u519b\u4e0d\u5206\u5f7c\u6b64。',
      '【\u5267\u60c5\u8282\u70b9\u516d：\u6218\u540e\u62c2\u6653】',
      '\u5973\u5e1d：\u5927\u519b\u62d4\u8425\u56de\u4eac。',
      '【\u7ed3\u5c40：\u4e09\u8db3\u9f0e\u7acb】',
      '\u6b64\u540e\u5341\u5e74，\u897f\u5883\u5b89\u5b9a。',
    ].join('\n'), 'explicit-sequential');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'explicit-sequential:1',
        mergeUnitId: 'explicit-sequential:14',
        options: [
          {
            sourceUnitId: 'explicit-sequential:3',
            text: '\u81e3\u4ee5\u4e3a，\u5f53\u4ee5\u629a\u6c11\u4e3a\u5148。',
            routeUnitIds: ['explicit-sequential:4'],
          },
          {
            sourceUnitId: 'explicit-sequential:5',
            text: '\u519b\u653f\u5e76\u884c。',
            routeUnitIds: ['explicit-sequential:8'],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const choiceTexts = result.plan.choices.map((choice) => (
      choice.textSegmentIds.map((segmentId) => (
        result.source.segments.find((segment) => segment.id === segmentId)?.text ?? ''
      )).join('')
    ));

    expect(choiceTexts).toEqual([
      '\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf',
      '\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf',
      '\u56de\u5e94\u5927\u5c06\u519b——\u7ed3\u76df\u8def\u7ebf',
    ]);
    expect(new Set(result.plan.choices.map((choice) => choice.fromNodeId)).size).toBe(1);
  });

  it('resolves repeated parent and child route successors without failing import', () => {
    const source = segmentStorySource([
      '\u4e3b\u51b3\u7b56：\u9009\u62e9\u8def\u7ebf。',
      '\u9009\u62e9 A：\u8fdb\u5165\u5185\u5c42。',
      '\u7236\u8def\u7ebf\u5f00\u59cb。',
      '\u5b50\u51b3\u7b56：\u7ee7\u7eed\u5417？',
      '\u9009\u62e9 A1：\u7ee7\u7eed。',
      '\u7236\u5b50\u91cd\u590d\u58f0\u660e\u7684\u5267\u60c5。',
      '\u5b50\u8def\u7ebf\u7ee7\u7eed。',
      '\u9009\u62e9 A2：\u9000\u51fa。',
      '\u9000\u51fa\u5185\u5c42。',
      '\u9009\u62e9 B：\u8d70\u5916\u5c42。',
      '\u5916\u5c42\u8def\u7ebf。',
      '\u5171\u540c\u5c3e\u58f0。',
    ].join('\n'), 'successor-conflict');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'successor-conflict:0',
          mergeUnitId: 'successor-conflict:11',
          options: [
            {
              sourceUnitId: 'successor-conflict:1',
              text: '\u9009\u62e9 A：\u8fdb\u5165\u5185\u5c42。',
              routeUnitIds: [
                'successor-conflict:2',
                'successor-conflict:5',
              ],
            },
            {
              sourceUnitId: 'successor-conflict:9',
              text: '\u9009\u62e9 B：\u8d70\u5916\u5c42。',
              routeUnitIds: ['successor-conflict:10'],
            },
          ],
        },
        {
          ownerUnitId: 'successor-conflict:3',
          mergeUnitId: 'successor-conflict:11',
          options: [
            {
              sourceUnitId: 'successor-conflict:4',
              text: '\u9009\u62e9 A1：\u7ee7\u7eed。',
              routeUnitIds: ['successor-conflict:5', 'successor-conflict:6'],
            },
            {
              sourceUnitId: 'successor-conflict:7',
              text: '\u9009\u62e9 A2：\u9000\u51fa。',
              routeUnitIds: ['successor-conflict:8'],
            },
          ],
        },
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );
    expect(() => buildStoryAuditProjection(document)).not.toThrow();
  });

  it('infers a missing merge for visible epilogue content after all sibling routes', () => {
    const source = segmentStorySource([
      '\u963f\u57ce：\u4e70\u4e0d\u4e70\u82b1？',
      '\u9009\u62e9 A：\u4e70。',
      '\u963f\u57ce\u4e70\u4e0b\u82b1。',
      '\u9009\u62e9 B：\u4e0d\u4e70。',
      '\u963f\u57ce\u6682\u65f6\u4e0d\u4e70。',
      '\u4e00\u4e2a\u6708\u540e，\u963f\u57ce\u518d\u6b21\u6765\u5230\u5730\u94c1\u53e3。',
      '\u5b57\u5e55：\u82b1\u9999\u4e0d\u4f1a\u8fdf\u5230。',
    ].join('\n'), 'missing-merge');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'missing-merge:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'missing-merge:1',
            text: '\u9009\u62e9 A：\u4e70。',
            routeUnitIds: ['missing-merge:2'],
          },
          {
            sourceUnitId: 'missing-merge:3',
            text: '\u9009\u62e9 B：\u4e0d\u4e70。',
            routeUnitIds: ['missing-merge:4'],
          },
        ],
      }],
    });

    const result = materializeAiBranchStructure(source, structure);
    const epilogue = result.plan.nodes.find((node) => (
      node.contentSegmentIds.some((segmentId) => segmentId.startsWith('missing-merge:5:'))
    ));

    expect(epilogue).toBeDefined();
    expect(result.plan.nodes.filter((node) => node.nextNodeId === epilogue?.id)).toHaveLength(2);
    expect(() => materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    )).not.toThrow();
  });

  it('breaks a choice route that merges back into its own decision owner', () => {
    const source = segmentStorySource([
      '\u4e3b\u51b3\u7b56：\u5148\u9009\u65b9\u5411。',
      '\u9009\u62e9 A：\u8fdb\u5165\u5185\u5c42。',
      '\u8fdb\u5165\u5185\u5c42\u8def\u7ebf。',
      '\u9009\u62e9 B：\u7559\u5728\u5916\u5c42。',
      '\u7559\u5728\u5916\u5c42\u8def\u7ebf。',
      '\u5b50\u51b3\u7b56：\u7ee7\u7eed\u8fd8\u662f\u9000\u51fa？',
      '\u9009\u62e9 C：\u7ee7\u7eed。',
      '\u7ee7\u7eed\u524d\u8fdb。',
      '\u9009\u62e9 D：\u9000\u51fa。',
      '\u9000\u51fa\u63a2\u7d22。',
      '\u6700\u7ec8\u5c3e\u58f0。',
    ].join('\n'), 'owner-cycle');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'owner-cycle:0',
          mergeUnitId: 'owner-cycle:5',
          options: [
            {
              sourceUnitId: 'owner-cycle:1',
              text: '\u9009\u62e9 A：\u8fdb\u5165\u5185\u5c42。',
              routeUnitIds: ['owner-cycle:2'],
            },
            {
              sourceUnitId: 'owner-cycle:3',
              text: '\u9009\u62e9 B：\u7559\u5728\u5916\u5c42。',
              routeUnitIds: ['owner-cycle:4'],
            },
          ],
        },
        {
          ownerUnitId: 'owner-cycle:5',
          mergeUnitId: 'owner-cycle:5',
          options: [
            {
              sourceUnitId: 'owner-cycle:6',
              text: '\u9009\u62e9 C：\u7ee7\u7eed。',
              routeUnitIds: ['owner-cycle:7'],
            },
            {
              sourceUnitId: 'owner-cycle:8',
              text: '\u9009\u62e9 D：\u9000\u51fa。',
              routeUnitIds: ['owner-cycle:9'],
            },
          ],
        },
      ],
    });

    const result = materializeAiBranchStructure(source, structure);
    const document = materializeStoryExtraction(
      buildStoryExtractionFromPlan(result.plan, result.source),
      result.source
    );

    expect(() => buildStoryAuditProjection(document)).not.toThrow();
  });
});
