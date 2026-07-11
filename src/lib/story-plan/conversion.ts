import { completeLlm } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import type { RoleMap } from '@/lib/script-parser';
import {
  StoryExtractionValidationError,
  materializeStoryExtraction,
} from '@/lib/story-extraction/materializer';
import {
  AUDITOR_STORY_EXTRACTION_TOOL,
  CONVERTER_STORY_EXTRACTION_TOOL,
  buildAuditorExtractionMessages,
  buildConverterExtractionMessages,
  type StoryExtractionRetryIssue,
} from '@/lib/story-extraction/prompts';
import { parseStoryExtraction, type StoryExtraction } from '@/lib/story-extraction/schema';
import type { StoryDocument } from '@/lib/story-ir/schema';
import { buildStoryAuditProjection, type StoryAuditProjection } from './projection';
import { parseStoryPlanAudit, type StoryPlanAudit } from './schema';
import { segmentStorySource, type SegmentedStorySource } from './sourceSegments';

export const DEFAULT_STORY_PLAN_MAX_SOURCE_CHARS = 24_000;
export const STORY_PLAN_LLM_TIMEOUT_MS = 60_000;
const MAX_MODEL_JSON_BYTES = 10 * 1024 * 1024;

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
  converted: true;
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
  constructor(stage: 'Converter' | 'Auditor') {
    super(`Story import timed out while waiting for the ${stage} LLM response.`);
    this.name = 'StoryPlanLlmTimeoutError';
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
  emit(options, { phase: 'explicit_parse', message: 'Preparing complete Story IR extraction' });
  let priorIssues: StoryExtractionRetryIssue[] = [];
  const llmBudget: StoryPlanLlmBudget = { used: 0, max: 4 };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      emit(options, {
        phase: 'conversion',
        attempt,
        message: `Waiting for Converter LLM response (attempt ${attempt}/2)`,
      });
      const extraction = await requestConverter(source, attempt, priorIssues, options, llmBudget);
      emit(options, {
        phase: 'deterministic_validation',
        attempt,
        message: `Validating source evidence and story graph (attempt ${attempt}/2)`,
      });
      const document = materializeStoryExtraction(extraction, source, options.roleMap);
      emit(options, {
        phase: 'table_projection',
        attempt,
        message: `Compiling table and path projection (attempt ${attempt}/2)`,
      });
      const projection = buildStoryAuditProjection(document);
      emit(options, {
        phase: 'semantic_audit',
        attempt,
        message: `Waiting for Auditor LLM response (attempt ${attempt}/2)`,
      });
      const audit = await requestAuditor(source, extraction, document, projection, options, llmBudget);
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

  emit(options, { phase: 'failed', attempt: 2, message: 'Story import failed after two audited attempts' });
  throw new ImportStoryPlanError('Story import failed after two audited attempts.', priorIssues);
}

async function requestConverter(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryExtraction> {
  const raw = await completeStoryPlanLlm(
    buildConverterExtractionMessages(source, attempt, priorIssues),
    CONVERTER_STORY_EXTRACTION_TOOL,
    'Converter',
    options,
    budget
  );
  return parseStoryExtraction(parseModelJson(raw));
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
  return parseStoryPlanAudit(parseModelJson(raw));
}

async function completeStoryPlanLlm(
  messages: Parameters<typeof completeLlm>[0],
  tool: OpenAITool,
  stage: 'Converter' | 'Auditor',
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<string> {
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
        maxCompletionTokens: stage === 'Converter' ? 24_000 : 10_000,
        thinking: 'disabled',
        tools: [tool],
        toolName: tool.function.name,
        signal: combined.signal,
      });
    } catch (error) {
      if (timedOut) throw new StoryPlanLlmTimeoutError(stage);
      if (!isProviderAbortedResponse(error) || budget.used >= budget.max) throw error;
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
