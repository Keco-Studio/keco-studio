import { z } from 'zod';
import { LABEL_PATTERN } from '@/lib/story-ir/schema';
import { parseStoryExtraction, type StoryExtraction } from './schema';

const IdSchema = z.string().regex(LABEL_PATTERN);
const UnitIdsSchema = z.array(z.string().min(1));

const ContentNodeSchema = z.object({
  id: IdSchema,
  type: z.enum(['dialogue', 'narration', 'scene', 'system']),
  presentationType: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]),
  speaker: z.string(),
  content: z.string(),
  sourceUnitIds: UnitIdsSchema,
}).strict().superRefine((node, context) => {
  if ((node.presentationType === 1 || node.presentationType === 2) && node.type !== 'dialogue') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Dialogue presentation Type requires a dialogue node' });
  }
  if (node.type === 'dialogue' && node.presentationType !== 1 && node.presentationType !== 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Dialogue nodes require presentation Type 1 or 2' });
  }
});

const ContentChoiceSchema = z.object({
  id: IdSchema,
  text: z.string().min(1),
  sourceUnitIds: UnitIdsSchema,
}).strict();

const StoryContentExtractionSchema = z.object({
  version: z.literal(3),
  structuralUnitIds: UnitIdsSchema,
  nodes: z.array(ContentNodeSchema).min(1),
  choices: z.array(ContentChoiceSchema),
}).strict();

const StoryGraphExtractionSchema = z.object({
  version: z.literal(3),
  entryNodeId: IdSchema,
  nodeLinks: z.array(z.string().min(3)),
  choiceLinks: z.array(z.string().min(5)),
  commandLinks: z.array(z.string().min(7)),
}).strict().superRefine((graph, context) => {
  graph.nodeLinks.forEach((link, index) => {
    if (!parseNodeLink(link)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodeLinks', index], message: 'Invalid story node link' });
    }
  });
  graph.choiceLinks.forEach((link, index) => {
    if (!parseChoiceLink(link)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['choiceLinks', index], message: 'Invalid story choice link' });
    }
  });
  graph.commandLinks.forEach((link, index) => {
    if (!parseCommandLink(link)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['commandLinks', index], message: 'Invalid story command link' });
    }
  });
});

export type StoryContentExtraction = z.infer<typeof StoryContentExtractionSchema>;
export type StoryGraphExtraction = z.infer<typeof StoryGraphExtractionSchema>;

export function parseStoryContentExtraction(value: unknown): StoryContentExtraction {
  return StoryContentExtractionSchema.parse(value);
}

export function parseStoryGraphExtraction(value: unknown): StoryGraphExtraction {
  return StoryGraphExtractionSchema.parse(value);
}

export function combineStoryExtraction(
  content: StoryContentExtraction,
  graph: StoryGraphExtraction
): StoryExtraction {
  const nodeIds = content.nodes.map((node) => node.id);
  const choiceIds = content.choices.map((choice) => choice.id);
  const nodeLinks = graph.nodeLinks.map((link) => parseNodeLink(link)!);
  const choiceLinks = graph.choiceLinks.map((link) => parseChoiceLink(link)!);
  const commandLinks = graph.commandLinks.map((link) => parseCommandLink(link)!);
  assertExactEdges('node', nodeIds, nodeLinks.map((edge) => edge.nodeId));
  assertExactEdges('choice', choiceIds, choiceLinks.map((edge) => edge.choiceId));
  const knownNodes = new Set(nodeIds);
  const choiceOwnerIds = new Set(choiceLinks.map((edge) => edge.fromNodeId));
  if (!knownNodes.has(graph.entryNodeId)) {
    throw new Error(`Story graph entry references unknown node ${graph.entryNodeId}`);
  }
  for (const edge of nodeLinks) {
    if (edge.nextNodeId && !choiceOwnerIds.has(edge.nodeId) && !knownNodes.has(edge.nextNodeId)) {
      throw new Error(`Story graph references unknown node ${edge.nextNodeId}`);
    }
  }
  for (const edge of choiceLinks) {
    if (!knownNodes.has(edge.fromNodeId) || !knownNodes.has(edge.targetNodeId)) {
      throw new Error('Story choice graph references an unknown node');
    }
  }

  const nodeEdges = new Map(nodeLinks.map((edge) => [
    edge.nodeId,
    choiceOwnerIds.has(edge.nodeId) ? '' : edge.nextNodeId,
  ]));
  const choiceEdges = new Map(choiceLinks.map((edge) => [edge.choiceId, edge]));
  const nodeCommandIds = new Map<string, string[]>();
  const choiceCommandIds = new Map<string, string[]>();
  commandLinks.forEach((link) => {
    const owners = link.kind === 'node' ? nodeCommandIds : choiceCommandIds;
    const knownOwners = link.kind === 'node' ? knownNodes : new Set(choiceIds);
    if (!knownOwners.has(link.ownerId)) {
      throw new Error(`Story command references unknown ${link.kind} ${link.ownerId}`);
    }
    const unitIds = owners.get(link.ownerId) ?? [];
    unitIds.push(link.commandId);
    owners.set(link.ownerId, unitIds);
  });
  return parseStoryExtraction({
    version: 3,
    entryNodeId: graph.entryNodeId,
    structuralUnitIds: content.structuralUnitIds,
    nodes: content.nodes.map((node) => ({
      ...node,
      sourceUnitIds: node.sourceUnitIds,
      commandSources: nodeCommandIds.get(node.id) ?? [],
      nextNodeId: nodeEdges.get(node.id) ?? '',
    })),
    choices: content.choices.map((choice) => {
      const edge = choiceEdges.get(choice.id)!;
      return {
        ...choice,
        sourceUnitIds: choice.sourceUnitIds,
        commandSources: choiceCommandIds.get(choice.id) ?? [],
        fromNodeId: edge.fromNodeId,
        targetNodeId: edge.targetNodeId,
      };
    }),
  });
}

function parseNodeLink(link: string): { nodeId: string; nextNodeId: string } | null {
  const parts = link.split('->');
  if (parts.length !== 2 || !LABEL_PATTERN.test(parts[0])) return null;
  if (parts[1] && !LABEL_PATTERN.test(parts[1])) return null;
  return { nodeId: parts[0], nextNodeId: parts[1] };
}

function parseChoiceLink(link: string): {
  choiceId: string;
  fromNodeId: string;
  targetNodeId: string;
} | null {
  const parts = link.split('->');
  if (parts.length !== 3 || parts.some((part) => !LABEL_PATTERN.test(part))) return null;
  return { choiceId: parts[0], fromNodeId: parts[1], targetNodeId: parts[2] };
}

function parseCommandLink(link: string): {
  commandId: string;
  kind: 'node' | 'choice';
  ownerId: string;
} | null {
  const parts = link.split('->');
  if (
    parts.length !== 3
    || !parts[0]
    || (parts[1] !== 'node' && parts[1] !== 'choice')
    || !LABEL_PATTERN.test(parts[2])
  ) return null;
  return { commandId: parts[0], kind: parts[1], ownerId: parts[2] };
}

function assertExactEdges(kind: 'node' | 'choice', expectedIds: string[], actualIds: string[]): void {
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  if (
    expected.size !== expectedIds.length
    || actual.size !== actualIds.length
    || expected.size !== actual.size
    || expectedIds.some((id) => !actual.has(id))
    || actualIds.some((id) => !expected.has(id))
  ) {
    throw new Error(`Story ${kind} edges do not match extracted ${kind} IDs`);
  }
}
