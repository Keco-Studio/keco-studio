import type {
  PlannedChoice,
  PlannedNode,
  StoryRelationshipPlan,
} from './schema';
import type { SegmentedStorySource, SourceSegment } from './sourceSegments';

const DECLARATION_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(branch|merge|分支|统一收尾)\s*[【[]\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*[|｜]/i;
const OPTION_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s*[：:].*[（(]([\s\S]*)[）)]$/;
const JUMP_ONLY_PATTERN = /^[（(]\s*(?:Jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge|分支|统一收尾))?\s*[）)]$/i;
const JUMP_TOKEN_PATTERN = /(?:Jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})/i;

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
    if (/^(?:merge|统一收尾)$/i.test(declaration[2])) mergeLabels.push(declaration[1]);
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
