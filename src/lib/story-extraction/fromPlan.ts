import type { StoryRelationshipPlan } from '@/lib/story-plan/schema';
import type { SegmentedStorySource, SourceSegment } from '@/lib/story-plan/sourceSegments';
import type { StoryExtraction } from './schema';

export function buildStoryExtractionFromPlan(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource
): StoryExtraction {
  const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));
  const commandsById = new Map(source.commands.map((command) => [command.id, command]));
  const dialogueTypes = new Map<string, 1 | 2>();

  const nodes = plan.nodes.map((node) => {
    const speakerSegments = node.speakerSegmentId
      ? [requireSegment(node.speakerSegmentId)]
      : [];
    const contentSegments = sortedSegments(node.contentSegmentIds);
    const speaker = speakerSegments[0]?.text ?? '';
    return {
      id: node.id,
      type: node.type,
      presentationType: inferPresentationType(node.type, speaker),
      speaker,
      content: contentSegments.map((segment) => segment.text).join('\n'),
      sourceUnitIds: unitIds([...speakerSegments, ...contentSegments]),
      commandSources: node.commandIds.map((commandId) => requireCommand(commandId).source),
      nextNodeId: node.nextNodeId,
    };
  });

  const choices = plan.choices.map((choice) => {
    const textSegments = sortedSegments(choice.textSegmentIds);
    return {
      id: choice.id,
      fromNodeId: choice.fromNodeId,
      text: textSegments.map((segment) => segment.text).join('\n'),
      targetNodeId: choice.targetNodeId,
      sourceUnitIds: unitIds(textSegments),
      commandSources: choice.commandIds.map((commandId) => requireCommand(commandId).source),
    };
  });

  const visibleUnitIds = new Set([
    ...nodes.flatMap((node) => node.sourceUnitIds),
    ...choices.flatMap((choice) => choice.sourceUnitIds),
  ]);

  return {
    version: 3,
    entryNodeId: plan.entryNodeId,
    structuralUnitIds: source.units
      .map((unit) => unit.id)
      .filter((unitId) => !visibleUnitIds.has(unitId)),
    nodes,
    choices,
  };

  function requireSegment(segmentId: string): SourceSegment {
    const segment = segmentsById.get(segmentId);
    if (!segment) throw new Error(`Unknown source segment ${segmentId}`);
    return segment;
  }

  function sortedSegments(segmentIds: string[]): SourceSegment[] {
    return segmentIds
      .map(requireSegment)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function requireCommand(commandId: string) {
    const command = commandsById.get(commandId);
    if (!command) throw new Error(`Unknown source command ${commandId}`);
    return command;
  }

  function inferPresentationType(
    type: StoryExtraction['nodes'][number]['type'],
    speaker: string
  ): 1 | 2 | 3 | 4 | 5 {
    if (type === 'dialogue') {
      const existing = dialogueTypes.get(speaker);
      if (existing) return existing;
      const assigned = dialogueTypes.size === 0 ? 1 : 2;
      dialogueTypes.set(speaker, assigned);
      return assigned;
    }
    if (type === 'scene') return 4;
    if (type === 'system') return 5;
    return 3;
  }
}

function unitIds(segments: SourceSegment[]): string[] {
  return [...new Set(segments.map((segment) => segment.unitId))];
}
