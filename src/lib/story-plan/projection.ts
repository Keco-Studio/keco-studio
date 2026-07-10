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

export interface StoryAuditProjection {
  rows: StoryAuditProjectionRow[];
  table: CompiledStoryTable;
  paths: StoryAuditProjectionPath[];
}

export function buildStoryAuditProjection(document: StoryDocument): StoryAuditProjection {
  const nodesByLabel = new Map(document.nodes.map((node) => [node.label, node]));
  const paths: StoryAuditProjectionPath[] = [];
  const maxTraversal = Math.max(1, document.nodes.length * 4);

  visit(document.entryLabel, [], new Set<string>());
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
    table: compileStoryTable(document),
    paths,
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
