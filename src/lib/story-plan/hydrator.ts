import type { RoleMap } from '@/lib/script-parser';
import type { StoryCommand, StoryDocument, StoryOption } from '@/lib/story-ir/schema';
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

  return {
    version: 1,
    entryLabel: plan.entryNodeId,
    nodes: plan.nodes.map((node) => {
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
    }),
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
