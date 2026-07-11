import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import {
  compileStoryTable,
  type CompiledStoryTable,
} from '@/lib/story-ir/tableCompiler';

export interface StoryAuditProjectionChoice {
  text: string;
  targetNodeId: string;
  commands: string[];
}

export interface StoryAuditProjectionRow {
  label: string;
  type: StoryNode['type'];
  speaker: string;
  content: string;
  commands: string[];
  nextNodeId: string;
  choices: StoryAuditProjectionChoice[];
}

export interface StoryAuditProjectionPath {
  labels: string[];
  terminalLabel: string;
}

export interface StoryAuditProjectionTablePath {
  rowIndexes: number[];
  terminalRowIndex: number;
}

export interface StoryAuditProjection {
  rows: StoryAuditProjectionRow[];
  table: CompiledStoryTable;
  paths: StoryAuditProjectionPath[];
  tablePaths: StoryAuditProjectionTablePath[];
}

export function buildStoryAuditProjection(document: StoryDocument): StoryAuditProjection {
  const nodesByLabel = new Map(document.nodes.map((node) => [node.label, node]));
  const paths: StoryAuditProjectionPath[] = [];
  const maxTraversal = Math.max(1, document.nodes.length * 4);
  const table = compileStoryTable(document);

  visit(document.entryLabel, [], new Set<string>());
  const tablePaths = enumerateTablePaths(table, document.entryLabel, maxTraversal);
  const nodeIndexes = new Map(document.nodes.map((node, index) => [node.label, index]));
  const irPathSignatures = paths.map((path) => path.labels.map((label) => nodeIndexes.get(label)!));
  const normalize = (values: number[][]) => values.map((value) => JSON.stringify(value)).sort();
  if (JSON.stringify(normalize(irPathSignatures)) !== JSON.stringify(normalize(
    tablePaths.map((path) => path.rowIndexes)
  ))) {
    throw new Error('Compiled story table paths do not match Story IR paths');
  }
  return {
    rows: document.nodes.map((node) => ({
      label: node.label,
      type: node.type,
      speaker: node.speaker ?? '',
      content: node.content,
      commands: node.commands.map((command) => command.source),
      nextNodeId: node.next ?? '',
      choices: node.options.map((option) => ({
        text: option.text,
        targetNodeId: option.target,
        commands: option.commands.map((command) => command.source),
      })),
    })),
    table,
    paths,
    tablePaths,
  };

  function visit(label: string, labels: string[], trail: Set<string>): void {
    if (labels.length >= maxTraversal || trail.has(label)) {
      throw new Error(`Automatic cycle detected while building audit projection at ${label}`);
    }
    const node = nodesByLabel.get(label);
    if (!node) throw new Error(`Unresolved story target ${label}`);
    const nextLabels = [...labels, label];
    const nextTrail = new Set(trail).add(label);

    if (node.options.length > 0) {
      node.options.forEach((option) => visit(option.target, nextLabels, nextTrail));
      return;
    }
    if (node.next) {
      visit(node.next, nextLabels, nextTrail);
      return;
    }
    paths.push({ labels: nextLabels, terminalLabel: label });
  }
}

function enumerateTablePaths(
  table: CompiledStoryTable,
  entryLabel: string,
  maxTraversal: number
): StoryAuditProjectionTablePath[] {
  const labelIndex = table.columns.indexOf('Label');
  const commandsIndex = table.columns.indexOf('Commands');
  const labels = new Map<string, number>();
  table.rows.forEach((row, index) => {
    if (row[labelIndex]) labels.set(row[labelIndex], index);
  });
  const entryIndex = labels.get(entryLabel);
  if (entryIndex == null) throw new Error(`Compiled table entry ${entryLabel} is missing`);
  const optionNextIndexes = table.columns.flatMap((column, index) =>
    /^Option\d+_Next$/.test(column) ? [index] : []
  );
  const paths: StoryAuditProjectionTablePath[] = [];

  visit(entryIndex, [], new Set<number>());
  return paths;

  function visit(rowIndex: number, rowIndexes: number[], trail: Set<number>): void {
    if (rowIndexes.length >= maxTraversal || trail.has(rowIndex)) {
      throw new Error(`Compiled table cycle detected at row ${rowIndex + 1}`);
    }
    const row = table.rows[rowIndex];
    if (!row) throw new Error(`Compiled table target row ${rowIndex + 1} is missing`);
    const nextRows = [...rowIndexes, rowIndex];
    const nextTrail = new Set(trail).add(rowIndex);
    const optionTargets = optionNextIndexes.flatMap((index) => {
      const target = parseJump(row[index]);
      return target ? [target] : [];
    });
    if (optionTargets.length > 0) {
      optionTargets.forEach((target) => visit(resolveLabel(target), nextRows, nextTrail));
      return;
    }
    const controls = (row[commandsIndex] ?? '').split(';').map((value) => value.trim());
    const jump = controls.map(parseJump).find(Boolean);
    if (jump) {
      visit(resolveLabel(jump), nextRows, nextTrail);
      return;
    }
    if (controls.includes('End') || rowIndex === table.rows.length - 1) {
      paths.push({ rowIndexes: nextRows, terminalRowIndex: rowIndex });
      return;
    }
    visit(rowIndex + 1, nextRows, nextTrail);
  }

  function resolveLabel(label: string): number {
    const index = labels.get(label);
    if (index == null) throw new Error(`Compiled table target ${label} is missing`);
    return index;
  }
}

function parseJump(value: string): string {
  return /^Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})$/i.exec(value.trim())?.[1] ?? '';
}
