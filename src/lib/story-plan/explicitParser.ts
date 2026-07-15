import type {
  PlannedChoice,
  PlannedNode,
  StoryRelationshipPlan,
} from './schema';
import {
  buildStoryPlanInventory,
  materializeStoryRelationshipPlan,
} from './inventory';
import type { SegmentedStorySource, SourceSegment } from './sourceSegments';

const DECLARATION_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(branch|merge)\s*[【[]\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*[|｜]/i;
const OPTION_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s*[：:].*[（(]([\s\S]*)[）)]$/;
const JUMP_ONLY_PATTERN = /^[（(]\s*Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge))?\s*[）)]$/i;
const JUMP_TOKEN_PATTERN = /Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})/i;
const NATURAL_BRANCH_PATTERN = /^Branch\s*(\d+)\s*[：:]\s*Choose\s*[【[]/i;

export function tryParseExplicitStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const declarations = collectDeclarations(source);
  if (!declarations) return null;

  const nodes: PlannedNode[] = [];
  const choices: PlannedChoice[] = [];
  const usedNodeIds = new Set<string>();
  const usedChoiceIds = new Set<string>();
  let pendingLabel = '';
  let currentNode: PlannedNode | undefined;
  let generatedIndex = 1;
  let sawExplicitStructure = false;

  for (const unit of source.units) {
    const declaration = DECLARATION_PATTERN.exec(unit.text);
    if (declaration) {
      if (pendingLabel) return null;
      pendingLabel = declaration[1];
      sawExplicitStructure = true;
      continue;
    }

    const option = OPTION_PATTERN.exec(unit.text);
    if (option && unitSegments(source, unit.id).some((segment) => segment.kind === 'choice_text')) {
      if (!currentNode || usedChoiceIds.has(option[1])) return null;
      const jump = JUMP_TOKEN_PATTERN.exec(option[2]);
      if (!jump) return null;
      choices.push({
        id: option[1],
        fromNodeId: currentNode.id,
        textSegmentIds: unitSegments(source, unit.id)
          .filter((segment) => segment.kind === 'choice_text')
          .map((segment) => segment.id),
        targetNodeId: resolveTarget(jump[1], declarations.mergeLabels),
        commandIds: source.commands
          .filter((command) => segmentUnitId(source, command.segmentId) === unit.id)
          .map((command) => command.id),
      });
      usedChoiceIds.add(option[1]);
      sawExplicitStructure = true;
      continue;
    }

    const jumpOnly = JUMP_ONLY_PATTERN.exec(unit.text);
    if (jumpOnly) {
      if (!currentNode || currentNode.nextNodeId) return null;
      currentNode.nextNodeId = resolveTarget(jumpOnly[1], declarations.mergeLabels);
      sawExplicitStructure = true;
      continue;
    }

    const contentSegments = unitSegments(source, unit.id).filter(isNodeContentSegment);
    if (contentSegments.length === 0) continue;

    const explicitBoundary = Boolean(pendingLabel);
    let nodeId = pendingLabel || (nodes.length === 0 ? 'Start' : `Line${generatedIndex++}`);
    while (usedNodeIds.has(nodeId)) {
      if (pendingLabel) return null;
      nodeId = `Line${generatedIndex++}`;
    }

    const speaker = unitSegments(source, unit.id).find((segment) => segment.kind === 'speaker');
    const node: PlannedNode = {
      id: nodeId,
      type: speaker ? 'dialogue' : contentSegments.some((segment) => segment.kind === 'scene_heading') ? 'scene' : 'narration',
      speakerSegmentId: speaker?.id ?? '',
      contentSegmentIds: contentSegments.map((segment) => segment.id),
      commandIds: source.commands
        .filter((command) => segmentUnitId(source, command.segmentId) === unit.id)
        .map((command) => command.id),
      nextNodeId: '',
    };

    if (currentNode && !explicitBoundary && !currentNode.nextNodeId && !choices.some((choice) => choice.fromNodeId === currentNode!.id)) {
      currentNode.nextNodeId = node.id;
    }
    nodes.push(node);
    usedNodeIds.add(node.id);
    currentNode = node;
    pendingLabel = '';
  }

  if (!sawExplicitStructure || pendingLabel || nodes.length === 0) return null;
  const knownNodes = new Set(nodes.map((node) => node.id));
  if (choices.some((choice) => !knownNodes.has(choice.targetNodeId))) return null;
  if (nodes.some((node) => node.nextNodeId && !knownNodes.has(node.nextNodeId))) return null;

  return {
    version: 2,
    entryNodeId: nodes[0].id,
    nodes,
    choices,
  };
}

export function tryParseNaturalBranchStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const inventory = buildStoryPlanInventory(source);
  if (inventory.choices.length < 2 || inventory.nodes.length === 0) return null;
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const naturalChoices = inventory.choices.map((choice) => {
    const unit = source.units.find((candidate) => candidate.id === choice.unitId);
    const match = unit ? NATURAL_BRANCH_PATTERN.exec(unit.text) : null;
    return match && unit ? {
      choice,
      unitIndex: unitIndexById.get(unit.id)!,
      ordinal: parseNaturalOrdinal(match[1]),
    } : null;
  });
  if (naturalChoices.some((choice) => !choice || choice.ordinal === null)) return null;
  const choices = naturalChoices.filter((choice): choice is NonNullable<typeof choice> => Boolean(choice));
  if (choices.some((choice, index) => choice.ordinal !== index + 1)) return null;

  const nodeUnits = inventory.nodes.map((node) => ({
    node,
    unitIndex: unitIndexById.get(node.unitId)!,
  }));
  const owner = [...nodeUnits]
    .reverse()
    .find((candidate) => candidate.unitIndex < choices[0].unitIndex);
  if (!owner) return null;

  const choiceEdges = [];
  const breakAfterNodeIds: string[] = [];
  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index];
    const nextChoice = choices[index + 1];
    const branchNodes = nodeUnits.filter((candidate) =>
      candidate.unitIndex > choice.unitIndex &&
      (!nextChoice || candidate.unitIndex < nextChoice.unitIndex)
    );
    if (branchNodes.length === 0) return null;
    choiceEdges.push({
      choiceId: choice.choice.id,
      fromNodeId: owner.node.id,
      targetNodeId: branchNodes[0].node.id,
    });
    if (nextChoice) breakAfterNodeIds.push(branchNodes.at(-1)!.node.id);
  }

  try {
    return materializeStoryRelationshipPlan({
      version: 2,
      entryNodeId: inventory.nodes[0].id,
      breakAfterNodeIds,
      nextOverrides: [],
      choiceEdges,
    }, inventory);
  } catch {
    return null;
  }
}

function collectDeclarations(
  source: SegmentedStorySource
): { labels: Set<string>; mergeLabels: string[] } | null {
  const labels = new Set<string>();
  const mergeLabels: string[] = [];

  for (const unit of source.units) {
    const declaration = DECLARATION_PATTERN.exec(unit.text);
    if (!declaration) continue;
    if (declaration[1] !== declaration[3] || labels.has(declaration[1])) return null;
    labels.add(declaration[1]);
    if (/^merge$/i.test(declaration[2])) mergeLabels.push(declaration[1]);
  }
  return { labels, mergeLabels };
}

function resolveTarget(target: string, mergeLabels: string[]): string {
  if (!/^Merge$/i.test(target)) return target;
  return mergeLabels.length === 1 ? mergeLabels[0] : target;
}

function unitSegments(source: SegmentedStorySource, unitId: string): SourceSegment[] {
  return source.segments.filter((segment) => segment.unitId === unitId);
}

function segmentUnitId(source: SegmentedStorySource, segmentId: string): string | undefined {
  return source.segments.find((segment) => segment.id === segmentId)?.unitId;
}

function isNodeContentSegment(segment: SourceSegment): boolean {
  return segment.kind === 'dialogue' ||
    segment.kind === 'stage_direction' ||
    segment.kind === 'narration' ||
    segment.kind === 'scene_heading';
}

function parseNaturalOrdinal(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
