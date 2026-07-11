import type { RoleMap } from '@/lib/script-parser';
import type {
  StoryCommand,
  StoryDocument,
  StoryNode,
  StoryOption,
} from '@/lib/story-ir/schema';
import type { StoryRelationshipPlan } from './schema';
import {
  sourceRefsForSegmentIds,
  type SegmentedStorySource,
  type SourceCommand,
  type SourceSegment,
} from './sourceSegments';

export function hydrateStoryDocument(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource,
  roleMap: RoleMap = {}
): StoryDocument {
  const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));
  const commandsById = new Map(source.commands.map((command) => [command.id, command]));
  const choicesByNode = new Map<string, StoryRelationshipPlan['choices']>();

  for (const choice of plan.choices) {
    const choices = choicesByNode.get(choice.fromNodeId) ?? [];
    choices.push(choice);
    choicesByNode.set(choice.fromNodeId, choices);
  }

  const nodes: StoryNode[] = plan.nodes.map((node) => {
    const speakerSegment = node.speakerSegmentId
      ? requireSegment(node.speakerSegmentId, segmentsById)
      : undefined;
    const contentSegments = sortedSegments(node.contentSegmentIds, segmentsById);
    const sourceSegmentIds = [
      ...(speakerSegment ? [speakerSegment.id] : []),
      ...contentSegments.map((segment) => segment.id),
    ];
    return {
        label: node.id,
        type: node.type,
        ...(speakerSegment ? {
          speaker: roleMap[speakerSegment.text]?.id ?? speakerSegment.text,
        } : {}),
        content: contentSegments.map((segment) => segment.text).join('\n'),
        commands: node.commandIds.map((commandId) => hydrateCommand(
          requireCommand(commandId, commandsById),
          source
        )),
        ...(node.nextNodeId ? { next: node.nextNodeId } : {}),
        options: (choicesByNode.get(node.id) ?? []).map((choice): StoryOption => {
          const textSegments = sortedSegments(choice.textSegmentIds, segmentsById);
          return {
            text: textSegments.map((segment) => segment.text).join('\n'),
            target: choice.targetNodeId,
            commands: choice.commandIds.map((commandId) => hydrateCommand(
              requireCommand(commandId, commandsById),
              source
            )),
            sourceRefs: sourceRefsForSegmentIds(source, textSegments.map((segment) => segment.id)),
          };
        }),
        sourceRefs: sourceRefsForSegmentIds(source, sourceSegmentIds),
    };
  });
  const terminalNodes = nodes.filter((node) =>
    !node.next && node.options.length === 0
  );
  const needsSharedTerminal = terminalNodes.length > 1 ||
    terminalNodes.some((node) => nodes.indexOf(node) !== nodes.length - 1);

  if (needsSharedTerminal) {
    const label = uniqueTerminalLabel(new Set(nodes.map((node) => node.label)));
    const sourceRefs = terminalNodes.flatMap((node) => node.sourceRefs)
      .filter((ref, index, refs) => refs.findIndex((candidate) => candidate.unitId === ref.unitId) === index);
    terminalNodes.forEach((node) => {
      node.next = label;
    });
    nodes.push({
      label,
      type: 'system',
      content: '',
      commands: [],
      options: [],
      sourceRefs,
      structuralRepair: {
        kind: 'generated_label',
        reason: 'Prevent independent endings from falling through into sibling branches',
        sourceRefs,
      },
    });
  }

  return {
    version: 1,
    entryLabel: plan.entryNodeId,
    nodes,
  };
}

function hydrateCommand(command: SourceCommand, source: SegmentedStorySource): StoryCommand {
  return {
    source: command.source,
    variable: command.variable,
    operator: command.operator,
    value: command.value,
    sourceRefs: sourceRefsForSegmentIds(source, [command.segmentId]),
  };
}

function requireSegment(
  segmentId: string,
  segmentsById: Map<string, SourceSegment>
): SourceSegment {
  const segment = segmentsById.get(segmentId);
  if (!segment) throw new Error(`Unknown source segment ${segmentId}`);
  return segment;
}

function requireCommand(
  commandId: string,
  commandsById: Map<string, SourceCommand>
): SourceCommand {
  const command = commandsById.get(commandId);
  if (!command) throw new Error(`Unknown source command ${commandId}`);
  return command;
}

function sortedSegments(
  segmentIds: string[],
  segmentsById: Map<string, SourceSegment>
): SourceSegment[] {
  return segmentIds
    .map((segmentId) => requireSegment(segmentId, segmentsById))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function uniqueTerminalLabel(usedLabels: Set<string>): string {
  let label = 'StoryEnd';
  let index = 2;
  while (usedLabels.has(label)) label = `StoryEnd${index++}`;
  return label;
}
