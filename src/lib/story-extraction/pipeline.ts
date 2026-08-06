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

export function normalizeStoryContentExtractionContract(
  value: unknown
): StoryContentExtraction {
  const root = asRecord(value);
  const rawNodes = Array.isArray(root?.nodes) ? root.nodes : [];
  const rawChoices = Array.isArray(root?.choices) ? root.choices : [];
  const nodeIds = normalizeGeneratedIds(rawNodes, 'Node');
  const choiceIds = normalizeGeneratedIds(rawChoices, 'Choice');
  const dialogueTypes = new Map<string, 1 | 2>();

  const normalizedChoices = rawChoices.map((rawChoice, index) => {
    const choice = asRecord(rawChoice) ?? {};
    const rawText = typeof choice.text === 'string' ? choice.text : '';
    return {
      id: choiceIds[index],
      text: cleanChoiceDisplayText(rawText),
      sourceUnitIds: uniqueStrings(choice.sourceUnitIds),
    };
  });
  const choices: typeof normalizedChoices = [];
  for (const choice of normalizedChoices) {
    const textKey = normalizedVisibleValue(choice.text);
    const duplicate = choices.find((candidate) => (
      normalizedVisibleValue(candidate.text) === textKey
      && candidate.sourceUnitIds.some((unitId) => choice.sourceUnitIds.includes(unitId))
    ));
    if (!duplicate) {
      choices.push(choice);
      continue;
    }
    duplicate.sourceUnitIds = [...new Set([
      ...duplicate.sourceUnitIds,
      ...choice.sourceUnitIds,
    ])];
  }
  const choiceClaims = new Set(choices.flatMap((choice) => (
    choice.sourceUnitIds.map((unitId) => visibleClaimKey(unitId, choice.text))
  )));
  const normalizedNodes = rawNodes.map((rawNode, index) => {
      const node = asRecord(rawNode) ?? {};
      const speaker = typeof node.speaker === 'string' ? node.speaker : '';
      const type = normalizeContentNodeType(node.type, speaker);
      const numericPresentation = Number(node.presentationType);
      let presentationType: 1 | 2 | 3 | 4 | 5;
      if (type === 'dialogue') {
        const normalizedSpeaker = speaker.trim();
        const existing = dialogueTypes.get(normalizedSpeaker);
        const supplied = numericPresentation === 1 || numericPresentation === 2
          ? numericPresentation
          : undefined;
        presentationType = existing
          ?? supplied
          ?? (dialogueTypes.size === 0 ? 1 : 2);
        dialogueTypes.set(normalizedSpeaker, presentationType);
      } else if (
        numericPresentation === 3
        || numericPresentation === 4
        || numericPresentation === 5
      ) {
        presentationType = numericPresentation;
      } else {
        presentationType = type === 'scene' ? 4 : type === 'system' ? 5 : 3;
      }
      return {
        id: nodeIds[index],
        type,
        presentationType,
        speaker,
        content: typeof node.content === 'string' ? node.content : '',
        sourceUnitIds: uniqueStrings(node.sourceUnitIds),
      };
    });
  const nodes: typeof normalizedNodes = [];
  for (const normalizedNode of normalizedNodes) {
    const node = {
      ...normalizedNode,
      sourceUnitIds: normalizedNode.sourceUnitIds.filter((unitId) => (
        !choiceClaims.has(visibleClaimKey(unitId, normalizedNode.content))
      )),
    };
    if (node.sourceUnitIds.length === 0) continue;

    const contentKey = normalizedVisibleValue(node.content);
    const duplicate = nodes.find((candidate) => (
      normalizedVisibleValue(candidate.content) === contentKey
      && candidate.sourceUnitIds.some((unitId) => node.sourceUnitIds.includes(unitId))
    ));
    if (!duplicate) {
      nodes.push(node);
      continue;
    }
    duplicate.sourceUnitIds = [...new Set([
      ...duplicate.sourceUnitIds,
      ...node.sourceUnitIds,
    ])];
  }

  return parseStoryContentExtraction({
    version: 3,
    structuralUnitIds: uniqueStrings(root?.structuralUnitIds),
    nodes,
    choices,
  });
}

export function parseStoryGraphExtraction(value: unknown): StoryGraphExtraction {
  return StoryGraphExtractionSchema.parse(value);
}

export function normalizeStoryGraphExtractionContract(
  value: unknown,
  content?: StoryContentExtraction
): StoryGraphExtraction {
  const root = asRecord(value) ?? {};
  const parsed = parseStoryGraphExtraction({
    version: 3,
    entryNodeId: typeof root.entryNodeId === 'string' ? root.entryNodeId : '',
    nodeLinks: normalizeNodeLinks(root.nodeLinks),
    choiceLinks: normalizeChoiceLinks(root.choiceLinks),
    commandLinks: normalizeCommandLinks(root.commandLinks),
  });
  if (!content) return parsed;

  const existingNodeLinks = new Map(parsed.nodeLinks.map((link) => {
    const [nodeId] = link.split('->');
    return [nodeId, link] as const;
  }));
  const choiceOwners = new Set<string>();
  const choiceTargets = new Set<string>();
  parsed.choiceLinks.forEach((link) => {
    const [, owner, target] = link.split('->');
    choiceOwners.add(owner);
    choiceTargets.add(target);
  });
  const nodeLinks = content.nodes.map((node, index) => {
    const existing = existingNodeLinks.get(node.id);
    if (existing) return existing;
    if (choiceOwners.has(node.id) || choiceTargets.has(node.id)) return `${node.id}->`;
    const next = content.nodes[index + 1]?.id ?? '';
    return `${node.id}->${next}`;
  });
  return { ...parsed, nodeLinks };
}

function normalizeNodeLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const edge = asRecord(item);
    return edge && typeof edge.nodeId === 'string' && typeof edge.nextNodeId === 'string'
      ? [`${edge.nodeId}->${edge.nextNodeId}`]
      : [];
  });
}

function normalizeChoiceLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const edge = asRecord(item);
    return edge
      && typeof edge.choiceId === 'string'
      && typeof edge.fromNodeId === 'string'
      && typeof edge.targetNodeId === 'string'
      ? [`${edge.choiceId}->${edge.fromNodeId}->${edge.targetNodeId}`]
      : [];
  });
}

function normalizeCommandLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const edge = asRecord(item);
    return edge
      && typeof edge.commandId === 'string'
      && (edge.kind === 'node' || edge.kind === 'choice')
      && typeof edge.ownerId === 'string'
      ? [`${edge.commandId}->${edge.kind}->${edge.ownerId}`]
      : [];
  });
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function uniqueStrings(value: unknown): string[] {
  return [...new Set(stringArrayValue(value))];
}

function visibleClaimKey(unitId: string, value: string): string {
  return `${unitId}\u0000${normalizedVisibleValue(value)}`;
}

function normalizedVisibleValue(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s*)/, '')
    .replace(/[\s“”‘’"'【】()[\]（）:：,.!?;，。！？、\-—_]/g, '')
    .toLowerCase();
}

function cleanChoiceDisplayText(value: string): string {
  const text = value.trim();
  const labeled = /^(?:(?:\u5d4c\u5957|\u5b50)?\u9009\u62e9|\u53ef\u9009\u65b9\u6848|\u9009\u9879|option)\s*[A-Za-z0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24]+\s*(?:[：:]\s*(.+)|[（(]([^）)]+)[）)])/iu.exec(text);
  if (labeled) return (labeled[1] ?? labeled[2] ?? text).trim();
  const coded = /^[A-Za-z]\d*\s*[：:]\s*(.+)$/u.exec(text);
  return (coded?.[1] ?? text).trim();
}

function normalizeGeneratedIds(values: unknown[], prefix: 'Node' | 'Choice'): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const supplied = asRecord(value)?.id;
    let id = typeof supplied === 'string' && LABEL_PATTERN.test(supplied) && !used.has(supplied)
      ? supplied
      : `${prefix}${index + 1}`;
    while (used.has(id)) id = `${prefix}${index + 1}_${used.size + 1}`;
    used.add(id);
    return id;
  });
}

function normalizeContentNodeType(
  value: unknown,
  speaker: string
): StoryContentExtraction['nodes'][number]['type'] {
  if (value === 'dialogue' || value === 'narration' || value === 'scene' || value === 'system') {
    return value;
  }
  if (value === 'scene_heading' || value === 'background' || value === 'prose') return 'scene';
  if (value === 'action' || value === 'stage_direction') return 'narration';
  return speaker.trim() ? 'dialogue' : 'narration';
}
