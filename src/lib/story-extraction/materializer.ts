import type { RoleMap } from '@/lib/script-parser';
import { sourceRefForUnit } from '@/lib/story-ir/sourceUnits';
import type { StoryCommand, StoryDocument, StoryNode, StoryOption } from '@/lib/story-ir/schema';
import type { SegmentedStorySource, SourceCommand } from '@/lib/story-plan/sourceSegments';
import type { StoryExtraction, StoryExtractionNode } from './schema';

export type StoryExtractionIssueCode =
  | 'unknown_unit'
  | 'duplicate_unit'
  | 'omitted_unit'
  | 'untraceable_content'
  | 'unknown_command'
  | 'duplicate_command'
  | 'wrong_command_owner'
  | 'duplicate_node'
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
  const issues: StoryExtractionIssue[] = [];
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitOwners = new Map<string, string[]>();
  const commandUsage = new Map<string, string[]>();
  const commandsBySource = groupCommandsBySource(source.commands);
  const nodesById = new Map<string, StoryExtractionNode>();

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
    useCommands(node.commandSources, node.sourceUnitIds, node.id);
    node.choices.forEach((choice, index) => {
      const owner = `${node.id}.choices.${index}`;
      ownUnits(choice.sourceUnitIds, owner);
      validateTraceability(choice.text, choice.sourceUnitIds, owner, 'option text');
      useCommands(choice.commandSources, choice.sourceUnitIds, owner);
    });
  }

  for (const [unitId, owners] of unitOwners) {
    if (owners.length > 1) {
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

  validateGraph(extraction, nodesById, issues);
  if (issues.length > 0) throw new StoryExtractionValidationError(issues);

  return {
    version: 1,
    entryLabel: extraction.entryNodeId,
    nodes: extraction.nodes.map((node): StoryNode => ({
      label: node.id,
      type: node.type,
      ...(node.speaker.trim() ? { speaker: roleMap[node.speaker]?.id ?? node.speaker } : {}),
      content: node.content,
      commands: hydrateCommands(node.commandSources, node.sourceUnitIds),
      ...(node.nextNodeId ? { next: node.nextNodeId } : {}),
      options: node.choices.map((choice): StoryOption => ({
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
    }
  }

  function useCommands(commandSources: string[], unitIds: string[], owner: string): void {
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

function validateGraph(
  extraction: StoryExtraction,
  nodesById: Map<string, StoryExtractionNode>,
  issues: StoryExtractionIssue[]
): void {
  const add = (code: StoryExtractionIssueCode, message: string, nodeIds: string[]) => {
    issues.push({ code, message, unitIds: [], nodeIds });
  };
  if (!nodesById.has(extraction.entryNodeId)) {
    add('invalid_entry', `Entry node ${extraction.entryNodeId} does not exist`, [extraction.entryNodeId]);
  }
  for (const node of extraction.nodes) {
    if (node.choices.length > 0 && node.nextNodeId) {
      add('branch_leak', `Node ${node.id} has choices and an automatic transition`, [node.id]);
    }
    if (node.nextNodeId && !nodesById.has(node.nextNodeId)) {
      add('unresolved_target', `Target ${node.nextNodeId} does not exist`, [node.id]);
    }
    for (const choice of node.choices) {
      if (!nodesById.has(choice.targetNodeId)) {
        add('unresolved_target', `Target ${choice.targetNodeId} does not exist`, [node.id]);
      }
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
      node.choices.forEach((choice) => pending.push(choice.targetNodeId));
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
