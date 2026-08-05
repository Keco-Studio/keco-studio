import { completeLlm } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import type { RoleMap } from '@/lib/script-parser';
import { buildStoryAuditView, type StoryAuditView } from './auditView';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import {
  StoryExtractionValidationError,
  materializeStoryExtraction,
  normalizeStoryExtraction,
} from '@/lib/story-extraction/materializer';
import {
  combineStoryExtraction,
  normalizeStoryContentExtractionContract,
  normalizeStoryGraphExtractionContract,
  type StoryContentExtraction,
  type StoryGraphExtraction,
} from '@/lib/story-extraction/pipeline';
import {
  AUDITOR_STORY_EXTRACTION_TOOL,
  AUDITOR_STORY_ADJUDICATION_TOOL,
  EXTRACTOR_STORY_CONTENT_TOOL,
  GRAPH_STORY_PLAN_TOOL,
  buildAuditAdjudicationMessages,
  buildAuditorExtractionMessages,
  buildContentExtractionMessages,
  buildGraphExtractionMessages,
  type StoryExtractionRetryIssue,
} from '@/lib/story-extraction/prompts';
import type { StoryExtraction } from '@/lib/story-extraction/schema';
import type { StoryDocument } from '@/lib/story-ir/schema';
import { buildDeterministicStoryPlotPlan } from '@/lib/story-plot/deterministicBuilder';
import { buildStoryPlotPlanFromGrouping } from '@/lib/story-plot/aiPlanner';
import {
  STORY_PLOT_GROUPING_TOOL,
  buildStoryPlotGroupingMessages,
} from '@/lib/story-plot/prompts';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import {
  applyAiBranchPatch,
  buildAiBranchPatchMessages,
  buildAiBranchPatchTool,
  materializeAiBranchStructure,
  parseAiBranchPatchForSource,
  parseAiBranchStructureForSource,
} from './aiBranchPlanner';
import { buildStoryAuditProjection, type StoryAuditProjection } from './projection';
import {
  parseStoryAuditAdjudication,
  parseStoryPlanAudit,
  type StoryAuditAdjudication,
  type StoryPlanAudit,
  type StoryPlanAuditIssue,
} from './schema';
import {
  tryParseExplicitStory,
  tryParseHierarchicalBranchStory,
  tryParseLinearScreenplay,
  tryParseMenuBranchStory,
  tryParseNaturalBranchStory,
  tryParseScenarioDecisionStory,
} from './explicitParser';
import { segmentStorySource, type SegmentedStorySource } from './sourceSegments';
import {
  AI_SEMANTIC_LINEAGE_TOOL,
  AI_SEMANTIC_LINEAGE_PATCH_TOOL,
  applySemanticLineagePatch,
  buildSemanticLineageMessages,
  buildSemanticLineagePatchMessages,
  materializeSemanticLineage,
  parseSemanticLineageForSource,
  parseSemanticLineagePatchForSource,
} from './semanticLineage';
import { chunkStorySource } from './chunkedSource';
import { mergeChunkedStoryContentExtractions } from './chunkedExtraction';
import {
  applyExplicitNestedBranchGraph,
  recoverExplicitNestedBranchChoices,
} from './explicitNestedBranches';

export const DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS = 60_000;
export const STORY_PLAN_LLM_TIMEOUT_MS = 150_000;
export const STORY_GRAPH_LLM_TIMEOUT_MS = 30_000;
export const STORY_PLOT_LLM_TIMEOUT_MS = 15_000;
export const STORY_BRANCH_LLM_TIMEOUT_MS = 120_000;
const MAX_MODEL_JSON_BYTES = 10 * 1024 * 1024;
const MAX_CANDIDATE_ATTEMPTS = 3;
const MAX_GRAPH_ATTEMPTS = 2;
const MAX_LLM_CALLS = 15;
const MAX_PROVIDER_ABORT_RETRIES_PER_STAGE = 3;
const CONTENT_CHUNK_THRESHOLD_CHARS = 10_000;
// Rich screenplay prose often has short lines, so character count alone can
// still produce an oversized source-unit inventory for the Extractor.
const CONTENT_CHUNK_THRESHOLD_UNITS = 80;
const BRANCH_PLANNER_LONG_MIN_UNITS = 20;
const MAX_CONTENT_CHUNK_CHARS = 8_000;

export function branchPlannerTimeoutMs(sourceChars: number, unitCount: number): number {
  const characterSteps = Math.ceil(Math.max(0, sourceChars - 2_000) / 2_000);
  const unitSteps = Math.ceil(Math.max(0, unitCount - 20) / 20);
  return Math.min(
    STORY_BRANCH_LLM_TIMEOUT_MS,
    45_000 + (characterSteps + unitSteps) * 5_000
  );
}

export type StoryPlanLlmStage =
  | 'Branch Planner'
  | 'Extractor'
  | 'Graph Planner'
  | 'Plot Planner'
  | 'Auditor'
  | 'Adjudicator';
type LlmStage = StoryPlanLlmStage;

export interface StoryPlanLlmTelemetryEvent {
  stage: StoryPlanLlmStage;
  attempt: number;
  elapsedMs: number;
  outcome: 'success' | 'error' | 'timeout';
  requestId?: string;
}

export type StoryPlanProgressPhase =
  | 'source_segmentation'
  | 'explicit_parse'
  | 'conversion'
  | 'deterministic_validation'
  | 'table_projection'
  | 'plot_planning'
  | 'semantic_audit'
  | 'table_compile'
  | 'database_write'
  | 'complete'
  | 'failed';

export interface StoryPlanProgressEvent {
  phase: StoryPlanProgressPhase;
  attempt?: number;
  message: string;
}

export interface ResolveStoryPlanOptions {
  sourceId?: string;
  roleMap?: RoleMap;
  signal?: AbortSignal;
  llmTimeoutMs?: number;
  maxSourceChars?: number;
  skipSemanticAuditAfterValidation?: boolean;
  enableAiPlotPlanning?: boolean;
  enableHeuristicBranchParsing?: boolean;
  onProgress?: (event: StoryPlanProgressEvent) => void;
  onLlmTelemetry?: (event: StoryPlanLlmTelemetryEvent) => void;
}

export interface ResolvedAuditedStory {
  document: StoryDocument;
  plotPlan: StoryPlotPlan;
  source: SegmentedStorySource;
  extraction: StoryExtraction;
  projection: StoryAuditProjection;
  audit: StoryPlanAudit;
  primaryAudit?: StoryPlanAudit;
  adjudication?: StoryAuditAdjudication;
  approval: 'primary_pass' | 'adjudicated_pass' | 'validation_pass';
  auditSkipped?: boolean;
  converted: boolean;
  attempts: number;
}

interface CandidateReview {
  approved: boolean;
  audit: StoryPlanAudit;
  primaryAudit: StoryPlanAudit;
  adjudication?: StoryAuditAdjudication;
  approval?: ResolvedAuditedStory['approval'];
  confirmedIssues: StoryPlanAuditIssue[];
}

interface StoryPlanLlmBudget {
  used: number;
  max: number;
}

export class ImportStoryPlanError extends Error {
  readonly issues: StoryExtractionRetryIssue[];

  constructor(message: string, issues: StoryExtractionRetryIssue[] = []) {
    super(message);
    this.name = 'ImportStoryPlanError';
    this.issues = issues;
  }
}

class StoryPlanLlmTimeoutError extends Error {
  constructor(stage: LlmStage) {
    super(`Story import timed out while waiting for the ${stage} LLM response.`);
    this.name = 'StoryPlanLlmTimeoutError';
  }
}

class StoryModelContractError extends Error {
  readonly stage: LlmStage;
  readonly cause: unknown;

  constructor(stage: LlmStage, cause: unknown) {
    super(`${stage} output did not match its structured contract`);
    this.name = 'StoryModelContractError';
    this.stage = stage;
    this.cause = cause;
  }
}

class StoryGraphPlanningExhaustedError extends Error {
  readonly issues: StoryExtractionRetryIssue[];

  constructor(issues: StoryExtractionRetryIssue[]) {
    const detail = issues.at(-1)?.message.replace(/\s+/g, ' ').trim().slice(0, 240);
    super(`Story graph planning failed after ${MAX_GRAPH_ATTEMPTS} attempts${
      detail ? `: ${detail}` : ''
    }.`);
    this.name = 'StoryGraphPlanningExhaustedError';
    this.issues = issues;
  }
}

export async function resolveStoryPlanForImport(
  sourceText: string,
  options: ResolveStoryPlanOptions = {}
): Promise<ResolvedAuditedStory> {
  throwIfAborted(options.signal);
  const maxSourceChars = options.maxSourceChars ?? DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS;
  if (sourceText.length > maxSourceChars) {
    throw new ImportStoryPlanError(
      `Story is too long for one import (${sourceText.length}/${maxSourceChars} characters).`
    );
  }

  emit(options, { phase: 'source_segmentation', message: 'Segmenting exact story source' });
  const source = segmentStorySource(sourceText, options.sourceId ?? 'import');
  emit(options, { phase: 'explicit_parse', message: 'Checking deterministic story structure' });
  let priorIssues: StoryExtractionRetryIssue[] = [];
  const llmBudget: StoryPlanLlmBudget = { used: 0, max: MAX_LLM_CALLS };

  const parsedDeterministicPlan = tryParseExplicitStory(source)
    ?? (options.enableHeuristicBranchParsing
      ? tryParseNaturalBranchStory(source)
        ?? tryParseScenarioDecisionStory(source)
        ?? tryParseMenuBranchStory(source)
        ?? tryParseHierarchicalBranchStory(source)
      : null);
  const linearCandidate = tryParseLinearScreenplay(source);
  const deterministicPlan = parsedDeterministicPlan
    && !hasUnresolvedNaturalBranches(source, parsedDeterministicPlan.choices.length)
    ? parsedDeterministicPlan
    : null;
  if (deterministicPlan) {
    try {
      const extraction = buildStoryExtractionFromPlan(deterministicPlan, source);
      emit(options, {
        phase: 'deterministic_validation',
        attempt: 1,
        message: 'Validating deterministic source evidence and story graph',
      });
      const document = materializeStoryExtraction(extraction, source, options.roleMap);
      emit(options, {
        phase: 'table_projection',
        attempt: 1,
        message: 'Compiling deterministic table and path projection',
      });
      const projection = buildStoryAuditProjection(document);
      const plotPlan = await resolvePlotPlan(document, options, llmBudget);
      if (options.skipSemanticAuditAfterValidation) {
        return await acceptValidatedStory({
          source,
          extraction,
          document,
          projection,
          converted: false,
          attempt: 1,
          options,
          budget: llmBudget,
          plotPlan,
        });
      }
      const auditView = buildStoryAuditView(document, extraction, projection);
      return await auditExplicitCandidate(
        source,
        extraction,
        document,
        projection,
        auditView,
        options,
        llmBudget,
        plotPlan
      );
    } catch (error) {
      if (
        isAbortError(error)
        || error instanceof StoryPlanLlmTimeoutError
        || error instanceof ImportStoryPlanError
      ) throw error;
      priorIssues = error instanceof StoryExtractionValidationError
        ? error.issues
        : [modelOutputIssue(publicModelOutputError(error))];
    }
  }

  // Even prose without a standard scene heading can contain mutually
  // exclusive branches. Use the compact structure-only model before the
  // heavier Extractor/Graph pair unless the source must be chunked.
  const shouldTryBranchPlanner = source.units.length >= 5
    && (
      source.content.length <= CONTENT_CHUNK_THRESHOLD_CHARS
      || source.units.length >= BRANCH_PLANNER_LONG_MIN_UNITS
  );
  if (shouldTryBranchPlanner) {
    let branchIssues: StoryExtractionRetryIssue[] = [];
    let previousStructureCandidate: ReturnType<typeof parseAiBranchStructureForSource> | undefined;
    let previousSemanticCandidate: ReturnType<typeof parseSemanticLineageForSource> | undefined;
    for (let branchAttempt = 1; branchAttempt <= 2; branchAttempt += 1) {
      emit(options, {
        phase: 'conversion',
        attempt: branchAttempt,
        message: `Waiting for Branch Planner LLM response (attempt ${branchAttempt}/2)`,
      });
      try {
        const useLegacyPatchRepair = Boolean(
          previousStructureCandidate
          && branchIssues.some((issue) => issue.unitIds.length > 0)
        );
        const useSemanticPatchRepair = Boolean(
          previousSemanticCandidate
          && branchIssues.some((issue) => issue.unitIds.length > 0)
        );
        const raw = await completeStoryPlanLlm(
          useLegacyPatchRepair
            ? buildAiBranchPatchMessages(source, branchIssues, previousStructureCandidate!)
            : useSemanticPatchRepair
              ? buildSemanticLineagePatchMessages(
                  source,
                  branchIssues,
                  previousSemanticCandidate!
                )
            : buildSemanticLineageMessages(
                source,
                branchIssues,
                previousSemanticCandidate
              ),
          useLegacyPatchRepair
            ? buildAiBranchPatchTool(previousStructureCandidate!)
            : useSemanticPatchRepair
              ? AI_SEMANTIC_LINEAGE_PATCH_TOOL
            : AI_SEMANTIC_LINEAGE_TOOL,
          'Branch Planner',
          branchAttempt,
          options,
          llmBudget,
          0,
          branchPlannerTimeoutMs(source.content.length, source.units.length)
        );
        const parsedModelOutput = parseModelJson(raw);
        let candidate: ReturnType<typeof materializeAiBranchStructure> | null;
        if (useLegacyPatchRepair) {
          const structure = applyAiBranchPatch(
            previousStructureCandidate!,
            parseAiBranchPatchForSource(parsedModelOutput, source),
            source,
            branchIssues
          );
          previousStructureCandidate = structure;
          candidate = materializeAiBranchStructure(source, structure);
        } else if (useSemanticPatchRepair) {
          const semantic = applySemanticLineagePatch(
            previousSemanticCandidate!,
            parseSemanticLineagePatchForSource(parsedModelOutput, source),
            branchIssues
          );
          previousSemanticCandidate = semantic;
          candidate = materializeSemanticLineage(source, semantic);
        } else if (
          parsedModelOutput
          && typeof parsedModelOutput === 'object'
          && 'version' in parsedModelOutput
          && parsedModelOutput.version === 3
        ) {
          const semantic = parseSemanticLineageForSource(parsedModelOutput, source);
          previousSemanticCandidate = semantic;
          candidate = materializeSemanticLineage(source, semantic);
        } else {
          const structure = parseAiBranchStructureForSource(parsedModelOutput, source);
          previousStructureCandidate = structure;
          candidate = (
            structure.decisions.some((decision) => decision.options.length > 0)
            || structure.choices.length > 0
          )
            ? materializeAiBranchStructure(source, structure)
            : linearCandidate
              ? { source, plan: linearCandidate }
              : null;
        }
        if (!candidate) {
          throw new Error('Branch Planner did not produce a playable structure');
        }
        const extraction = buildStoryExtractionFromPlan(candidate.plan, candidate.source);
        const document = materializeStoryExtraction(extraction, candidate.source, options.roleMap);
        const plotPlan = buildDeterministicStoryPlotPlan(document);
        const projection = buildStoryAuditProjection(document);
        if (options.skipSemanticAuditAfterValidation) {
          return await acceptValidatedStory({
            source: candidate.source,
            extraction,
            document,
            projection,
            converted: true,
            attempt: branchAttempt,
            options,
            budget: llmBudget,
            plotPlan,
          });
        }
        const auditView = buildStoryAuditView(document, extraction, projection);
        return await auditExplicitCandidate(
          candidate.source,
          extraction,
          document,
          projection,
          auditView,
          options,
          llmBudget,
          plotPlan
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        branchIssues = error instanceof StoryExtractionValidationError
          ? error.issues
          : [branchPlannerRetryIssue(error, source)];
      }
    }
    const detail = formatBranchIssueDetail(branchIssues.at(-1), source);
    throw new ImportStoryPlanError(
      `Story branch planning failed after 2 attempts${detail ? `: ${detail}` : ''}.`,
      branchIssues
    );
  }

  for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      emit(options, {
        phase: 'conversion',
        attempt,
        message: `Waiting for Extractor LLM response (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
      });
      const content = await requestContentExtractor(source, attempt, priorIssues, options, llmBudget);
      const extraction = await buildExtractionWithGraphRetries(
        source,
        content,
        attempt,
        priorIssues,
        options,
        llmBudget
      );
      emit(options, {
        phase: 'deterministic_validation',
        attempt,
        message: `Validating source evidence and story graph (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
      });
      const document = materializeStoryExtraction(extraction, source, options.roleMap);
      emit(options, {
        phase: 'table_projection',
        attempt,
        message: `Compiling table and path projection (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
      });
      const projection = buildStoryAuditProjection(document);
      if (options.skipSemanticAuditAfterValidation) {
        return await acceptValidatedStory({
          source,
          extraction,
          document,
          projection,
          converted: true,
          attempt,
          options,
          budget: llmBudget,
        });
      }
      const auditView = buildStoryAuditView(document, extraction, projection);
      const review = await reviewCandidate(source, auditView, attempt, options, llmBudget);
      if (review.approved) {
        const plotPlan = buildDeterministicStoryPlotPlan(document);
        emit(options, { phase: 'complete', attempt, message: 'Story conversion and audit completed' });
        return {
          document,
          plotPlan,
          source,
          extraction,
          projection,
          audit: review.audit,
          primaryAudit: review.primaryAudit,
          ...(review.adjudication ? { adjudication: review.adjudication } : {}),
          approval: review.approval!,
          converted: true,
          attempts: attempt,
        };
      }
      priorIssues = review.confirmedIssues;
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      if (error instanceof StoryGraphPlanningExhaustedError) {
        throw new ImportStoryPlanError(error.message, error.issues);
      }
      priorIssues = error instanceof StoryExtractionValidationError
        ? error.issues
        : [modelOutputIssue(publicModelOutputError(error))];
    }
  }

  const finalIssue = priorIssues.at(-1)?.message
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const finalMessage = `Story import failed after three conversion attempts${
    finalIssue ? `: ${finalIssue}` : ''
  }.`;
  emit(options, {
    phase: 'failed',
    attempt: MAX_CANDIDATE_ATTEMPTS,
    message: finalMessage,
  });
  throw new ImportStoryPlanError(finalMessage, priorIssues);
}

function hasUnresolvedNaturalBranches(
  source: SegmentedStorySource,
  parsedChoiceCount: number
): boolean {
  const choiceMarkerPattern = /^(?:[A-Za-z]\d*\s*(?:\u9009\u9879|\u5206\u652f)|\u9009\u9879\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\d]+)\s*(?:[：:]|[（(])/i;
  const branchContainerPattern = /^\u5206\u652f\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\d]+\s*(?:[：:]|[（(])/;
  const choiceMarkerCount = source.units.filter((unit) => (
    choiceMarkerPattern.test(unit.text.trim())
  )).length;
  if (choiceMarkerCount > parsedChoiceCount) return true;
  return parsedChoiceCount === 0 && source.units.some((unit) => (
    branchContainerPattern.test(unit.text.trim())
  ));
}

async function acceptValidatedStory(input: {
  source: SegmentedStorySource;
  extraction: StoryExtraction;
  document: StoryDocument;
  projection: StoryAuditProjection;
  converted: boolean;
  attempt: number;
  options: ResolveStoryPlanOptions;
  budget: StoryPlanLlmBudget;
  plotPlan?: StoryPlotPlan;
}): Promise<ResolvedAuditedStory> {
  const plotPlan = input.plotPlan
    ?? await resolvePlotPlan(input.document, input.options, input.budget);
  emit(input.options, {
    phase: 'complete',
    attempt: input.attempt,
    message: 'Story conversion and deterministic validation completed',
  });
  return {
    document: input.document,
    plotPlan,
    source: input.source,
    extraction: input.extraction,
    projection: input.projection,
    audit: { verdict: 'pass', issues: [] },
    approval: 'validation_pass',
    auditSkipped: true,
    converted: input.converted,
    attempts: input.attempt,
  };
}

async function buildExtractionWithGraphRetries(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  candidateAttempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryExtraction> {
  let graphIssues = priorIssues;
  let previousGraphCandidate: StoryGraphExtraction | undefined;
  for (let graphAttempt = 1; graphAttempt <= MAX_GRAPH_ATTEMPTS; graphAttempt += 1) {
    emit(options, {
      phase: 'conversion',
      attempt: candidateAttempt,
      message: `Waiting for Graph Planner LLM response (graph attempt ${graphAttempt}/${MAX_GRAPH_ATTEMPTS})`,
    });
    try {
      const graph = await requestGraphPlanner(
        source,
        content,
        graphAttempt,
        graphIssues,
        options,
        budget,
        previousGraphCandidate
      );
      previousGraphCandidate = graph;
      const normalized = normalizeStoryExtraction(
        combineStoryExtraction(content, graph),
        source
      );
      materializeStoryExtraction(normalized, source, options.roleMap);
      return normalized;
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      graphIssues = error instanceof StoryExtractionValidationError
        ? error.issues
        : [modelOutputIssue(publicModelOutputError(error))];
      if (graphAttempt === MAX_GRAPH_ATTEMPTS || budget.used >= budget.max) {
        throw new StoryGraphPlanningExhaustedError(graphIssues);
      }
    }
  }
  throw new Error('Graph Planner retry loop exhausted.');
}

async function auditExplicitCandidate(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  document: StoryDocument,
  projection: StoryAuditProjection,
  auditView: StoryAuditView,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget,
  plotPlan?: StoryPlotPlan
): Promise<ResolvedAuditedStory> {
  try {
    const review = await reviewCandidate(source, auditView, 1, options, budget);
    if (!review.approved) {
      emit(options, {
        phase: 'failed',
        attempt: 1,
        message: 'Story import failed confirmed semantic audit',
      });
      throw new ImportStoryPlanError(
        'Story import failed confirmed semantic audit issues.',
        review.confirmedIssues
      );
    }
    const resolvedPlotPlan = plotPlan ?? await resolvePlotPlan(document, options, budget);
    emit(options, { phase: 'complete', attempt: 1, message: 'Story conversion and audit completed' });
    return {
      document,
      plotPlan: resolvedPlotPlan,
      source,
      extraction,
      projection,
      audit: review.audit,
      primaryAudit: review.primaryAudit,
      ...(review.adjudication ? { adjudication: review.adjudication } : {}),
      approval: review.approval!,
      converted: false,
      attempts: 1,
    };
  } catch (error) {
    if (
      isAbortError(error)
      || error instanceof StoryPlanLlmTimeoutError
      || error instanceof ImportStoryPlanError
    ) throw error;
    throw new ImportStoryPlanError(
      'Story audit adjudication failed.',
      [modelOutputIssue(publicModelOutputError(error))]
    );
  }
}

async function requestContentExtractor(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryContentExtraction> {
  const shouldChunk = source.content.length > CONTENT_CHUNK_THRESHOLD_CHARS
    || source.units.length > CONTENT_CHUNK_THRESHOLD_UNITS;
  const unitChunkCount = Math.ceil(source.units.length / CONTENT_CHUNK_THRESHOLD_UNITS);
  const chunkLimit = source.content.length > CONTENT_CHUNK_THRESHOLD_CHARS
    ? MAX_CONTENT_CHUNK_CHARS
    : Math.max(1_000, Math.ceil(source.content.length / Math.max(2, unitChunkCount)));
  const chunks = shouldChunk ? chunkStorySource(source, chunkLimit) : [source];
  const extractions = await Promise.all(chunks.map(async (chunk, chunkIndex) => {
    if (chunks.length > 1) {
      emit(options, {
        phase: 'conversion',
        attempt,
        message: `Waiting for Extractor LLM response (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS}, chunk ${chunkIndex + 1}/${chunks.length})`,
      });
    }
    const unitIds = new Set(chunk.units.map((unit) => unit.id));
    const chunkIssues = priorIssues.filter((issue) => (
      issue.unitIds.length === 0
      || issue.unitIds.some((unitId) => unitIds.has(unitId))
    ));
    const raw = await completeStoryPlanLlm(
      buildContentExtractionMessages(chunk, attempt, chunkIssues),
      EXTRACTOR_STORY_CONTENT_TOOL,
      'Extractor',
      attempt,
      options,
      budget
    );
    try {
      return normalizeStoryContentExtractionContract(parseModelJson(raw));
    } catch (error) {
      throw new StoryModelContractError('Extractor', error);
    }
  }));

  const merged = extractions.length === 1
    ? extractions[0]
    : mergeChunkedStoryContentExtractions(extractions);
  return recoverExplicitNestedBranchChoices(source, merged);
}

async function requestGraphPlanner(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget,
  previousGraphCandidate?: StoryGraphExtraction
): Promise<StoryGraphExtraction> {
  const raw = await completeStoryPlanLlm(
    buildGraphExtractionMessages(
      source,
      content,
      attempt,
      priorIssues,
      previousGraphCandidate
    ),
    GRAPH_STORY_PLAN_TOOL,
    'Graph Planner',
    attempt,
    options,
    budget
  );
  try {
    return applyExplicitNestedBranchGraph(
      source,
      content,
      normalizeStoryGraphExtractionContract(parseModelJson(raw), content)
    );
  } catch (error) {
    throw new StoryModelContractError('Graph Planner', error);
  }
}

async function reviewCandidate(
  source: SegmentedStorySource,
  auditView: StoryAuditView,
  attempt: number,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<CandidateReview> {
  emit(options, {
    phase: 'semantic_audit',
    attempt,
    message: `Waiting for Primary Auditor LLM response (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
  });
  const primaryAudit = await requestAuditor(source, auditView, attempt, options, budget);
  if (auditPassed(primaryAudit)) {
    return {
      approved: true,
      audit: primaryAudit,
      primaryAudit,
      approval: 'primary_pass',
      confirmedIssues: [],
    };
  }
  if (primaryAudit.issues.length === 0) {
    throw new StoryModelContractError('Auditor', new Error('Fail verdict requires issues'));
  }

  emit(options, {
    phase: 'semantic_audit',
    attempt,
    message: `Verifying Auditor issues with Targeted Adjudicator (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
  });
  const adjudication = await requestAdjudicator(
    source,
    auditView,
    primaryAudit.issues,
    attempt,
    options,
    budget
  );
  const confirmedIssues = validateAdjudication(primaryAudit.issues, adjudication);
  if (confirmedIssues.length === 0) {
    return {
      approved: true,
      audit: { verdict: 'pass', issues: [] },
      primaryAudit,
      adjudication,
      approval: 'adjudicated_pass',
      confirmedIssues: [],
    };
  }
  return {
    approved: false,
    audit: primaryAudit,
    primaryAudit,
    adjudication,
    confirmedIssues,
  };
}

async function requestAuditor(
  source: SegmentedStorySource,
  auditView: StoryAuditView,
  attempt: number,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryPlanAudit> {
  const raw = await completeStoryPlanLlm(
    buildAuditorExtractionMessages(source, auditView),
    AUDITOR_STORY_EXTRACTION_TOOL,
    'Auditor',
    attempt,
    options,
    budget
  );
  try {
    return parseStoryPlanAudit(parseModelJson(raw));
  } catch (error) {
    throw new StoryModelContractError('Auditor', error);
  }
}

async function requestAdjudicator(
  source: SegmentedStorySource,
  auditView: StoryAuditView,
  issues: StoryPlanAuditIssue[],
  attempt: number,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryAuditAdjudication> {
  const raw = await completeStoryPlanLlm(
    buildAuditAdjudicationMessages(source, auditView, issues),
    AUDITOR_STORY_ADJUDICATION_TOOL,
    'Adjudicator',
    attempt,
    options,
    budget
  );
  try {
    return parseStoryAuditAdjudication(parseModelJson(raw));
  } catch (error) {
    throw new StoryModelContractError('Adjudicator', error);
  }
}

function validateAdjudication(
  issues: StoryPlanAuditIssue[],
  adjudication: StoryAuditAdjudication
): StoryPlanAuditIssue[] {
  const expectedIds = issues.map((_, index) => `issue-${index + 1}`);
  const actualIds = adjudication.decisions.map((decision) => decision.issueId);
  if (
    actualIds.length !== expectedIds.length
    || new Set(actualIds).size !== actualIds.length
    || expectedIds.some((issueId) => !actualIds.includes(issueId))
  ) {
    throw new StoryModelContractError(
      'Adjudicator',
      new Error('Adjudication decisions must match every allegation exactly once')
    );
  }
  const decisionsById = new Map(
    adjudication.decisions.map((decision) => [decision.issueId, decision.status])
  );
  return issues.filter((_, index) => decisionsById.get(`issue-${index + 1}`) === 'confirmed');
}

async function resolvePlotPlan(
  document: StoryDocument,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryPlotPlan> {
  const fallback = () => buildDeterministicStoryPlotPlan(document);
  if (!options.enableAiPlotPlanning) return fallback();

  emit(options, {
    phase: 'plot_planning',
    attempt: 1,
    message: 'Grouping canonical script rows into plot nodes',
  });
  try {
    const raw = await completeStoryPlanLlm(
      buildStoryPlotGroupingMessages(document),
      STORY_PLOT_GROUPING_TOOL,
      'Plot Planner',
      1,
      options,
      budget,
      0
    );
    return buildStoryPlotPlanFromGrouping(document, parseModelJson(raw));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return fallback();
  }
}

async function completeStoryPlanLlm(
  messages: Parameters<typeof completeLlm>[0],
  tool: OpenAITool,
  stage: LlmStage,
  attempt: number,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget,
  providerAbortRetryLimit = MAX_PROVIDER_ABORT_RETRIES_PER_STAGE,
  timeoutOverrideMs?: number
): Promise<string> {
  let providerAbortRetries = 0;
  const startedAt = Date.now();
  let requestId: string | undefined;
  let reported = false;
  const report = (outcome: StoryPlanLlmTelemetryEvent['outcome']) => {
    if (reported) return;
    reported = true;
    options.onLlmTelemetry?.({
      stage,
      attempt,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      outcome,
      ...(requestId ? { requestId } : {}),
    });
  };
  while (budget.used < budget.max) {
    budget.used += 1;
    const timeoutController = new AbortController();
    const combined = combineAbortSignals(options.signal, timeoutController.signal);
    let timedOut = false;
    const configuredTimeout = options.llmTimeoutMs ?? STORY_PLAN_LLM_TIMEOUT_MS;
    const timeoutMs = stage === 'Plot Planner'
      ? Math.min(configuredTimeout, STORY_PLOT_LLM_TIMEOUT_MS)
      : stage === 'Graph Planner'
        ? Math.min(configuredTimeout, STORY_GRAPH_LLM_TIMEOUT_MS)
      : stage === 'Branch Planner'
        ? Math.min(
            configuredTimeout,
            timeoutOverrideMs ?? STORY_BRANCH_LLM_TIMEOUT_MS
          )
        : configuredTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new DOMException('Story extraction LLM deadline exceeded', 'TimeoutError'));
    }, timeoutMs);

    try {
      const result = await completeLlm(messages, {
        temperature: 0,
        maxCompletionTokens: stage === 'Extractor'
          ? 24_000
          : stage === 'Graph Planner' ? 6_000
            : stage === 'Branch Planner' ? 24_000
            : stage === 'Plot Planner' ? 4_000 : 10_000,
        thinking: 'disabled',
        tools: [tool],
        toolName: tool.function.name,
        signal: combined.signal,
        onResponseMetadata: (metadata) => {
          requestId = metadata.requestId ?? requestId;
        },
      });
      report('success');
      return result;
    } catch (error) {
      if (timedOut) {
        report('timeout');
        throw new StoryPlanLlmTimeoutError(stage);
      }
      if (!isProviderAbortedResponse(error)) {
        report('error');
        throw error;
      }
      providerAbortRetries += 1;
      if (
        providerAbortRetries > providerAbortRetryLimit
        || budget.used >= budget.max
      ) {
        report('error');
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      combined.cleanup();
    }
  }
  report('error');
  throw new Error('Story import LLM call budget exhausted.');
}

function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('```') || trimmed.endsWith('```')) {
    throw new Error('Model output must be one plain JSON object');
  }
  if (new TextEncoder().encode(trimmed).byteLength > MAX_MODEL_JSON_BYTES) {
    throw new Error('Model JSON exceeds the size limit');
  }
  return JSON.parse(trimmed);
}

function auditPassed(audit: StoryPlanAudit): boolean {
  return audit.verdict === 'pass'
    && audit.issues.every((issue) => issue.severity === 'minor');
}

function modelOutputIssue(message: string): StoryExtractionRetryIssue {
  return { code: 'model_output', message, unitIds: [], nodeIds: [] };
}

function publicModelOutputError(error: unknown): string {
  if (error instanceof StoryModelContractError) {
    return `${error.stage} output did not match the complete Story IR contract`;
  }
  if (error instanceof SyntaxError) return 'Model output was not valid JSON';
  return 'Model output did not match the complete Story IR contract';
}

function branchPlannerError(error: unknown): string {
  if (!(error instanceof Error)) return 'Branch Planner returned an invalid structure';
  const detail = error.message.replace(/\s+/g, ' ').trim().slice(0, 300);
  return detail || 'Branch Planner returned an invalid structure';
}

function branchPlannerRetryIssue(
  error: unknown,
  source: SegmentedStorySource
): StoryExtractionRetryIssue {
  const message = branchPlannerError(error);
  const unitIds = [...message.matchAll(/\bu(\d+)\b/g)].flatMap((match) => {
    const unit = source.units[Number(match[1])];
    return unit ? [unit.id] : [];
  });
  return {
    code: 'model_output',
    message,
    unitIds: [...new Set(unitIds)],
    nodeIds: [],
  };
}

function formatBranchIssueDetail(
  issue: StoryExtractionRetryIssue | undefined,
  source: SegmentedStorySource
): string {
  if (!issue) return '';
  const message = issue.message.replace(/\s+/g, ' ').trim();
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const sourceDetails = [...new Set(issue.unitIds)].flatMap((unitId) => {
    const index = unitIndexById.get(unitId);
    if (index === undefined) return [];
    const text = source.units[index].text.replace(/\s+/g, ' ').trim().slice(0, 100);
    return [`u${index}: "${text}"`];
  }).slice(0, 3);
  return `${message}${sourceDetails.length > 0
    ? ` (source ${sourceDetails.join('; ')})`
    : ''}`.slice(0, 500);
}

function emit(options: ResolveStoryPlanOptions, event: StoryPlanProgressEvent): void {
  options.onProgress?.(event);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Story import aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isProviderAbortedResponse(error: unknown): boolean {
  return error instanceof Error
    && error.name === 'LlmError'
    && error.message === 'LLM aborted before completing the response.';
}

function combineAbortSignals(
  first?: AbortSignal,
  second?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  for (const source of [first, second].filter((signal): signal is AbortSignal => Boolean(signal))) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const listener = () => controller.abort(source.reason);
    listeners.set(source, listener);
    source.addEventListener('abort', listener, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
    },
  };
}
