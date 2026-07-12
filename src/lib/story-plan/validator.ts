import type { StoryRelationshipPlan } from './schema';
import type { SegmentedStorySource, SourceSegment, SourceSegmentKind } from './sourceSegments';

export type StoryPlanIssueCode =
  | 'invalid_entry'
  | 'duplicate_node_id'
  | 'duplicate_choice_id'
  | 'unknown_segment'
  | 'segment_kind_mismatch'
  | 'omitted_segment'
  | 'duplicate_segment'
  | 'unknown_command'
  | 'wrong_command_owner'
  | 'unresolved_target'
  | 'unreachable_node'
  | 'branch_leak'
  | 'invalid_merge'
  | 'automatic_cycle';

export interface StoryPlanIssue {
  code: StoryPlanIssueCode;
  message: string;
  unitIds: string[];
  nodeIds: string[];
}

const CONTENT_KINDS = new Set<SourceSegmentKind>([
  'dialogue',
  'stage_direction',
  'narration',
  'scene_heading',
]);

export function validateStoryPlan(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource
): StoryPlanIssue[] {
  const issues: StoryPlanIssue[] = [];
  const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));
  const commandsById = new Map(source.commands.map((command) => [command.id, command]));
  const nodesById = new Map<string, StoryRelationshipPlan['nodes'][number]>();
  const segmentUsage = new Map<string, number>();
  const commandUsage = new Map<string, number>();
  const choiceIds = new Set<string>();

  for (const node of plan.nodes) {
    if (nodesById.has(node.id)) {
      push(issues, 'duplicate_node_id', `Duplicate node id ${node.id}`, [], [node.id]);
    } else {
      nodesById.set(node.id, node);
    }
  }
  if (!nodesById.has(plan.entryNodeId)) {
    push(issues, 'invalid_entry', `Entry node ${plan.entryNodeId} does not exist`, [], [plan.entryNodeId]);
  }
  for (const choice of plan.choices) {
    if (choiceIds.has(choice.id)) {
      push(issues, 'duplicate_choice_id', `Duplicate choice id ${choice.id}`, [], [choice.fromNodeId]);
    }
    choiceIds.add(choice.id);
  }

  const recordSegmentUsage = (
    segmentId: string,
    allowedKinds: Set<SourceSegmentKind>,
    nodeId: string
  ): SourceSegment | undefined => {
    const segment = segmentsById.get(segmentId);
    if (!segment) {
      push(issues, 'unknown_segment', `Unknown source segment ${segmentId}`, [], [nodeId]);
      return undefined;
    }
    segmentUsage.set(segmentId, (segmentUsage.get(segmentId) ?? 0) + 1);
    if (!allowedKinds.has(segment.kind)) {
      push(issues, 'segment_kind_mismatch', `Segment ${segmentId} cannot be used here`, [segment.unitId], [nodeId]);
    }
    return segment;
  };

  for (const node of plan.nodes) {
    if (node.type === 'dialogue') {
      if (!node.speakerSegmentId) {
        push(issues, 'segment_kind_mismatch', `Dialogue node ${node.id} has no speaker`, [], [node.id]);
      } else {
        recordSegmentUsage(node.speakerSegmentId, new Set(['speaker']), node.id);
      }
    } else if (node.speakerSegmentId) {
      recordSegmentUsage(node.speakerSegmentId, new Set(), node.id);
    }
    node.contentSegmentIds.forEach((segmentId) =>
      recordSegmentUsage(segmentId, CONTENT_KINDS, node.id)
    );
    node.commandIds.forEach((commandId) => useCommand(commandId, node.id));
  }

  for (const choice of plan.choices) {
    choice.textSegmentIds.forEach((segmentId) =>
      recordSegmentUsage(segmentId, new Set(['choice_text']), choice.fromNodeId)
    );
    choice.commandIds.forEach((commandId) => useCommand(commandId, choice.fromNodeId));
  }

  for (const segment of source.segments) {
    if (!segment.required) continue;
    const count = segmentUsage.get(segment.id) ?? 0;
    if (count === 0) {
      push(issues, 'omitted_segment', `Required segment ${segment.id} is omitted`, [segment.unitId], []);
    } else if (count > 1) {
      push(issues, 'duplicate_segment', `Required segment ${segment.id} is used ${count} times`, [segment.unitId], []);
    }
  }
  for (const [commandId, count] of commandUsage) {
    if (count > 1) {
      const command = commandsById.get(commandId);
      push(issues, 'wrong_command_owner', `Command ${commandId} has multiple owners`, command ? [segmentUnit(command.segmentId)] : [], []);
    }
  }

  for (const node of plan.nodes) {
    if (node.nextNodeId && !nodesById.has(node.nextNodeId)) {
      push(issues, 'unresolved_target', `Node ${node.id} targets missing node ${node.nextNodeId}`, [], [node.id]);
    }
    if (node.nextNodeId && plan.choices.some((choice) => choice.fromNodeId === node.id)) {
      push(issues, 'branch_leak', `Choice node ${node.id} also has automatic fallthrough`, [], [node.id]);
    }
  }
  for (const choice of plan.choices) {
    if (!nodesById.has(choice.fromNodeId)) {
      push(issues, 'unresolved_target', `Choice ${choice.id} has missing owner ${choice.fromNodeId}`, [], [choice.fromNodeId]);
    }
    if (!nodesById.has(choice.targetNodeId)) {
      push(issues, 'unresolved_target', `Choice ${choice.id} targets missing node ${choice.targetNodeId}`, [], [choice.fromNodeId]);
    }
  }
  validateExplicitMerges(plan, source, issues);

  if (nodesById.has(plan.entryNodeId)) {
    const reachable = collectReachable(plan, nodesById);
    for (const node of plan.nodes) {
      if (!reachable.has(node.id)) {
        push(issues, 'unreachable_node', `Node ${node.id} is unreachable`, [], [node.id]);
      }
    }
  }
  validateAutomaticCycles(plan, nodesById, issues);
  return dedupeIssues(issues);

  function useCommand(commandId: string, nodeId: string): void {
    const command = commandsById.get(commandId);
    if (!command) {
      push(issues, 'unknown_command', `Unknown source command ${commandId}`, [], [nodeId]);
      return;
    }
    commandUsage.set(commandId, (commandUsage.get(commandId) ?? 0) + 1);
    recordSegmentUsage(command.segmentId, new Set(['command']), nodeId);
  }

  function segmentUnit(segmentId: string): string {
    return segmentsById.get(segmentId)?.unitId ?? '';
  }
}

function validateExplicitMerges(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource,
  issues: StoryPlanIssue[]
): void {
  const explicitBranchLabels = new Set<string>();
  const declarationPattern = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(branch|merge|分支|统一收尾)\b/i;
  for (const unit of source.units) {
    const declaration = declarationPattern.exec(unit.text);
    if (declaration && /^(?:branch|分支)$/i.test(declaration[2])) {
      explicitBranchLabels.add(declaration[1]);
    }
  }

  const incoming = new Map<string, number>();
  for (const node of plan.nodes) {
    if (node.nextNodeId) incoming.set(node.nextNodeId, (incoming.get(node.nextNodeId) ?? 0) + 1);
  }
  for (const choice of plan.choices) {
    incoming.set(choice.targetNodeId, (incoming.get(choice.targetNodeId) ?? 0) + 1);
  }
  for (const label of explicitBranchLabels) {
    if ((incoming.get(label) ?? 0) > 1) {
      push(issues, 'invalid_merge', `Multiple paths merge into branch label ${label}`, [], [label]);
    }
  }
}

function collectReachable(
  plan: StoryRelationshipPlan,
  nodesById: Map<string, StoryRelationshipPlan['nodes'][number]>
): Set<string> {
  const choicesByNode = new Map<string, string[]>();
  for (const choice of plan.choices) {
    const targets = choicesByNode.get(choice.fromNodeId) ?? [];
    targets.push(choice.targetNodeId);
    choicesByNode.set(choice.fromNodeId, targets);
  }
  const reachable = new Set<string>();
  const pending = [plan.entryNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId) || !nodesById.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodesById.get(nodeId)!;
    if (node.nextNodeId) pending.push(node.nextNodeId);
    pending.push(...(choicesByNode.get(nodeId) ?? []));
  }
  return reachable;
}

function validateAutomaticCycles(
  plan: StoryRelationshipPlan,
  nodesById: Map<string, StoryRelationshipPlan['nodes'][number]>,
  issues: StoryPlanIssue[]
): void {
  for (const start of plan.nodes) {
    const trail = new Set<string>();
    let current: StoryRelationshipPlan['nodes'][number] | undefined = start;
    while (current?.nextNodeId) {
      if (trail.has(current.id)) {
        push(issues, 'automatic_cycle', `Automatic cycle detected at ${current.id}`, [], [...trail]);
        break;
      }
      trail.add(current.id);
      current = nodesById.get(current.nextNodeId);
    }
  }
}

function push(
  issues: StoryPlanIssue[],
  code: StoryPlanIssueCode,
  message: string,
  unitIds: string[],
  nodeIds: string[]
): void {
  issues.push({ code, message, unitIds: unitIds.filter(Boolean), nodeIds: nodeIds.filter(Boolean) });
}

function dedupeIssues(issues: StoryPlanIssue[]): StoryPlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}:${issue.unitIds.join(',')}:${issue.nodeIds.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
