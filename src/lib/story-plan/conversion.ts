import { completeLlm } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import type { RoleMap } from '@/lib/script-parser';
import { tryLegacyStoryImport } from '@/lib/story-ir/legacyAdapter';
import type { StoryDocument } from '@/lib/story-ir/schema';
import {
  tryParseExplicitStory,
  tryParseNaturalBranchStory,
} from './explicitParser';
import { hydrateStoryDocument } from './hydrator';
import {
  buildStoryPlanInventory,
  materializeStoryRelationshipPlan,
} from './inventory';
import {
  AUDITOR_PLAN_TOOL,
  CONVERTER_PLAN_TOOL,
  buildAuditorPlanMessages,
  buildConverterPlanMessages,
  type StoryPlanRetryIssue,
} from './prompts';
import { buildStoryAuditProjection, type StoryAuditProjection } from './projection';
import {
  parseStoryPlanAudit,
  parseStoryGraphPlan,
  type StoryPlanAudit,
  type StoryRelationshipPlan,
} from './schema';
import { segmentStorySource, type SegmentedStorySource } from './sourceSegments';
import { validateStoryPlan } from './validator';

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
  plan: StoryRelationshipPlan | null;
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
  readonly issues: StoryPlanRetryIssue[];

  constructor(message: string, issues: StoryPlanRetryIssue[] = []) {
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
  const sourceId = options.sourceId ?? 'import';
  const source = segmentStorySource(sourceText, sourceId);
  emit(options, { phase: 'explicit_parse', message: 'Checking explicit story structure' });
  let legacyDocument = tryLegacyStoryImport(sourceText, sourceId, options.roleMap)?.document;
  let candidate = legacyDocument
    ? null
    : tryParseExplicitStory(source) ?? tryParseNaturalBranchStory(source);
  let priorIssues: StoryPlanRetryIssue[] = [];
  let converted = false;
  const llmBudget: StoryPlanLlmBudget = { used: 0, max: 4 };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      if (legacyDocument) {
        const document = legacyDocument;
        legacyDocument = undefined;
        emit(options, {
          phase: 'deterministic_validation',
          attempt,
          message: `Validating legacy story structure (attempt ${attempt}/2)`,
        });
        emit(options, {
          phase: 'table_projection',
          attempt,
          message: `Compiling audit projection (attempt ${attempt}/2)`,
        });
        const projection = buildStoryAuditProjection(document);
        emit(options, {
          phase: 'semantic_audit',
          attempt,
          message: `Waiting for Auditor LLM response (attempt ${attempt}/2)`,
        });
        const audit = await requestAuditor(source, null, projection, options, llmBudget);
        if (auditPassed(audit)) {
          emit(options, { phase: 'complete', attempt, message: 'Story conversion and audit completed' });
          return {
            document,
            source,
            plan: null,
            projection,
            audit,
            converted: false,
            attempts: attempt,
          };
        }
        priorIssues = audit.issues.length > 0
          ? audit.issues
          : [modelOutputIssue('Auditor rejected the candidate without structured issues')];
        continue;
      }

      if (!candidate) {
        emit(options, {
          phase: 'conversion',
          attempt,
          message: `Waiting for Converter LLM response (attempt ${attempt}/2)`,
        });
        candidate = await requestConverter(source, attempt, priorIssues, options, llmBudget);
        converted = true;
      }

      emit(options, {
        phase: 'deterministic_validation',
        attempt,
        message: `Validating story relationships (attempt ${attempt}/2)`,
      });
      const deterministicIssues = validateStoryPlan(candidate, source);
      if (deterministicIssues.length > 0) {
        priorIssues = deterministicIssues;
        candidate = null;
        continue;
      }

      const document = hydrateStoryDocument(candidate, source, options.roleMap);
      emit(options, {
        phase: 'table_projection',
        attempt,
        message: `Compiling audit projection (attempt ${attempt}/2)`,
      });
      const projection = buildStoryAuditProjection(document);
      emit(options, {
        phase: 'semantic_audit',
        attempt,
        message: `Waiting for Auditor LLM response (attempt ${attempt}/2)`,
      });
      const audit = await requestAuditor(source, candidate, projection, options, llmBudget);
      if (auditPassed(audit)) {
        emit(options, { phase: 'complete', attempt, message: 'Story conversion and audit completed' });
        return { document, source, plan: candidate, projection, audit, converted, attempts: attempt };
      }
      priorIssues = audit.issues.length > 0
        ? audit.issues
        : [modelOutputIssue('Auditor rejected the candidate without structured issues')];
      candidate = null;
    } catch (error) {
      if (isAbortError(error) || error instanceof StoryPlanLlmTimeoutError) throw error;
      priorIssues = [modelOutputIssue(publicModelOutputError(error))];
      candidate = null;
    }
  }

  emit(options, { phase: 'failed', attempt: 2, message: 'Story import failed after two audited attempts' });
  throw new ImportStoryPlanError('Story import failed after two audited attempts.', priorIssues);
}

async function requestConverter(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryPlanRetryIssue[],
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryRelationshipPlan> {
  const raw = await completeStoryPlanLlm(
    buildConverterPlanMessages(source, attempt, priorIssues),
    CONVERTER_PLAN_TOOL,
    'Converter',
    options,
    budget
  );
  const graph = parseStoryGraphPlan(parseModelJson(raw));
  return materializeStoryRelationshipPlan(graph, buildStoryPlanInventory(source));
}

async function requestAuditor(
  source: SegmentedStorySource,
  plan: StoryRelationshipPlan | null,
  projection: StoryAuditProjection,
  options: ResolveStoryPlanOptions,
  budget: StoryPlanLlmBudget
): Promise<StoryPlanAudit> {
  const raw = await completeStoryPlanLlm(
    buildAuditorPlanMessages(source, plan, projection),
    AUDITOR_PLAN_TOOL,
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
      timeoutController.abort(new DOMException('Story plan LLM deadline exceeded', 'TimeoutError'));
    }, options.llmTimeoutMs ?? STORY_PLAN_LLM_TIMEOUT_MS);

    try {
      return await completeLlm(messages, {
        temperature: 0,
        maxCompletionTokens: stage === 'Converter' ? 16_000 : 8_000,
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
  return audit.verdict === 'pass' &&
    audit.issues.every((issue) => issue.severity === 'minor');
}

function modelOutputIssue(message: string): StoryPlanRetryIssue {
  return { code: 'model_output', message, unitIds: [], nodeIds: [] };
}

function publicModelOutputError(error: unknown): string {
  if (error instanceof SyntaxError) return 'Model output was not valid JSON';
  return 'Model output did not match the flat story plan contract';
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
  return error instanceof Error &&
    error.name === 'LlmError' &&
    error.message === 'LLM aborted before completing the response.';
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
