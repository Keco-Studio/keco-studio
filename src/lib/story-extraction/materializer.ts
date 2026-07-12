import type { RoleMap } from '@/lib/script-parser';
import { sourceRefForUnit } from '@/lib/story-ir/sourceUnits';
import type { StoryCommand, StoryDocument, StoryNode, StoryOption } from '@/lib/story-ir/schema';
import type { SegmentedStorySource, SourceCommand } from '@/lib/story-plan/sourceSegments';
import type {
  StoryExtraction,
  StoryExtractionChoice,
  StoryExtractionNode,
} from './schema';

export type StoryExtractionIssueCode =
  | 'unknown_unit'
  | 'duplicate_unit'
  | 'omitted_unit'
  | 'untraceable_content'
  | 'unknown_command'
  | 'duplicate_command'
  | 'wrong_command_owner'
  | 'duplicate_node'
  | 'duplicate_choice'
  | 'invalid_presentation_type'
  | 'invalid_entry'
  | 'unresolved_target'
  | 'unreachable_node'
  | 'branch_leak'
  | 'automatic_cycle';

export type StoryExtractionIssue = {
  code: StoryExtractionIssueCode;
  message: string;
  unitIds: string[];
  nodeIds: string[];
};

export class StoryExtractionValidationError extends Error {
  readonly issues: StoryExtractionIssue[];

  constructor(issues: StoryExtractionIssue[]) {
    super(issues.map((issue) => issue.message).join('; '));
    this.name = 'StoryExtractionValidationError';
    this.issues = issues;
  }
}

export function materializeStoryExtraction(
  extraction: StoryExtraction,
  source: SegmentedStorySource,
  roleMap: RoleMap = {}
): StoryDocument {
  extraction = normalizeStoryExtraction(extraction, source);
  const issues: StoryExtractionIssue[] = [];
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitOwners = new Map<string, string[]>();
  const visibleClaims = new Map<string, Array<{ owner: string; value: string }>>();
  const commandUsage = new Map<string, string[]>();
  const commandsBySource = groupCommandsBySource(source.commands);
  const nodesById = new Map<string, StoryExtractionNode>();
  const choicesByNode = new Map<string, StoryExtractionChoice[]>();
  const choiceIds = new Set<string>();
  const dialogueTypesBySpeaker = new Map<string, Set<1 | 2>>();

  const ownUnits = (unitIds: string[], owner: string): void => {
    for (const unitId of unitIds) {
      if (!unitsById.has(unitId)) {
        push('unknown_unit', `Unknown source unit ${unitId}`, [unitId], [owner]);
        continue;
      }
      const owners = unitOwners.get(unitId) ?? [];
      owners.push(owner);
      unitOwners.set(unitId, owners);
    }
  };

  extraction.structuralUnitIds.forEach((unitId) => ownUnits([unitId], 'structural'));
  for (const node of extraction.nodes) {
    if (nodesById.has(node.id)) {
      push('duplicate_node', `Duplicate node id ${node.id}`, [], [node.id]);
    } else {
      nodesById.set(node.id, node);
    }
    ownUnits(node.sourceUnitIds, node.id);
    validateTraceability(node.speaker, node.sourceUnitIds, node.id, 'speaker');
    validateTraceability(node.content, node.sourceUnitIds, node.id, 'content');
    validatePresentationType(node);
    assignCommands(node.commandSources, node.sourceUnitIds, node.id);
  }
  const explicitDialogueTypes = new Set(
    [...dialogueTypesBySpeaker.values()].flatMap((types) => [...types])
  );
  if (dialogueTypesBySpeaker.size >= 2 && explicitDialogueTypes.size < 2) {
    push(
      'invalid_presentation_type',
      'Multiple dialogue speakers must use both presentation Type 1 and Type 2',
      [],
      extraction.nodes
        .filter((node) => node.type === 'dialogue' && node.presentationType !== undefined)
        .map((node) => node.id)
    );
  }
  for (const choice of extraction.choices) {
    const owner = `${choice.fromNodeId}.choice.${choice.id}`;
    if (choiceIds.has(choice.id)) {
      push('duplicate_choice', `Duplicate choice id ${choice.id}`, [], [choice.fromNodeId]);
    }
    choiceIds.add(choice.id);
    const choices = choicesByNode.get(choice.fromNodeId) ?? [];
    choices.push(choice);
    choicesByNode.set(choice.fromNodeId, choices);
    ownUnits(choice.sourceUnitIds, owner);
    validateTraceability(choice.text, choice.sourceUnitIds, owner, 'option text');
    assignCommands(choice.commandSources, choice.sourceUnitIds, owner);
  }

  for (const [unitId, owners] of unitOwners) {
    const claims = visibleClaims.get(unitId) ?? [];
    const duplicateClaim = claims.some((claim, index) =>
      claim.value
      && claims.findIndex((candidate) => candidate.value === claim.value) !== index
    );
    if (
      owners.length > 1
      && (owners.includes('structural') || duplicateClaim)
    ) {
      push('duplicate_unit', `Source unit ${unitId} is assigned more than once`, [unitId], owners);
    }
  }
  for (const unit of source.units) {
    if (!unitOwners.has(unit.id)) {
      push('omitted_unit', `Source unit ${unit.id} is not assigned`, [unit.id], []);
    }
  }
  for (const sourceCommand of source.commands) {
    const owners = commandUsage.get(sourceCommand.id) ?? [];
    if (owners.length === 0) {
      push('unknown_command', `Source command ${sourceCommand.source} is not assigned`, [unitForCommand(sourceCommand)], []);
    } else if (owners.length > 1) {
      push('duplicate_command', `Source command ${sourceCommand.source} is assigned more than once`, [unitForCommand(sourceCommand)], owners);
    }
  }

  validateGraph(extraction, nodesById, choicesByNode, issues);
  if (issues.length > 0) throw new StoryExtractionValidationError(issues);

  return {
    version: 1,
    entryLabel: extraction.entryNodeId,
    nodes: extraction.nodes.map((node): StoryNode => ({
      label: node.id,
      type: node.type,
      ...(node.presentationType ? { presentationType: node.presentationType } : {}),
      ...(node.speaker.trim() ? { speaker: roleMap[node.speaker]?.id ?? node.speaker } : {}),
      content: node.content,
      commands: hydrateCommands(node.commandSources, node.sourceUnitIds),
      ...(node.nextNodeId ? { next: node.nextNodeId } : {}),
      options: (choicesByNode.get(node.id) ?? []).map((choice): StoryOption => ({
        text: choice.text,
        target: choice.targetNodeId,
        commands: hydrateCommands(choice.commandSources, choice.sourceUnitIds),
        sourceRefs: choice.sourceUnitIds.map((unitId) => sourceRefForUnit(unitsById.get(unitId)!)),
      })),
      sourceRefs: node.sourceUnitIds.map((unitId) => sourceRefForUnit(unitsById.get(unitId)!)),
    })),
  };

  function validateTraceability(
    value: string,
    unitIds: string[],
    owner: string,
    field: string
  ): void {
    if (!value.trim()) return;
    const evidence = unitIds
      .map((unitId) => unitsById.get(unitId)?.text ?? '')
      .join('\n');
    if (!isTraceable(value, evidence)) {
      push('untraceable_content', `${field} for ${owner} is not traceable to its source units`, unitIds, [owner]);
      return;
    }
    if (field !== 'speaker') {
      const normalized = normalizeEvidence(value);
      unitIds.forEach((unitId) => {
        const claims = visibleClaims.get(unitId) ?? [];
        claims.push({ owner, value: normalized });
        visibleClaims.set(unitId, claims);
      });
    }
  }

  function assignCommands(commandSources: string[], unitIds: string[], owner: string): void {
    for (const commandSource of commandSources) {
      const candidates = commandsBySource.get(normalizeCommand(commandSource)) ?? [];
      const command = candidates.find((candidate) => unitIds.includes(unitForCommand(candidate)))
        ?? candidates[0];
      if (!command) {
        push('unknown_command', `Command ${commandSource} was not found in the source`, unitIds, [owner]);
        continue;
      }
      const owners = commandUsage.get(command.id) ?? [];
      owners.push(owner);
      commandUsage.set(command.id, owners);
      if (!unitIds.includes(unitForCommand(command))) {
        push('wrong_command_owner', `Command ${commandSource} is not in ${owner}'s source units`, unitIds, [owner]);
      }
    }
  }

  function validatePresentationType(node: StoryExtractionNode): void {
    if (node.presentationType === undefined) return;
    const isDialogueType = node.presentationType === 1 || node.presentationType === 2;
    if (isDialogueType !== (node.type === 'dialogue')) {
      push(
        'invalid_presentation_type',
        `Node ${node.id} has presentation Type ${node.presentationType}, which does not match ${node.type}`,
        node.sourceUnitIds,
        [node.id]
      );
      return;
    }
    if (!isDialogueType) return;

    const speaker = node.speaker.trim();
    const types = dialogueTypesBySpeaker.get(speaker) ?? new Set<1 | 2>();
    types.add(node.presentationType as 1 | 2);
    dialogueTypesBySpeaker.set(speaker, types);
    if (types.size > 1) {
      push(
        'invalid_presentation_type',
        `Dialogue speaker ${speaker} changes presentation Type between 1 and 2`,
        node.sourceUnitIds,
        extraction.nodes.filter((candidate) => candidate.speaker.trim() === speaker).map((candidate) => candidate.id)
      );
    }
  }

  function hydrateCommands(commandSources: string[], unitIds: string[]): StoryCommand[] {
    return commandSources.map((commandSource) => {
      const command = (commandsBySource.get(normalizeCommand(commandSource)) ?? [])
        .find((candidate) => unitIds.includes(unitForCommand(candidate)))!;
      return {
        source: command.source,
        variable: command.variable,
        operator: command.operator,
        value: command.value,
        sourceRefs: [sourceRefForUnit(unitsById.get(unitForCommand(command))!)],
      };
    });
  }

  function unitForCommand(command: SourceCommand): string {
    return source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '';
  }

  function push(
    code: StoryExtractionIssueCode,
    message: string,
    unitIds: string[],
    nodeIds: string[]
  ): void {
    issues.push({ code, message, unitIds, nodeIds });
  }
}

export function normalizeStoryExtraction(
  extraction: StoryExtraction,
  source?: SegmentedStorySource
): StoryExtraction {
  let entryNodeId = extraction.entryNodeId;
  const addedStructuralUnitIds = new Set<string>();
  const commandUnitId = (command: SourceCommand): string => source?.segments
    .find((segment) => segment.id === command.segmentId)?.unitId ?? '';
  const canonicalizeCommandSources = (values: string[]): string[] => values.map((value) => {
    if (!source) return value;
    const exact = source.commands.find((command) => normalizeCommand(command.source) === normalizeCommand(value));
    if (exact) return exact.source;
    const byId = source.commands.find((command) => command.id === value);
    if (byId) return byId.source;
    const unitCommands = source.commands.filter((command) =>
      source.segments.find((segment) => segment.id === command.segmentId)?.unitId === value
    );
    if (unitCommands.length === 1) return unitCommands[0].source;
    const embeddedCommands = value.match(
      /\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g
    ) ?? [];
    if (embeddedCommands.length !== 1) return value;
    return source.commands.find((command) =>
      normalizeCommand(command.source) === normalizeCommand(embeddedCommands[0])
    )?.source ?? value;
  });
  const normalizeEvidenceUnitIds = (
    value: string,
    speaker: string,
    unitIds: string[]
  ): string[] => {
    if (!source || !value.trim()) return unitIds;
    if (unitIds.some((unitId) => !source.units.some((unit) => unit.id === unitId))) {
      return unitIds;
    }
    const currentEvidence = unitIds
      .map((unitId) => source.units.find((unit) => unit.id === unitId)?.text ?? '')
      .join('\n');
    if (
      isTraceable(value, currentEvidence)
      && (!speaker.trim() || isTraceable(speaker, currentEvidence))
    ) {
      return unitIds;
    }
    const matches = source.units.filter((unit) =>
      isTraceable(value, unit.text)
      && (!speaker.trim() || isTraceable(speaker, unit.text))
    );
    return matches.length === 1 ? [matches[0].id] : unitIds;
  };
  const addCommandUnits = (
    unitIds: string[],
    commandSources: string[],
    rawCommandSources: string[]
  ): string[] => {
    if (!source) return unitIds;
    const result = new Set(unitIds);
    commandSources.forEach((commandSource, index) => {
      const commands = source.commands.filter((candidate) =>
        normalizeCommand(candidate.source) === normalizeCommand(commandSource)
      );
      if (commands.some((command) => result.has(commandUnitId(command)))) return;
      const rawSource = rawCommandSources[index] ?? '';
      const hintedCommands = commands.filter((command) => rawSource.includes(commandUnitId(command)));
      const selected = hintedCommands.length === 1
        ? hintedCommands[0]
        : commands.length === 1 ? commands[0] : undefined;
      const unitId = selected ? commandUnitId(selected) : '';
      if (unitId) result.add(unitId);
    });
    return [...result];
  };
  const normalizeSpeakerAlias = (speaker: string, unitIds: string[]): string => {
    const roleName = speaker.trim();
    if (!source || !roleName) return speaker;
    const localEvidence = unitIds
      .map((unitId) => source.units.find((unit) => unit.id === unitId)?.text ?? '')
      .join('\n')
      .trimStart();
    if (isTraceable(roleName, localEvidence)) return speaker;
    const allEvidence = source.units.map((unit) => unit.text).join('\n');
    if (!isTraceable(roleName, allEvidence)) return speaker;

    const aliases = new Set<string>();
    for (let length = 1; length < roleName.length; length += 1) {
      aliases.add(roleName.slice(0, length).trim());
      aliases.add(roleName.slice(roleName.length - length).trim());
    }
    return [...aliases]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .find((alias) => (
        localEvidence.startsWith(alias)
        && (alias.length > 1 || /^[：:（(]/.test(localEvidence.slice(alias.length)))
      )) ?? speaker;
  };
  let nodes = extraction.nodes.map((node) => {
    const commandSources = canonicalizeCommandSources(node.commandSources);
    const speaker = normalizeSpeakerAlias(node.speaker, node.sourceUnitIds);
    const evidenceUnitIds = normalizeEvidenceUnitIds(
      node.content,
      speaker,
      node.sourceUnitIds
    );
    return {
    ...node,
      speaker,
      commandSources,
      sourceUnitIds: addCommandUnits(evidenceUnitIds, commandSources, node.commandSources),
    };
  });
  const explicitRoleOrder = source?.units
    .map((unit) => unit.text.match(/^(?:人物|角色|characters?)\s*[：:]\s*(.+)$/i)?.[1] ?? '')
    .find(Boolean)
    ?.split(/[、,，;；/]/)
    .map((role) => role.replace(/[（(][^）)]*[）)]/g, '').trim())
    .filter(Boolean) ?? [];
  const speakingRoles = explicitRoleOrder.filter((role, index) => (
    explicitRoleOrder.indexOf(role) === index
    && nodes.some((node) => (
      node.type === 'dialogue'
      && (role.includes(node.speaker.trim()) || node.speaker.trim().includes(role))
    ))
  ));
  if (speakingRoles.length >= 2) {
    const orderedTypes = new Map(speakingRoles.slice(0, 2).map((role, index) => (
      [role, (index + 1) as 1 | 2]
    )));
    nodes = nodes.map((node) => {
      if (node.type !== 'dialogue' || node.presentationType === undefined) return node;
      const speaker = node.speaker.trim();
      const role = [...orderedTypes.keys()].find((candidate) => (
        candidate.includes(speaker) || speaker.includes(candidate)
      ));
      return role ? { ...node, presentationType: orderedTypes.get(role)! } : node;
    });
  }
  let choices = extraction.choices.map((choice) => {
    const commandSources = canonicalizeCommandSources(choice.commandSources);
    const text = cleanChoiceText(choice.text);
    const evidenceUnitIds = normalizeEvidenceUnitIds(text, '', choice.sourceUnitIds);
    return {
      ...choice,
      text,
      commandSources,
      sourceUnitIds: addCommandUnits(evidenceUnitIds, commandSources, choice.commandSources),
    };
  });

  for (const choice of [...choices]) {
    const placeholder = nodes.find((node) => node.id === choice.targetNodeId);
    if (
      !placeholder
      || !placeholder.nextNodeId
      || placeholder.speaker.trim()
      || entryNodeId === placeholder.id
      || nodes.some((node) => node.nextNodeId === placeholder.id)
      || choices.filter((candidate) => candidate.targetNodeId === placeholder.id).length !== 1
      || choices.some((candidate) => candidate.fromNodeId === placeholder.id)
      || !sameValues(placeholder.sourceUnitIds, choice.sourceUnitIds, (value) => value)
      || normalizeEvidence(cleanChoiceText(placeholder.content)) !== normalizeEvidence(choice.text)
      || !sameValues(placeholder.commandSources, choice.commandSources, normalizeCommand)
    ) continue;

    choices = choices.map((candidate) => candidate.id === choice.id
      ? { ...candidate, targetNodeId: placeholder.nextNodeId }
      : candidate);
    nodes = nodes.filter((node) => node.id !== placeholder.id);
  }

  for (const structuralNode of [...nodes]) {
    if (
      structuralNode.commandSources.length > 0
      || !isStructuralControlNode(structuralNode.content)
    ) continue;
    const incomingNext = nodes.filter((node) => node.nextNodeId === structuralNode.id);
    const incomingChoices = choices.filter((choice) => choice.targetNodeId === structuralNode.id);
    const ownedChoices = choices.filter((choice) => choice.fromNodeId === structuralNode.id);
    let removable = false;

    if (
      ownedChoices.length > 0
      && !structuralNode.nextNodeId
      && incomingNext.length === 1
      && incomingChoices.length === 0
    ) {
      const ownerId = incomingNext[0].id;
      nodes = nodes.map((node) => node.id === ownerId ? { ...node, nextNodeId: '' } : node);
      choices = choices.map((choice) => choice.fromNodeId === structuralNode.id
        ? { ...choice, fromNodeId: ownerId }
        : choice);
      removable = true;
    } else if (ownedChoices.length === 0 && structuralNode.nextNodeId) {
      nodes = nodes.map((node) => node.nextNodeId === structuralNode.id
        ? { ...node, nextNodeId: structuralNode.nextNodeId }
        : node);
      choices = choices.map((choice) => choice.targetNodeId === structuralNode.id
        ? { ...choice, targetNodeId: structuralNode.nextNodeId }
        : choice);
      if (entryNodeId === structuralNode.id) entryNodeId = structuralNode.nextNodeId;
      removable = true;
    } else if (
      ownedChoices.length === 0
      && incomingNext.length === 0
      && incomingChoices.length === 0
      && entryNodeId !== structuralNode.id
    ) {
      removable = true;
    }

    if (removable) {
      structuralNode.sourceUnitIds.forEach((unitId) => addedStructuralUnitIds.add(unitId));
      nodes = nodes.filter((node) => node.id !== structuralNode.id);
    }
  }

  if (source) {
    const commandUnitFor = (commandSource: string, unitIds: string[]): string => {
      const candidates = source.commands.filter((command) =>
        normalizeCommand(command.source) === normalizeCommand(commandSource)
        && unitIds.includes(commandUnitId(command))
      );
      return candidates.length === 1 ? commandUnitId(candidates[0]) : '';
    };
    const choiceTargetsByCommandUnit = new Map<string, Set<string>>();
    choices.forEach((choice) => {
      choice.commandSources.forEach((commandSource) => {
        const unitId = commandUnitFor(commandSource, choice.sourceUnitIds);
        if (!unitId) return;
        const targets = choiceTargetsByCommandUnit.get(unitId) ?? new Set<string>();
        targets.add(choice.targetNodeId);
        choiceTargetsByCommandUnit.set(unitId, targets);
      });
    });
    nodes = nodes.map((node) => {
      const removedUnits = new Set<string>();
      const commandSources = node.commandSources.filter((commandSource) => {
        const unitId = commandUnitFor(commandSource, node.sourceUnitIds);
        const unitText = source.units.find((unit) => unit.id === unitId)?.text ?? '';
        const duplicatedChoiceTrigger = Boolean(
          unitId
          && /选择(?:发生)?时(?:让|执行)/.test(unitText)
          && choiceTargetsByCommandUnit.get(unitId)?.has(node.id)
        );
        if (duplicatedChoiceTrigger) removedUnits.add(unitId);
        return !duplicatedChoiceTrigger;
      });
      if (removedUnits.size === 0) return node;
      const remainingUnitIds = node.sourceUnitIds.filter((unitId) => !removedUnits.has(unitId));
      const evidence = remainingUnitIds
        .map((unitId) => source.units.find((unit) => unit.id === unitId)?.text ?? '')
        .join('\n');
      const canDropUnits = isTraceable(node.content, evidence)
        && (!node.speaker.trim() || isTraceable(node.speaker, evidence));
      return {
        ...node,
        commandSources,
        sourceUnitIds: canDropUnits ? remainingUnitIds : node.sourceUnitIds,
      };
    });
  }

  const choicesByOwner = new Map<string, StoryExtractionChoice[]>();
  choices.forEach((choice) => {
    const ownerChoices = choicesByOwner.get(choice.fromNodeId) ?? [];
    ownerChoices.push(choice);
    choicesByOwner.set(choice.fromNodeId, ownerChoices);
  });
  const convertedChoiceIds = new Set<string>();
  nodes = nodes.map((node) => {
    const ownerChoices = choicesByOwner.get(node.id) ?? [];
    if (
      !node.nextNodeId
      && ownerChoices.length === 1
      && ownerChoices[0].commandSources.length === 0
      && /^(?:continue|next|继续)$/i.test(ownerChoices[0].text.trim())
    ) {
      convertedChoiceIds.add(ownerChoices[0].id);
      return { ...node, nextNodeId: ownerChoices[0].targetNodeId };
    }
    return node;
  });
  choices = choices.filter((choice) => !convertedChoiceIds.has(choice.id));
  const visibleUnitIds = new Set([
    ...nodes.flatMap((node) => node.sourceUnitIds),
    ...choices.flatMap((choice) => choice.sourceUnitIds),
  ]);
  const structuralUnitIds = new Set(
    extraction.structuralUnitIds.filter((unitId) => !visibleUnitIds.has(unitId))
  );
  addedStructuralUnitIds.forEach((unitId) => {
    if (!visibleUnitIds.has(unitId)) structuralUnitIds.add(unitId);
  });
  source?.units.forEach((unit) => {
    if (
      !visibleUnitIds.has(unit.id)
      && !structuralUnitIds.has(unit.id)
      && isClearlyStructuralUnit(unit.text)
    ) {
      structuralUnitIds.add(unit.id);
    }
  });
  return {
    ...extraction,
    entryNodeId,
    nodes,
    choices,
    structuralUnitIds: [...structuralUnitIds],
  };
}

function validateGraph(
  extraction: StoryExtraction,
  nodesById: Map<string, StoryExtractionNode>,
  choicesByNode: Map<string, StoryExtractionChoice[]>,
  issues: StoryExtractionIssue[]
): void {
  const add = (code: StoryExtractionIssueCode, message: string, nodeIds: string[]) => {
    issues.push({ code, message, unitIds: [], nodeIds });
  };
  if (!nodesById.has(extraction.entryNodeId)) {
    add('invalid_entry', `Entry node ${extraction.entryNodeId} does not exist`, [extraction.entryNodeId]);
  }
  for (const node of extraction.nodes) {
    if ((choicesByNode.get(node.id)?.length ?? 0) > 0 && node.nextNodeId) {
      add('branch_leak', `Node ${node.id} has choices and an automatic transition`, [node.id]);
    }
    if (node.nextNodeId && !nodesById.has(node.nextNodeId)) {
      add('unresolved_target', `Target ${node.nextNodeId} does not exist`, [node.id]);
    }
  }
  for (const choice of extraction.choices) {
    if (!nodesById.has(choice.fromNodeId)) {
      add('unresolved_target', `Choice owner ${choice.fromNodeId} does not exist`, [choice.fromNodeId]);
    }
    if (!nodesById.has(choice.targetNodeId)) {
      add('unresolved_target', `Target ${choice.targetNodeId} does not exist`, [choice.fromNodeId]);
    }
  }

  if (nodesById.has(extraction.entryNodeId)) {
    const reachable = new Set<string>();
    const pending = [extraction.entryNodeId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      const node = nodesById.get(id);
      if (!node || reachable.has(id)) continue;
      reachable.add(id);
      if (node.nextNodeId) pending.push(node.nextNodeId);
      (choicesByNode.get(node.id) ?? []).forEach((choice) => pending.push(choice.targetNodeId));
    }
    extraction.nodes.forEach((node) => {
      if (!reachable.has(node.id)) {
        add('unreachable_node', `Unreachable node ${node.id}`, [node.id]);
      }
    });
  }

  for (const start of extraction.nodes) {
    const trail = new Set<string>();
    let current: StoryExtractionNode | undefined = start;
    while (current?.nextNodeId) {
      if (trail.has(current.id)) {
        add('automatic_cycle', `Automatic cycle detected at ${current.id}`, [...trail]);
        break;
      }
      trail.add(current.id);
      current = nodesById.get(current.nextNodeId);
    }
  }
}

function groupCommandsBySource(commands: SourceCommand[]): Map<string, SourceCommand[]> {
  const grouped = new Map<string, SourceCommand[]>();
  commands.forEach((command) => {
    const key = normalizeCommand(command.source);
    const values = grouped.get(key) ?? [];
    values.push(command);
    grouped.set(key, values);
  });
  return grouped;
}

function normalizeCommand(value: string): string {
  return value.replace(/\s+/g, '');
}

function cleanChoiceText(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*如果(?:你)?选择\s*/, '')
    .replace(/[\s，,。.!！;；:：]*(?:选择发生时让|选择发生时执行|选择时执行|选择时让)[\s，,。.!！;；:：]*$/i, '')
    .trim();
  return cleaned || value;
}

function isTraceable(value: string, evidence: string): boolean {
  const normalizedEvidence = normalizeEvidence(evidence);
  const normalizedValue = normalizeEvidence(value);
  if (!normalizedValue) return true;
  if (normalizedEvidence.includes(normalizedValue)) return true;
  return value
    .split(/\r?\n/)
    .map(normalizeEvidence)
    .filter(Boolean)
    .every((part) => normalizedEvidence.includes(part));
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, '')
    .replace(/[\s“”‘’"'「」『』【】()[\]（）:：,，。.!！?？;；]/g, '')
    .toLowerCase();
}

function sameValues(
  left: string[],
  right: string[],
  normalize: (value: string) => string
): boolean {
  const normalizedLeft = [...new Set(left.map(normalize))].sort();
  const normalizedRight = [...new Set(right.map(normalize))].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function isClearlyStructuralUnit(value: string): boolean {
  const text = value.trim();
  return /^(?:最终合流|合流|统一收尾|触发分支选择|这里有(?:两个|三个|四个|\d+个)?选择)\s*[：:]?$/i.test(text)
    || /^(?:所有|全部|两条|三条|各条|上述|以上|这些)?[^。！？!?]{0,20}(?:路径|分支)[^。！？!?]{0,40}合流[。.!！]?$/.test(text)
    || /^如果(?:你)?[^。！？!?；;]{1,80}[：:]$/.test(text)
    || /^[（(]\s*(?:Jump|跳转)\s+[^）)]+[）)]$/i.test(text);
}

function isStructuralControlNode(value: string): boolean {
  return isClearlyStructuralUnit(value)
    || /^如果(?:你)?选择[\s\S]*选择(?:发生)?时(?:让|执行)/.test(value.trim());
}
