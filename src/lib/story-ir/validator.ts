import type {
  SourceRef,
  SourceUnit,
  StoryCommand,
  StoryDocument,
  StoryNode,
} from './schema';

export type StoryIssueType =
  | 'invalid_entry'
  | 'duplicate_label'
  | 'unresolved_target'
  | 'unreachable_node'
  | 'invalid_source_ref'
  | 'untraceable_content'
  | 'command_mutation'
  | 'omission'
  | 'branch_fallthrough'
  | 'automatic_cycle';

export interface StoryIssue {
  type: StoryIssueType;
  message: string;
  outputPath?: string;
  unitId?: string;
}

export interface StoryValidationOptions {
  allowUnresolvedTargets?: boolean;
  allowUnreachableNodes?: boolean;
}

export function validateStoryDocument(
  document: StoryDocument,
  units: SourceUnit[],
  options: StoryValidationOptions = {}
): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const coveredUnitIds = new Set<string>();

  document.nodes.forEach((node, nodeIndex) => {
    validateRefs(node.sourceRefs, `nodes[${nodeIndex}].sourceRefs`, unitsById, coveredUnitIds, issues);
    validateRefs(node.structuralRepair?.sourceRefs ?? [], `nodes[${nodeIndex}].structuralRepair`, unitsById, coveredUnitIds, issues);
    validateEvidence(node.speaker, node.sourceRefs, `nodes[${nodeIndex}].speaker`, unitsById, issues);
    validateEvidence(node.content, node.sourceRefs, `nodes[${nodeIndex}].content`, unitsById, issues);
    validateCommands(node.commands, `nodes[${nodeIndex}].commands`, unitsById, coveredUnitIds, issues);

    node.options.forEach((option, optionIndex) => {
      const path = `nodes[${nodeIndex}].options[${optionIndex}]`;
      validateRefs(option.sourceRefs, `${path}.sourceRefs`, unitsById, coveredUnitIds, issues);
      validateRefs(option.structuralRepair?.sourceRefs ?? [], `${path}.structuralRepair`, unitsById, coveredUnitIds, issues);
      validateEvidence(option.text, option.sourceRefs, `${path}.text`, unitsById, issues);
      validateCommands(option.commands, `${path}.commands`, unitsById, coveredUnitIds, issues);
    });
  });

  for (const unit of units) {
    if (unit.authoritative && !coveredUnitIds.has(unit.id)) {
      issues.push({ type: 'omission', unitId: unit.id, message: `Source unit ${unit.id} is not represented` });
    }
  }

  issues.push(...validateGraph(document, options));
  return dedupeIssues(issues);
}

function validateRefs(
  refs: SourceRef[],
  path: string,
  unitsById: Map<string, SourceUnit>,
  coveredUnitIds: Set<string>,
  issues: StoryIssue[]
): void {
  refs.forEach((ref) => {
    const unit = unitsById.get(ref.unitId);
    if (
      !unit ||
      unit.sourceId !== ref.sourceId ||
      unit.start !== ref.start ||
      unit.end !== ref.end
    ) {
      issues.push({
        type: 'invalid_source_ref',
        outputPath: path,
        unitId: ref.unitId,
        message: `Invalid source reference ${ref.unitId}`,
      });
      return;
    }
    coveredUnitIds.add(unit.id);
  });
}

function validateEvidence(
  value: string | undefined,
  refs: SourceRef[],
  path: string,
  unitsById: Map<string, SourceUnit>,
  issues: StoryIssue[]
): void {
  if (!value) return;
  const normalizedValue = normalizeEvidence(value);
  const evidence = normalizeEvidence(refs
    .map((ref) => unitsById.get(ref.unitId)?.text ?? '')
    .join(' '));
  const containsNoise = /```|^(?:jump|branch|merge)\b/i.test(value.trim()) ||
    /\b(?:branch|merge)\s*[\[【]/i.test(value);

  if (!normalizedValue || !evidence.includes(normalizedValue) || containsNoise) {
    issues.push({
      type: 'untraceable_content',
      outputPath: path,
      message: `Content at ${path} is not supported by its source references`,
    });
  }
}

function validateCommands(
  commands: StoryCommand[],
  path: string,
  unitsById: Map<string, SourceUnit>,
  coveredUnitIds: Set<string>,
  issues: StoryIssue[]
): void {
  commands.forEach((command, index) => {
    const commandPath = `${path}[${index}]`;
    validateRefs(command.sourceRefs, `${commandPath}.sourceRefs`, unitsById, coveredUnitIds, issues);
    const evidence = command.sourceRefs
      .map((ref) => unitsById.get(ref.unitId)?.text ?? '')
      .join('\n');
    if (!evidence.includes(command.source)) {
      issues.push({
        type: 'command_mutation',
        outputPath: commandPath,
        message: `Command ${command.source} is not present in its source references`,
      });
    }
  });
}

function validateGraph(
  document: StoryDocument,
  options: StoryValidationOptions
): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const indexesByLabel = new Map<string, number[]>();
  document.nodes.forEach((node, index) => {
    const indexes = indexesByLabel.get(node.label) ?? [];
    indexes.push(index);
    indexesByLabel.set(node.label, indexes);
  });

  for (const [label, indexes] of indexesByLabel) {
    if (indexes.length > 1) {
      issues.push({ type: 'duplicate_label', message: `Duplicate label ${label}` });
    }
  }

  const entryIndex = indexesByLabel.get(document.entryLabel)?.[0];
  if (entryIndex === undefined) {
    issues.push({ type: 'invalid_entry', message: `Entry label ${document.entryLabel} does not exist` });
    return issues;
  }

  const optionTargets = new Set(
    document.nodes.flatMap((node) => node.options.map((option) => option.target))
  );
  document.nodes.forEach((node, index) => {
    if (index === 0 || !optionTargets.has(node.label)) return;
    const predecessor = document.nodes[index - 1];
    if (predecessor.options.length === 0 && !predecessor.next) {
      issues.push({
        type: 'branch_fallthrough',
        outputPath: `nodes[${index - 1}]`,
        message: `Node ${predecessor.label} falls through into sibling branch target ${node.label}`,
      });
    }
  });

  document.nodes.forEach((node, nodeIndex) => {
    for (const target of targetsForNode(node)) {
      if (!indexesByLabel.has(target) && !options.allowUnresolvedTargets) {
        issues.push({
          type: 'unresolved_target',
          outputPath: `nodes[${nodeIndex}]`,
          message: `Target ${target} does not exist`,
        });
      }
    }
  });

  if (!options.allowUnreachableNodes) {
    const visited = new Set<number>();
    const pending = [entryIndex];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const target of targetsForNode(document.nodes[current])) {
        const targetIndex = indexesByLabel.get(target)?.[0];
        if (targetIndex !== undefined) pending.push(targetIndex);
      }
      const node = document.nodes[current];
      if (node.options.length === 0 && !node.next && current + 1 < document.nodes.length) {
        pending.push(current + 1);
      }
    }

    document.nodes.forEach((node, index) => {
      if (!visited.has(index)) {
        issues.push({
          type: 'unreachable_node',
          outputPath: `nodes[${index}]`,
          message: `Node ${node.label} is unreachable`,
        });
      }
    });
  }

  return issues;
}

function targetsForNode(node: StoryNode): string[] {
  if (node.options.length > 0) return node.options.map((option) => option.target);
  return node.next ? [node.next] : [];
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
    .replace(/[\[\]()【】（）［］]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeIssues(issues: StoryIssue[]): StoryIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.outputPath ?? ''}:${issue.unitId ?? ''}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
