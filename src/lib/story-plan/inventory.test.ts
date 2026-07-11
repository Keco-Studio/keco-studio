import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from './sourceSegments';
import {
  buildStoryPlanInventory,
  materializeStoryRelationshipPlan,
} from './inventory';

const source = segmentStorySource([
  'Guide: Choose a path.',
  '分支一：选择【Left】（safe）',
  'Left ending.',
  '分支二：选择【Right】（risk）',
  'Right ending.',
].join('\n'), 'fixture');

describe('story plan inventory', () => {
  it('builds immutable nodes and choices from exact source segments', () => {
    const inventory = buildStoryPlanInventory(source);

    expect(inventory.nodes).toEqual([
      expect.objectContaining({
        id: 'Node1', unitId: 'fixture:0', type: 'dialogue', commandIds: [],
      }),
      expect.objectContaining({ id: 'Node2', unitId: 'fixture:2', type: 'narration' }),
      expect.objectContaining({ id: 'Node3', unitId: 'fixture:4', type: 'narration' }),
    ]);
    expect(inventory.choices).toEqual([
      expect.objectContaining({ id: 'Choice1', unitId: 'fixture:1', commandIds: [] }),
      expect.objectContaining({ id: 'Choice2', unitId: 'fixture:3', commandIds: [] }),
    ]);
  });

  it('materializes the full relationship plan from edge-only model output', () => {
    const inventory = buildStoryPlanInventory(source);
    const plan = materializeStoryRelationshipPlan({
      version: 2,
      entryNodeId: 'Node1',
      breakAfterNodeIds: ['Node2'],
      nextOverrides: [],
      choiceEdges: [
        { choiceId: 'Choice1', fromNodeId: 'Node1', targetNodeId: 'Node2' },
        { choiceId: 'Choice2', fromNodeId: 'Node1', targetNodeId: 'Node3' },
      ],
    }, inventory);

    expect(plan.nodes).toEqual(inventory.nodes.map(({ unitId: _unitId, ...node }) => ({
      ...node,
      nextNodeId: '',
    })));
    expect(plan.choices).toEqual(inventory.choices.map(({ unitId: _unitId, ...choice }, index) => ({
      ...choice,
      fromNodeId: 'Node1',
      targetNodeId: index === 0 ? 'Node2' : 'Node3',
    })));
  });

  it('rejects duplicate or unknown graph deltas and incomplete choice edges', () => {
    const inventory = buildStoryPlanInventory(source);
    const base = {
      version: 2 as const,
      entryNodeId: 'Node1',
      breakAfterNodeIds: ['Node2'],
      nextOverrides: [],
      choiceEdges: inventory.choices.map((choice) => ({
        choiceId: choice.id,
        fromNodeId: 'Node1',
        targetNodeId: 'Node2',
      })),
    };

    expect(() => materializeStoryRelationshipPlan({
      ...base,
      breakAfterNodeIds: ['Node2', 'Node2'],
    }, inventory)).toThrow(/break/i);
    expect(() => materializeStoryRelationshipPlan({
      ...base,
      nextOverrides: [{ nodeId: 'Unknown', targetNodeId: 'Node1' }],
    }, inventory)).toThrow(/override/i);
    expect(() => materializeStoryRelationshipPlan({
      ...base,
      choiceEdges: base.choiceEdges.slice(1),
    }, inventory)).toThrow(/choice edges/i);
  });
});
