import { z } from 'zod';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import {
  materializeAiBranchStructure,
  parseAiBranchStructure,
} from './aiBranchPlanner';
import { isExplicitMergeBoundary } from './explicitParser';
import type { SegmentedStorySource } from './sourceSegments';

const IdSchema = z.string().trim().min(1);

const SemanticLineageSchema = z.object({
  version: z.literal(3),
  structuralUnitIds: z.array(IdSchema),
  mergeUnitIds: z.array(IdSchema).default([]),
  decisions: z.array(z.object({
    id: IdSchema,
    ownerUnitId: IdSchema,
    options: z.array(z.object({
      id: IdSchema,
      sourceUnitId: IdSchema,
      text: z.string().trim().min(1),
    }).strict()).min(1),
  }).strict()),
  histories: z.array(z.object({
    id: IdSchema,
    optionIds: z.array(IdSchema).min(1),
  }).strict()).min(1),
  unitClaims: z.array(z.object({
    sourceUnitId: IdSchema,
    historyIds: z.array(IdSchema).min(1),
  }).strict()),
}).strict();

const SemanticLineagePatchSchema = z.object({
  operations: z.array(z.discriminatedUnion('action', [
    z.object({
      action: z.literal('set_unit_histories'),
      unitId: IdSchema,
      historyIds: z.array(IdSchema).min(1),
    }).strict(),
    z.object({
      action: z.literal('set_structural'),
      unitId: IdSchema,
      structural: z.boolean(),
    }).strict(),
    z.object({
      action: z.literal('set_history_options'),
      historyId: IdSchema,
      optionIds: z.array(IdSchema).min(1),
    }).strict(),
  ])).min(1),
}).strict();

export type SemanticLineage = z.infer<typeof SemanticLineageSchema>;
export type SemanticLineagePatch = z.infer<typeof SemanticLineagePatchSchema>;

const nonEmptyString = { type: 'string', minLength: 1 };

export const AI_SEMANTIC_LINEAGE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_branch_structure',
    description: 'Submit semantic decisions, leaf histories, and source-unit history membership.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        structuralUnitIds: { type: 'array', items: nonEmptyString },
        mergeUnitIds: { type: 'array', items: nonEmptyString },
        decisions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: nonEmptyString,
              ownerUnitId: nonEmptyString,
              options: {
                type: 'array', minItems: 1,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    id: nonEmptyString,
                    sourceUnitId: nonEmptyString,
                    text: nonEmptyString,
                  },
                  required: ['id', 'sourceUnitId', 'text'],
                },
              },
            },
            required: ['id', 'ownerUnitId', 'options'],
          },
        },
        histories: {
          type: 'array', minItems: 1,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: nonEmptyString,
              optionIds: { type: 'array', minItems: 1, items: nonEmptyString },
            },
            required: ['id', 'optionIds'],
          },
        },
        unitClaims: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              sourceUnitId: nonEmptyString,
              historyIds: { type: 'array', minItems: 1, items: nonEmptyString },
            },
            required: ['sourceUnitId', 'historyIds'],
          },
        },
      },
      required: [
        'version', 'structuralUnitIds', 'mergeUnitIds',
        'decisions', 'histories', 'unitClaims',
      ],
    },
  },
};

export const AI_SEMANTIC_LINEAGE_PATCH_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_branch_patch',
    description: 'Patch only affected semantic history membership.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        operations: {
          type: 'array', minItems: 1,
          items: {
            anyOf: [
              {
                type: 'object', additionalProperties: false,
                properties: {
                  action: { type: 'string', enum: ['set_unit_histories'] },
                  unitId: nonEmptyString,
                  historyIds: { type: 'array', minItems: 1, items: nonEmptyString },
                },
                required: ['action', 'unitId', 'historyIds'],
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  action: { type: 'string', enum: ['set_structural'] },
                  unitId: nonEmptyString,
                  structural: { type: 'boolean' },
                },
                required: ['action', 'unitId', 'structural'],
              },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  action: { type: 'string', enum: ['set_history_options'] },
                  historyId: nonEmptyString,
                  optionIds: { type: 'array', minItems: 1, items: nonEmptyString },
                },
                required: ['action', 'historyId', 'optionIds'],
              },
            ],
          },
        },
      },
      required: ['operations'],
    },
  },
};

const SEMANTIC_LINEAGE_PROMPT = `You are the semantic branch planner for a screenplay.
Call submit_branch_structure exactly once. Return semantic membership, never graph jumps.
Identify every real decision and every complete leaf history through nested decisions. Give decisions, options, and histories unique short IDs.
For every visible non-option source unit, emit exactly one unitClaims item listing every leaf history on which that exact content plays. Parent-route content belongs to every descendant history. History-specific later content belongs only to its matching history.
Shared content before later history-specific variants still belongs to every affected history; the server will replay it without losing history. A final suffix shared after all variants also belongs to every history; the server will merge it safely.
Use mergeUnitIds for the first visible common unit where prior choices no longer affect later playback. Do not mark shared content as a merge when later variants still depend on the earlier history. A story may merge and then make a new independent decision.
Option source rows are represented in decisions.options and must not appear in unitClaims. Put only non-visible headings, branch labels, and formatting rows in structuralUnitIds. Do not classify dialogue, action, scene content, inner thoughts, ending summaries, or final captions as structural.
Use semantic meaning rather than requiring A/B labels or fixed formatting. Never place one sibling's exclusive content on another sibling history. Cover every visible non-option unit exactly once in unitClaims.`;

const SEMANTIC_LINEAGE_PATCH_PROMPT = `Repair semantic lineage using submit_branch_patch exactly once.
Return patch operations only. Change only source units named in validationIssues, or a history option chain directly required to correct those units. Use set_unit_histories for wrong, omitted, or cross-branch content. Shared content before later variants belongs to all affected histories; each later variant belongs only to its matching history. Preserve every unrelated decision, history, and unit claim.`;

export function parseSemanticLineage(value: unknown): SemanticLineage {
  return SemanticLineageSchema.parse(value);
}

export function parseSemanticLineagePatch(value: unknown): SemanticLineagePatch {
  return SemanticLineagePatchSchema.parse(value);
}

export function parseSemanticLineageForSource(
  value: unknown,
  source: SegmentedStorySource
): SemanticLineage {
  const parsed = parseSemanticLineage(value);
  const aliases = new Map(source.units.map((unit, index) => [`u${index}`, unit.id]));
  const unitId = (id: string) => aliases.get(id) ?? id;
  return SemanticLineageSchema.parse({
    ...parsed,
    structuralUnitIds: parsed.structuralUnitIds.map(unitId),
    mergeUnitIds: parsed.mergeUnitIds.map(unitId),
    decisions: parsed.decisions.map((decision) => ({
      ...decision,
      ownerUnitId: unitId(decision.ownerUnitId),
      options: decision.options.map((option) => ({
        ...option,
        sourceUnitId: unitId(option.sourceUnitId),
      })),
    })),
    unitClaims: parsed.unitClaims.map((claim) => ({
      ...claim,
      sourceUnitId: unitId(claim.sourceUnitId),
    })),
  });
}

export function parseSemanticLineagePatchForSource(
  value: unknown,
  source: SegmentedStorySource
): SemanticLineagePatch {
  const patch = parseSemanticLineagePatch(value);
  const aliases = new Map(source.units.map((unit, index) => [`u${index}`, unit.id]));
  return {
    operations: patch.operations.map((operation) => (
      operation.action === 'set_unit_histories' || operation.action === 'set_structural'
        ? { ...operation, unitId: aliases.get(operation.unitId) ?? operation.unitId }
        : operation
    )),
  };
}

export function buildSemanticLineageMessages(
  source: SegmentedStorySource,
  validationIssues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }> = [],
  previous?: SemanticLineage
): ChatMessage[] {
  const realToAlias = new Map(source.units.map((unit, index) => [unit.id, `u${index}`]));
  const alias = (id: string) => realToAlias.get(id) ?? id;
  const sourceUnits = source.units.map((unit, index) => {
    const explicitChoiceTexts = source.segments
      .filter((segment) => segment.unitId === unit.id && segment.kind === 'choice_text')
      .map((segment) => segment.text);
    return {
      id: `u${index}`,
      text: unit.text,
      visible: source.segments.some((segment) => segment.unitId === unit.id && segment.display),
      ...(explicitChoiceTexts.length > 0 ? { explicitChoiceTexts } : {}),
    };
  });
  const mapPrevious = (structure: SemanticLineage) => ({
    ...structure,
    structuralUnitIds: structure.structuralUnitIds.map(alias),
    mergeUnitIds: structure.mergeUnitIds.map(alias),
    decisions: structure.decisions.map((decision) => ({
      ...decision,
      ownerUnitId: alias(decision.ownerUnitId),
      options: decision.options.map((option) => ({
        ...option,
        sourceUnitId: alias(option.sourceUnitId),
      })),
    })),
    unitClaims: structure.unitClaims.map((claim) => ({
      ...claim,
      sourceUnitId: alias(claim.sourceUnitId),
    })),
  });
  return [
    { role: 'system', content: SEMANTIC_LINEAGE_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: previous ? 'REPAIR_SEMANTIC_LINEAGE' : 'PLAN_SEMANTIC_LINEAGE',
      sourceUnits,
      validationIssues: validationIssues.map((issue) => ({
        ...issue,
        unitIds: (issue.unitIds ?? []).map(alias),
      })),
      ...(previous ? { previousSemanticLineage: mapPrevious(previous) } : {}),
    }) },
  ];
}

export function buildSemanticLineagePatchMessages(
  source: SegmentedStorySource,
  issues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }>,
  candidate: SemanticLineage
): ChatMessage[] {
  const [, user] = buildSemanticLineageMessages(source, issues, candidate);
  const input = JSON.parse(user.content as string) as Record<string, unknown>;
  return [
    { role: 'system', content: SEMANTIC_LINEAGE_PATCH_PROMPT },
    { role: 'user', content: JSON.stringify({
      ...input,
      task: 'PATCH_SEMANTIC_LINEAGE',
    }) },
  ];
}

export function applySemanticLineagePatch(
  candidate: SemanticLineage,
  patch: SemanticLineagePatch,
  issues: Array<{ message?: string; unitIds?: string[]; nodeIds?: string[] }>
): SemanticLineage {
  const affected = new Set(issues.flatMap((issue) => issue.unitIds ?? []));
  const repaired: SemanticLineage = {
    ...candidate,
    structuralUnitIds: [...candidate.structuralUnitIds],
    decisions: candidate.decisions.map((decision) => ({
      ...decision,
      options: decision.options.map((option) => ({ ...option })),
    })),
    histories: candidate.histories.map((history) => ({
      ...history,
      optionIds: [...history.optionIds],
    })),
    unitClaims: candidate.unitClaims.map((claim) => ({
      ...claim,
      historyIds: [...claim.historyIds],
    })),
  };
  const historyIds = new Set(repaired.histories.map((history) => history.id));
  const optionIds = new Set(repaired.decisions.flatMap((decision) => (
    decision.options.map((option) => option.id)
  )));
  const relationshipKeys = new Set<string>();
  for (const operation of patch.operations) {
    const relationshipKey = operation.action === 'set_history_options'
      ? `history:${operation.historyId}`
      : `unit:${operation.unitId}`;
    if (relationshipKeys.has(relationshipKey)) {
      throw new Error(`Semantic lineage patch has conflicting operations for ${relationshipKey}`);
    }
    relationshipKeys.add(relationshipKey);
    if (operation.action === 'set_unit_histories') {
      if (!affected.has(operation.unitId)) {
        throw new Error(`Semantic lineage patch unit ${operation.unitId} is unrelated to validation issues`);
      }
      if (operation.historyIds.some((historyId) => !historyIds.has(historyId))) {
        throw new Error('Semantic lineage patch references an unknown history');
      }
      const claim = repaired.unitClaims.find((item) => item.sourceUnitId === operation.unitId);
      if (claim) claim.historyIds = [...new Set(operation.historyIds)];
      else repaired.unitClaims.push({
        sourceUnitId: operation.unitId,
        historyIds: [...new Set(operation.historyIds)],
      });
    } else if (operation.action === 'set_structural') {
      if (!affected.has(operation.unitId)) {
        throw new Error(`Semantic lineage patch unit ${operation.unitId} is unrelated to validation issues`);
      }
      repaired.structuralUnitIds = operation.structural
        ? [...new Set([...repaired.structuralUnitIds, operation.unitId])]
        : repaired.structuralUnitIds.filter((unitId) => unitId !== operation.unitId);
      if (operation.structural) {
        repaired.unitClaims = repaired.unitClaims.filter((claim) => (
          claim.sourceUnitId !== operation.unitId
        ));
      }
    } else {
      const history = repaired.histories.find((item) => item.id === operation.historyId);
      if (!history) throw new Error('Semantic lineage patch references an unknown history');
      if (operation.optionIds.some((optionId) => !optionIds.has(optionId))) {
        throw new Error('Semantic lineage patch references an unknown option');
      }
      history.optionIds = [...new Set(operation.optionIds)];
    }
  }
  return SemanticLineageSchema.parse(repaired);
}

export function materializeSemanticLineage(
  source: SegmentedStorySource,
  structure: SemanticLineage
) {
  const effectiveStructure = normalizeSemanticRoleConflicts(
    source,
    normalizeMergeControlHeadings(source, structure)
  );
  validateSemanticLineage(source, effectiveStructure);
  const unitIndex = new Map(source.units.map((unit, index) => [unit.id, index]));
  const historyById = new Map(effectiveStructure.histories.map((history) => [history.id, history]));
  const optionEntries = effectiveStructure.decisions.flatMap((decision, decisionIndex) => (
    decision.options.map((option, optionIndex) => ({
      decision,
      decisionIndex,
      option,
      optionIndex,
      sourceIndex: unitIndex.get(option.sourceUnitId)!,
    }))
  ));
  const optionById = new Map(optionEntries.map((entry) => [entry.option.id, entry]));
  const claimsByUnit = new Map(effectiveStructure.unitClaims.map((claim) => (
    [claim.sourceUnitId, new Set(claim.historyIds)] as const
  )));
  const optionUnitIds = new Set(optionEntries.map((entry) => entry.option.sourceUnitId));
  const structuralUnitIds = new Set(effectiveStructure.structuralUnitIds);
  const explicitMergeUnitIds = source.units.flatMap((unit, index) => {
    if (!isExplicitMergeBoundary(unit.text)) return [];
    const target = source.units.slice(index + 1).find((candidate) => (
      claimsByUnit.has(candidate.id)
      && !optionUnitIds.has(candidate.id)
      && !structuralUnitIds.has(candidate.id)
    ));
    return target ? [target.id] : [];
  });
  const mergeUnitIds = [...new Set([
    ...effectiveStructure.mergeUnitIds,
    ...explicitMergeUnitIds,
  ])];
  const mergeTargetByDecisionId = new Map<string, string>();
  for (const mergeUnitId of mergeUnitIds) {
    const mergeIndex = unitIndex.get(mergeUnitId);
    const mergeHistories = claimsByUnit.get(mergeUnitId);
    if (mergeIndex === undefined || !mergeHistories) continue;
    const eligible = effectiveStructure.decisions.filter((decision) => {
      if ((unitIndex.get(decision.ownerUnitId) ?? Number.MAX_SAFE_INTEGER) >= mergeIndex) {
        return false;
      }
      const siblingOptionIds = new Set(decision.options.map((option) => option.id));
      const selectedCounts = new Map(decision.options.map((option) => [option.id, 0]));
      for (const historyId of mergeHistories) {
        const selected = historyById.get(historyId)?.optionIds.filter((optionId) => (
          siblingOptionIds.has(optionId)
        )) ?? [];
        if (selected.length !== 1) return false;
        selectedCounts.set(selected[0], (selectedCounts.get(selected[0]) ?? 0) + 1);
      }
      return [...selectedCounts.values()].every((count) => count > 0);
    }).sort((left, right) => (
      (unitIndex.get(right.ownerUnitId) ?? -1) - (unitIndex.get(left.ownerUnitId) ?? -1)
    ));
    if (eligible[0]) mergeTargetByDecisionId.set(eligible[0].id, mergeUnitId);
  }
  const mergeIndexByDecisionId = new Map([...mergeTargetByDecisionId].map(([
    decisionId,
    mergeUnitId,
  ]) => [decisionId, unitIndex.get(mergeUnitId)!]));
  const visibleSequences = new Map(effectiveStructure.histories.map((history) => [
    history.id,
    source.units.flatMap((unit) => (
      !optionUnitIds.has(unit.id)
      && !structuralUnitIds.has(unit.id)
      && claimsByUnit.get(unit.id)?.has(history.id)
        ? [unit.id]
        : []
    )),
  ]));
  const commonSuffix = commonTerminalSuffix([...visibleSequences.values()]);
  const commonSuffixSet = new Set(commonSuffix);
  const routeUnitsByOption = new Map(optionEntries.map((entry) => (
    [entry.option.id, new Set<string>()] as const
  )));

  for (const claim of effectiveStructure.unitClaims) {
    if (commonSuffixSet.has(claim.sourceUnitId)) continue;
    const position = unitIndex.get(claim.sourceUnitId)!;
    for (const historyId of claim.historyIds) {
      const history = historyById.get(historyId)!;
      const owner = history.optionIds
        .map((optionId) => optionById.get(optionId)!)
        .filter((entry) => (
          entry.sourceIndex < position
          && (mergeIndexByDecisionId.get(entry.decision.id) ?? Number.MAX_SAFE_INTEGER) > position
        ))
        .sort((left, right) => right.sourceIndex - left.sourceIndex)[0];
      if (owner) routeUnitsByOption.get(owner.option.id)!.add(claim.sourceUnitId);
    }
  }

  const suffixTarget = commonSuffix[0] ?? null;
  const leafOptionIds = new Set(effectiveStructure.histories.map((history) => history.optionIds.at(-1)!));
  const decisions = effectiveStructure.decisions.map((decision) => {
    const explicitMergeTarget = mergeTargetByDecisionId.get(decision.id) ?? null;
    const options = decision.options.map((option) => ({
      sourceUnitId: option.sourceUnitId,
      text: option.text,
      routeUnitIds: [...routeUnitsByOption.get(option.id)!]
        .sort((left, right) => unitIndex.get(left)! - unitIndex.get(right)!),
      nextUnitId: explicitMergeTarget
        ?? (leafOptionIds.has(option.id) ? suffixTarget : null),
    }));
    const mergeUnitId = explicitMergeTarget
      ?? (suffixTarget && options.every((option) => option.nextUnitId === suffixTarget)
        ? suffixTarget
        : null);
    return { ownerUnitId: decision.ownerUnitId, mergeUnitId, options };
  });
  const routeOccurrences = new Map<string, number>();
  const decisionOwnerUnitIds = new Set(decisions.map((decision) => decision.ownerUnitId));
  decisions.forEach((decision) => decision.options.forEach((option) => {
    option.routeUnitIds.forEach((unitId) => {
      if (decisionOwnerUnitIds.has(unitId)) return;
      routeOccurrences.set(unitId, (routeOccurrences.get(unitId) ?? 0) + 1);
    });
  }));
  const sharedReplayUnitIds = [...routeOccurrences]
    .filter(([, count]) => count > 1)
    .map(([unitId]) => unitId);
  const terminalUnitIds = commonSuffix.length > 0
    ? [commonSuffix.at(-1)!]
    : [...leafOptionIds].flatMap((optionId) => {
        const route = [...routeUnitsByOption.get(optionId)!]
          .sort((left, right) => unitIndex.get(left)! - unitIndex.get(right)!);
        return route.at(-1) ? [route.at(-1)!] : [];
      });

  return materializeAiBranchStructure(source, parseAiBranchStructure({
    version: 2,
    structuralUnitIds: effectiveStructure.structuralUnitIds,
    sharedReplayUnitIds,
    decisions,
    breakAfterUnitIds: [...new Set(terminalUnitIds)],
  }));
}

function normalizeSemanticRoleConflicts(
  source: SegmentedStorySource,
  structure: SemanticLineage
): SemanticLineage {
  const optionUnitIds = new Set(structure.decisions.flatMap((decision) => (
    decision.options.map((option) => option.sourceUnitId)
  )));
  const sourceStructuralUnitIds = new Set(source.units.flatMap((unit) => {
    const segments = source.segments.filter((segment) => segment.unitId === unit.id);
    return segments.length > 0 && segments.every((segment) => (
      !segment.display
      && ['structural', 'branch_marker', 'jump_hint', 'command'].includes(segment.kind)
    )) ? [unit.id] : [];
  }));
  const structuralUnitIds = new Set(structure.structuralUnitIds.filter((unitId) => (
    !optionUnitIds.has(unitId)
  )));
  const unitClaims = structure.unitClaims.filter((claim) => {
    if (optionUnitIds.has(claim.sourceUnitId)) return false;
    if (!structuralUnitIds.has(claim.sourceUnitId)) return true;
    if (sourceStructuralUnitIds.has(claim.sourceUnitId)) return false;
    structuralUnitIds.delete(claim.sourceUnitId);
    return true;
  });
  return SemanticLineageSchema.parse({
    ...structure,
    structuralUnitIds: [...structuralUnitIds],
    unitClaims,
  });
}

function normalizeMergeControlHeadings(
  source: SegmentedStorySource,
  structure: SemanticLineage
): SemanticLineage {
  const controlUnitIds = new Set(source.units.flatMap((unit) => {
    const text = unit.text.trim();
    const controlHeading = /^【[^】]+】$/.test(text)
      || /^\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\u5e55(?:[：:]|.*(?:\u6c47\u5165|\u6c47\u5408|\u6c47\u805a|\u5408\u6d41))/.test(text);
    return controlHeading && isExplicitMergeBoundary(text) ? [unit.id] : [];
  }));
  if (controlUnitIds.size === 0) return structure;
  return SemanticLineageSchema.parse({
    ...structure,
    structuralUnitIds: [...new Set([
      ...structure.structuralUnitIds,
      ...controlUnitIds,
    ])],
    mergeUnitIds: structure.mergeUnitIds.filter((unitId) => !controlUnitIds.has(unitId)),
    unitClaims: structure.unitClaims.filter((claim) => (
      !controlUnitIds.has(claim.sourceUnitId)
    )),
  });
}

function validateSemanticLineage(
  source: SegmentedStorySource,
  structure: SemanticLineage
): void {
  const knownUnits = new Set(source.units.map((unit) => unit.id));
  const decisionIds = structure.decisions.map((decision) => decision.id);
  const optionIds = structure.decisions.flatMap((decision) => (
    decision.options.map((option) => option.id)
  ));
  const historyIds = structure.histories.map((history) => history.id);
  assertUnique('decision', decisionIds);
  assertUnique('option', optionIds);
  assertUnique('history', historyIds);
  assertUnique('structural unit', structure.structuralUnitIds);
  assertUnique('merge unit', structure.mergeUnitIds);
  assertUnique('unit claim', structure.unitClaims.map((claim) => claim.sourceUnitId));
  const knownOptions = new Set(optionIds);
  const knownHistories = new Set(historyIds);
  const optionUnitIds = new Set(structure.decisions.flatMap((decision) => (
    decision.options.map((option) => option.sourceUnitId)
  )));
  const structural = new Set(structure.structuralUnitIds);
  const referencedUnits = [
    ...structure.structuralUnitIds,
    ...structure.mergeUnitIds,
    ...structure.decisions.flatMap((decision) => [
      decision.ownerUnitId,
      ...decision.options.map((option) => option.sourceUnitId),
    ]),
    ...structure.unitClaims.map((claim) => claim.sourceUnitId),
  ];
  if (referencedUnits.some((unitId) => !knownUnits.has(unitId))) {
    throw new Error('Semantic lineage references an unknown source unit');
  }
  for (const history of structure.histories) {
    assertUnique(`history ${history.id} option`, history.optionIds);
    if (history.optionIds.some((optionId) => !knownOptions.has(optionId))) {
      throw new Error(`Semantic history ${history.id} references an unknown option`);
    }
    for (const decision of structure.decisions) {
      const siblingIds = new Set(decision.options.map((option) => option.id));
      if (history.optionIds.filter((optionId) => siblingIds.has(optionId)).length > 1) {
        throw new Error(`Semantic history ${history.id} selects sibling options`);
      }
    }
  }
  for (const claim of structure.unitClaims) {
    assertUnique(`unit ${claim.sourceUnitId} history`, claim.historyIds);
    if (claim.historyIds.some((historyId) => !knownHistories.has(historyId))) {
      throw new Error(`Semantic unit ${claim.sourceUnitId} references an unknown history`);
    }
    if (optionUnitIds.has(claim.sourceUnitId) || structural.has(claim.sourceUnitId)) {
      throw new Error(`Semantic unit ${claim.sourceUnitId} cannot be both claimed and structural/option`);
    }
  }
  const claimed = new Set(structure.unitClaims.map((claim) => claim.sourceUnitId));
  const visibleUnitIds = new Set(source.segments
    .filter((segment) => segment.display)
    .map((segment) => segment.unitId));
  const omitted = source.units.find((unit) => (
    visibleUnitIds.has(unit.id)
    && !optionUnitIds.has(unit.id)
    && !structural.has(unit.id)
    && !claimed.has(unit.id)
  ));
  if (omitted) throw new Error(`Semantic lineage omits visible source unit ${omitted.id}`);
}

function commonTerminalSuffix(sequences: string[][]): string[] {
  if (sequences.length === 0) return [];
  const shortest = Math.min(...sequences.map((sequence) => sequence.length));
  const suffix: string[] = [];
  for (let offset = 1; offset <= shortest; offset += 1) {
    const unitId = sequences[0].at(-offset)!;
    if (!sequences.every((sequence) => sequence.at(-offset) === unitId)) break;
    suffix.unshift(unitId);
  }
  return suffix;
}

function assertUnique(label: string, values: string[]): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Semantic lineage ${label} IDs must be unique`);
  }
}
