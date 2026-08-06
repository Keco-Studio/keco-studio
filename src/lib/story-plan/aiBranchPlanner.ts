import { z } from 'zod';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryRelationshipPlan } from './schema';
import {
  materializeStoryRelationshipPlan,
  type StoryPlanInventory,
} from './inventory';
import {
  buildHierarchicalStoryPlanInventory,
  isExplicitMergeBoundary,
} from './explicitParser';
import type {
  SegmentedStorySource,
  SourceSegment,
} from './sourceSegments';
import type { StoryPlotEdge, StoryPlotPlan } from '@/lib/story-plot/schema';
import { validateStoryPlotPlan } from '@/lib/story-plot/validator';

const UnitIdSchema = z.string().min(1);

const AiBranchChoiceSchema = z.object({
  sourceUnitId: UnitIdSchema,
  text: z.string().min(1),
  fromUnitId: UnitIdSchema,
  targetUnitId: UnitIdSchema,
}).strict();

const AiBranchDecisionSchema = z.object({
  ownerUnitId: UnitIdSchema,
  mergeUnitId: UnitIdSchema.nullable(),
  options: z.array(z.object({
    sourceUnitId: UnitIdSchema,
    text: z.string().min(1),
    routeUnitIds: z.array(UnitIdSchema),
    nextUnitId: UnitIdSchema.nullable().optional(),
  }).strict()).min(1),
}).strict();

const AiPlotGroupSchema = z.object({
  title: z.string().trim().min(1),
  sourceUnitIds: z.array(UnitIdSchema).min(1),
}).strict();

const AiBranchStructureSchema = z.object({
  version: z.literal(2),
  structuralUnitIds: z.array(UnitIdSchema),
  sharedReplayUnitIds: z.array(UnitIdSchema).default([]),
  decisions: z.array(AiBranchDecisionSchema),
  plotGroups: z.array(AiPlotGroupSchema).optional(),
  // Legacy fields remain canonicalized for cached repair candidates and tests.
  choices: z.array(AiBranchChoiceSchema),
  jumps: z.array(z.object({
    fromUnitId: UnitIdSchema,
    targetUnitId: UnitIdSchema,
  }).strict()),
  breakAfterUnitIds: z.array(UnitIdSchema),
}).strict();

export type AiBranchStructure = z.infer<typeof AiBranchStructureSchema>;

export const AI_BRANCH_STRUCTURE_PROMPT = `You are the Branch Structure Planner for a screenplay.
Call submit_branch_structure exactly once and return no prose.
Use semantic judgment, not naming conventions or regex assumptions. The source may describe choices and nested branches in arbitrary language.

Return grouped branch ownership, not a flat list of guessed jumps:
- structuralUnitIds: pure choice prompts, branch labels, branch-container act/scene headings (for example "\u7b2c\u4e8c\u5e55：\u4e24\u79cd\u9009\u62e9"), merge labels, and formatting rows with no visible story content. An opening act/scene heading that establishes the playable setting remains visible unless it is explicitly only a container label.
- sharedReplayUnitIds: only source units that are genuinely shared setup played once on multiple history-specific routes before those routes diverge again. Every unit repeated across options[].routeUnitIds must be listed here. Never list branch-exclusive dialogue from one sibling merely because another route should reach a similar beat.
- decisions: one object per real player decision. Put every sibling option in the same decision object.
- ownerUnitId: the visible prompt/content row that owns all options in that decision.
- options[].sourceUnitId and text: the option row and an exact contiguous option substring.
- options[].routeUnitIds: every visible story unit exclusive to that option, in playback order. Include discontiguous later continuations such as "\u6765\u81ea\u5206\u652f A". Do not include sibling content or shared merge content.
- options[].nextUnitId: the first visible unit played after that option's exclusive route. Set it independently for every option because siblings may lead to different endings or one option may rejoin another branch. Use null only when the option terminates or its route ends at a nested decision owner.
- mergeUnitId: the first visible unit shared by all sibling options after their exclusive routes, or null when the routes terminate separately.
- breakAfterUnitIds: every truly terminal visible unit. A row titled "\u7ed3\u5c40" is not terminal when a later act explicitly continues, converges, or provides a history-specific epilogue for that route; keep such an ending row inside its route. Independent final endings must never automatically link to the next ending in source order.
- plotGroups: group visible source units into playback-level plot nodes and provide a concise title for every group. Cover every visible story unit exactly once; do not include choice-only or structural units.

The user input may include branchPartHints derived from explicit headings such as "\u5206\u652f A（...）" and "\u6765\u81ea\u5206\u652f B...". Treat those unit lists as hard ownership evidence: an A option route must never contain a unit owned by part B, including later history-specific continuations.

When a source unit includes explicitChoiceTexts, it is a server-recognized player option. Use those exact texts as options and never invent an option from dialogue while explicitChoiceTexts are present. Units labeled \u5206\u652f\u9009\u62e9\u4e00/\u4e8c/\u4e09 are sibling options of one decision even when each option's route prose is written between the markers.
All unit IDs must come from sourceUnits. Choice rows are not visible story content and must not also be structural. Branch-body labels such as "\u5206\u652f A（\u4e70\u82b1）" are structural, not decisions. Ending markers and ending summaries are visible story content; never put them in structuralUnitIds.
When alternatives are listed together, emit them inside the same decision object. Never split sibling options across decisions and never emit only the last option. Never let one sibling route contain another sibling's target, body, ending, or later branch-specific continuation.
If shared setup prose appears before later "\u6765\u81ea\u5206\u652f A" / "\u6765\u81ea\u5206\u652f B" variants, preserve playback order by repeating the shared setup unit IDs inside every affected option's routeUnitIds before its history-specific continuation. Repeating the same source unit across sibling routes explicitly authorizes the server to replay that exact source content once per path. Set mergeUnitId and nextUnitId to the first truly shared unit after all history-specific variants, never to the earlier shared setup.
Concrete pattern: u0="\u4e70\u4e0d\u4e70？", u1="\u9009\u62e9 A：\u4e70。", u2="\u4e70\u82b1\u6b63\u6587", u3="\u9009\u62e9 B：\u4e0d\u4e70。", u4="\u4e0d\u4e70\u6b63\u6587" becomes one decision with ownerUnitId=u0, option A routeUnitIds=[u2] and nextUnitId=null, option B routeUnitIds=[u4] and nextUnitId=null, mergeUnitId=null, and breakAfterUnitIds=[u2,u4]. Do not make u1 or u3 visible nodes.
On a retry, previousStructureCandidate is the last parseable structure. Preserve its valid choices and transitions, and change only the relationships required to resolve validationIssues. Do not recreate unrelated branches.
Follow each validationIssues[].repairHint exactly. A route unit cannot be both terminal in breakAfterUnitIds and continue through options[].nextUnitId or its decision mergeUnitId.
Before returning, verify that branch-exclusive route units belong to exactly one sibling. Sibling routeUnitIds may overlap only for shared setup that must replay before later history-specific continuations.`;

const nonEmptyString = { type: 'string', minLength: 1 };

export const AI_BRANCH_STRUCTURE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_branch_structure',
    description: 'Submit source-unit-level player choices and non-sequential branch transitions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [2] },
        structuralUnitIds: { type: 'array', items: nonEmptyString },
        sharedReplayUnitIds: { type: 'array', items: nonEmptyString },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ownerUnitId: nonEmptyString,
              mergeUnitId: { anyOf: [nonEmptyString, { type: 'null' }] },
              options: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    sourceUnitId: nonEmptyString,
                    text: nonEmptyString,
                    routeUnitIds: {
                      type: 'array',
                      items: nonEmptyString,
                    },
                    nextUnitId: { anyOf: [nonEmptyString, { type: 'null' }] },
                  },
                  required: ['sourceUnitId', 'text', 'routeUnitIds', 'nextUnitId'],
                },
              },
            },
            required: ['ownerUnitId', 'mergeUnitId', 'options'],
          },
        },
        plotGroups: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: nonEmptyString,
              sourceUnitIds: { type: 'array', minItems: 1, items: nonEmptyString },
            },
            required: ['title', 'sourceUnitIds'],
          },
        },
        breakAfterUnitIds: { type: 'array', items: nonEmptyString },
      },
      required: [
        'version', 'structuralUnitIds', 'sharedReplayUnitIds', 'decisions',
        'plotGroups', 'breakAfterUnitIds',
      ],
    },
  },
};

const AiBranchPatchOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_route_unit'), optionRef: UnitIdSchema, unitId: UnitIdSchema }).strict(),
  z.object({ action: z.literal('remove_route_unit'), optionRef: UnitIdSchema, unitId: UnitIdSchema }).strict(),
  z.object({ action: z.literal('set_next'), optionRef: UnitIdSchema, targetUnitId: UnitIdSchema.nullable() }).strict(),
  z.object({ action: z.literal('set_merge'), decisionOwnerUnitId: UnitIdSchema, targetUnitId: UnitIdSchema.nullable() }).strict(),
  z.object({ action: z.enum(['add_break', 'remove_break']), unitId: UnitIdSchema }).strict(),
  z.object({ action: z.literal('set_structural'), unitId: UnitIdSchema, structural: z.boolean() }).strict(),
]);

const AiBranchPatchSchema = z.object({
  operations: z.array(AiBranchPatchOperationSchema).min(1),
}).strict();

export type AiBranchPatch = z.infer<typeof AiBranchPatchSchema>;

function branchPatchTool(optionRef: Record<string, unknown>): OpenAITool {
  return {
  type: 'function',
  function: {
    name: 'submit_branch_patch',
    description: 'Repair only the reported relationships in a previous branch structure.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          items: {
            anyOf: [
              ...['add_route_unit', 'remove_route_unit'].map((action) => ({
                type: 'object', additionalProperties: false,
                properties: { action: { type: 'string', enum: [action] }, optionRef, unitId: nonEmptyString },
                required: ['action', 'optionRef', 'unitId'],
              })),
              { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['set_next'] }, optionRef, targetUnitId: { anyOf: [nonEmptyString, { type: 'null' }] } }, required: ['action', 'optionRef', 'targetUnitId'] },
              { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['set_merge'] }, decisionOwnerUnitId: nonEmptyString, targetUnitId: { anyOf: [nonEmptyString, { type: 'null' }] } }, required: ['action', 'decisionOwnerUnitId', 'targetUnitId'] },
              { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['add_break', 'remove_break'] }, unitId: nonEmptyString }, required: ['action', 'unitId'] },
              { type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['set_structural'] }, unitId: nonEmptyString, structural: { type: 'boolean' } }, required: ['action', 'unitId', 'structural'] },
            ],
          },
        },
      },
      required: ['operations'],
    },
  },
  };
}

export const AI_BRANCH_PATCH_TOOL: OpenAITool = branchPatchTool(nonEmptyString);

export function buildAiBranchPatchTool(candidate: AiBranchStructure): OpenAITool {
  const optionRefs = candidate.decisions.flatMap((decision, decisionIndex) => (
    decision.options.map((_, optionIndex) => `o${decisionIndex}.${optionIndex}`)
  ));
  return branchPatchTool({ type: 'string', enum: optionRefs });
}

const AI_BRANCH_PATCH_PROMPT = `Repair the previous branch structure using submit_branch_patch exactly once.
Return patch operations only, never a replacement graph. Refer to an option only by its exact patchOptionRef; a source unit can contain multiple distinct options. Change only units named in validationIssues or their direct continuation. Preserve every unrelated decision, option, route, merge, break, and structural classification. Follow every validationIssues[].repairHint exactly. For an unreachable visible unit, use its neighboring visible units and current route claims to add it to the semantically matching option in playback order. Never attach it through a sibling route.`;

export function parseAiBranchPatch(value: unknown): AiBranchPatch {
  return AiBranchPatchSchema.parse(value);
}

export function parseAiBranchPatchForSource(
  value: unknown,
  source: SegmentedStorySource
): AiBranchPatch {
  const patch = parseAiBranchPatch(value);
  const { aliasToReal } = branchUnitAliasMaps(source);
  const unitId = (id: string) => aliasToReal.get(id) ?? id;
  return {
    operations: patch.operations.map((operation) => {
      if (operation.action === 'add_route_unit' || operation.action === 'remove_route_unit') {
        return { ...operation, unitId: unitId(operation.unitId) };
      }
      if (operation.action === 'set_next') {
        return { ...operation, targetUnitId: operation.targetUnitId ? unitId(operation.targetUnitId) : null };
      }
      if (operation.action === 'set_merge') {
        return { ...operation, decisionOwnerUnitId: unitId(operation.decisionOwnerUnitId), targetUnitId: operation.targetUnitId ? unitId(operation.targetUnitId) : null };
      }
      return { ...operation, unitId: unitId(operation.unitId) };
    }),
  };
}

export function buildAiBranchPatchMessages(
  source: SegmentedStorySource,
  issues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }>,
  candidate: AiBranchStructure
): ChatMessage[] {
  const { realToAlias } = branchUnitAliasMaps(source);
  const alias = (unitId: string) => realToAlias.get(unitId) ?? unitId;
  const visible = new Set(source.segments.filter((segment) => segment.display).map((segment) => segment.unitId));
  const visibleUnits = source.units.filter((unit) => visible.has(unit.id));
  const visibleIndex = new Map(visibleUnits.map((unit, index) => [unit.id, index]));
  const claims = new Map<string, string[]>();
  candidate.decisions.forEach((decision) => decision.options.forEach((option) => {
    option.routeUnitIds.forEach((unitId) => claims.set(unitId, [
      ...(claims.get(unitId) ?? []), option.sourceUnitId,
    ]));
  }));
  const affectedIds = [...new Set(issues.flatMap((issue) => issue.unitIds ?? []))];
  const candidateView = mapAiBranchStructureUnitIds(candidate, alias);
  const patchDecisions = candidateView.decisions.map((decision, decisionIndex) => ({
    ...decision,
    options: decision.options.map((option, optionIndex) => ({
      ...option,
      patchOptionRef: `o${decisionIndex}.${optionIndex}`,
    })),
  }));
  const neighbor = (unitId: string, offset: number) => {
    const index = visibleIndex.get(unitId);
    const unit = index === undefined ? undefined : visibleUnits[index + offset];
    return unit ? { id: alias(unit.id), text: unit.text } : null;
  };
  return [
    { role: 'system', content: AI_BRANCH_PATCH_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'REPAIR_BRANCH_STRUCTURE_WITH_PATCH',
      validationIssues: issues.map((issue) => ({
        ...issue,
        unitIds: (issue.unitIds ?? []).map(alias),
        repairHint: validationIssueRepairHint(
          issue.message ?? '',
          (issue.unitIds ?? []).map(alias)
        ),
      })),
      affectedUnits: affectedIds.flatMap((unitId) => {
        const unit = source.units.find((candidateUnit) => candidateUnit.id === unitId);
        if (!unit) return [];
        return [{
          id: alias(unitId), text: unit.text,
          visible: visible.has(unitId),
          ending: isExplicitEndingSourceUnit(unit.text),
          structural: candidate.structuralUnitIds.includes(unitId),
          currentOptionSourceUnitIds: (claims.get(unitId) ?? []).map(alias),
          previousVisible: neighbor(unitId, -1),
          nextVisible: neighbor(unitId, 1),
        }];
      }),
      nearbyDecisions: patchDecisions,
      previousStructureCandidate: { ...candidateView, decisions: patchDecisions },
    }) },
  ];
}

export function applyAiBranchPatch(
  candidate: AiBranchStructure,
  patch: AiBranchPatch,
  source: SegmentedStorySource,
  issues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }>
): AiBranchStructure {
  const known = new Set(source.units.map((unit) => unit.id));
  const affected = new Set(issues.flatMap((issue) => issue.unitIds ?? []));
  const repaired: AiBranchStructure = {
    ...candidate,
    structuralUnitIds: [...candidate.structuralUnitIds],
    breakAfterUnitIds: [...candidate.breakAfterUnitIds],
    decisions: candidate.decisions.map((decision) => ({
      ...decision,
      options: decision.options.map((option) => ({ ...option, routeUnitIds: [...option.routeUnitIds] })),
    })),
  };
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const option = (optionRef: string) => {
    const match = /^o(\d+)\.(\d+)$/.exec(optionRef);
    const item = match
      ? repaired.decisions[Number(match[1])]?.options[Number(match[2])]
      : undefined;
    if (!item) throw new Error(`Branch patch option ${optionRef} is unknown`);
    return item;
  };
  const decision = (ownerUnitId: string) => {
    const matches = repaired.decisions.filter((item) => item.ownerUnitId === ownerUnitId);
    if (matches.length !== 1) throw new Error(`Branch patch decision ${ownerUnitId} is unknown or ambiguous`);
    return matches[0];
  };
  const requireAffected = (unitId: string | null) => {
    if (unitId && (!known.has(unitId) || !affected.has(unitId))) {
      throw new Error(`Branch patch unit ${unitId} is unknown or unrelated to validation issues`);
    }
  };
  const operationKeys = new Set<string>();
  const relationshipKeys = new Set<string>();
  for (const operation of patch.operations) {
    const key = JSON.stringify(operation);
    if (operationKeys.has(key)) throw new Error('Branch patch operations must be unique');
    operationKeys.add(key);
    const relationshipKey = operation.action === 'add_route_unit' || operation.action === 'remove_route_unit'
      ? `route:${operation.optionRef}:${operation.unitId}`
      : operation.action === 'set_next'
        ? `next:${operation.optionRef}`
        : operation.action === 'set_merge'
          ? `merge:${operation.decisionOwnerUnitId}`
          : operation.action === 'add_break' || operation.action === 'remove_break'
            ? `break:${operation.unitId}`
            : `structural:${operation.unitId}`;
    if (relationshipKeys.has(relationshipKey)) {
      throw new Error(`Branch patch has conflicting operations for ${relationshipKey}`);
    }
    relationshipKeys.add(relationshipKey);
    if (operation.action === 'add_route_unit' || operation.action === 'remove_route_unit') {
      requireAffected(operation.unitId);
      const target = option(operation.optionRef);
      target.routeUnitIds = operation.action === 'add_route_unit'
        ? [...new Set([...target.routeUnitIds, operation.unitId])].sort((left, right) => (unitIndex.get(left)! - unitIndex.get(right)!))
        : target.routeUnitIds.filter((unitId) => unitId !== operation.unitId);
    } else if (operation.action === 'set_next') {
      requireAffected(operation.targetUnitId);
      option(operation.optionRef).nextUnitId = operation.targetUnitId;
    } else if (operation.action === 'set_merge') {
      requireAffected(operation.targetUnitId);
      decision(operation.decisionOwnerUnitId).mergeUnitId = operation.targetUnitId;
    } else if (operation.action === 'add_break' || operation.action === 'remove_break') {
      requireAffected(operation.unitId);
      repaired.breakAfterUnitIds = operation.action === 'add_break'
        ? [...new Set([...repaired.breakAfterUnitIds, operation.unitId])]
        : repaired.breakAfterUnitIds.filter((unitId) => unitId !== operation.unitId);
    } else if (operation.action === 'set_structural') {
      requireAffected(operation.unitId);
      repaired.structuralUnitIds = operation.structural
        ? [...new Set([...repaired.structuralUnitIds, operation.unitId])]
        : repaired.structuralUnitIds.filter((unitId) => unitId !== operation.unitId);
    } else {
      throw new Error('Unsupported branch patch operation');
    }
  }
  return repaired;
}

export function buildAiBranchStructureMessages(
  source: SegmentedStorySource,
  validationIssues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }> = [],
  previousStructureCandidate?: AiBranchStructure
): ChatMessage[] {
  const { realToAlias } = branchUnitAliasMaps(source);
  const alias = (unitId: string): string => realToAlias.get(unitId) ?? unitId;
  const branchPartHints = collectExplicitBranchPartHints(source);
  return [
    { role: 'system', content: AI_BRANCH_STRUCTURE_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: previousStructureCandidate
          ? 'REPAIR_BRANCH_STRUCTURE'
          : 'PLAN_BRANCH_STRUCTURE',
        sourceUnits: source.units.map(({ id, text }, index) => {
          const explicitChoiceTexts = source.segments
            .filter((segment) => segment.unitId === id && segment.kind === 'choice_text')
            .map((segment) => segment.text);
          return {
            id: `u${index}`,
            text,
            ...(explicitChoiceTexts.length > 0 ? { explicitChoiceTexts } : {}),
          };
        }),
        ...(branchPartHints.length > 0 ? {
          branchPartHints: branchPartHints.map((hint) => ({
            partCode: hint.partCode,
            unitIds: hint.unitIds.map(alias),
          })),
        } : {}),
        validationIssues: validationIssues.map((issue) => {
          const unitIds = issue.unitIds?.map(alias) ?? [];
          const repairHint = validationIssueRepairHint(issue.message ?? '', unitIds);
          return {
            ...issue,
            ...(issue.unitIds ? { unitIds } : {}),
            ...(repairHint ? { repairHint } : {}),
          };
        }),
        ...(previousStructureCandidate ? {
          previousStructureCandidate: mapAiBranchStructureUnitIds(
            previousStructureCandidate,
            alias
          ),
        } : {}),
      }),
    },
  ];
}

type ExplicitBranchPartHint = { partCode: string; unitIds: string[] };

function collectExplicitBranchPartHints(
  source: SegmentedStorySource
): ExplicitBranchPartHint[] {
  const markerPattern = /^\s*(?:[（(]\s*)?(?:\u6765\u81ea\u5206\u652f\s*([A-Za-z]\d*)\s*(?=【|\u7684|[（(:：]|$)|(?:\u5d4c\u5957|\u5b50)?\u5206\u652f\s*([A-Za-z]\d*)\s*(?:\u6b63\u6587|\u7ed3\u5c40)?\s*(?=[（(:：]|$))/i;
  const markers = source.units.flatMap((unit, unitIndex) => {
    const match = markerPattern.exec(unit.text);
    const partCode = match?.[1] ?? match?.[2];
    return partCode
      ? [{ unitIndex, partCode: partCode.toUpperCase() }]
      : [];
  });
  const unitIdsByPart = new Map<string, string[]>();
  markers.forEach((marker, markerIndex) => {
    const nextMarkerIndex = markers[markerIndex + 1]?.unitIndex ?? source.units.length;
    const commonBoundaryIndex = source.units.findIndex((unit, unitIndex) => (
      unitIndex > marker.unitIndex
      && unitIndex < nextMarkerIndex
      && isExplicitMergeBoundary(unit.text)
    ));
    const end = commonBoundaryIndex >= 0 ? commonBoundaryIndex : nextMarkerIndex;
    const owned = source.units
      .slice(marker.unitIndex + 1, end)
      .map((unit) => unit.id);
    unitIdsByPart.set(marker.partCode, [
      ...(unitIdsByPart.get(marker.partCode) ?? []),
      ...owned,
    ]);
  });
  return [...unitIdsByPart].flatMap(([partCode, unitIds]) => (
    unitIds.length > 0
      ? [{ partCode, unitIds: [...new Set(unitIds)] }]
      : []
  ));
}

function assertExplicitBranchPartOwnership(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): void {
  const hints = collectExplicitBranchPartHints(source);
  if (hints.length === 0) return;
  const ownerByUnitId = new Map(hints.flatMap((hint) => (
    hint.unitIds.map((unitId) => [unitId, hint.partCode] as const)
  )));
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitAlias = new Map(source.units.map((unit, index) => [unit.id, `u${index}`]));
  const optionCode = (option: AiBranchStructure['decisions'][number]['options'][number]) => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  for (const decision of decisions) {
    for (const option of decision.options) {
      const code = optionCode(option);
      if (!code) continue;
      const misplacedUnitId = option.routeUnitIds.find((unitId) => {
        const owner = ownerByUnitId.get(unitId);
        return owner !== undefined && owner !== code && !code.startsWith(owner);
      });
      if (!misplacedUnitId) continue;
      throw new Error(
        `AI option ${code} contains source ${unitAlias.get(misplacedUnitId) ?? misplacedUnitId} owned by explicit branch part ${ownerByUnitId.get(misplacedUnitId)}`
      );
    }
  }
}

function inferExplicitParentReplayUnitIds(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): string[] {
  const ownerByUnitId = new Map(collectExplicitBranchPartHints(source).flatMap((hint) => (
    hint.unitIds.map((unitId) => [unitId, hint.partCode] as const)
  )));
  if (ownerByUnitId.size === 0) return [];
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const optionCode = (option: AiBranchStructure['decisions'][number]['options'][number]) => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  const optionCodesByUnit = new Map<string, Set<string>>();
  decisions.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    new Set(option.routeUnitIds).forEach((unitId) => {
      const codes = optionCodesByUnit.get(unitId) ?? new Set<string>();
      codes.add(code);
      optionCodesByUnit.set(unitId, codes);
    });
  }));
  return [...optionCodesByUnit].flatMap(([unitId, codes]) => {
    const owner = ownerByUnitId.get(unitId);
    return owner
      && codes.size > 1
      && [...codes].every((code) => code.length > owner.length && code.startsWith(owner))
      ? [unitId]
      : [];
  });
}

function normalizeAncestorRouteOverlaps(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): AiBranchStructure['decisions'] {
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const optionCode = (option: AiBranchStructure['decisions'][number]['options'][number]) => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  const normalized = decisions.map((decision) => ({
    ...decision,
    options: decision.options.map((option) => ({
      ...option,
      routeUnitIds: [...option.routeUnitIds],
    })),
  }));
  const occurrences = new Map<string, Array<{
    code: string;
    option: AiBranchStructure['decisions'][number]['options'][number];
  }>>();
  normalized.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    new Set(option.routeUnitIds).forEach((unitId) => {
      occurrences.set(unitId, [
        ...(occurrences.get(unitId) ?? []),
        { code, option },
      ]);
    });
  }));
  occurrences.forEach((uses, unitId) => {
    const distinctCodes = [...new Set(uses.map((use) => use.code))];
    if (distinctCodes.length < 2) return;
    const ancestor = [...distinctCodes]
      .sort((left, right) => left.length - right.length)
      .find((candidate) => (
        distinctCodes.some((code) => code.length > candidate.length)
        && distinctCodes.every((code) => code.startsWith(candidate))
      ));
    if (!ancestor) return;
    const position = unitIndex.get(unitId) ?? Number.MAX_SAFE_INTEGER;
    const eligibleDescendantCodes = [...new Set(uses.flatMap((use) => (
      use.code !== ancestor
      && (unitIndex.get(use.option.sourceUnitId) ?? Number.MAX_SAFE_INTEGER) < position
        ? [use.code]
        : []
    )))];
    const deepestEligibleCodes = eligibleDescendantCodes.filter((candidate) => (
      !eligibleDescendantCodes.some((code) => (
        code.length > candidate.length && code.startsWith(candidate)
      ))
    ));
    const keeperCode = deepestEligibleCodes.length === 1
      ? deepestEligibleCodes[0]
      : ancestor;
    uses.forEach((use) => {
      if (use.code === keeperCode) return;
      use.option.routeUnitIds = use.option.routeUnitIds.filter((candidate) => (
        candidate !== unitId
      ));
    });
  });
  return normalized;
}

function normalizeDescendantPartOwnership(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): AiBranchStructure['decisions'] {
  const ownerByUnitId = new Map(collectExplicitBranchPartHints(source).flatMap((hint) => (
    hint.unitIds.map((unitId) => [unitId, hint.partCode] as const)
  )));
  if (ownerByUnitId.size === 0) return decisions;
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const optionCode = (
    option: AiBranchStructure['decisions'][number]['options'][number]
  ): string | undefined => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  const normalized = decisions.map((decision) => ({
    ...decision,
    options: decision.options.map((option) => ({
      ...option,
      routeUnitIds: [...option.routeUnitIds],
    })),
  }));
  type BranchOption = typeof normalized[number]['options'][number];
  const optionsByCode = new Map<string, BranchOption[]>();
  normalized.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    optionsByCode.set(code, [...(optionsByCode.get(code) ?? []), option]);
  }));
  const moved = new Map<BranchOption, string[]>();

  normalized.forEach((decision) => decision.options.forEach((option) => {
    const code = optionCode(option);
    if (!code) return;
    option.routeUnitIds = option.routeUnitIds.filter((unitId) => {
      const owner = ownerByUnitId.get(unitId);
      if (!owner || owner.length <= code.length || !owner.startsWith(code)) return true;
      const destinations = optionsByCode.get(owner) ?? [];
      if (destinations.length !== 1) return true;
      moved.set(destinations[0], [...(moved.get(destinations[0]) ?? []), unitId]);
      return false;
    });
  }));
  moved.forEach((unitIds, option) => {
    option.routeUnitIds = [...new Set([...option.routeUnitIds, ...unitIds])]
      .sort((left, right) => (
        (unitIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      ));
  });
  return normalized;
}

function normalizeExplicitOptionPreviews(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions'],
  structuralUnitIds: string[]
): AiBranchStructure['decisions'] {
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const visibleUnitIds = new Set(source.segments
    .filter((segment) => segment.display)
    .map((segment) => segment.unitId));
  const optionUnitIds = new Set(decisions.flatMap((decision) => (
    decision.options.map((option) => option.sourceUnitId)
  )));
  const routeUnitOccurrenceCounts = new Map<string, number>();
  decisions.forEach((decision) => decision.options.forEach((option) => {
    new Set(option.routeUnitIds).forEach((unitId) => {
      routeUnitOccurrenceCounts.set(unitId, (routeUnitOccurrenceCounts.get(unitId) ?? 0) + 1);
    });
  }));
  const repeatedRouteUnitIds = new Set(
    [...routeUnitOccurrenceCounts]
      .filter(([, count]) => count > 1)
      .map(([unitId]) => unitId)
  );
  const decisionOwnerUnitIds = new Set(decisions.map((decision) => decision.ownerUnitId));
  const structural = new Set(structuralUnitIds);
  const branchBodyMarkerPattern = /^\s*(?:[（(]\s*)?(?:\u6765\u81ea\u5206\u652f|(?:\u5d4c\u5957|\u5b50)?\u5206\u652f)\s*[A-Za-z]\d*/i;
  const normalized = decisions.map((decision) => ({
    ...decision,
    options: decision.options.map((option) => ({
      ...option,
      routeUnitIds: [...option.routeUnitIds],
    })),
  }));

  normalized.forEach((decision, decisionIndex) => {
    const ancestorDecisionIndexes = new Set(decisions.flatMap((candidate, candidateIndex) => (
      candidateIndex !== decisionIndex
      && (
        candidate.mergeUnitId === decision.ownerUnitId
        || candidate.options.some((option) => (
          option.routeUnitIds.includes(decision.ownerUnitId)
          || option.nextUnitId === decision.ownerUnitId
        ))
      )
        ? [candidateIndex]
        : []
    )));
    const otherDecisionRouteUnitIds = new Set(decisions.flatMap((candidate, candidateIndex) => (
      candidateIndex === decisionIndex || ancestorDecisionIndexes.has(candidateIndex)
        ? []
        : candidate.options.flatMap((option) => option.routeUnitIds)
    )));
    const ordered = [...decision.options].sort((left, right) => (
      (unitIndexById.get(left.sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
      - (unitIndexById.get(right.sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
    ));
    ordered.forEach((option, optionIndex) => {
      const start = unitIndexById.get(option.sourceUnitId);
      if (start === undefined) return;
      const nextSiblingIndex = ordered[optionIndex + 1]
        ? unitIndexById.get(ordered[optionIndex + 1].sourceUnitId)
        : undefined;
      const laterBodyIndex = source.units.findIndex((unit, unitIndex) => (
        unitIndex > start && branchBodyMarkerPattern.test(unit.text)
      ));
      const endCandidates = [
        nextSiblingIndex,
        laterBodyIndex >= 0 ? laterBodyIndex : undefined,
      ].filter((index): index is number => index !== undefined);
      const end = endCandidates.length > 0 ? Math.min(...endCandidates) : undefined;
      if (end === undefined || end <= start + 1) return;
      const previewUnitIds = source.units.slice(start + 1, end)
        .filter((unit) => (
          visibleUnitIds.has(unit.id)
          && !optionUnitIds.has(unit.id)
          && !decisionOwnerUnitIds.has(unit.id)
          && !structural.has(unit.id)
          && !repeatedRouteUnitIds.has(unit.id)
          && !otherDecisionRouteUnitIds.has(unit.id)
        ))
        .map((unit) => unit.id);
      if (previewUnitIds.length === 0) return;
      const previewUnitIdSet = new Set(previewUnitIds);
      decision.options.forEach((candidateOption) => {
        candidateOption.routeUnitIds = candidateOption.routeUnitIds.filter((unitId) => (
          !previewUnitIdSet.has(unitId)
        ));
      });
      option.routeUnitIds = [...previewUnitIds, ...option.routeUnitIds];
    });
  });
  return normalized;
}

function normalizeCrossPartContinuations(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions']
): AiBranchStructure['decisions'] {
  const ownerByUnitId = new Map(collectExplicitBranchPartHints(source).flatMap((hint) => (
    hint.unitIds.map((unitId) => [unitId, hint.partCode] as const)
  )));
  if (ownerByUnitId.size === 0) return decisions;
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const optionCode = (option: AiBranchStructure['decisions'][number]['options'][number]) => {
    const evidence = `${unitsById.get(option.sourceUnitId)?.text ?? ''} ${option.text}`;
    return /(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f)\s*([A-Za-z]\d*)\b/i.exec(evidence)?.[1].toUpperCase();
  };
  const compatible = (code: string | undefined, owner: string | undefined) => (
    !code || !owner || code === owner || code.startsWith(owner)
  );
  return decisions.map((decision) => {
    const unanimouslyDeclaredMerge = Boolean(
      decision.mergeUnitId
      && decision.options.every((option) => (
        Object.hasOwn(option, 'nextUnitId')
        && option.nextUnitId === decision.mergeUnitId
      ))
    );
    const options = decision.options.map((option) => {
      const code = optionCode(option);
      const nextOwner = option.nextUnitId
        ? ownerByUnitId.get(option.nextUnitId)
        : undefined;
      const isDeclaredMerge = unanimouslyDeclaredMerge
        && option.nextUnitId === decision.mergeUnitId;
      return option.nextUnitId && !isDeclaredMerge && !compatible(code, nextOwner)
        ? { ...option, nextUnitId: null }
        : { ...option };
    });
    const mergeOwner = decision.mergeUnitId
      ? ownerByUnitId.get(decision.mergeUnitId)
      : undefined;
    const mergeIsCompatible = unanimouslyDeclaredMerge || options.every((option) => (
      compatible(optionCode(option), mergeOwner)
    ));
    return {
      ...decision,
      mergeUnitId: mergeIsCompatible ? decision.mergeUnitId : null,
      options,
    };
  });
}

function unreachableUnitRepairHint(unitIds: string[]): string {
  const targets = [...new Set(unitIds)].join(', ');
  return `Make visible source unit(s) ${targets} reachable from the entry. If a target is the shared suffix after history-specific route content, remove the earlier route tails from breakAfterUnitIds, set every affected leaf option nextUnitId and its decision mergeUnitId to the first shared suffix unit, and keep only the true final unit terminal. If it is branch-exclusive, add it only to the correct option routeUnitIds. Do not connect it through a sibling route.`;
}

function validationIssueRepairHint(message: string, unitIds: string[]): string {
  if (/unreachable/i.test(message) && unitIds.length > 0) {
    return unreachableUnitRepairHint(unitIds);
  }
  const partMismatch = /AI option ([A-Za-z]\d*) contains source (u\d+) owned by explicit branch part ([A-Za-z]\d*)/i.exec(message);
  if (partMismatch) {
    const [, optionCode, unitId, ownerCode] = partMismatch;
    return `Remove ${unitId} from option ${optionCode.toUpperCase()} routeUnitIds and assign it only to option ${ownerCode.toUpperCase()} or one of that option's descendants. Preserve all unrelated route units and transitions.`;
  }
  const repeatedRoute = /AI route unit (u\d+) is repeated across options but not declared as shared replay/i.exec(message);
  if (repeatedRoute) {
    return `If ${repeatedRoute[1]} is genuinely shared setup played on every affected route, add it to sharedReplayUnitIds. Otherwise remove it from the incorrect sibling routeUnitIds. Do not change unrelated transitions.`;
  }
  return '';
}

export function parseAiBranchStructure(value: unknown): AiBranchStructure {
  const root = asRecord(value);
  const rawDecisions = arrayValue(root.decisions);
  const rawChoices = arrayValue(root.choices);
  const rawJumps = arrayValue(root.jumps);
  const parsedDecisions = rawDecisions.map((value) => {
    const decision = asRecord(value);
    return {
      ownerUnitId: stringValue(decision.ownerUnitId ?? decision.fromUnitId ?? decision.owner),
      mergeUnitId: nullableStringValue(
        decision.mergeUnitId ?? decision.mergeTargetUnitId ?? decision.merge
      ),
      options: arrayValue(decision.options ?? decision.choices).map((value) => {
        const option = asRecord(value);
        return {
          sourceUnitId: stringValue(option.sourceUnitId ?? option.sourceUnit),
          text: stringValue(option.text ?? option.label ?? option.choiceText),
          routeUnitIds: stringArray(
            option.routeUnitIds ?? option.routeUnits ?? option.pathUnitIds
          ),
          ...(
            Object.hasOwn(option, 'nextUnitId')
            || Object.hasOwn(option, 'continuationUnitId')
            || Object.hasOwn(option, 'next')
              ? {
                  nextUnitId: nullableStringValue(
                    option.nextUnitId ?? option.continuationUnitId ?? option.next
                  ),
                }
              : {}
          ),
        };
      }),
    };
  });
  const plotGroups = arrayValue(root.plotGroups).flatMap((value) => {
    const group = asRecord(value);
    const title = stringValue(group.title ?? group.name ?? group.label);
    const sourceUnitIds = stringArray(group.sourceUnitIds ?? group.unitIds);
    return title && sourceUnitIds.length > 0 ? [{ title, sourceUnitIds }] : [];
  });
  return AiBranchStructureSchema.parse({
    version: 2,
    structuralUnitIds: stringArray(root.structuralUnitIds ?? root.structural_unit_ids),
    sharedReplayUnitIds: stringArray(
      root.sharedReplayUnitIds ?? root.shared_replay_unit_ids
    ),
    decisions: normalizeGroupedDecisions(parsedDecisions),
    ...(plotGroups.length > 0 ? { plotGroups } : {}),
    choices: rawChoices.map((value) => {
      const choice = asRecord(value);
      return {
        sourceUnitId: stringValue(choice.sourceUnitId ?? choice.sourceUnit),
        text: stringValue(choice.text ?? choice.label ?? choice.choiceText),
        fromUnitId: stringValue(choice.fromUnitId ?? choice.ownerUnitId ?? choice.from),
        targetUnitId: stringValue(choice.targetUnitId ?? choice.targetUnit ?? choice.to),
      };
    }),
    jumps: rawJumps.map((value) => {
      const jump = asRecord(value);
      return {
        fromUnitId: stringValue(jump.fromUnitId ?? jump.from),
        targetUnitId: stringValue(jump.targetUnitId ?? jump.targetUnit ?? jump.to),
      };
    }),
    breakAfterUnitIds: stringArray(
      root.breakAfterUnitIds ?? root.terminalUnitIds ?? root.breaks
    ),
  });
}

export function parseAiBranchStructureForSource(
  value: unknown,
  source: SegmentedStorySource
): AiBranchStructure {
  const parsed = parseAiBranchStructure(value);
  const { aliasToReal } = branchUnitAliasMaps(source);
  return AiBranchStructureSchema.parse(mapAiBranchStructureUnitIds(
    parsed,
    (unitId) => aliasToReal.get(unitId) ?? unitId
  ));
}

function branchUnitAliasMaps(source: SegmentedStorySource): {
  realToAlias: Map<string, string>;
  aliasToReal: Map<string, string>;
} {
  const pairs = source.units.map((unit, index) => [unit.id, `u${index}`] as const);
  return {
    realToAlias: new Map(pairs),
    aliasToReal: new Map(pairs.map(([real, alias]) => [alias, real])),
  };
}

function mapAiBranchStructureUnitIds(
  structure: AiBranchStructure,
  mapUnitId: (unitId: string) => string
): AiBranchStructure {
  return {
    ...structure,
    structuralUnitIds: structure.structuralUnitIds.map(mapUnitId),
    sharedReplayUnitIds: structure.sharedReplayUnitIds.map(mapUnitId),
    decisions: structure.decisions.map((decision) => ({
      ...decision,
      ownerUnitId: mapUnitId(decision.ownerUnitId),
      mergeUnitId: decision.mergeUnitId ? mapUnitId(decision.mergeUnitId) : null,
      options: decision.options.map((option) => ({
        ...option,
        sourceUnitId: mapUnitId(option.sourceUnitId),
        routeUnitIds: option.routeUnitIds.map(mapUnitId),
        ...(Object.hasOwn(option, 'nextUnitId') ? {
          nextUnitId: option.nextUnitId ? mapUnitId(option.nextUnitId) : null,
        } : {}),
      })),
    })),
    ...(structure.plotGroups ? {
      plotGroups: structure.plotGroups.map((group) => ({
        ...group,
        sourceUnitIds: group.sourceUnitIds.map(mapUnitId),
      })),
    } : {}),
    choices: structure.choices.map((choice) => ({
      ...choice,
      sourceUnitId: mapUnitId(choice.sourceUnitId),
      fromUnitId: mapUnitId(choice.fromUnitId),
      targetUnitId: mapUnitId(choice.targetUnitId),
    })),
    jumps: structure.jumps.map((jump) => ({
      fromUnitId: mapUnitId(jump.fromUnitId),
      targetUnitId: mapUnitId(jump.targetUnitId),
    })),
    breakAfterUnitIds: structure.breakAfterUnitIds.map(mapUnitId),
  };
}

export function buildStoryPlotPlanFromAiGroups(
  plan: StoryRelationshipPlan,
  source: SegmentedStorySource,
  groups: Array<{ title?: string; sourceUnitIds?: string[] }>
): StoryPlotPlan {
  const effectiveGroups = expandPlotGroupsWithRouteReplays(source, groups);
  const segmentUnitById = new Map(source.segments.map((segment) => [segment.id, segment.unitId]));
  const segmentTextById = new Map(source.segments.map((segment) => [segment.id, segment.text]));
  const nodeUnits = new Map(plan.nodes.map((node) => [
    node.id,
    new Set([
      ...(node.speakerSegmentId ? [segmentUnitById.get(node.speakerSegmentId)] : []),
      ...node.contentSegmentIds.map((segmentId) => segmentUnitById.get(segmentId)),
    ].filter((unitId): unitId is string => Boolean(unitId))),
  ]));
  const nodeIdsByUnit = new Map<string, string[]>();
  for (const [nodeId, unitIds] of nodeUnits) {
    for (const unitId of unitIds) {
      const ids = nodeIdsByUnit.get(unitId) ?? [];
      ids.push(nodeId);
      nodeIdsByUnit.set(unitId, ids);
    }
  }

  const assigned = new Set<string>();
  const nodes = effectiveGroups.flatMap((group) => {
    const title = group.title?.trim();
    if (!title) throw new Error('AI plot groups require a non-empty title');
    const mappedNodeIds = [...new Set((group.sourceUnitIds ?? []).flatMap((unitId) => (
      nodeIdsByUnit.get(unitId) ?? []
    )))];
    const duplicateNodeId = mappedNodeIds.find((nodeId) => assigned.has(nodeId));
    if (duplicateNodeId) {
      throw new Error(`AI plot groups assign Story node ${duplicateNodeId} more than once`);
    }
    const storyNodeIds = mappedNodeIds;
    if (storyNodeIds.length === 0) return [];
    assertPlotGroupBranchCoherence(plan, storyNodeIds, title);
    storyNodeIds.forEach((nodeId) => assigned.add(nodeId));
    return [{ id: storyNodeIds[0], title, storyNodeIds }];
  });
  if (assigned.size !== plan.nodes.length) {
    throw new Error('AI plot groups must cover every visible Story node exactly once');
  }

  const plotByStoryId = new Map(nodes.flatMap((node) => (
    node.storyNodeIds.map((storyNodeId) => [storyNodeId, node.id] as const)
  )));
  const choicesByOwner = new Map<string, typeof plan.choices>();
  for (const choice of plan.choices) {
    const choices = choicesByOwner.get(choice.fromNodeId) ?? [];
    choices.push(choice);
    choicesByOwner.set(choice.fromNodeId, choices);
  }
  const edges: StoryPlotEdge[] = [];
  const edgeKeys = new Set<string>();
  const optionIndexByPlot = new Map<string, number>();
  const addEdge = (edge: StoryPlotEdge) => {
    if (edge.fromPlotNodeId === edge.toPlotNodeId) return;
    const key = JSON.stringify(edge);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };
  for (const storyNode of plan.nodes) {
    const fromPlotNodeId = plotByStoryId.get(storyNode.id);
    if (!fromPlotNodeId) continue;
    const ownerChoices = choicesByOwner.get(storyNode.id) ?? [];
    if (ownerChoices.length > 0) {
      ownerChoices.forEach((choice) => {
        const toPlotNodeId = plotByStoryId.get(choice.targetNodeId);
        if (!toPlotNodeId) throw new Error(`AI choice target ${choice.targetNodeId} is not plotted`);
        const optionIndex = optionIndexByPlot.get(fromPlotNodeId) ?? 0;
        optionIndexByPlot.set(fromPlotNodeId, optionIndex + 1);
        const text = choice.textSegmentIds
          .map((segmentId) => segmentTextById.get(segmentId) ?? '')
          .join(' ')
          .trim();
        if (!text) throw new Error(`AI choice ${choice.id} has no display text`);
        addEdge({ fromPlotNodeId, toPlotNodeId, optionText: text, optionIndex });
      });
      continue;
    }
    if (!storyNode.nextNodeId) continue;
    const toPlotNodeId = plotByStoryId.get(storyNode.nextNodeId);
    if (!toPlotNodeId) throw new Error(`Story next target ${storyNode.nextNodeId} is not plotted`);
    addEdge({ fromPlotNodeId, toPlotNodeId, optionText: null, optionIndex: null });
  }
  const entryPlotNodeId = plotByStoryId.get(plan.entryNodeId);
  if (!entryPlotNodeId) throw new Error(`Story entry ${plan.entryNodeId} is not plotted`);
  return validateStoryPlotPlan({ version: 1, entryPlotNodeId, nodes, edges }, plan.nodes.map((node) => node.id));
}

function assertPlotGroupBranchCoherence(
  plan: StoryRelationshipPlan,
  storyNodeIds: string[],
  title: string
): void {
  const groupedNodeIds = new Set(storyNodeIds);
  const nodesById = new Map(plan.nodes.map((node) => [node.id, node]));
  const choicesByOwner = new Map<string, StoryRelationshipPlan['choices']>();
  plan.choices.forEach((choice) => {
    choicesByOwner.set(choice.fromNodeId, [
      ...(choicesByOwner.get(choice.fromNodeId) ?? []),
      choice,
    ]);
  });
  const collectReachable = (startId: string): Set<string> => {
    const reachable = new Set<string>();
    const pending = [startId];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (reachable.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;
      reachable.add(nodeId);
      if (node.nextNodeId) pending.push(node.nextNodeId);
      (choicesByOwner.get(nodeId) ?? []).forEach((choice) => (
        pending.push(choice.targetNodeId)
      ));
    }
    return reachable;
  };

  for (const siblingChoices of choicesByOwner.values()) {
    if (siblingChoices.length < 2) continue;
    const reachableByChoice = siblingChoices.map((choice) => (
      collectReachable(choice.targetNodeId)
    ));
    const exclusiveHits = reachableByChoice.filter((reachable, choiceIndex) => {
      const otherReachable = new Set(
        reachableByChoice.flatMap((candidate, candidateIndex) => (
          candidateIndex === choiceIndex ? [] : [...candidate]
        ))
      );
      return [...groupedNodeIds].some((nodeId) => (
        reachable.has(nodeId) && !otherReachable.has(nodeId)
      ));
    }).length;
    if (exclusiveHits > 1) {
      throw new Error(
        `AI plot group "${title}" mixes mutually exclusive sibling routes`
      );
    }
  }

  if (storyNodeIds.length < 2) return;
  const adjacent = new Map<string, Set<string>>(
    storyNodeIds.map((nodeId) => [nodeId, new Set<string>()])
  );
  const connect = (left: string, right: string) => {
    if (!groupedNodeIds.has(left) || !groupedNodeIds.has(right)) return;
    adjacent.get(left)!.add(right);
    adjacent.get(right)!.add(left);
  };
  plan.nodes.forEach((node) => {
    if (node.nextNodeId) connect(node.id, node.nextNodeId);
  });
  plan.choices.forEach((choice) => connect(choice.fromNodeId, choice.targetNodeId));
  const connected = new Set<string>();
  const pending = [storyNodeIds[0]];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (connected.has(nodeId)) continue;
    connected.add(nodeId);
    adjacent.get(nodeId)?.forEach((candidate) => pending.push(candidate));
  }
  if (connected.size !== groupedNodeIds.size) {
    throw new Error(`AI plot group "${title}" contains disconnected story content`);
  }
}

function normalizeGroupedDecisions(
  decisions: Array<{
    ownerUnitId: string;
    mergeUnitId: string | null;
    options: Array<{
      sourceUnitId: string;
      text: string;
      routeUnitIds: string[];
      nextUnitId?: string | null;
    }>;
  }>
): typeof decisions {
  if (decisions.flatMap((decision) => decision.options).every((option) => (
    Object.hasOwn(option, 'nextUnitId')
  ))) return decisions;
  const grouped = new Map<string, typeof decisions[number]>();
  for (const decision of decisions) {
    const key = `${decision.ownerUnitId}\u0000${decision.mergeUnitId ?? ''}`;
    const existing = grouped.get(key);
    if (existing) existing.options.push(...decision.options);
    else grouped.set(key, { ...decision, options: [...decision.options] });
  }
  const normalized = [...grouped.values()];
  for (const decision of normalized) {
    for (const option of decision.options) {
      const nestedRouteUnits = new Set(
        normalized
          .filter((candidate) => (
            candidate !== decision
            && option.routeUnitIds.includes(candidate.ownerUnitId)
          ))
          .flatMap((candidate) => candidate.options.flatMap((child) => child.routeUnitIds))
      );
      option.routeUnitIds = [...new Set(option.routeUnitIds)].filter((unitId) => (
        unitId !== decision.mergeUnitId && !nestedRouteUnits.has(unitId)
      ));
    }
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  ));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableStringValue(value: unknown): string | null {
  const normalized = stringValue(value);
  return normalized || null;
}

const ROUTE_REPLAY_SUFFIX = ':ai-replay:';

function expandSharedRouteReplays(
  source: SegmentedStorySource,
  decisions: AiBranchStructure['decisions'],
  sharedReplayUnitIds: string[]
): { source: SegmentedStorySource; decisions: AiBranchStructure['decisions'] } {
  const unitAlias = new Map(source.units.map((unit, index) => [unit.id, `u${index}`]));
  const decisionOwnerUnitIds = new Set(decisions.map((decision) => decision.ownerUnitId));
  const occurrenceCounts = new Map<string, number>();
  decisions.forEach((decision) => decision.options.forEach((option) => {
    assertUnique('route', option.routeUnitIds, option.routeUnitIds.length);
    option.routeUnitIds.forEach((unitId) => {
      if (decisionOwnerUnitIds.has(unitId)) return;
      occurrenceCounts.set(unitId, (occurrenceCounts.get(unitId) ?? 0) + 1);
    });
  }));
  const repeatedUnitIds = new Set(
    [...occurrenceCounts]
      .filter(([, count]) => count > 1)
      .map(([unitId]) => unitId)
  );
  assertUnique('shared replay', sharedReplayUnitIds, sharedReplayUnitIds.length);
  const replayedUnitIds = new Set(sharedReplayUnitIds);
  const undeclaredReplay = [...repeatedUnitIds].find((unitId) => !replayedUnitIds.has(unitId));
  if (undeclaredReplay) {
    throw new Error(
      `AI route unit ${unitAlias.get(undeclaredReplay) ?? undeclaredReplay} is repeated across options but not declared as shared replay`
    );
  }
  const unusedReplay = [...replayedUnitIds].find((unitId) => !repeatedUnitIds.has(unitId));
  if (unusedReplay) {
    throw new Error(
      `AI shared replay unit ${unitAlias.get(unusedReplay) ?? unusedReplay} is not repeated across option routes`
    );
  }
  if (replayedUnitIds.size === 0) return { source, decisions };

  const sourceUnitById = new Map(source.units.map((unit) => [unit.id, unit]));
  const sourceSegmentsByUnit = new Map<string, SourceSegment[]>();
  source.segments.forEach((segment) => {
    sourceSegmentsByUnit.set(segment.unitId, [
      ...(sourceSegmentsByUnit.get(segment.unitId) ?? []),
      segment,
    ]);
  });
  const commandBySegment = new Map<string, typeof source.commands>();
  source.commands.forEach((command) => {
    commandBySegment.set(command.segmentId, [
      ...(commandBySegment.get(command.segmentId) ?? []),
      command,
    ]);
  });
  const units = [...source.units];
  const segments = [...source.segments];
  const commands = [...source.commands];
  const seen = new Set<string>();

  const expandedDecisions = decisions.map((decision, decisionIndex) => ({
    ...decision,
    options: decision.options.map((option, optionIndex) => ({
      ...option,
      routeUnitIds: option.routeUnitIds.map((unitId) => {
        if (!replayedUnitIds.has(unitId) || !seen.has(unitId)) {
          seen.add(unitId);
          return unitId;
        }
        const replayKey = `d${decisionIndex + 1}:o${optionIndex + 1}`;
        const replayUnitId = `${unitId}${ROUTE_REPLAY_SUFFIX}${replayKey}`;
        const sourceUnit = sourceUnitById.get(unitId);
        if (!sourceUnit) throw new Error(`AI replay unit ${unitId} does not exist`);
        units.push({ ...sourceUnit, id: replayUnitId, authoritative: false });

        for (const segment of sourceSegmentsByUnit.get(unitId) ?? []) {
          const replaySegmentId = `${segment.id}${ROUTE_REPLAY_SUFFIX}${replayKey}`;
          segments.push({ ...segment, id: replaySegmentId, unitId: replayUnitId });
          for (const command of commandBySegment.get(segment.id) ?? []) {
            commands.push({
              ...command,
              id: `${command.id}${ROUTE_REPLAY_SUFFIX}${replayKey}`,
              segmentId: replaySegmentId,
            });
          }
        }
        return replayUnitId;
      }),
    })),
  }));

  return {
    source: { ...source, units, segments, commands },
    decisions: expandedDecisions,
  };
}

function normalizeRouteBreaks(
  decisions: AiBranchStructure['decisions'],
  breakAfterUnitIds: string[]
): string[] {
  const contradictoryBreaks = new Set<string>();
  for (const decision of decisions) {
    for (const option of decision.options) {
      const continuation = Object.hasOwn(option, 'nextUnitId')
        ? option.nextUnitId
        : decision.mergeUnitId;
      option.routeUnitIds.forEach((unitId, index) => {
        if (index < option.routeUnitIds.length - 1 || continuation) {
          contradictoryBreaks.add(unitId);
        }
      });
    }
  }
  return breakAfterUnitIds.filter((unitId) => !contradictoryBreaks.has(unitId));
}

function expandPlotGroupsWithRouteReplays(
  source: SegmentedStorySource,
  groups: Array<{ title?: string; sourceUnitIds?: string[] }>
): Array<{ title?: string; sourceUnitIds?: string[] }> {
  const groupIndexByUnit = new Map<string, number>();
  groups.forEach((group, groupIndex) => {
    (group.sourceUnitIds ?? []).forEach((unitId) => groupIndexByUnit.set(unitId, groupIndex));
  });
  const replayGroups = new Map<string, {
    groupIndex: number;
    replayKey: string;
    sourceUnitIds: string[];
  }>();
  for (const unit of source.units) {
    const markerIndex = unit.id.lastIndexOf(ROUTE_REPLAY_SUFFIX);
    if (markerIndex < 0) continue;
    const originalUnitId = unit.id.slice(0, markerIndex);
    const replayKey = unit.id.slice(markerIndex + ROUTE_REPLAY_SUFFIX.length);
    const groupIndex = groupIndexByUnit.get(originalUnitId);
    if (groupIndex === undefined) continue;
    const key = `${groupIndex}\u0000${replayKey}`;
    const replayGroup = replayGroups.get(key) ?? {
      groupIndex,
      replayKey,
      sourceUnitIds: [],
    };
    replayGroup.sourceUnitIds.push(unit.id);
    replayGroups.set(key, replayGroup);
  }

  return groups.flatMap((group, groupIndex) => [
    group,
    ...[...replayGroups.values()]
      .filter((replay) => replay.groupIndex === groupIndex)
      .map((replay) => ({
        title: `${group.title?.trim() ?? '\u5267\u60c5'}（\u8def\u5f84 ${replay.replayKey.slice(1).replace(':o', '-')}）`,
        sourceUnitIds: replay.sourceUnitIds,
      })),
  ]);
}

export function materializeAiBranchStructure(
  source: SegmentedStorySource,
  structure: AiBranchStructure
): { source: SegmentedStorySource; plan: StoryRelationshipPlan } {
  const directOptionContinuations = structure.decisions.length > 0
    && structure.decisions.flatMap((decision) => decision.options).every((option) => (
      Object.hasOwn(option, 'nextUnitId')
    ));
  const previewNormalizedDecisions = directOptionContinuations
    ? normalizeExplicitOptionPreviews(
        source,
        structure.decisions,
        structure.structuralUnitIds
      )
    : structure.decisions;
  const hierarchyNormalizedDecisions = directOptionContinuations
    ? normalizeAncestorRouteOverlaps(source, previewNormalizedDecisions)
    : structure.decisions;
  const ownershipNormalizedDecisions = directOptionContinuations
    ? normalizeDescendantPartOwnership(source, hierarchyNormalizedDecisions)
    : hierarchyNormalizedDecisions;
  const partNormalizedDecisions = directOptionContinuations
    ? normalizeCrossPartContinuations(source, ownershipNormalizedDecisions)
    : ownershipNormalizedDecisions;
  if (directOptionContinuations) {
    assertExplicitBranchPartOwnership(source, partNormalizedDecisions);
  }
  const effectiveBreakAfterUnitIds = directOptionContinuations
    ? normalizeRouteBreaks(partNormalizedDecisions, structure.breakAfterUnitIds)
    : structure.breakAfterUnitIds;
  const effectiveSharedReplayUnitIds = directOptionContinuations
    ? [
        ...structure.sharedReplayUnitIds,
        ...inferExplicitParentReplayUnitIds(source, partNormalizedDecisions)
          .filter((unitId) => !structure.sharedReplayUnitIds.includes(unitId)),
      ]
    : structure.sharedReplayUnitIds;
  const replayExpansion = directOptionContinuations
    ? expandSharedRouteReplays(
        source,
        partNormalizedDecisions,
        effectiveSharedReplayUnitIds
      )
    : { source, decisions: partNormalizedDecisions };
  const workingSource = replayExpansion.source;
  const knownUnits = new Map(workingSource.units.map((unit) => [unit.id, unit]));
  const anchoredDecisions = directOptionContinuations
    ? replayExpansion.decisions
    : alignDecisionsToExplicitChoiceAnchors(structure.decisions, workingSource);
  const endingUnitIds = new Set(
    workingSource.units
      .filter((unit) => isExplicitEndingSourceUnit(unit.text))
      .map((unit) => unit.id)
  );
  const effectiveStructuralUnitIds = directOptionContinuations
    ? structure.structuralUnitIds
    : structure.structuralUnitIds.filter((unitId) => !endingUnitIds.has(unitId));
  const decisions = directOptionContinuations
    ? anchoredDecisions
    : inferMissingDecisionMerges(
        promoteSharedSiblingRouteUnits(
          repairAnchoredRouteOwnership(
            coalesceSingletonDecisionsByMerge(anchoredDecisions, workingSource),
            workingSource,
            new Set(effectiveStructuralUnitIds),
            endingUnitIds
          ),
          workingSource
        ),
        workingSource,
        new Set(effectiveStructuralUnitIds)
      );
  const normalizedStructure = {
    ...structure,
    structuralUnitIds: effectiveStructuralUnitIds,
    sharedReplayUnitIds: effectiveSharedReplayUnitIds,
    breakAfterUnitIds: effectiveBreakAfterUnitIds,
    decisions,
  };
  const groupedChoices = decisions.flatMap((decision) => (
    decision.options.map((option) => ({
      sourceUnitId: option.sourceUnitId,
      text: option.text,
      fromUnitId: decision.ownerUnitId,
      targetUnitId: option.routeUnitIds[0]
        ?? option.nextUnitId
        ?? decision.mergeUnitId
        ?? '',
    }))
  ));
  if (groupedChoices.some((choice) => !choice.targetUnitId)) {
    throw new Error('AI branch option has neither exclusive route content nor a merge target');
  }
  const normalizedChoices = (groupedChoices.length > 0 ? groupedChoices : structure.choices).map((choice) => {
    if (knownUnits.get(choice.sourceUnitId)?.text.includes(choice.text)) return choice;
    const matchingUnits = workingSource.units.filter((unit) => (
      unit.authoritative && unit.text.includes(choice.text)
    ));
    if (matchingUnits.length !== 1) {
      throw new Error('AI branch choice text must identify one unique source unit');
    }
    return { ...choice, sourceUnitId: matchingUnits[0].id };
  });
  const choiceUnits = new Set(normalizedChoices.map((choice) => choice.sourceUnitId));
  const structuralUnits = new Set(
    effectiveStructuralUnitIds.filter((unitId) => !choiceUnits.has(unitId))
  );
  assertUnique('structural', structure.structuralUnitIds, structure.structuralUnitIds.length);
  assertUnique('jump source', structure.jumps.map((jump) => jump.fromUnitId), structure.jumps.length);
  assertUnique('break', effectiveBreakAfterUnitIds, effectiveBreakAfterUnitIds.length);
  if ([...choiceUnits].some((unitId) => structuralUnits.has(unitId))) {
    throw new Error('AI branch choice units cannot also be structural');
  }
  const referenced = [
    ...structure.structuralUnitIds,
    ...effectiveSharedReplayUnitIds,
    ...effectiveBreakAfterUnitIds,
    ...normalizedChoices.flatMap((choice) => [
      choice.sourceUnitId, choice.fromUnitId, choice.targetUnitId,
    ]),
    ...structure.jumps.flatMap((jump) => [jump.fromUnitId, jump.targetUnitId]),
    ...decisions.flatMap((decision) => [
      decision.ownerUnitId,
      ...(decision.mergeUnitId ? [decision.mergeUnitId] : []),
      ...decision.options.flatMap((option) => [
        option.sourceUnitId,
        ...option.routeUnitIds,
        ...(option.nextUnitId ? [option.nextUnitId] : []),
      ]),
    ]),
  ];
  if (referenced.some((unitId) => !knownUnits.has(unitId))) {
    throw new Error('AI branch structure references an unknown source unit');
  }

  const rewrittenSegments = workingSource.segments.filter((segment) => (
    segment.kind === 'command'
    || (!choiceUnits.has(segment.unitId) && !structuralUnits.has(segment.unitId))
  ));
  const choiceSegmentsByUnit = new Map<string, SourceSegment[]>();
  for (const choice of normalizedChoices) {
    const unit = knownUnits.get(choice.sourceUnitId)!;
    const evidenceStart = unit.text.indexOf(choice.text);
    if (evidenceStart < 0 || unit.text.indexOf(choice.text, evidenceStart + 1) >= 0) {
      throw new Error('AI branch choice text must be one unique exact source substring');
    }
    const visibleText = cleanChoiceDisplayText(choice.text);
    const relativeStart = unit.text.indexOf(visibleText, evidenceStart);
    if (relativeStart < 0 || unit.text.indexOf(visibleText, relativeStart + 1) >= 0) {
      throw new Error('AI branch choice display text must be one unique exact source substring');
    }
    const siblings = choiceSegmentsByUnit.get(unit.id) ?? [];
    const segment: SourceSegment = {
      id: `${unit.id}:ai-choice:${siblings.length}`,
      unitId: unit.id,
      kind: 'choice_text',
      text: visibleText,
      start: unit.start + relativeStart,
      end: unit.start + relativeStart + visibleText.length,
      display: true,
      required: true,
    };
    siblings.push(segment);
    choiceSegmentsByUnit.set(unit.id, siblings);
    rewrittenSegments.push(segment);
  }
  for (const unitId of structuralUnits) {
    const unit = knownUnits.get(unitId)!;
    rewrittenSegments.push({
      id: `${unit.id}:ai-structural`,
      unitId: unit.id,
      kind: 'structural',
      text: unit.text,
      start: unit.start,
      end: unit.end,
      display: false,
      required: true,
    });
  }
  rewrittenSegments.sort((left, right) => left.start - right.start || left.end - right.end);
  const rewrittenSource = { ...workingSource, segments: rewrittenSegments };
  const inventory = buildHierarchicalStoryPlanInventory(rewrittenSource);
  const positioned = positionInventory(inventory);
  const unitIndexById = new Map(workingSource.units.map((unit, index) => [unit.id, index]));
  const positionedNodes = inventory.nodes.map((node) => ({
    node,
    unitIndex: unitIndexById.get(node.unitId) ?? Number.MAX_SAFE_INTEGER,
  }));
  const resolveBackward = (unitId: string): string | undefined => {
    const exact = positioned.lastByUnit.get(unitId);
    if (exact) return exact;
    const unitIndex = unitIndexById.get(unitId);
    if (unitIndex === undefined) return undefined;
    return [...positionedNodes].reverse().find((candidate) => (
      candidate.unitIndex < unitIndex
    ))?.node.id;
  };
  const resolveForward = (unitId: string): string | undefined => {
    const exact = positioned.firstByUnit.get(unitId);
    if (exact) return exact;
    const unitIndex = unitIndexById.get(unitId);
    if (unitIndex === undefined) return undefined;
    return positionedNodes.find((candidate) => candidate.unitIndex > unitIndex)?.node.id;
  };
  const choiceInventoryByUnit = new Map<string, StoryPlanInventory['choices']>();
  for (const choice of inventory.choices) {
    const choices = choiceInventoryByUnit.get(choice.unitId) ?? [];
    choices.push(choice);
    choiceInventoryByUnit.set(choice.unitId, choices);
  }
  const consumedChoiceIndexes = new Map<string, number>();
  const choiceEdges = normalizedChoices.map((choice) => {
    const index = consumedChoiceIndexes.get(choice.sourceUnitId) ?? 0;
    consumedChoiceIndexes.set(choice.sourceUnitId, index + 1);
    const inventoryChoice = choiceInventoryByUnit.get(choice.sourceUnitId)?.[index];
    const owner = resolveBackward(choice.fromUnitId);
    const target = resolveForward(choice.targetUnitId);
    if (!inventoryChoice || !owner || !target) {
      throw new Error('AI branch choice does not map to visible source nodes');
    }
    return {
      choiceId: inventoryChoice.id,
      fromNodeId: owner,
      targetNodeId: target,
    };
  });
  const groupedRelationships = decisions.length > 0
    ? buildGroupedRelationships(normalizedStructure, inventory, resolveBackward, resolveForward)
    : null;
  const nextOverrides = groupedRelationships?.nextOverrides ?? structure.jumps.map((jump) => {
      const nodeId = resolveBackward(jump.fromUnitId);
      const targetNodeId = resolveForward(jump.targetUnitId);
      if (!nodeId || !targetNodeId) throw new Error('AI branch jump does not map to visible source nodes');
      return { nodeId, targetNodeId };
    });
  const breakAfterNodeIds = groupedRelationships?.breakAfterNodeIds
    ?? effectiveBreakAfterUnitIds.map((unitId) => {
      const nodeId = resolveBackward(unitId);
      if (!nodeId) throw new Error('AI branch break does not map to a visible source node');
      return nodeId;
    });

  const plan = materializeStoryRelationshipPlan({
    version: 2,
    entryNodeId: inventory.nodes[0].id,
    breakAfterNodeIds,
    nextOverrides,
    choiceEdges,
  }, inventory);
  const finalPlan = directOptionContinuations
    ? plan
    : breakStoryPlanCycles(
        repairUnreachablePlanNodes(
          breakStoryPlanCycles(isolateSiblingBranchLeaks(plan), inventory),
          inventory
        ),
        inventory
      );

  return {
    source: rewrittenSource,
    plan: finalPlan,
  };
}

function breakStoryPlanCycles(
  plan: StoryRelationshipPlan,
  inventory: StoryPlanInventory
): StoryRelationshipPlan {
  const nodes = plan.nodes.map((node) => ({ ...node }));
  const choices = plan.choices.map((choice) => ({ ...choice }));
  const nodeIndex = new Map(inventory.nodes.map((node, index) => [node.id, index]));

  type Edge = { from: string; to: string; kind: 'next' | 'choice'; choiceId?: string };
  const findCycle = (): Edge[] | null => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const choicesByOwner = new Map<string, typeof choices>();
    for (const choice of choices) {
      const owned = choicesByOwner.get(choice.fromNodeId) ?? [];
      owned.push(choice);
      choicesByOwner.set(choice.fromNodeId, owned);
    }
    const state = new Map<string, 0 | 1 | 2>();
    const pathNodes: string[] = [];
    const pathEdges: Edge[] = [];
    const visit = (nodeId: string): Edge[] | null => {
      state.set(nodeId, 1);
      pathNodes.push(nodeId);
      const node = nodesById.get(nodeId);
      const outgoing: Edge[] = [
        ...(node?.nextNodeId ? [{ from: nodeId, to: node.nextNodeId, kind: 'next' as const }] : []),
        ...(choicesByOwner.get(nodeId) ?? []).map((choice) => ({
          from: nodeId,
          to: choice.targetNodeId,
          kind: 'choice' as const,
          choiceId: choice.id,
        })),
      ];
      for (const edge of outgoing) {
        if (state.get(edge.to) === 1) {
          const cycleStart = pathNodes.lastIndexOf(edge.to);
          return [...pathEdges.slice(Math.max(0, cycleStart)), edge];
        }
        if ((state.get(edge.to) ?? 0) !== 0) continue;
        pathEdges.push(edge);
        const cycle = visit(edge.to);
        pathEdges.pop();
        if (cycle) return cycle;
      }
      pathNodes.pop();
      state.set(nodeId, 2);
      return null;
    };
    for (const node of nodes) {
      if ((state.get(node.id) ?? 0) !== 0) continue;
      const cycle = visit(node.id);
      if (cycle) return cycle;
    }
    return null;
  };

  for (let attempt = 0; attempt < nodes.length + choices.length + 1; attempt += 1) {
    const cycle = findCycle();
    if (!cycle) return { ...plan, nodes, choices };
    const automaticEdges = cycle.filter((edge) => edge.kind === 'next');
    const edgeToCut = automaticEdges.find((edge) => (
      (nodeIndex.get(edge.to) ?? Number.MAX_SAFE_INTEGER)
      <= (nodeIndex.get(edge.from) ?? -1)
    )) ?? automaticEdges.at(-1);
    if (edgeToCut) {
      const node = nodes.find((candidate) => candidate.id === edgeToCut.from);
      if (node) node.nextNodeId = '';
      continue;
    }
    const choiceId = cycle.find((edge) => edge.kind === 'choice')?.choiceId;
    const choiceIndex = choices.findIndex((choice) => choice.id === choiceId);
    if (choiceIndex >= 0) choices.splice(choiceIndex, 1);
  }
  return { ...plan, nodes, choices };
}

function repairUnreachablePlanNodes(
  plan: StoryRelationshipPlan,
  inventory: StoryPlanInventory
): StoryRelationshipPlan {
  const nodes = plan.nodes.map((node) => ({ ...node }));
  const nodeIndex = new Map(inventory.nodes.map((node, index) => [node.id, index]));
  const choicesByOwner = new Map<string, StoryRelationshipPlan['choices']>();
  for (const choice of plan.choices) {
    const choices = choicesByOwner.get(choice.fromNodeId) ?? [];
    choices.push(choice);
    choicesByOwner.set(choice.fromNodeId, choices);
  }
  const nodesById = () => new Map(nodes.map((node) => [node.id, node]));

  for (let attempt = 0; attempt < nodes.length + 1; attempt += 1) {
    const reachable = new Set<string>();
    const pending = [plan.entryNodeId];
    const currentNodes = nodesById();
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      const node = currentNodes.get(id);
      if (!node) continue;
      reachable.add(id);
      if (node.nextNodeId) pending.push(node.nextNodeId);
      (choicesByOwner.get(id) ?? []).forEach((choice) => pending.push(choice.targetNodeId));
    }
    const orphan = nodes
      .filter((node) => !reachable.has(node.id))
      .sort((left, right) => (
        (nodeIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (nodeIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      ))[0];
    if (!orphan) return { ...plan, nodes };

    const orphanIndex = nodeIndex.get(orphan.id) ?? Number.MAX_SAFE_INTEGER;
    const canReach = (startId: string, targetId: string): boolean => {
      const seen = new Set<string>();
      const pendingIds = [startId];
      while (pendingIds.length > 0) {
        const id = pendingIds.pop()!;
        if (id === targetId) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = currentNodes.get(id);
        if (node?.nextNodeId) pendingIds.push(node.nextNodeId);
        (choicesByOwner.get(id) ?? []).forEach((choice) => pendingIds.push(choice.targetNodeId));
      }
      return false;
    };
    const predecessors = nodes
      .filter((node) => (
        reachable.has(node.id)
        && !choicesByOwner.has(node.id)
        && (nodeIndex.get(node.id) ?? -1) < orphanIndex
        && !canReach(orphan.id, node.id)
      ))
      .sort((left, right) => (
        (nodeIndex.get(right.id) ?? -1) - (nodeIndex.get(left.id) ?? -1)
      ));
    const terminalPredecessor = predecessors.find((node) => !node.nextNodeId)
      ?? predecessors[0]
      ?? nodes.find((node) => (
        reachable.has(node.id)
        && !choicesByOwner.has(node.id)
        && !node.nextNodeId
        && !canReach(orphan.id, node.id)
      ));
    if (!terminalPredecessor) return { ...plan, nodes };

    const oldNext = terminalPredecessor.nextNodeId;
    terminalPredecessor.nextNodeId = orphan.id;
    if (oldNext && !choicesByOwner.has(orphan.id)) {
      const orphanComponent = new Set<string>();
      let cursor = orphan.id;
      while (cursor && !orphanComponent.has(cursor)) {
        orphanComponent.add(cursor);
        cursor = currentNodes.get(cursor)?.nextNodeId ?? '';
      }
      const componentTail = [...orphanComponent]
        .map((id) => currentNodes.get(id))
        .find((node) => node && !node.nextNodeId);
      if (componentTail) componentTail.nextNodeId = oldNext;
    }
  }
  return { ...plan, nodes };
}

function alignDecisionsToExplicitChoiceAnchors(
  decisions: AiBranchStructure['decisions'],
  source: SegmentedStorySource
): AiBranchStructure['decisions'] {
  const explicitChoicesByUnit = new Map<string, string[]>();
  for (const segment of source.segments) {
    if (segment.kind !== 'choice_text') continue;
    const texts = explicitChoicesByUnit.get(segment.unitId) ?? [];
    texts.push(segment.text);
    explicitChoicesByUnit.set(segment.unitId, texts);
  }
  if (explicitChoicesByUnit.size < 2) return decisions;

  const explicitUnitIds = new Set(explicitChoicesByUnit.keys());
  const filtered = decisions.flatMap((decision) => {
    const options = decision.options.flatMap((option) => {
      const explicitTexts = explicitChoicesByUnit.get(option.sourceUnitId);
      if (!explicitTexts) return [];
      const explicitText = explicitTexts.find((text) => option.text.includes(text))
        ?? explicitTexts[0];
      return [{ ...option, text: explicitText }];
    });
    return options.length > 0 ? [{ ...decision, options }] : [];
  });

  const rootUnits = source.units.filter((unit) => (
    explicitUnitIds.has(unit.id)
    && /^\s*【?\s*\u5206\u652f\u9009\u62e9[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\s*[：:]/.test(unit.text)
  ));
  if (rootUnits.length < 2) return filtered;

  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const visibleUnitIds = new Set(
    source.segments
      .filter((segment) => new Set([
        'dialogue', 'stage_direction', 'narration', 'scene_heading',
      ]).has(segment.kind))
      .map((segment) => segment.unitId)
  );
  const firstIndex = unitIndex.get(rootUnits[0].id)!;
  const owner = [...source.units.slice(0, firstIndex)].reverse().find((unit) => (
    visibleUnitIds.has(unit.id) && !explicitUnitIds.has(unit.id)
  ));
  if (!owner) return filtered;

  const lastRootIndex = unitIndex.get(rootUnits.at(-1)!.id)!;
  const merge = source.units.find((unit, index) => (
    index > lastRootIndex
    && (
      isExplicitEndingSourceUnit(unit.text)
      || /(?:\u6700\u7ec8\u5c3e\u58f0|\u6240\u6709\u5206\u652f.*(?:\u6c47\u805a|\u6c47\u5408|\u5408\u6d41))/.test(unit.text)
    )
  ));
  const mergeIndex = merge ? unitIndex.get(merge.id)! : source.units.length;
  const rootUnitIds = new Set(rootUnits.map((unit) => unit.id));
  const rootDecision: AiBranchStructure['decisions'][number] = {
    ownerUnitId: owner.id,
    mergeUnitId: merge?.id ?? null,
    options: rootUnits.map((unit, optionIndex) => {
      const start = unitIndex.get(unit.id)!;
      const next = rootUnits[optionIndex + 1];
      const end = next ? unitIndex.get(next.id)! : mergeIndex;
      return {
        sourceUnitId: unit.id,
        text: explicitChoicesByUnit.get(unit.id)![0],
        routeUnitIds: source.units
          .slice(start + 1, end)
          .filter((candidate) => (
            visibleUnitIds.has(candidate.id) && !explicitUnitIds.has(candidate.id)
          ))
          .map((candidate) => candidate.id),
      };
    }),
  };
  const otherDecisions = filtered.flatMap((decision) => {
    const options = decision.options.filter((option) => !rootUnitIds.has(option.sourceUnitId));
    return options.length > 0 ? [{ ...decision, options }] : [];
  });
  return [rootDecision, ...otherDecisions];
}

function inferMissingDecisionMerges(
  decisions: AiBranchStructure['decisions'],
  source: SegmentedStorySource,
  structuralUnitIds: Set<string>
): AiBranchStructure['decisions'] {
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const routeUnitIds = new Set(
    decisions.flatMap((decision) => decision.options.flatMap((option) => option.routeUnitIds))
  );
  const choiceUnitIds = new Set(
    decisions.flatMap((decision) => decision.options.map((option) => option.sourceUnitId))
  );
  return decisions.map((decision) => {
    if (decision.mergeUnitId) return decision;
    const ownedIndexes = [
      ...decision.options.map((option) => unitIndex.get(option.sourceUnitId)),
      ...decision.options.flatMap((option) => (
        option.routeUnitIds.map((unitId) => unitIndex.get(unitId))
      )),
    ].filter((index): index is number => index !== undefined);
    const afterIndex = Math.max(-1, ...ownedIndexes);
    const merge = source.units.find((unit, index) => (
      index > afterIndex
      && !routeUnitIds.has(unit.id)
      && !choiceUnitIds.has(unit.id)
      && !structuralUnitIds.has(unit.id)
    ));
    return merge ? { ...decision, mergeUnitId: merge.id } : decision;
  });
}

function coalesceSingletonDecisionsByMerge(
  decisions: AiBranchStructure['decisions'],
  source: SegmentedStorySource
): AiBranchStructure['decisions'] {
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const groups = new Map<string, AiBranchStructure['decisions']>();
  for (const decision of decisions) {
    if (decision.options.length !== 1 || !decision.mergeUnitId) continue;
    const group = groups.get(decision.mergeUnitId) ?? [];
    group.push(decision);
    groups.set(decision.mergeUnitId, group);
  }
  const consumed = new Set<AiBranchStructure['decisions'][number]>();
  const result: AiBranchStructure['decisions'] = [];
  for (const decision of decisions) {
    if (consumed.has(decision)) continue;
    const group = decision.mergeUnitId ? groups.get(decision.mergeUnitId) ?? [] : [];
    if (decision.options.length === 1 && group.length > 1) {
      const ordered = [...group].sort((left, right) => (
        (unitIndex.get(left.options[0].sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndex.get(right.options[0].sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
      ));
      ordered.forEach((candidate) => consumed.add(candidate));
      result.push({
        ownerUnitId: ordered[0].ownerUnitId,
        mergeUnitId: decision.mergeUnitId,
        options: ordered.flatMap((candidate) => candidate.options),
      });
      continue;
    }
    consumed.add(decision);
    result.push(decision);
  }
  return result;
}

function repairAnchoredRouteOwnership(
  decisions: AiBranchStructure['decisions'],
  source: SegmentedStorySource,
  structuralUnitIds: Set<string>,
  endingUnitIds: Set<string>
): AiBranchStructure['decisions'] {
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const choiceUnitIds = new Set(
    decisions.flatMap((decision) => decision.options.map((option) => option.sourceUnitId))
  );
  const repaired = decisions.map((decision) => ({
    ...decision,
    options: decision.options.map((option) => ({
      ...option,
      routeUnitIds: [...new Set(option.routeUnitIds)].filter((unitId) => !endingUnitIds.has(unitId)),
    })),
  }));

  for (const decision of repaired) {
    const orderedOptions = [...decision.options].sort((left, right) => (
      (unitIndex.get(left.sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
      - (unitIndex.get(right.sourceUnitId) ?? Number.MAX_SAFE_INTEGER)
    ));
    orderedOptions.forEach((option, optionIndex) => {
      const start = unitIndex.get(option.sourceUnitId);
      if (start === undefined) return;
      const nextOptionIndex = orderedOptions[optionIndex + 1]
        ? unitIndex.get(orderedOptions[optionIndex + 1].sourceUnitId)
        : undefined;
      const nextStructuralIndex = source.units.findIndex((unit, index) => (
        index > start && structuralUnitIds.has(unit.id)
      ));
      const mergeIndex = decision.mergeUnitId
        ? unitIndex.get(decision.mergeUnitId)
        : undefined;
      const upperBound = Math.min(
        nextOptionIndex ?? source.units.length,
        nextStructuralIndex >= 0 ? nextStructuralIndex : source.units.length,
        mergeIndex ?? source.units.length
      );
      const previewUnitIds = source.units
        .slice(start + 1, upperBound)
        .filter((unit) => (
          !choiceUnitIds.has(unit.id)
          && !structuralUnitIds.has(unit.id)
          && !endingUnitIds.has(unit.id)
        ))
        .slice(0, 1)
        .map((unit) => unit.id);
      for (const previewUnitId of previewUnitIds) {
        for (const sibling of decision.options) {
          sibling.routeUnitIds = sibling.routeUnitIds.filter((unitId) => unitId !== previewUnitId);
        }
        option.routeUnitIds.push(previewUnitId);
      }
    });
  }

  for (const endingUnitId of endingUnitIds) {
    if (repaired.some((decision) => decision.mergeUnitId === endingUnitId)) continue;
    const endingIndex = unitIndex.get(endingUnitId);
    if (endingIndex === undefined) continue;
    let closest: { option: AiBranchStructure['decisions'][number]['options'][number]; index: number }
      | undefined;
    for (const decision of repaired) {
      for (const option of decision.options) {
        const priorIndexes = option.routeUnitIds
          .map((unitId) => unitIndex.get(unitId))
          .filter((index): index is number => index !== undefined && index < endingIndex);
        const nearestIndex = Math.max(-1, ...priorIndexes);
        if (nearestIndex >= 0 && (!closest || nearestIndex > closest.index)) {
          closest = { option, index: nearestIndex };
        }
      }
    }
    closest?.option.routeUnitIds.push(endingUnitId);
  }

  for (const decision of repaired) {
    for (const option of decision.options) {
      option.routeUnitIds = [...new Set(option.routeUnitIds)].sort((left, right) => (
        (unitIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      ));
    }
  }
  return repaired;
}

function isExplicitEndingSourceUnit(value: string): boolean {
  return /(?:【\s*)?\u7ed3\u5c40(?:\u6807\u8bb0|[A-Za-z0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24]*)?\s*[：:]/.test(value)
    || /^\s*\u7ed3\u5c40\s*\d+\s*[-—]/.test(value);
}

function promoteSharedSiblingRouteUnits(
  decisions: AiBranchStructure['decisions'],
  source: SegmentedStorySource
): AiBranchStructure['decisions'] {
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  return decisions.map((decision) => {
    const counts = new Map<string, number>();
    for (const option of decision.options) {
      for (const unitId of new Set(option.routeUnitIds)) {
        counts.set(unitId, (counts.get(unitId) ?? 0) + 1);
      }
    }
    const sharedUnitIds = [...counts]
      .filter(([, count]) => count > 1)
      .map(([unitId]) => unitId)
      .sort((left, right) => (
        (unitIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (unitIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      ));
    const shared = new Set(sharedUnitIds);
    return {
      ...decision,
      mergeUnitId: decision.mergeUnitId ?? sharedUnitIds[0] ?? null,
      options: decision.options.map((option) => ({
        ...option,
        routeUnitIds: option.routeUnitIds.filter((unitId) => !shared.has(unitId)),
      })),
    };
  });
}

function buildGroupedRelationships(
  structure: AiBranchStructure,
  inventory: StoryPlanInventory,
  resolveBackward: (unitId: string) => string | undefined,
  resolveForward: (unitId: string) => string | undefined
): { nextOverrides: Array<{ nodeId: string; targetNodeId: string }>; breakAfterNodeIds: string[] } {
  const decisionOwnerNodeIds = new Set(structure.decisions.map((decision) => {
    const owner = resolveBackward(decision.ownerUnitId);
    if (!owner) throw new Error('AI branch decision owner does not map to a visible source node');
    return owner;
  }));
  const routeUnits = new Set<string>();
  for (const decision of structure.decisions) {
    for (const option of decision.options) {
      assertUnique('route', option.routeUnitIds, option.routeUnitIds.length);
      for (const unitId of option.routeUnitIds) {
        routeUnits.add(unitId);
      }
    }
  }

  const desiredNext = new Map<string, string>();
  const breaks = new Set<string>();
  const priorityByNode = new Map<string, number>();
  const setNext = (nodeId: string, targetNodeId: string, priority: number) => {
    const existingPriority = priorityByNode.get(nodeId) ?? -1;
    if (existingPriority > priority) return;
    const existing = desiredNext.get(nodeId);
    if (existingPriority === priority && existing && existing !== targetNodeId) return;
    priorityByNode.set(nodeId, priority);
    desiredNext.set(nodeId, targetNodeId);
    breaks.delete(nodeId);
  };
  const setBreak = (nodeId: string, priority: number) => {
    const existingPriority = priorityByNode.get(nodeId) ?? -1;
    if (existingPriority > priority) return;
    priorityByNode.set(nodeId, priority);
    desiredNext.delete(nodeId);
    breaks.add(nodeId);
  };

  const sharedNodes = inventory.nodes.filter((node) => !routeUnits.has(node.unitId));
  sharedNodes.forEach((node, index) => {
    if (decisionOwnerNodeIds.has(node.id)) return;
    const successor = sharedNodes[index + 1];
    if (successor) setNext(node.id, successor.id, 0);
    else setBreak(node.id, 0);
  });

  structure.decisions.forEach((decision, decisionIndex) => {
    const priority = decisionIndex + 1;
    for (const option of decision.options) {
      const route = option.routeUnitIds.map((unitId) => {
        const firstNodeId = resolveForward(unitId);
        const lastNodeId = resolveBackward(unitId);
        if (!firstNodeId || !lastNodeId) {
          throw new Error('AI branch route does not map to visible source nodes');
        }
        return { firstNodeId, lastNodeId };
      });
      route.forEach((part, index) => {
        if (decisionOwnerNodeIds.has(part.lastNodeId)) return;
        const successor = route[index + 1];
        if (successor) {
          setNext(part.lastNodeId, successor.firstNodeId, priority);
        } else {
          const continuationUnitId = Object.hasOwn(option, 'nextUnitId')
            ? option.nextUnitId
            : decision.mergeUnitId;
          if (!continuationUnitId) {
            setBreak(part.lastNodeId, priority);
            return;
          }
          const mergeNodeId = resolveForward(continuationUnitId);
          if (!mergeNodeId) throw new Error('AI branch merge does not map to a visible source node');
          setNext(part.lastNodeId, mergeNodeId, priority);
        }
      });
    }
  });

  structure.breakAfterUnitIds.forEach((unitId) => {
    const nodeId = resolveBackward(unitId);
    if (!nodeId) throw new Error('AI branch terminal does not map to a visible source node');
    setBreak(nodeId, structure.decisions.length + 1);
  });

  return {
    nextOverrides: [...desiredNext].map(([nodeId, targetNodeId]) => ({ nodeId, targetNodeId })),
    breakAfterNodeIds: [...breaks],
  };
}

/**
 * A reachable graph is not necessarily a correct choice graph. This catches
 * the common model error where the automatic successor of option A is the
 * first row of option B's branch. Traversal intentionally stops at a nested
 * decision owner because that decision is conditional and must be validated
 * independently.
 */
function isolateSiblingBranchLeaks(plan: StoryRelationshipPlan): StoryRelationshipPlan {
  const nodes = plan.nodes.map((node) => ({ ...node }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const choicesByOwner = new Map<string, typeof plan.choices>();
  for (const choice of plan.choices) {
    const choices = choicesByOwner.get(choice.fromNodeId) ?? [];
    choices.push(choice);
    choicesByOwner.set(choice.fromNodeId, choices);
  }

  for (const choices of choicesByOwner.values()) {
    if (choices.length < 2) continue;
    const siblingTargets = new Set(choices.map((choice) => choice.targetNodeId));
    for (const choice of choices) {
      const seen = new Set<string>();
      let currentId = choice.targetNodeId;
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        if (choicesByOwner.has(currentId)) break;
        const node = nodesById.get(currentId);
        const nextId = node?.nextNodeId ?? '';
        if (node && nextId && siblingTargets.has(nextId) && nextId !== choice.targetNodeId) {
          node.nextNodeId = '';
          break;
        }
        currentId = nextId;
      }
    }
  }
  return { ...plan, nodes };
}

function cleanChoiceDisplayText(value: string): string {
  const labeled = /^(?:(?:\u5d4c\u5957|\u5b50)?\u9009\u62e9|\u53ef\u9009\u65b9\u6848|\u9009\u9879|option)\s*[A-Za-z0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24]+\s*(?:[：:]\s*(.+)|[（(]([^）)]+)[）)])/iu.exec(value.trim());
  return (labeled?.[1] ?? labeled?.[2] ?? value).trim();
}

function positionInventory(inventory: StoryPlanInventory): {
  firstByUnit: Map<string, string>;
  lastByUnit: Map<string, string>;
} {
  const firstByUnit = new Map<string, string>();
  const lastByUnit = new Map<string, string>();
  for (const node of inventory.nodes) {
    if (!firstByUnit.has(node.unitId)) firstByUnit.set(node.unitId, node.id);
    lastByUnit.set(node.unitId, node.id);
  }
  return { firstByUnit, lastByUnit };
}

function assertUnique(kind: string, ids: string[], expectedLength: number): void {
  if (new Set(ids).size !== expectedLength) throw new Error(`AI branch ${kind} IDs must be unique`);
}
