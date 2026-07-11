import {
  parseStoryRelationshipPlan,
  type PlannedChoice,
  type PlannedNode,
  type StoryGraphPlan,
  type StoryRelationshipPlan,
} from './schema';
import type {
  SegmentedStorySource,
  SourceSegmentKind,
} from './sourceSegments';

export interface StoryPlanInventoryNode extends Omit<PlannedNode, 'nextNodeId'> {
  unitId: string;
}

export interface StoryPlanInventoryChoice extends Omit<
  PlannedChoice,
  'fromNodeId' | 'targetNodeId'
> {
  unitId: string;
}

export interface StoryPlanInventory {
  nodes: StoryPlanInventoryNode[];
  choices: StoryPlanInventoryChoice[];
}

const NODE_CONTENT_KINDS = new Set<SourceSegmentKind>([
  'dialogue',
  'stage_direction',
  'narration',
  'scene_heading',
]);

export function buildStoryPlanInventory(
  source: SegmentedStorySource
): StoryPlanInventory {
  const segmentUnitById = new Map(source.segments.map((segment) => [segment.id, segment.unitId]));
  let nodeIndex = 0;
  const nodes = source.units.flatMap((unit): StoryPlanInventoryNode[] => {
    const segments = source.segments.filter((segment) => segment.unitId === unit.id);
    const speaker = segments.find((segment) => segment.kind === 'speaker');
    const content = segments.filter((segment) => NODE_CONTENT_KINDS.has(segment.kind));
    if (content.length === 0) return [];
    nodeIndex += 1;
    return [{
      id: `Node${nodeIndex}`,
      unitId: unit.id,
      type: speaker
        ? 'dialogue'
        : content.some((segment) => segment.kind === 'scene_heading')
          ? 'scene'
          : 'narration',
      speakerSegmentId: speaker?.id ?? '',
      contentSegmentIds: content.map((segment) => segment.id),
      commandIds: source.commands
        .filter((command) => segmentUnitById.get(command.segmentId) === unit.id)
        .map((command) => command.id),
    }];
  });
  const choices = source.segments
    .filter((segment) => segment.kind === 'choice_text')
    .map((segment, index): StoryPlanInventoryChoice => ({
      id: `Choice${index + 1}`,
      unitId: segment.unitId,
      textSegmentIds: [segment.id],
      commandIds: source.commands
        .filter((command) => segmentUnitById.get(command.segmentId) === segment.unitId)
        .map((command) => command.id),
    }));

  return { nodes, choices };
}

export function materializeStoryRelationshipPlan(
  graph: StoryGraphPlan,
  inventory: StoryPlanInventory
): StoryRelationshipPlan {
  assertExactEdges(
    'choice',
    inventory.choices.map((choice) => choice.id),
    graph.choiceEdges.map((edge) => edge.choiceId)
  );
  const knownNodeIds = new Set(inventory.nodes.map((node) => node.id));
  assertUniqueKnownIds('break', graph.breakAfterNodeIds, knownNodeIds);
  assertUniqueKnownIds(
    'override',
    graph.nextOverrides.map((override) => override.nodeId),
    knownNodeIds
  );
  if (graph.nextOverrides.some((override) => !knownNodeIds.has(override.targetNodeId))) {
    throw new Error('Model next override targets do not match the server inventory');
  }
  const breakAfter = new Set(graph.breakAfterNodeIds);
  const nextOverrides = new Map(graph.nextOverrides.map((override) => [override.nodeId, override]));
  const choiceEdges = new Map(graph.choiceEdges.map((edge) => [edge.choiceId, edge]));
  const choiceOwners = new Set(graph.choiceEdges.map((edge) => edge.fromNodeId));
  if (graph.nextOverrides.some((override) => choiceOwners.has(override.nodeId))) {
    throw new Error('Choice owners cannot also have next overrides');
  }
  if (graph.nextOverrides.some((override) => breakAfter.has(override.nodeId))) {
    throw new Error('A node cannot have both a break and a next override');
  }

  return parseStoryRelationshipPlan({
    version: 2,
    entryNodeId: graph.entryNodeId,
    nodes: inventory.nodes.map(({ unitId: _unitId, ...node }, index) => ({
      ...node,
      nextNodeId: choiceOwners.has(node.id) || breakAfter.has(node.id)
        ? ''
        : nextOverrides.get(node.id)?.targetNodeId ?? inventory.nodes[index + 1]?.id ?? '',
    })),
    choices: inventory.choices.map(({ unitId: _unitId, ...choice }) => {
      const edge = choiceEdges.get(choice.id)!;
      return {
        ...choice,
        fromNodeId: edge.fromNodeId,
        targetNodeId: edge.targetNodeId,
      };
    }),
  });
}

function assertUniqueKnownIds(
  kind: 'break' | 'override',
  ids: string[],
  knownIds: Set<string>
): void {
  if (new Set(ids).size !== ids.length || ids.some((id) => !knownIds.has(id))) {
    throw new Error(`Model ${kind} node IDs do not match the server inventory`);
  }
}

function assertExactEdges(
  kind: 'node' | 'choice',
  expectedIds: string[],
  actualIds: string[]
): void {
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  if (
    actual.size !== actualIds.length ||
    expected.size !== actual.size ||
    expectedIds.some((id) => !actual.has(id)) ||
    actualIds.some((id) => !expected.has(id))
  ) {
    throw new Error(`Model ${kind} edges do not match the server inventory`);
  }
}
