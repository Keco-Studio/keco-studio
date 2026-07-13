import { completeLlm } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import type { RoleMap } from '@/lib/script-parser';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import {
  StoryExtractionValidationError,
  materializeStoryExtraction,
  normalizeStoryExtraction,
} from '@/lib/story-extraction/materializer';
import {
  combineStoryExtraction,
  parseStoryContentExtraction,
  parseStoryGraphExtraction,
  type StoryContentExtraction,
  type StoryGraphExtraction,
} from '@/lib/story-extraction/pipeline';
import {
  AUDITOR_STORY_EXTRACTION_TOOL,
  EXTRACTOR_STORY_CONTENT_TOOL,
  GRAPH_STORY_PLAN_TOOL,
  buildAuditorExtractionMessages,
  buildContentExtractionMessages,
  buildGraphExtractionMessages,
  type StoryExtractionRetryIssue,
} from '@/lib/story-extraction/prompts';
import type { StoryExtraction } from '@/lib/story-extraction/schema';
import type { StoryDocument } from '@/lib/story-ir/schema';
import { buildStoryAuditProjection, type StoryAuditProjection } from './projection';
import { parseStoryPlanAudit, type StoryPlanAudit } from './schema';
import { tryParseExplicitStory, tryParseNaturalBranchStory } from './explicitParser';
import { segmentStorySource, type SegmentedStorySource } from './sourceSegments';

export const DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS = 24_000;
export const STORY_PLAN_LLM_TIMEOUT_MS = 150_000;
const MAX_MODEL_JSON_BYTES = 10 * 1024 * 1024;
const MAX_CANDIDATE_ATTEMPTS = 3;
const MAX_GRAPH_ATTEMPTS = 5;
const MAX_LLM_CALLS = 15;
const MAX_PROVIDER_ABORT_RETRIES_PER_STAGE = 3;

type LlmStage = 'Extractor' | 'Graph Planner' | 'Auditor';

export type StoryPlanProgressPhase =
  | 'source_segmentation'
  | 'explicit_parse'
  | 'conversion'
  | 'deterministic_validation'
  | 'table_projection'
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
  onProgress?: (event: StoryPlanProgressEvent) => void;
}

export interface ResolvedAuditedStory {
  document: StoryDocument;
  source: SegmentedStorySource;
  extraction: StoryExtraction;
  projection: StoryAuditProjection;
  audit: StoryPlanAudit;
  converted: boolean;
  attempts: number;
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

export async function resolveStoryPlanForImport(
  sourceText: string,
  options: ResolveStoryPlanOptions = {}
): Promise<ResolvedAuditedStory> {
  throwIfAborted(options.signal);
  const maxSourceChars = options.maxSourceChars ?? DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS;
  if (sourceText.length > maxSourceChars) {
    throw new ImportStoryPlanError(
      `Story is too long for one audited import (${sourceText.length}/${maxSourceChars} characters).`
    );
  }

  emit(options, { phase: 'source_segmentation', message: 'Segmenting exact story source' });
  const source = segmentStorySource(sourceText, options.sourceId ?? 'import');
  emit(options, { phase: 'explicit_parse', message: 'Checking deterministic story structure' });
  let priorIssues: StoryExtractionRetryIssue[] = [];
  const llmBudget: StoryPlanLlmBudget = { used: 0, max: MAX_LLM_CALLS };

  const deterministicPlan = tryParseExplicitStory(source) ?? tryParseNaturalBranchStory(source);
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
      return await auditExplicitCandidate(
        source,
        extraction,
        document,
        projection,
        options,
        llmBudget
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
      emit(options, {
        phase: 'semantic_audit',
        attempt,
        message: `Waiting for Combined Auditor LLM response (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
      });
      const audit = await requestAuditor(
        source,
        extraction,
        document,
        projection,
        options,
        llmBudget
      );
      if (auditPassed(audit)) {
        emit(options, { phase: 'complete', attempt, message: 'Story conversion and audit completed' });
        return {
          document,
          source,
          extraction,
          projection,
          audit,
          converted: true,
          attempts: attempt,
        };
      }
      priorIssues = audit.issues.length > 0
        ? audit.issues
        : [modelOutputIssue('Auditor rejected the candidate without structured issues')];
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      priorIssues = error instanceof StoryExtractionValidationError
        ? error.issues
        : [modelOutputIssue(publicModelOutputError(error))];
    }
  }

  emit(options, {
    phase: 'failed',
    attempt: MAX_CANDIDATE_ATTEMPTS,
    message: 'Story import failed after three audited attempts',
  });
  throw new ImportStoryPlanError('Story import failed after three audited attempts.', priorIssues);
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
        budget
      );
      return normalizeStoryExtraction(combineStoryExtraction(content, graph), source);
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      graphIssues = error instanceof StoryExtractionValidationError
        ? error.issues
        : [modelOutputIssue(publicModelOutputError(error))];
      if (graphAttempt === MAX_GRAPH_ATTEMPTS || budget.used >= budget.max) throw error;
    }
  }
  throw new Error('Graph Planner retry loop exhausted.');
}

async function auditExplicitCandidate(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  document: StoryDocument,
  projection: StoryAuditProjection,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<ResolvedAuditedStory> {
  let priorIssues: StoryExtractionRetryIssue[] = [];
  for (let attempt = 1; attempt <= MAX_CANDIDATE_ATTEMPTS; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      emit(options, {
        phase: 'semantic_audit',
        attempt,
        message: `Waiting for Auditor LLM response (attempt ${attempt}/${MAX_CANDIDATE_ATTEMPTS})`,
      });
      const audit = await requestAuditor(source, extraction, document, projection, options, budget);
      if (auditPassed(audit)) {
        emit(options, { phase: 'complete', attempt, message: 'Story conversion and audit completed' });
        return {
          document,
          source,
          extraction,
          projection,
          audit,
          converted: false,
          attempts: attempt,
        };
      }
      priorIssues = audit.issues.length > 0
        ? audit.issues
        : [modelOutputIssue('Auditor rejected the candidate without structured issues')];
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      priorIssues = [modelOutputIssue(publicModelOutputError(error))];
    }
  }

  emit(options, {
    phase: 'failed',
    attempt: MAX_CANDIDATE_ATTEMPTS,
    message: 'Story import failed after three audited attempts',
  });
  throw new ImportStoryPlanError('Story import failed after three audited attempts.', priorIssues);
}

async function requestContentExtractor(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryContentExtraction> {
  const raw = await completeStoryPlanLlm(
    buildContentExtractionMessages(source, attempt, priorIssues),
    EXTRACTOR_STORY_CONTENT_TOOL,
    'Extractor',
    options,
    budget
  );
  try {
    return parseStoryContentExtraction(parseModelJson(raw));
  } catch (error) {
    throw new StoryModelContractError('Extractor', error);
  }
}

async function requestGraphPlanner(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryGraphExtraction> {
  const raw = await completeStoryPlanLlm(
    buildGraphExtractionMessages(source, content, attempt, priorIssues),
    GRAPH_STORY_PLAN_TOOL,
    'Graph Planner',
    options,
    budget
  );
  try {
    return parseStoryGraphExtraction(parseModelJson(raw));
  } catch (error) {
    throw new StoryModelContractError('Graph Planner', error);
  }
}

async function requestAuditor(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  document: StoryDocument,
  projection: StoryAuditProjection,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryPlanAudit> {
  const raw = await completeStoryPlanLlm(
    buildAuditorExtractionMessages(source, extraction, document, projection),
    AUDITOR_STORY_EXTRACTION_TOOL,
    'Auditor',
    options,
    budget
  );
  try {
    return parseStoryPlanAudit(parseModelJson(raw));
  } catch (error) {
    throw new StoryModelContractError('Auditor', error);
  }
}

async function completeStoryPlanLlm(
  messages: Parameters<typeof completeLlm>[0],
  tool: OpenAITool,
  stage: LlmStage,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<string> {
  let providerAbortRetries = 0;
  while (budget.used < budget.max) {
    budget.used += 1;
    const timeoutController = new AbortController();
    const combined = combineAbortSignals(options.signal, timeoutController.signal);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new DOMException('Story extraction LLM deadline exceeded', 'TimeoutError'));
    }, options.llmTimeoutMs ?? STORY_PLAN_LLM_TIMEOUT_MS);

    try {
      return await completeLlm(messages, {
        temperature: 0,
        maxCompletionTokens: stage === 'Extractor' ? 24_000 : 10_000,
        thinking: 'disabled',
        tools: [tool],
        toolName: tool.function.name,
        signal: combined.signal,
      });
    } catch (error) {
      if (timedOut) throw new StoryPlanLlmTimeoutError(stage);
      if (!isProviderAbortedResponse(error)) throw error;
      providerAbortRetries += 1;
      if (
        providerAbortRetries > MAX_PROVIDER_ABORT_RETRIES_PER_STAGE
        || budget.used >= budget.max
      ) throw error;
    } finally {
      clearTimeout(timeout);
      combined.cleanup();
    }
  }
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
