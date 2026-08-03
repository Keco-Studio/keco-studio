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
const CHINESE_NATURAL_BRANCH_PATTERN = /^\u5206\u652f\s*([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\d]+)\s*[：:]\s*\u9009\u62e9\s*[【[]/;
const CHINESE_BRANCH_PATTERN = /^【\s*\u5206\u652f\u9009\u62e9([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\d]+)\s*[：:]/;

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
    const ordinalText = unit ? naturalBranchOrdinalText(unit.text) : undefined;
    return ordinalText && unit ? {
      choice,
      unitIndex: unitIndexById.get(unit.id)!,
      ordinal: parseNaturalOrdinal(ordinalText),
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

export function tryParseLinearScreenplay(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const dialogueCount = source.segments.filter((segment) => segment.kind === 'dialogue').length;
  const sceneCount = source.segments.filter((segment) => segment.kind === 'scene_heading').length;
  if (dialogueCount < 2 || sceneCount < 1) return null;

  const nodes: PlannedNode[] = [];
  const branchChoices: Array<{
    ordinal: number;
    choice: Omit<PlannedChoice, 'targetNodeId'>;
    targetNodeId?: string;
  }> = [];
  let currentNode: PlannedNode | undefined;
  let branchOwner: PlannedNode | undefined;
  let pendingChoiceIndex: number | undefined;

  const appendNode = (
    type: PlannedNode['type'],
    speakerSegmentId: string,
    contentSegmentIds: string[],
    commandIds: string[]
  ): void => {
    const node: PlannedNode = {
      id: `Node${nodes.length + 1}`,
      type,
      speakerSegmentId,
      contentSegmentIds,
      commandIds,
      nextNodeId: '',
    };

    if (pendingChoiceIndex !== undefined) {
      branchChoices[pendingChoiceIndex].targetNodeId = node.id;
      pendingChoiceIndex = undefined;
    } else if (currentNode) {
      currentNode.nextNodeId = node.id;
    }

    nodes.push(node);
    currentNode = node;
  };

  for (const unit of source.units) {
    const segments = unitSegments(source, unit.id);
    const choiceSegments = segments.filter((segment) => segment.kind === 'choice_text');
    const contentSegments = segments.filter(isNodeContentSegment);
    const commandIds = source.commands
      .filter((command) => segmentUnitId(source, command.segmentId) === unit.id)
      .map((command) => command.id);

    if (choiceSegments.length > 0) {
      const ordinal = parseChineseBranchOrdinal(unit.text);
      if (
        choiceSegments.length !== 1
        || contentSegments.length > 0
        || !currentNode
        || pendingChoiceIndex !== undefined
        || ordinal === null
      ) return null;
      if (ordinal === 1) {
        if (branchChoices.length > 0) return null;
        branchOwner = currentNode;
      } else if (!branchOwner || ordinal !== branchChoices.length + 1) {
        return null;
      }
      branchChoices.push({
        ordinal,
        choice: {
          id: `Choice${branchChoices.length + 1}`,
          fromNodeId: branchOwner!.id,
          textSegmentIds: [choiceSegments[0].id],
          commandIds,
        },
      });
      pendingChoiceIndex = branchChoices.length - 1;
      continue;
    }

    if (contentSegments.length === 0) continue;
    const speaker = segments.find((segment) => segment.kind === 'speaker');
    const dialogue = segments.find((segment) => segment.kind === 'dialogue');
    const stageDirections = segments.filter((segment) => segment.kind === 'stage_direction');

    if (speaker && dialogue) {
      if (stageDirections.length > 0) {
        appendNode('narration', speaker.id, stageDirections.map((segment) => segment.id), []);
      }
      appendNode('dialogue', speaker.id, [dialogue.id], commandIds);
      continue;
    }

    appendNode(
      contentSegments.some((segment) => segment.kind === 'scene_heading') ? 'scene' : 'narration',
      '',
      contentSegments.map((segment) => segment.id),
      commandIds
    );
  }

  if (
    nodes.length === 0
    || pendingChoiceIndex !== undefined
    || branchChoices.length === 1
    || branchChoices.some((branch) => !branch.targetNodeId)
  ) return null;
  const choices: PlannedChoice[] = branchChoices.map(({ choice, targetNodeId }) => ({
    ...choice,
    targetNodeId: targetNodeId!,
  }));
  return {
    version: 2,
    entryNodeId: nodes[0].id,
    nodes,
    choices,
  };
}

function parseChineseBranchOrdinal(line: string): number | null {
  const value = CHINESE_BRANCH_PATTERN.exec(line)?.[1];
  return value ? parseOrdinal(value) : null;
}

function naturalBranchOrdinalText(line: string): string | undefined {
  return NATURAL_BRANCH_PATTERN.exec(line)?.[1]
    ?? CHINESE_NATURAL_BRANCH_PATTERN.exec(line)?.[1];
}

function parseOrdinal(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  const digits: Record<string, number> = {
    \u4e00: 1, \u4e8c: 2, \u4e24: 2, \u4e09: 3, \u56db: 4, \u4e94: 5,
    \u516d: 6, \u4e03: 7, \u516b: 8, \u4e5d: 9,
  };
  if (!value.includes('\u5341')) return value.length === 1 ? digits[value] ?? null : null;
  const [tensText, onesText] = value.split('\u5341');
  const tens = tensText ? digits[tensText] : 1;
  const ones = onesText ? digits[onesText] : 0;
  return tens && ones !== undefined ? tens * 10 + ones : null;
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
  return parseOrdinal(value);
}
