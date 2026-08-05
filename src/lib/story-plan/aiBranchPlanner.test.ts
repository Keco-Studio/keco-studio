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
      '林远：留下吗？',
      '选择 A：留下。',
      '林远握住父亲的手。',
      '结局标记：【即时救赎】 —— 父亲露出最后的笑容。',
    ].join('\n'), 'patch-apply');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-apply:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-apply:1', text: '留下。',
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
      '王大可面如土色，疯狂发消息。',
      '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”',
      '李总给王大可加了绩效分。',
    ].join('\n'), 'patch-context');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-context:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-context:0', text: '疯狂发消息',
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
      text: expect.stringContaining('李总我错了'),
      previousVisible: expect.objectContaining({ id: 'u0' }),
      nextVisible: expect.objectContaining({ id: 'u2' }),
    }));
  });

  it('addresses options uniquely when sibling options share one source unit', () => {
    const source = segmentStorySource([
      '林远：留下，还是离开？',
      '选择：留下；离开。',
      '结局标记：【即时救赎】 —— 父亲露出最后的笑容。',
    ].join('\n'), 'patch-option-ref');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-option-ref:0', mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'patch-option-ref:1', text: '留下',
            routeUnitIds: [], nextUnitId: null,
          },
          {
            sourceUnitId: 'patch-option-ref:1', text: '离开',
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
      expect.objectContaining({ patchOptionRef: 'o0.0', text: '留下' }),
      expect.objectContaining({ patchOptionRef: 'o0.1', text: '离开' }),
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
      '林远：留下吗？',
      '选择 A：留下。',
      '林远握住父亲的手。',
    ].join('\n'), 'patch-conflict');
    const candidate = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [], sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'patch-conflict:0', mergeUnitId: null,
        options: [{
          sourceUnitId: 'patch-conflict:1', text: '留下。',
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
      '旅人：选择哪条小径？',
      '分支1-1：青石小径',
      '旅人走入青石小径。',
      '雾中虚影：触碰石坛，或者转身离去。',
      '分支2-1：触碰石坛',
      '旅人找回了记忆。',
      '分支2-2：转身返回',
      '旅人被牵引至灯影小径。',
      '分支1-2：灯影小径',
      '旅人走入灯影小径。',
      '守灯人：借灯寻路，或者灭灯安眠。',
      '分支2-3：借灯前行',
      '旅人直面记忆。',
      '分支2-4：熄灭铜灯',
      '旅人忘记了过往。',
      '【结局A：执心而归】',
      '【结局B：忘川无忆】',
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
              sourceUnitId: 'option-next:1', text: '青石小径',
              routeUnitIds: ['option-next:2', 'option-next:3'], nextUnitId: null,
            },
            {
              sourceUnitId: 'option-next:8', text: '灯影小径',
              routeUnitIds: ['option-next:9', 'option-next:10'], nextUnitId: null,
            },
          ],
        },
        {
          ownerUnitId: 'option-next:3',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'option-next:4', text: '触碰石坛',
              routeUnitIds: ['option-next:5'], nextUnitId: 'option-next:15',
            },
            {
              sourceUnitId: 'option-next:6', text: '转身返回',
              routeUnitIds: ['option-next:7'], nextUnitId: 'option-next:9',
            },
          ],
        },
        {
          ownerUnitId: 'option-next:10',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'option-next:11', text: '借灯前行',
              routeUnitIds: ['option-next:12'], nextUnitId: 'option-next:15',
            },
            {
              sourceUnitId: 'option-next:13', text: '熄灭铜灯',
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
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下花。',
      '选择 B：不买。',
      '阿城没有买花。',
    ].join('\n'), 'direct-leak');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'direct-leak:0',
        mergeUnitId: null,
        options: [
          {
            sourceUnitId: 'direct-leak:1', text: '选择 A：买。',
            routeUnitIds: ['direct-leak:2'], nextUnitId: 'direct-leak:4',
          },
          {
            sourceUnitId: 'direct-leak:3', text: '选择 B：不买。',
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
      '陈默：看不看笔记本？',
      '选择 A：看。',
      '陈默看完了笔记本。',
      '选择 B：不看。',
      '陈默烧掉了笔记本。',
      '两年后，陈默来到墓地。',
      '陈默：林妍，我来看你了。',
      '来自分支 A 的陈默放下纸鹤。',
      '来自分支 B 的陈默放下蓝色笔记本。',
      '风吹过墓碑，纸张微微作响。',
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
            sourceUnitId: 'history-replay:1', text: '看。',
            routeUnitIds: [
              'history-replay:2', 'history-replay:5',
              'history-replay:6', 'history-replay:7',
            ],
            nextUnitId: 'history-replay:9',
          },
          {
            sourceUnitId: 'history-replay:3', text: '不看。',
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
        { title: '笔记本的选择', sourceUnitIds: ['history-replay:0'] },
        { title: '违背遗愿', sourceUnitIds: ['history-replay:2'] },
        { title: '尊重遗愿', sourceUnitIds: ['history-replay:4'] },
        { title: '墓地重逢', sourceUnitIds: ['history-replay:5', 'history-replay:6'] },
        { title: '纸鹤与解释信', sourceUnitIds: ['history-replay:7'] },
        { title: '蓝色笔记本', sourceUnitIds: ['history-replay:8'] },
        { title: '风中终镜', sourceUnitIds: ['history-replay:9'] },
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
      '陈默看完了笔记本。',
      '两年后，陈默来到墓地。',
      '林妍，我来看你了。',
      '来自分支 A 的陈默放下纸鹤。',
      '风吹过墓碑，纸张微微作响。',
    ]);
    expect(routeB).toEqual([
      '陈默烧掉了笔记本。',
      '两年后，陈默来到墓地。',
      '林妍，我来看你了。',
      '来自分支 B 的陈默放下蓝色笔记本。',
      '风吹过墓碑，纸张微微作响。',
    ]);
    const plot = buildStoryPlotPlanFromAiGroups(
      result.plan,
      result.source,
      structure.plotGroups ?? []
    );
    expect(plot.nodes.map((node) => node.title)).toEqual(expect.arrayContaining([
      '墓地重逢', '墓地重逢（路径 1-2）',
    ]));
  });

  it('rejects sibling route overlap unless AI explicitly declares shared replay', () => {
    const source = segmentStorySource([
      '林远：怎么说服他？',
      '选择 A：用事实证明。',
      '林远拿出了调查记录。',
      '选择 B：用感情唤醒。',
      '林远讲起了他们共同的往事。',
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
            sourceUnitId: 'route-overlap:1', text: '用事实证明。',
            routeUnitIds: ['route-overlap:2', 'route-overlap:4'], nextUnitId: null,
          },
          {
            sourceUnitId: 'route-overlap:3', text: '用感情唤醒。',
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
      '陈默：看不看这个笔记本？',
      '选择 A：看。',
      '选择 B：不看。',
      '分支 A（看笔记本）',
      '陈默翻开了笔记本。',
      '分支 B（不看笔记本）',
      '陈默把笔记本扔进壁炉。',
      '火苗吞没了封面。',
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
            sourceUnitId: 'explicit-parts:1', text: '看。',
            routeUnitIds: ['explicit-parts:4', 'explicit-parts:6'], nextUnitId: null,
          },
          {
            sourceUnitId: 'explicit-parts:2', text: '不看。',
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
      '分支 A（看笔记本）',
      '陈默：我该如何面对真相？',
      '选择 A1：用事实证明。',
      '陈默拿出了完整的记录。',
    ].join('\n'), 'nested-parent-part');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['nested-parent-part:0'],
      sharedReplayUnitIds: [],
      decisions: [{
        ownerUnitId: 'nested-parent-part:1',
        mergeUnitId: null,
        options: [{
          sourceUnitId: 'nested-parent-part:2', text: '用事实证明。',
          routeUnitIds: ['nested-parent-part:3'], nextUnitId: null,
        }],
      }],
      breakAfterUnitIds: ['nested-parent-part:3'],
    });

    expect(() => materializeAiBranchStructure(source, structure)).not.toThrow();
  });

  it('moves a child-part unit claimed only by its parent option to the child option', () => {
    const source = segmentStorySource([
      '王大可：周报怎么写？',
      '选择 A：胡编乱造。',
      '选择 B：硬刚坦白。',
      '分支 A（胡编乱造）',
      '王大可：AI误判了我，怎么办？',
      '选择 A1：对质AI系统。',
      '选择 A2：承认是AI写的。',
      '子分支 A1 结局（对质）：',
      '王大可被实际操作记录拆穿。',
      '子分支 A2 结局（自首）：',
      '王大可成了全公司的笑话。',
      '分支 B（硬刚坦白）',
      '王大可的诚实周报意外走红。',
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
              text: '选择 A：胡编乱造。',
              routeUnitIds: [
                'descendant-route-repair:4',
                'descendant-route-repair:8',
              ],
              nextUnitId: null,
            },
            {
              sourceUnitId: 'descendant-route-repair:2',
              text: '选择 B：硬刚坦白。',
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
              text: '选择 A1：对质AI系统。',
              routeUnitIds: [],
              nextUnitId: null,
            },
            {
              sourceUnitId: 'descendant-route-repair:6',
              text: '选择 A2：承认是AI写的。',
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
      '分支 A（继续调查）',
      '陈默：我该如何说服他？',
      '选择 A1：用事实证明。',
      '选择 A2：用感情唤醒。',
      '子分支 A1 结局（用事实证明）：',
      '陈默拿出了完整的记录。',
      '子分支 A2 结局（用感情唤醒）：',
      '陈默讲起了他们共同的往事。',
      '这段话终于唤醒了对方。',
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
            sourceUnitId: 'nested-sibling-parts:2', text: '用事实证明。',
            routeUnitIds: ['nested-sibling-parts:5', 'nested-sibling-parts:7'], nextUnitId: null,
          },
          {
            sourceUnitId: 'nested-sibling-parts:3', text: '用感情唤醒。',
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
      '分支 A（继续调查）',
      '陈默：我该如何说服他？',
      '选择 A1：用事实证明。',
      '选择 A2：用感情唤醒。',
      '陈默先说明了整件事的来龙去脉。',
      '子分支 A1 结局（事实证明）：',
      '陈默拿出了完整记录。',
      '子分支 A2 结局（感情唤醒）：',
      '陈默讲起了他们共同的往事。',
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
            sourceUnitId: 'parent-replay:2', text: '用事实证明。',
            routeUnitIds: ['parent-replay:4', 'parent-replay:6'], nextUnitId: null,
          },
          {
            sourceUnitId: 'parent-replay:3', text: '用感情唤醒。',
            routeUnitIds: ['parent-replay:4', 'parent-replay:8'], nextUnitId: null,
          },
        ],
      }],
      breakAfterUnitIds: ['parent-replay:6', 'parent-replay:8'],
    });

    const result = materializeAiBranchStructure(source, structure);
    expect(result.source.units.filter((unit) => (
      unit.text === '陈默先说明了整件事的来龙去脉。'
    ))).toHaveLength(2);
  });

  it('keeps parent setup once when AI repeats it in descendant option A1', () => {
    const source = segmentStorySource([
      '陈默：是否继续调查？',
      '选择 A：继续。',
      '分支 A（继续调查）',
      '陈默先梳理了所有线索。',
      '陈默：接下来用什么方式？',
      '选择 A1：用事实证明。',
      '陈默拿出了完整记录。',
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
            sourceUnitId: 'ancestor-overlap:1', text: '继续。',
            routeUnitIds: ['ancestor-overlap:3', 'ancestor-overlap:4'], nextUnitId: null,
          }],
        },
        {
          ownerUnitId: 'ancestor-overlap:4',
          mergeUnitId: null,
          options: [{
            sourceUnitId: 'ancestor-overlap:5', text: '用事实证明。',
            routeUnitIds: ['ancestor-overlap:3', 'ancestor-overlap:6'], nextUnitId: null,
          }],
        },
      ],
      breakAfterUnitIds: ['ancestor-overlap:6'],
    });

    const result = materializeAiBranchStructure(source, structure);
    expect(result.source.units.filter((unit) => (
      unit.text === '陈默先梳理了所有线索。'
    ))).toHaveLength(1);
  });

  it('moves post-choice preview dialogue from an ancestor route into the nested option', () => {
    const source = segmentStorySource([
      '林远：走，还是留？',
      '选择 B：离开。',
      '林远拖着行李走到门口。',
      '林远：接不接这枚银元？',
      '嵌套选择 B1（接下银元，离开）：',
      '“爸，我收下了。”',
      '嵌套选择 B2（推回银元，留下）：',
      '“爸，我不走了。我走不了了。”',
      '子分支 B1 结局（接下银元，离开）：',
      '林远带着银元离开。',
      '子分支 B2 结局（推回银元，留下）：',
      '林远留下陪父亲吃早饭。',
    ].join('\n'), 'nested-preview-owner');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: ['nested-preview-owner:8', 'nested-preview-owner:10'],
      sharedReplayUnitIds: [],
      decisions: [
        {
          ownerUnitId: 'nested-preview-owner:0', mergeUnitId: null,
          options: [{
            sourceUnitId: 'nested-preview-owner:1', text: '离开',
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
              sourceUnitId: 'nested-preview-owner:4', text: '接下银元，离开',
              routeUnitIds: ['nested-preview-owner:9'], nextUnitId: null,
            },
            {
              sourceUnitId: 'nested-preview-owner:6', text: '推回银元，留下',
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
      node.content.includes('接不接这枚银元')
    ));
    const optionB2 = nestedOwner?.options.find((option) => option.text.includes('推回银元'));
    const target = optionB2 ? nodesByLabel.get(optionB2.target) : undefined;

    expect(target?.content).toBe('“爸，我不走了。我走不了了。”');
  });

  it('assigns contiguous option preview dialogue before later branch body sections', () => {
    const source = segmentStorySource([
      '王大可：该怎么回应？',
      '嵌套选择 B1（顺势而为）：',
      '王大可立即敲响了总监的门。',
      '嵌套选择 B2（惊慌失措）：',
      '王大可面如土色，疯狂发消息。',
      '“李总我错了！我那是情绪发泄！您别截图了！”',
      '子分支 B1 结局（改革先锋）：',
      '王大可推动了周报改革。',
      '子分支 B2 结局（道歉立功）：',
      '李总给王大可加了绩效分。',
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
            sourceUnitId: 'option-previews:1', text: '顺势而为',
            routeUnitIds: ['option-previews:7'], nextUnitId: null,
          },
          {
            sourceUnitId: 'option-previews:3', text: '惊慌失措',
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
      '王大可立即敲响了总监的门。',
      '王大可推动了周报改革。',
    ]));
    expect(routeB2).toEqual(expect.arrayContaining([
      '王大可面如土色，疯狂发消息。',
      '“李总我错了！我那是情绪发泄！您别截图了！”',
      '李总给王大可加了绩效分。',
    ]));
    expect(routeB1).not.toContain('“李总我错了！我那是情绪发泄！您别截图了！”');
  });

  it('reassigns a misclaimed contiguous option preview to its source-order sibling', () => {
    const source = segmentStorySource([
      '王大可：该怎么回应？',
      '嵌套选择 B1（顺势而为）：',
      '王大可立即敲响了总监的门。',
      '嵌套选择 B2（惊慌失措）：',
      '王大可面如土色，疯狂发消息。',
      '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”',
      '子分支 B1 结局（改革先锋）：',
      '王大可推动了周报改革。',
      '子分支 B2 结局（道歉立功）：',
      '李总给王大可加了绩效分。',
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
            sourceUnitId: 'misclaimed-option-preview:1', text: '顺势而为',
            routeUnitIds: [
              'misclaimed-option-preview:2',
              'misclaimed-option-preview:5',
              'misclaimed-option-preview:7',
            ],
            nextUnitId: null,
          },
          {
            sourceUnitId: 'misclaimed-option-preview:3', text: '惊慌失措',
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
    const optionB1 = decisionNode?.options.find((option) => option.text.includes('顺势而为'));
    const optionB2 = decisionNode?.options.find((option) => option.text.includes('惊慌失措'));
    expect(optionB1).toBeDefined();
    expect(optionB2).toBeDefined();
    const routeB1 = routeContent(optionB1!.target);
    const routeB2 = routeContent(optionB2!.target);
    const apology = '“李总我错了！我那是情绪发泄！您别截图了！我马上重写！”';

    expect(routeB1).not.toContain(apology);
    expect(routeB2).toEqual([
      '王大可面如土色，疯狂发消息。',
      apology,
      '李总给王大可加了绩效分。',
    ]);
  });

  it('stops an option preview at an earlier explicit branch body marker', () => {
    const source = segmentStorySource([
      '阿城：选哪条路？',
      '选择 A：留下。',
      '阿城点了点头。',
      '分支 B 正文：',
      '阿城转身离开。',
      '选择 B：离开。',
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
            sourceUnitId: 'preview-body-boundary:1', text: '留下',
            routeUnitIds: ['preview-body-boundary:2'], nextUnitId: null,
          },
          {
            sourceUnitId: 'preview-body-boundary:5', text: '离开',
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
      '王大可：周报怎么写？',
      '选择 A：胡编乱造。',
      '选择 B：硬刚坦白。',
      '分支 A（胡编乱造）',
      '王大可：AI误判了我，怎么办？',
      '选择 A1：对质AI系统。',
      '选择 A2：承认是AI写的。',
      '子分支 A1 结局（对质）：',
      '王大可被实际操作记录拆穿。',
      '子分支 A2 结局（自首）：',
      '王大可成了全公司的笑话。',
      '分支 B（硬刚坦白）',
      '王大可的诚实周报意外走红。',
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
              sourceUnitId: 'cross-level-leak:1', text: '胡编乱造。',
              routeUnitIds: ['cross-level-leak:4'], nextUnitId: null,
            },
            {
              sourceUnitId: 'cross-level-leak:2', text: '硬刚坦白。',
              routeUnitIds: ['cross-level-leak:12'], nextUnitId: null,
            },
          ],
        },
        {
          ownerUnitId: 'cross-level-leak:4',
          mergeUnitId: null,
          options: [
            {
              sourceUnitId: 'cross-level-leak:5', text: '对质AI系统。',
              routeUnitIds: ['cross-level-leak:8'], nextUnitId: null,
            },
            {
              sourceUnitId: 'cross-level-leak:6', text: '承认是AI写的。',
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
      '林远：怎么说服他？',
      '选择 A：用事实证明。',
      '林远拿出了调查记录。',
      '选择 B：用感情唤醒。',
      '林远讲起了他们共同的往事。',
      '字幕：他们最终在归途上重逢。',
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
            sourceUnitId: 'premature-break:1', text: '用事实证明。',
            routeUnitIds: ['premature-break:2'], nextUnitId: 'premature-break:5',
          },
          {
            sourceUnitId: 'premature-break:3', text: '用感情唤醒。',
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
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
      '一个月后，阿城再次来到地铁口。',
    ].join('\n'), 'plot-groups');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'plot-groups:1',
        mergeUnitId: 'plot-groups:6',
        options: [
          { sourceUnitId: 'plot-groups:2', text: '选择 A：买。', routeUnitIds: ['plot-groups:3'] },
          { sourceUnitId: 'plot-groups:4', text: '选择 B：不买。', routeUnitIds: ['plot-groups:5'] },
        ],
      }],
      plotGroups: [
        { title: '地铁口的选择', sourceUnitIds: ['plot-groups:0', 'plot-groups:1'] },
        { title: '买花路线', sourceUnitIds: ['plot-groups:3'] },
        { title: '放弃路线', sourceUnitIds: ['plot-groups:5'] },
        { title: '一个月后的重逢', sourceUnitIds: ['plot-groups:6'] },
      ],
    });
    const materialized = materializeAiBranchStructure(source, structure);
    const plot = buildStoryPlotPlanFromAiGroups(
      materialized.plan,
      materialized.source,
      structure.plotGroups ?? []
    );

    expect(plot.nodes.map((node) => node.title)).toEqual([
      '地铁口的选择', '买花路线', '放弃路线', '一个月后的重逢',
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
    const source = segmentStorySource('场景：开场。\n阿城：继续。', 'plot-duplicate');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      sharedReplayUnitIds: [],
      decisions: [],
      plotGroups: [
        { title: '第一组', sourceUnitIds: ['plot-duplicate:0'] },
        { title: '重复组', sourceUnitIds: ['plot-duplicate:0', 'plot-duplicate:1'] },
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
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下花。',
      '选择 B：不买。',
      '阿城没有买花。',
      '一个月后，阿城再次来到地铁口。',
    ].join('\n'), 'plot-mixed');
    const structure = parseAiBranchStructure({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'plot-mixed:0',
        mergeUnitId: 'plot-mixed:5',
        options: [
          {
            sourceUnitId: 'plot-mixed:1', text: '选择 A：买。',
            routeUnitIds: ['plot-mixed:2'], nextUnitId: 'plot-mixed:5',
          },
          {
            sourceUnitId: 'plot-mixed:3', text: '选择 B：不买。',
            routeUnitIds: ['plot-mixed:4'], nextUnitId: 'plot-mixed:5',
          },
        ],
      }],
      breakAfterUnitIds: ['plot-mixed:5'],
      plotGroups: [
        { title: '地铁口的选择', sourceUnitIds: ['plot-mixed:0'] },
        { title: '错误混合的分支', sourceUnitIds: ['plot-mixed:2', 'plot-mixed:4'] },
        { title: '一个月后', sourceUnitIds: ['plot-mixed:5'] },
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
      '林远：你要留下吗？',
      '选择 A：留下。',
      '林远留下。',
      '选择 B：离开。',
      '林远离开。',
    ].join('\n'), 'ai-branch');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'ai-branch:1', text: '选择 A：留下。', fromUnitId: 'ai-branch:0', targetUnitId: 'ai-branch:2' },
        { sourceUnitId: 'ai-branch:3', text: '选择 B：离开。', fromUnitId: 'ai-branch:0', targetUnitId: 'ai-branch:4' },
      ],
      jumps: [],
      breakAfterUnitIds: ['ai-branch:2', 'ai-branch:4'],
    });

    const result = materializeAiBranchStructure(source, structure);
    const choiceTexts = result.plan.choices.map((choice) => (
      choice.textSegmentIds.map((id) => result.source.segments.find((segment) => segment.id === id)?.text).join('')
    ));

    expect(choiceTexts).toEqual(['留下。', '离开。']);
    expect(result.plan.choices.map((choice) => choice.targetNodeId)).toEqual(['Node2', 'Node3']);
  });

  it('sends source units and validation issues as planner input', () => {
    const source = segmentStorySource('林远：继续。', 'ai-branch');
    const messages = buildAiBranchStructureMessages(source, [{
      message: 'Unreachable node end',
      unitIds: ['ai-branch:0'],
      nodeIds: ['end'],
    }]);
    const input = JSON.parse(messages[1].content as string);

    expect(input.sourceUnits).toEqual([{ id: 'u0', text: '林远：继续。' }]);
    expect(input.validationIssues).toEqual([expect.objectContaining({
      message: 'Unreachable node end', unitIds: ['u0'], nodeIds: ['end'],
      repairHint: expect.stringContaining('u0'),
    })]);
  });

  it('gives the repair attempt an explicit instruction for an unreachable shared suffix', () => {
    const source = segmentStorySource([
      '分支尾声。',
      '各路线的不同心声。',
      '字幕：所有笑话最终都会重逢。',
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
      '陈默：看不看？',
      '选择 A：看。',
      '选择 B：不看。',
      '分支 A（看笔记本）',
      '陈默翻开笔记本。',
      '分支 B（不看笔记本）',
      '陈默把笔记本投进壁炉。',
      '第二幕：汇聚',
      '两年后，陈默来到墓地。',
      '来自分支 A【被拆穿】的陈默：',
      '陈默放下纸鹤。',
      '来自分支 B【被信任】的陈默：',
      '陈默放下蓝色笔记本。',
      '（最后一个镜头：风吹过墓碑。）',
      '字幕浮现。',
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
      '林溪：怎么安慰他？',
      '选择 A：温柔倾听。',
      '选择 B：安静陪伴。',
      '分支 A（温柔倾听）',
      '林溪耐心听完了故事。',
      '分支 B（安静陪伴）',
      '林溪安静地陪在一旁。',
      '【并行分支统一汇入：中段固定剧情】',
      '（晚风卷起落叶，两人继续共同的对话。）',
    ].join('\n'), 'shared-middle-boundary');
    const input = JSON.parse(buildAiBranchStructureMessages(source)[1].content as string);

    expect(input.branchPartHints).toEqual([
      { partCode: 'A', unitIds: ['u4'] },
      { partCode: 'B', unitIds: ['u6'] },
    ]);
  });

  it('expands compact AI unit aliases back to canonical source ids', () => {
    const source = segmentStorySource([
      '阿城：买花吗？',
      '选择 A：买。',
      '阿城买了花。',
      '一个月后重逢。',
    ].join('\n'), 'canonical-source-with-long-id');

    const structure = parseAiBranchStructureForSource({
      version: 2,
      structuralUnitIds: [],
      decisions: [{
        ownerUnitId: 'u0',
        mergeUnitId: 'u3',
        options: [{
          sourceUnitId: 'u1', text: '选择 A：买。',
          routeUnitIds: ['u2'], nextUnitId: 'u3',
        }],
      }],
      breakAfterUnitIds: ['u3'],
      plotGroups: [
        { title: '选择', sourceUnitIds: ['u0'] },
        { title: '买花', sourceUnitIds: ['u2'] },
        { title: '重逢', sourceUnitIds: ['u3'] },
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
      '女帝：你二人，谁先说？',
      '【分支选择一：答布防——稳守派路线】',
      '你：臣以为，当以抚民为先。',
    ].join('\n'), 'explicit-hint');
    const messages = buildAiBranchStructureMessages(source);
    const input = JSON.parse(messages[1].content as string);

    expect(input.sourceUnits[1]).toEqual({
      id: 'u1',
      text: '【分支选择一：答布防——稳守派路线】',
      explicitChoiceTexts: ['答布防——稳守派路线'],
    });
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('explicitChoiceTexts');
  });

  it('sends the previous structure as a targeted repair request', () => {
    const source = segmentStorySource('阿城：买花吗？\n选择 A：买。\n阿城买花。', 'repair');
    const previous = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [{
        sourceUnitId: 'repair:1', text: '选择 A：买。',
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
        sourceUnitId: 'u1', text: '选择 A：买。',
        fromUnitId: 'u0', targetUnitId: 'u2',
      }],
      breakAfterUnitIds: ['u2'],
    });
    expect(AI_BRANCH_STRUCTURE_PROMPT).toContain('change only the relationships required');
  });

  it('cuts an automatic fallthrough into a sibling target', () => {
    const source = segmentStorySource([
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
    ].join('\n'), 'leak');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'leak:2', text: '选择 A：买。', fromUnitId: 'leak:1', targetUnitId: 'leak:3' },
        { sourceUnitId: 'leak:4', text: '选择 B：不买。', fromUnitId: 'leak:1', targetUnitId: 'leak:5' },
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
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '选择 B：不买。',
      '阿城把手缩了回来。',
      '一个月后，阿城再次来到地铁口。',
    ].join('\n'), 'merge');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'merge:2', text: '选择 A：买。', fromUnitId: 'merge:1', targetUnitId: 'merge:3' },
        { sourceUnitId: 'merge:4', text: '选择 B：不买。', fromUnitId: 'merge:1', targetUnitId: 'merge:5' },
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
      '场景：地铁口。',
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下两把花。',
      '阿城：还是不买吗？',
      '选择 B：不买。',
      '阿城把手缩了回来。',
    ].join('\n'), 'split-owner');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: [],
      choices: [
        { sourceUnitId: 'split-owner:2', text: '选择 A：买。', fromUnitId: 'split-owner:1', targetUnitId: 'split-owner:3' },
        { sourceUnitId: 'split-owner:5', text: '选择 B：不买。', fromUnitId: 'split-owner:4', targetUnitId: 'split-owner:6' },
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
      '阿城：买不买花？',
      '请选择一个选项：',
      '选择 A：买花。',
      '分支 A 正文：',
      '阿城买下两把花。',
    ].join('\n'), 'hidden-control');
    const structure = parseAiBranchStructure({
      version: 1,
      structuralUnitIds: ['hidden-control:1', 'hidden-control:3'],
      choices: [{
        sourceUnitId: 'hidden-control:2', text: '选择 A：买花。',
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
        sourceUnit: 'near:1', label: '买花',
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
        sourceUnitId: 'near:1', text: '买花',
        fromUnitId: 'near:0', targetUnitId: 'near:2',
      }],
      jumps: [{ fromUnitId: 'near:2', targetUnitId: 'near:3' }],
      breakAfterUnitIds: ['near:3'],
    });
  });

  it('materializes grouped sibling routes without leaking through displaced shared prose', () => {
    const source = segmentStorySource([
      '第一幕',
      '阿城：买不买这把花？',
      '选择 A：买。',
      '分支 A（买花）',
      '阿城买下两把花。',
      '【结局：花香引路】阿城获得了工作机会。',
      '选择 B：不买。',
      '分支 B（不买花）',
      '阿城暂时没有买花。',
      '【结局：花香迟到】阿城后来补买了花。',
      '第二幕：汇聚',
      '一个月后，阿城再次来到地铁口。',
      '来自分支 A 的阿城拿出干枯的栀子花。',
      '来自分支 B 的阿城买了十把花。',
      '阿城拿着花汇入人流。',
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
            text: '选择 A：买。',
            routeUnitIds: [
              'grouped-routes:4',
              'grouped-routes:5',
              'grouped-routes:12',
            ],
          },
          {
            sourceUnitId: 'grouped-routes:6',
            text: '选择 B：不买。',
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
      '阿城买下两把花。',
      '【结局：花香引路】阿城获得了工作机会。',
      '来自分支 A 的阿城拿出干枯的栀子花。',
    ]));
    expect(routeContents(choiceTargets[0])).not.toContain('阿城暂时没有买花。');
    expect(routeContents(choiceTargets[0])).not.toContain('来自分支 B 的阿城买了十把花。');
    expect(routeContents(choiceTargets[1])).toEqual(expect.arrayContaining([
      '阿城暂时没有买花。',
      '【结局：花香迟到】阿城后来补买了花。',
      '来自分支 B 的阿城买了十把花。',
    ]));
    expect(routeContents(choiceTargets[1])).not.toContain('阿城买下两把花。');
    expect(routeContents(choiceTargets[1])).not.toContain('来自分支 A 的阿城拿出干枯的栀子花。');
  });

  it('honors AI structural ownership for act headings that only organize branch routes', () => {
    const source = segmentStorySource([
      '第一幕：抉择之夜',
      '林远：明早七点的火车，走，还是留？',
      '选择 A（留下）：',
      '林远：爸，我不走了。',
      '选择 B（离开）：',
      '林远：陈姨，我真的得回去。',
      '第二幕：两种选择，三种走向',
      '分支 A（林远选择留下）',
      '林远留下照顾父亲。',
      '分支 B（林远选择离开）',
      '林远带着银元离开。',
      '第三幕：汇聚与尾声',
      '一年后，所有分支在父亲的葬礼汇聚。',
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
            text: '选择 A（留下）：',
            routeUnitIds: ['act-containers:3', 'act-containers:8'],
          },
          {
            sourceUnitId: 'act-containers:4',
            text: '选择 B（离开）：',
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

    expect(visibleContents).toContain('第一幕：抉择之夜');
    expect(visibleContents).not.toContain('第二幕：两种选择，三种走向');
    expect(visibleContents).not.toContain('第三幕：汇聚与尾声');
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
            text: '选择 A：买。',
            routeUnitIds: ['split:4'],
          }],
        },
        {
          ownerUnitId: 'split:1',
          mergeUnitId: 'split:8',
          options: [{
            sourceUnitId: 'split:3',
            text: '选择 B：不买。',
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
          text: '选择 A：买。',
          routeUnitIds: ['split:4'],
        },
        {
          sourceUnitId: 'split:3',
          text: '选择 B：不买。',
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
          { sourceUnitId: 'direct:1', text: '继续', routeUnitIds: [] },
          { sourceUnitId: 'direct:2', text: '绕行', routeUnitIds: ['direct:3'] },
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
              text: '选择 A',
              routeUnitIds: ['nested:2', 'nested:3', 'nested:5', 'nested:7', 'nested:8'],
            },
            {
              sourceUnitId: 'nested:9',
              text: '选择 B',
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
              text: '选择 A1',
              routeUnitIds: ['nested:5'],
            },
            {
              sourceUnitId: 'nested:6',
              text: '选择 A2',
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
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买花。',
      '选择 B：不买。',
      '阿城暂时不买。',
      '一个月后，阿城再次来到地铁口。',
      '阿城拿着花汇入人流。',
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
            text: '选择 A：买。',
            routeUnitIds: ['shared-overlap:2', 'shared-overlap:5', 'shared-overlap:6'],
          },
          {
            sourceUnitId: 'shared-overlap:3',
            text: '选择 B：不买。',
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
      '第一幕',
      '阿城：买不买花？',
      '选择 A：买。',
      '（掏出十块钱）奶奶，我买两把。',
      '选择 B：不买。',
      '（把手缩回来）下次吧，我今天钱不够。',
      '分支 A（买花）',
      '阿城遇到了小雅，获得工作机会。',
      '【结局：花香引路】—— 花被插在新工位上。',
      '分支 B（不买花）',
      '阿城后来回头补买了花。',
      '【结局：花香迟到】—— 花被带回家放在窗台上。',
      '第二幕：汇聚',
      '一个月后，阿城再次来到地铁口。',
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
            text: '选择 A：买。',
            routeUnitIds: [
              'screenshot-repair:3',
              'screenshot-repair:5',
              'screenshot-repair:7',
            ],
          },
          {
            sourceUnitId: 'screenshot-repair:4',
            text: '选择 B：不买。',
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
      '（掏出十块钱）奶奶，我买两把。',
      '阿城遇到了小雅，获得工作机会。',
      '【结局：花香引路】—— 花被插在新工位上。',
    ]));
    expect(buyContents).not.toContain('（把手缩回来）下次吧，我今天钱不够。');
    expect(skipContents).toEqual(expect.arrayContaining([
      '（把手缩回来）下次吧，我今天钱不够。',
      '阿城后来回头补买了花。',
      '【结局：花香迟到】—— 花被带回家放在窗台上。',
    ]));
    expect(skipContents).not.toContain('（掏出十块钱）奶奶，我买两把。');
  });

  it('coalesces one-option decisions with different owners when they share one merge', () => {
    const source = segmentStorySource([
      '场景一：朝堂',
      '女帝：三策当前，卿择其一。',
      '【分支选择一：答布防】',
      '丞相陈述布防之策。',
      '【分支选择二：回应女帝】',
      '丞相回应女帝。',
      '【分支选择三：回应大将军】',
      '丞相回应大将军。',
      '【最终尾声 - 所有分支汇聚】',
      '史官落笔。',
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
            text: '答布防',
            routeUnitIds: ['singleton-merge:3'],
          }],
        },
        {
          ownerUnitId: 'singleton-merge:3',
          mergeUnitId: 'singleton-merge:8',
          options: [{
            sourceUnitId: 'singleton-merge:4',
            text: '回应女帝',
            routeUnitIds: ['singleton-merge:5'],
          }],
        },
        {
          ownerUnitId: 'singleton-merge:5',
          mergeUnitId: 'singleton-merge:8',
          options: [{
            sourceUnitId: 'singleton-merge:6',
            text: '回应大将军',
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
      '【开场对话】',
      '女帝：你二人，谁先说？',
      '【分支选择一：答布防——稳守派路线】',
      '你：臣以为，当以抚民为先。',
      '【剧情节点一：女帝决断】',
      '女帝：军政并行。',
      '【分支选择二：回应女帝——忠君路线】',
      '你：臣愿为陛下执笔。',
      '【剧情节点三：密诏】',
      '女帝：替朕守住平衡。',
      '【分支选择三：回应大将军——结盟路线】',
      '你：臣与将军不分彼此。',
      '【剧情节点六：战后拂晓】',
      '女帝：大军拔营回京。',
      '【结局：三足鼎立】',
      '此后十年，西境安定。',
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
            text: '臣以为，当以抚民为先。',
            routeUnitIds: ['explicit-sequential:4'],
          },
          {
            sourceUnitId: 'explicit-sequential:5',
            text: '军政并行。',
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
      '答布防——稳守派路线',
      '回应女帝——忠君路线',
      '回应大将军——结盟路线',
    ]);
    expect(new Set(result.plan.choices.map((choice) => choice.fromNodeId)).size).toBe(1);
  });

  it('resolves repeated parent and child route successors without failing import', () => {
    const source = segmentStorySource([
      '主决策：选择路线。',
      '选择 A：进入内层。',
      '父路线开始。',
      '子决策：继续吗？',
      '选择 A1：继续。',
      '父子重复声明的剧情。',
      '子路线继续。',
      '选择 A2：退出。',
      '退出内层。',
      '选择 B：走外层。',
      '外层路线。',
      '共同尾声。',
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
              text: '选择 A：进入内层。',
              routeUnitIds: [
                'successor-conflict:2',
                'successor-conflict:5',
              ],
            },
            {
              sourceUnitId: 'successor-conflict:9',
              text: '选择 B：走外层。',
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
              text: '选择 A1：继续。',
              routeUnitIds: ['successor-conflict:5', 'successor-conflict:6'],
            },
            {
              sourceUnitId: 'successor-conflict:7',
              text: '选择 A2：退出。',
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
      '阿城：买不买花？',
      '选择 A：买。',
      '阿城买下花。',
      '选择 B：不买。',
      '阿城暂时不买。',
      '一个月后，阿城再次来到地铁口。',
      '字幕：花香不会迟到。',
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
            text: '选择 A：买。',
            routeUnitIds: ['missing-merge:2'],
          },
          {
            sourceUnitId: 'missing-merge:3',
            text: '选择 B：不买。',
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
      '主决策：先选方向。',
      '选择 A：进入内层。',
      '进入内层路线。',
      '选择 B：留在外层。',
      '留在外层路线。',
      '子决策：继续还是退出？',
      '选择 C：继续。',
      '继续前进。',
      '选择 D：退出。',
      '退出探索。',
      '最终尾声。',
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
              text: '选择 A：进入内层。',
              routeUnitIds: ['owner-cycle:2'],
            },
            {
              sourceUnitId: 'owner-cycle:3',
              text: '选择 B：留在外层。',
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
              text: '选择 C：继续。',
              routeUnitIds: ['owner-cycle:7'],
            },
            {
              sourceUnitId: 'owner-cycle:8',
              text: '选择 D：退出。',
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
