import type {
  PlannedChoice,
  PlannedNode,
  StoryRelationshipPlan,
} from './schema';
import {
  buildStoryPlanInventory,
  materializeStoryRelationshipPlan,
  type StoryPlanInventory,
} from './inventory';
import type { SegmentedStorySource, SourceSegment } from './sourceSegments';
import { parseHierarchicalBranchMarker } from './hierarchicalBranchMarkers';
import {
  isFinalMenuMerge,
  isMenuDivider,
  isMenuMarker,
  parseMenuBranchTarget,
  parseMenuChoiceLine,
} from './menuBranchMarkers';
import { parseScenarioBranchMarker } from './scenarioBranchMarkers';

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

interface PositionedHierarchicalMarker {
  unitId: string;
  unitIndex: number;
  groupKey: string;
  choiceSegmentId: string;
}

interface HierarchicalGroup {
  key: string;
  markers: PositionedHierarchicalMarker[];
  parent?: {
    group: HierarchicalGroup;
    markerIndex: number;
  };
}

export function tryParseHierarchicalBranchStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const inventory = buildHierarchicalStoryPlanInventory(source);
  if (inventory.nodes.length === 0 || inventory.choices.length < 2) return null;

  const groupsByKey = new Map<string, HierarchicalGroup>();
  const markers: PositionedHierarchicalMarker[] = [];
  source.units.forEach((unit, unitIndex) => {
    const parsed = parseHierarchicalBranchMarker(unit.text);
    if (!parsed) return;
    const choiceSegment = unitSegments(source, unit.id).find((segment) => (
      segment.kind === 'choice_text' && segment.text === parsed.choiceText
    ));
    if (!choiceSegment) return;
    const marker = {
      unitId: unit.id,
      unitIndex,
      groupKey: parsed.groupKey,
      choiceSegmentId: choiceSegment.id,
    };
    markers.push(marker);
    const group = groupsByKey.get(parsed.groupKey) ?? {
      key: parsed.groupKey,
      markers: [],
    };
    group.markers.push(marker);
    groupsByKey.set(parsed.groupKey, group);
  });

  if (markers.length !== inventory.choices.length) return null;
  const groups = [...groupsByKey.values()]
    .sort((left, right) => left.markers[0].unitIndex - right.markers[0].unitIndex);
  if (groups.length === 0 || groups.some((group) => group.markers.length < 2)) return null;
  const mergeUnitIndexes = source.units
    .map((unit, index) => isExplicitMergeBoundary(unit.text) ? index : -1)
    .filter((index) => index >= 0);
  const branchEnd = (group: HierarchicalGroup, markerIndex: number): number => {
    const marker = group.markers[markerIndex];
    return group.markers[markerIndex + 1]?.unitIndex
      ?? mergeUnitIndexes.find((index) => index > marker.unitIndex)
      ?? source.units.length;
  };

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const firstIndex = group.markers[0].unitIndex;
    let bestParent: HierarchicalGroup['parent'];
    let bestParentStart = -1;
    for (const candidate of groups.slice(0, groupIndex)) {
      candidate.markers.forEach((marker, markerIndex) => {
        const end = branchEnd(candidate, markerIndex);
        if (
          marker.unitIndex < firstIndex
          && firstIndex < end
          && marker.unitIndex > bestParentStart
        ) {
          bestParent = { group: candidate, markerIndex };
          bestParentStart = marker.unitIndex;
        }
      });
    }
    group.parent = bestParent;
  }
  const roots = groups.filter((group) => !group.parent);
  if (roots.length === 0) return null;

  const rootForGroup = (group: HierarchicalGroup): HierarchicalGroup => {
    let current = group;
    while (current.parent) current = current.parent.group;
    return current;
  };
  const rootBounds = new Map<HierarchicalGroup, {
    end: number;
    mergeIndex: number;
  }>();
  roots.forEach((root, rootIndex) => {
    const nextRootStart = roots[rootIndex + 1]?.markers[0].unitIndex ?? source.units.length;
    const mergeIndex = mergeUnitIndexes.find((index) => (
      index > root.markers[0].unitIndex && index < nextRootStart
    )) ?? -1;
    rootBounds.set(root, {
      end: mergeIndex >= 0 ? mergeIndex : nextRootStart,
      mergeIndex,
    });
  });
  if (roots.length > 1 && roots.some((root, index) => (
    index < roots.length - 1 && rootBounds.get(root)!.mergeIndex < 0
  ))) return null;

  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const positionedNodes = inventory.nodes.map((node) => ({
    node,
    unitIndex: unitIndexById.get(node.unitId) ?? Number.MAX_SAFE_INTEGER,
  }));
  const inventoryChoiceByUnitId = new Map(
    inventory.choices.map((choice) => [choice.unitId, choice])
  );
  const mergeTargets = new Map<HierarchicalGroup, typeof positionedNodes[number]>();
  roots.forEach((root, rootIndex) => {
    const mergeIndex = rootBounds.get(root)!.mergeIndex;
    if (mergeIndex < 0) return;
    const nextRootStart = roots[rootIndex + 1]?.markers[0].unitIndex ?? source.units.length;
    const mergeTarget = firstPositionedNodeBetween(
      positionedNodes,
      mergeIndex - 1,
      nextRootStart
    );
    if (mergeTarget) mergeTargets.set(root, mergeTarget);
  });
  if (roots.some((root) => (
    rootBounds.get(root)!.mergeIndex >= 0 && !mergeTargets.has(root)
  ))) return null;
  const choiceEdges: Array<{
    choiceId: string;
    fromNodeId: string;
    targetNodeId: string;
  }> = [];
  const breakAfterNodeIds = new Set<string>();
  const nextOverrides: Array<{ nodeId: string; targetNodeId: string }> = [];

  for (const group of groups) {
    const root = rootForGroup(group);
    const rootEnd = rootBounds.get(root)!.end;
    const mergeTarget = mergeTargets.get(root);
    const groupStart = group.markers[0].unitIndex;
    const ownerLowerBound = group.parent
      ? group.parent.group.markers[group.parent.markerIndex].unitIndex
      : -1;
    const owner = lastPositionedNodeBetween(positionedNodes, ownerLowerBound, groupStart);
    if (!owner) return null;

    for (let markerIndex = 0; markerIndex < group.markers.length; markerIndex += 1) {
      const marker = group.markers[markerIndex];
      const end = hierarchicalBranchEnd(group, markerIndex, rootEnd);
      const target = firstPositionedNodeBetween(positionedNodes, marker.unitIndex, end);
      const choice = inventoryChoiceByUnitId.get(marker.unitId);
      if (!target || !choice || !choice.textSegmentIds.includes(marker.choiceSegmentId)) return null;
      choiceEdges.push({
        choiceId: choice.id,
        fromNodeId: owner.node.id,
        targetNodeId: target.node.id,
      });

      const hasChildGroup = groups.some((candidate) => (
        candidate.parent?.group === group
        && candidate.parent.markerIndex === markerIndex
      ));
      if (!hasChildGroup) {
        const terminal = lastPositionedNodeBetween(positionedNodes, marker.unitIndex, end);
        if (!terminal) return null;
        if (mergeTarget) {
          nextOverrides.push({
            nodeId: terminal.node.id,
            targetNodeId: mergeTarget.node.id,
          });
        } else {
          breakAfterNodeIds.add(terminal.node.id);
        }
      }
    }
  }

  try {
    return materializeStoryRelationshipPlan({
      version: 2,
      entryNodeId: inventory.nodes[0].id,
      breakAfterNodeIds: [...breakAfterNodeIds],
      nextOverrides,
      choiceEdges,
    }, inventory);
  } catch {
    return null;
  }
}

export function tryParseScenarioDecisionStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const inventory = buildHierarchicalStoryPlanInventory(source);
  if (inventory.nodes.length === 0 || inventory.choices.length < 2) return null;
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const positionedNodes = inventory.nodes.map((node) => ({
    node,
    unitIndex: unitIndexById.get(node.unitId) ?? Number.MAX_SAFE_INTEGER,
  }));
  const choiceByUnitId = new Map(inventory.choices.map((choice) => [choice.unitId, choice]));
  const groups = new Map<string, Array<{
    unitId: string;
    unitIndex: number;
    code: string;
  }>>();
  const coreIndexes = new Map<string, number>();
  let scenarioChoiceCount = 0;

  source.units.forEach((unit, unitIndex) => {
    const marker = parseScenarioBranchMarker(unit.text);
    if (!marker) return;
    if (marker.kind === 'core') {
      coreIndexes.set(marker.code, unitIndex);
      return;
    }
    if (marker.kind !== 'choice') return;
    const parentCode = /^([A-Z]+)\d+$/.exec(marker.code)?.[1];
    if (!parentCode) return;
    scenarioChoiceCount += 1;
    const siblings = groups.get(parentCode) ?? [];
    siblings.push({ unitId: unit.id, unitIndex, code: marker.code });
    groups.set(parentCode, siblings);
  });

  if (
    scenarioChoiceCount !== inventory.choices.length
    || groups.size === 0
    || [...groups.values()].some((markers) => markers.length < 2)
  ) return null;

  const orderedGroups = [...groups]
    .map(([code, markers]) => ({ code, markers }))
    .sort((left, right) => left.markers[0].unitIndex - right.markers[0].unitIndex);
  const choiceEdges: Array<{ choiceId: string; fromNodeId: string; targetNodeId: string }> = [];
  const nextOverrides: Array<{ nodeId: string; targetNodeId: string }> = [];

  for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
    const group = orderedGroups[groupIndex];
    const firstMarkerIndex = group.markers[0].unitIndex;
    const owner = lastPositionedNodeBetween(
      positionedNodes,
      coreIndexes.get(group.code) ?? -1,
      firstMarkerIndex
    );
    if (!owner) return null;

    const nextCoreIndex = orderedGroups
      .slice(groupIndex + 1)
      .map((candidate) => coreIndexes.get(candidate.code))
      .find((index): index is number => index !== undefined && index > firstMarkerIndex);
    let mergeBoundary = nextCoreIndex;
    if (mergeBoundary === undefined) {
      mergeBoundary = source.units.findIndex((unit, unitIndex) => {
        const marker = parseScenarioBranchMarker(unit.text);
        return unitIndex > group.markers.at(-1)!.unitIndex
          && marker?.kind === 'structural'
          && marker.control === 'outcome';
      });
      if (mergeBoundary < 0) return null;
      mergeBoundary += 1;
    }
    const mergeTarget = firstPositionedNodeAtOrAfter(
      positionedNodes,
      mergeBoundary,
      source.units.length
    );
    if (!mergeTarget) return null;

    for (let markerIndex = 0; markerIndex < group.markers.length; markerIndex += 1) {
      const marker = group.markers[markerIndex];
      const branchEnd = group.markers[markerIndex + 1]?.unitIndex ?? mergeBoundary;
      const target = firstPositionedNodeBetween(positionedNodes, marker.unitIndex, branchEnd);
      const terminal = lastPositionedNodeBetween(positionedNodes, marker.unitIndex, branchEnd);
      const choice = choiceByUnitId.get(marker.unitId);
      if (!target || !terminal || !choice) return null;
      choiceEdges.push({
        choiceId: choice.id,
        fromNodeId: owner.node.id,
        targetNodeId: target.node.id,
      });
      nextOverrides.push({
        nodeId: terminal.node.id,
        targetNodeId: mergeTarget.node.id,
      });
    }
  }

  try {
    return materializeStoryRelationshipPlan({
      version: 2,
      entryNodeId: inventory.nodes[0].id,
      breakAfterNodeIds: [],
      nextOverrides,
      choiceEdges,
    }, inventory);
  } catch {
    return null;
  }
}

export function tryParseMenuBranchStory(
  source: SegmentedStorySource
): StoryRelationshipPlan | null {
  const inventory = buildHierarchicalStoryPlanInventory(source);
  if (inventory.nodes.length === 0 || inventory.choices.length < 2) return null;
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const menuIndexes = source.units
    .map((unit, index) => isMenuMarker(unit.text) ? index : -1)
    .filter((index) => index >= 0);
  const positionedNodes = inventory.nodes.map((node) => ({
    node,
    unitIndex: unitIndexById.get(node.unitId) ?? Number.MAX_SAFE_INTEGER,
  }));
  const choiceByUnitId = new Map(inventory.choices.map((choice) => [choice.unitId, choice]));
  const choiceEdges: Array<{ choiceId: string; fromNodeId: string; targetNodeId: string }> = [];
  const nextOverrides: Array<{ nodeId: string; targetNodeId: string }> = [];
  const breakAfterNodeIds: string[] = [];
  let parsedChoiceCount = 0;

  for (let menuPosition = 0; menuPosition < menuIndexes.length; menuPosition += 1) {
    const menuIndex = menuIndexes[menuPosition];
    const blockEnd = menuIndexes[menuPosition + 1] ?? source.units.length;
    const owner = lastPositionedNodeBetween(positionedNodes, -1, menuIndex);
    if (!owner) return null;

    const declaredChoices: Array<{
      code: string;
      choice: StoryPlanInventory['choices'][number];
    }> = [];
    let firstTargetIndex = -1;
    for (let index = menuIndex + 1; index < blockEnd; index += 1) {
      const unit = source.units[index];
      if (isMenuDivider(unit.text)) continue;
      const target = parseMenuBranchTarget(unit.text);
      if (target) {
        firstTargetIndex = index;
        break;
      }
      const parsed = parseMenuChoiceLine(unit.text);
      if (!parsed) return null;
      const choice = choiceByUnitId.get(unit.id);
      if (!choice) return null;
      declaredChoices.push({ code: parsed.code, choice });
    }
    if (
      firstTargetIndex < 0
      || declaredChoices.length < 2
      || new Set(declaredChoices.map((choice) => choice.code)).size !== declaredChoices.length
    ) return null;

    const declaredCodes = new Set(declaredChoices.map((choice) => choice.code));
    const targets = source.units.flatMap((unit, unitIndex) => {
      if (unitIndex < firstTargetIndex || unitIndex >= blockEnd) return [];
      const target = parseMenuBranchTarget(unit.text);
      return target && declaredCodes.has(target.code) ? [{ ...target, unitIndex }] : [];
    });
    if (
      targets.length !== declaredChoices.length
      || new Set(targets.map((target) => target.code)).size !== targets.length
    ) return null;
    const targetByCode = new Map(targets.map((target) => [target.code, target]));
    if (declaredChoices.some(({ code }) => !targetByCode.has(code))) return null;

    const lastTargetIndex = Math.max(...targets.map((target) => target.unitIndex));
    const mergeIndex = source.units.findIndex((unit, unitIndex) => (
      unitIndex > lastTargetIndex
      && unitIndex < blockEnd
      && isFinalMenuMerge(unit.text)
    ));
    const mergeTarget = mergeIndex >= 0
      ? firstPositionedNodeAtOrAfter(positionedNodes, mergeIndex, blockEnd)
      : undefined;
    if (mergeIndex >= 0 && !mergeTarget) return null;

    const orderedTargets = [...targets].sort((left, right) => left.unitIndex - right.unitIndex);
    for (const { code, choice } of declaredChoices) {
      const target = targetByCode.get(code)!;
      const targetPosition = orderedTargets.findIndex((candidate) => candidate.code === code);
      const branchEnd = orderedTargets[targetPosition + 1]?.unitIndex
        ?? (mergeIndex >= 0 ? mergeIndex : blockEnd);
      const firstNode = firstPositionedNodeAtOrAfter(positionedNodes, target.unitIndex, branchEnd);
      const terminal = lastPositionedNodeBetween(positionedNodes, target.unitIndex - 1, branchEnd);
      if (!firstNode || !terminal) return null;
      choiceEdges.push({ choiceId: choice.id, fromNodeId: owner.node.id, targetNodeId: firstNode.node.id });
      if (mergeTarget) nextOverrides.push({ nodeId: terminal.node.id, targetNodeId: mergeTarget.node.id });
      else breakAfterNodeIds.push(terminal.node.id);
    }
    parsedChoiceCount += declaredChoices.length;
  }

  if (parsedChoiceCount !== inventory.choices.length) return null;

  try {
    return materializeStoryRelationshipPlan({
      version: 2,
      entryNodeId: inventory.nodes[0].id,
      breakAfterNodeIds,
      nextOverrides,
      choiceEdges,
    }, inventory);
  } catch {
    return null;
  }
}

export function isExplicitMergeBoundary(text: string): boolean {
  return /\u5206\u652f\u6c47\u603b|\u7edf\u4e00(?:\u5408\u5e76)?\u7ed3\u5c40|\u5171\u540c\u7ed3\u5c40|(?:\u5168\u90e8|\u5168\u90fd|\u6240\u6709).*(?:\u6c47\u5165|\u6c47\u5408|\u6c47\u805a|\u5408\u6d41)|(?:\u7edf\u4e00|\u5171\u540c).*(?:\u6c47\u5165|\u6c47\u5408|\u6c47\u805a|\u5408\u6d41)|\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\u5e55.*(?:\u6c47\u5165|\u6c47\u5408|\u6c47\u805a|\u5408\u6d41)|(?:\u6700\u540e|\u6700\u7ec8).*(?:\u955c\u5934|\u753b\u9762)|\u5b57\u5e55\u6d6e\u73b0/.test(text);
}

export function buildHierarchicalStoryPlanInventory(
  source: SegmentedStorySource
): StoryPlanInventory {
  const nodes: StoryPlanInventory['nodes'] = [];
  const choices: StoryPlanInventory['choices'] = [];
  const segmentUnitById = new Map(
    source.segments.map((segment) => [segment.id, segment.unitId])
  );
  const commandIdsForUnit = (unitId: string) => source.commands
    .filter((command) => segmentUnitById.get(command.segmentId) === unitId)
    .map((command) => command.id);
  const appendNode = (
    unitId: string,
    type: PlannedNode['type'],
    speakerSegmentId: string,
    contentSegmentIds: string[],
    commandIds: string[]
  ) => {
    nodes.push({
      id: `Node${nodes.length + 1}`,
      unitId,
      type,
      speakerSegmentId,
      contentSegmentIds,
      commandIds,
    });
  };

  for (const unit of source.units) {
    const segments = unitSegments(source, unit.id);
    const choiceSegments = segments.filter((segment) => segment.kind === 'choice_text');
    if (choiceSegments.length > 0) {
      choiceSegments.forEach((segment) => {
        choices.push({
          id: `Choice${choices.length + 1}`,
          unitId: unit.id,
          textSegmentIds: [segment.id],
          commandIds: commandIdsForUnit(unit.id),
        });
      });
      continue;
    }

    const speaker = segments.find((segment) => segment.kind === 'speaker');
    const dialogue = segments.find((segment) => segment.kind === 'dialogue');
    const stageDirections = segments.filter((segment) => segment.kind === 'stage_direction');
    if (speaker && dialogue) {
      if (stageDirections.length > 0) {
        appendNode(
          unit.id,
          'narration',
          speaker.id,
          stageDirections.map((segment) => segment.id),
          []
        );
      }
      appendNode(
        unit.id,
        'dialogue',
        speaker.id,
        [dialogue.id],
        commandIdsForUnit(unit.id)
      );
      continue;
    }

    const content = segments.filter(isNodeContentSegment);
    if (content.length === 0) continue;
    appendNode(
      unit.id,
      content.some((segment) => segment.kind === 'scene_heading') ? 'scene' : 'narration',
      speaker?.id ?? '',
      content.map((segment) => segment.id),
      commandIdsForUnit(unit.id)
    );
  }

  return { nodes, choices };
}

function hierarchicalBranchEnd(
  group: HierarchicalGroup,
  markerIndex: number,
  unitCount: number
): number {
  return group.markers[markerIndex + 1]?.unitIndex
    ?? (group.parent
      ? hierarchicalBranchEnd(group.parent.group, group.parent.markerIndex, unitCount)
      : unitCount);
}

function firstPositionedNodeBetween<T extends { unitIndex: number }>(
  nodes: T[],
  after: number,
  before: number
): T | undefined {
  return nodes.find((candidate) => candidate.unitIndex > after && candidate.unitIndex < before);
}

function firstPositionedNodeAtOrAfter<T extends { unitIndex: number }>(
  nodes: T[],
  start: number,
  before: number
): T | undefined {
  return nodes.find((candidate) => candidate.unitIndex >= start && candidate.unitIndex < before);
}

function lastPositionedNodeBetween<T extends { unitIndex: number }>(
  nodes: T[],
  after: number,
  before: number
): T | undefined {
  return [...nodes].reverse().find((candidate) => (
    candidate.unitIndex > after && candidate.unitIndex < before
  ));
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
