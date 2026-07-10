import { completeLlm } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import type { RoleMap } from '@/lib/script-parser';
import { chunkSourceUnits, mergeStoryChunks, type StorySourceChunk } from './chunking';
import { parseSingleNumericCommandFromText } from './commands';
import { tryLegacyStoryImport } from './legacyAdapter';
import {
  parseStoryAudit,
  parseStoryDocument,
  type ImportProgressEvent,
  type SourceUnit,
  type StoryAudit,
  type StoryAuditIssue,
  type StoryDocument,
} from './schema';
import { unitizeSource } from './sourceUnits';
import { sourceRefForUnit } from './sourceUnits';
import {
  AUDITOR_OUTPUT_TOOL,
  CONVERTER_OUTPUT_TOOL,
  buildAuditorMessages,
  buildConverterMessages,
} from './prompts';
import { validateStoryDocument, type StoryIssue } from './validator';

export const MAX_MODEL_JSON_BYTES = 10 * 1024 * 1024;
export const DEFAULT_CHUNK_CHARS = 24_000;
export const IMPORT_LLM_TIMEOUT_MS = 150_000;
const MAX_CONVERSION_ATTEMPTS = 3;

export interface ResolveStoryOptions {
  sourceId?: string;
  roleMap?: RoleMap;
  maxChunkChars?: number;
  llmTimeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: ImportProgressEvent) => void;
}

export interface ResolvedStory {
  document: StoryDocument;
  units: SourceUnit[];
  converted: boolean;
  audits: StoryAudit[];
  warnings: string[];
}

export async function resolveStoryForImport(
  source: string,
  options: ResolveStoryOptions = {}
): Promise<ResolvedStory> {
  throwIfAborted(options.signal);
  const sourceId = options.sourceId ?? 'import';
  emit(options, { phase: 'source_read', message: 'Reading script source' });
  emit(options, { phase: 'direct_import_check', message: 'Checking direct import eligibility' });

  const direct = tryLegacyStoryImport(source, sourceId, options.roleMap);
  if (direct) {
    emit(options, { phase: 'complete', message: 'Script is ready to import' });
    return { ...direct, converted: false, audits: [], warnings: [] };
  }

  throwIfAborted(options.signal);
  const units = unitizeSource(source, sourceId);
  emit(options, { phase: 'chunking', message: 'Splitting script into safe chunks' });
  const chunks = chunkSourceUnits(units, {
    maxChars: options.maxChunkChars ?? DEFAULT_CHUNK_CHARS,
  });
  const audits: StoryAudit[] = [];
  const partials: StoryDocument[] = [];

  for (const chunk of chunks) {
    const converted = await convertAndAuditChunk(chunk, chunks.length, options);
    partials.push(converted.document);
    audits.push(converted.audit);
  }

  emit(options, { phase: 'merge', message: 'Merging converted story chunks' });
  const document = mergeStoryChunks(partials);
  emit(options, { phase: 'structure_validation', message: 'Validating the complete story graph' });
  const globalIssues = validateStoryDocument(document, units);
  if (globalIssues.length > 0) {
    throw new Error(`Story merge validation failed: ${formatIssues(globalIssues)}`);
  }

  if (chunks.length > 1) {
    emit(options, { phase: 'semantic_audit', message: 'Waiting for global Auditor LLM response' });
    const globalAudit = await requestAudit(units, document, 'global', options);
    audits.push(globalAudit);
    if (!auditPassed(globalAudit)) {
      throw new Error(`Global story audit failed: ${formatAuditIssues(globalAudit.issues)}`);
    }
  }

  emit(options, { phase: 'complete', message: 'Script conversion completed' });
  return { document, units, converted: true, audits, warnings: [] };
}

async function convertAndAuditChunk(
  chunk: StorySourceChunk,
  totalChunks: number,
  options: ResolveStoryOptions
): Promise<{ document: StoryDocument; audit: StoryAudit }> {
  let previousIssues: Array<StoryAuditIssue | { evidence: string }> = [];
  let lastError = 'conversion failed';

  for (let attempt = 1; attempt <= MAX_CONVERSION_ATTEMPTS; attempt++) {
    throwIfAborted(options.signal);
    emit(options, {
      phase: 'conversion',
      attempt,
      chunk: chunk.index + 1,
      totalChunks,
      message: `Waiting for Converter LLM response (attempt ${attempt}/${MAX_CONVERSION_ATTEMPTS}, chunk ${chunk.index + 1}/${totalChunks})`,
    });

    try {
      const raw = await completeImportLlm(
        buildConverterMessages(chunk.units, attempt, previousIssues),
        {
          temperature: 0,
          maxTokens: 16_000,
          thinking: 'disabled',
          tools: [CONVERTER_OUTPUT_TOOL],
          toolName: CONVERTER_OUTPUT_TOOL.function.name,
        },
        'Converter',
        options
      );
      const document = parseStoryDocument(canonicalizeStoryOptionTexts(
        canonicalizeStoryCommands(
          canonicalizeStorySourceRefs(
            normalizeStoryCollections(parseModelJson(raw)),
            chunk.units
          )
        )
      ));
      emit(options, {
        phase: 'structure_validation',
        attempt,
        chunk: chunk.index + 1,
        totalChunks,
        message: `Validating chunk ${chunk.index + 1}/${totalChunks}`,
      });
      const deterministicIssues = validateStoryDocument(document, chunk.units, {
        allowUnresolvedTargets: true,
        allowUnreachableNodes: true,
      });
      if (deterministicIssues.length > 0) {
        lastError = formatIssues(deterministicIssues);
        previousIssues = deterministicIssues.map((issue) => ({ evidence: issue.message }));
        continue;
      }

      emit(options, {
        phase: 'semantic_audit',
        attempt,
        chunk: chunk.index + 1,
        totalChunks,
        message: `Waiting for Auditor LLM response (attempt ${attempt}/${MAX_CONVERSION_ATTEMPTS}, chunk ${chunk.index + 1}/${totalChunks})`,
      });
      const audit = await requestAudit(chunk.units, document, 'chunk', options);
      if (auditPassed(audit)) return { document, audit };
      lastError = formatAuditIssues(audit.issues);
      previousIssues = audit.issues;
    } catch (error) {
      if (isAbortError(error) || error instanceof ImportLlmTimeoutError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      previousIssues = [{ evidence: lastError }];
    }
  }

  throw new Error(`Script conversion failed after three attempts: ${lastError}`);
}

async function requestAudit(
  units: SourceUnit[],
  document: StoryDocument,
  scope: 'chunk' | 'global',
  options: Pick<ResolveStoryOptions, 'signal' | 'llmTimeoutMs'>
): Promise<StoryAudit> {
  throwIfAborted(options.signal);
  const raw = await completeImportLlm(
    buildAuditorMessages(units, document, scope),
    {
      temperature: 0,
      maxTokens: 8_000,
      thinking: 'disabled',
      tools: [AUDITOR_OUTPUT_TOOL],
      toolName: AUDITOR_OUTPUT_TOOL.function.name,
    },
    'Auditor',
    options
  );
  return parseStoryAudit(canonicalizeStorySourceRefs(
    normalizeStoryCollections(parseModelJson(raw)),
    units
  ));
}

class ImportLlmTimeoutError extends Error {
  constructor(stage: 'Converter' | 'Auditor') {
    super(`Script import timed out while waiting for the ${stage} LLM response. Please try again.`);
    this.name = 'ImportLlmTimeoutError';
  }
}

async function completeImportLlm(
  messages: Parameters<typeof completeLlm>[0],
  llmOptions: {
    temperature: number;
    maxTokens: number;
    thinking: 'adaptive' | 'disabled';
    tools: OpenAITool[];
    toolName: string;
  },
  stage: 'Converter' | 'Auditor',
  options: Pick<ResolveStoryOptions, 'signal' | 'llmTimeoutMs'>
): Promise<string> {
  const timeoutController = new AbortController();
  const combined = combineAbortSignals(options.signal, timeoutController.signal);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(new DOMException('Import LLM deadline exceeded', 'TimeoutError'));
  }, options.llmTimeoutMs ?? IMPORT_LLM_TIMEOUT_MS);

  try {
    return await completeLlm(messages, { ...llmOptions, signal: combined.signal });
  } catch (error) {
    if (timedOut) throw new ImportLlmTimeoutError(stage);
    throw error;
  } finally {
    clearTimeout(timeout);
    combined.cleanup();
  }
}

function combineAbortSignals(
  first?: AbortSignal,
  second?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const sources = [first, second].filter((signal): signal is AbortSignal => !!signal);
  const listeners = new Map<AbortSignal, () => void>();

  for (const source of sources) {
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
      for (const [source, listener] of listeners) {
        source.removeEventListener('abort', listener);
      }
    },
  };
}

export function parseModelJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('```') || trimmed.endsWith('```')) {
    throw new Error('Model must return one plain JSON object');
  }
  if (new TextEncoder().encode(trimmed).byteLength > MAX_MODEL_JSON_BYTES) {
    throw new Error('Model JSON exceeds the 10 MB limit');
  }
  return JSON.parse(trimmed);
}

export function canonicalizeStorySourceRefs(value: unknown, units: SourceUnit[]): unknown {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));

  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== 'object') return current;

    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new Error(`Unsafe JSON key: ${key}`);
      }
      if (key === 'sourceRefs' && Array.isArray(child)) {
        result[key] = child.map((rawRef) => {
          const ref = visit(rawRef);
          if (!ref || typeof ref !== 'object') return ref;
          const record = ref as Record<string, unknown>;
          const unit = typeof record.unitId === 'string'
            ? unitsById.get(record.unitId)
            : undefined;
          if (!unit) return record;
          return Object.assign(record, sourceRefForUnit(unit));
        });
      } else {
        result[key] = visit(child);
      }
    }
    return result;
  };

  return visit(value);
}

export function normalizeStoryCollections(value: unknown): unknown {
  const collectionKeys = new Set(['commands', 'options', 'sourceRefs', 'issues']);
  const decodeCollection = (candidate: unknown): unknown => {
    let decoded = candidate;
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (['', 'none', 'null', 'n/a'].includes(trimmed.toLowerCase())) return [];
      if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return candidate;
      try {
        decoded = JSON.parse(trimmed);
      } catch {
        return candidate;
      }
    }
    if (Array.isArray(decoded)) return decoded.flat(Infinity);
    if (decoded && typeof decoded === 'object') {
      return Object.keys(decoded as Record<string, unknown>).length === 0 ? [] : [decoded];
    }
    return candidate;
  };

  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.flat(Infinity).map(visit).flat(Infinity);
    if (!current || typeof current !== 'object') return current;
    const entries = Object.entries(current as Record<string, unknown>);
    if (entries.length === 1 && entries[0][0] === 'item') {
      return visit(entries[0][1]);
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of entries) {
      result[key] = visit(collectionKeys.has(key) ? decodeCollection(child) : child);
    }
    return result;
  };

  return visit(value);
}

export function canonicalizeStoryCommands(value: unknown): unknown {
  function visit(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== 'object') return current;

    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      result[key] = key === 'commands' && Array.isArray(child)
        ? child.map(canonicalizeCommand)
        : visit(child);
    }
    return result;
  }

  function canonicalizeCommand(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const record = visit(candidate) as Record<string, unknown>;
    if (typeof record.source !== 'string') return record;
    return Object.assign(record, parseSingleNumericCommandFromText(record.source));
  }

  return visit(value);
}

const OPTION_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}\s*[：:]\s*([\s\S]+)$/;
const OPTION_JUMP_PATTERN = /(?:jump|跳转)\s+[A-Za-z][A-Za-z0-9_-]{0,63}/i;

export function canonicalizeStoryOptionTexts(value: unknown): unknown {
  function visit(current: unknown): unknown {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== 'object') return current;

    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      result[key] = key === 'options' && Array.isArray(child)
        ? child.map(canonicalizeOption)
        : visit(child);
    }
    return result;
  }

  function canonicalizeOption(candidate: unknown): unknown {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const record = visit(candidate) as Record<string, unknown>;
    if (typeof record.text === 'string') record.text = cleanStructuredOptionText(record.text);
    return record;
  }

  return visit(value);
}

function cleanStructuredOptionText(text: string): string {
  const match = OPTION_PREFIX_PATTERN.exec(text.trim());
  if (!match) return text;
  const body = match[1].trim();
  const closing = body.at(-1);
  const opening = closing === ')' ? '(' : closing === '）' ? '（' : '';
  if (!opening) return text;

  const metadataStart = body.lastIndexOf(opening);
  if (metadataStart < 0) return text;
  const metadata = body.slice(metadataStart + 1, -1);
  const displayText = body.slice(0, metadataStart).trim();
  return displayText && OPTION_JUMP_PATTERN.test(metadata) ? displayText : text;
}

function auditPassed(audit: StoryAudit): boolean {
  return audit.verdict === 'pass' &&
    audit.issues.every((issue) => issue.severity === 'minor');
}

function emit(options: ResolveStoryOptions, event: ImportProgressEvent): void {
  options.onProgress?.(event);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Script import aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatIssues(issues: StoryIssue[]): string {
  return issues.map((issue) => issue.message).join('; ');
}

function formatAuditIssues(issues: StoryAuditIssue[]): string {
  return issues
    .map((issue) => issue.outputPath ? `${issue.type} at ${issue.outputPath}` : issue.type)
    .join('; ');
}
