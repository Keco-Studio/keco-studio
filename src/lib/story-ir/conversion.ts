import { completeLlm } from '@/lib/agent/llm-client';
import type { RoleMap } from '@/lib/script-parser';
import { chunkSourceUnits, mergeStoryChunks, type StorySourceChunk } from './chunking';
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
import { buildAuditorMessages, buildConverterMessages } from './prompts';
import { validateStoryDocument, type StoryIssue } from './validator';

export const MAX_MODEL_JSON_BYTES = 10 * 1024 * 1024;
export const DEFAULT_CHUNK_CHARS = 24_000;
const MAX_CONVERSION_ATTEMPTS = 3;

export interface ResolveStoryOptions {
  sourceId?: string;
  roleMap?: RoleMap;
  maxChunkChars?: number;
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
    emit(options, { phase: 'semantic_audit', message: 'Auditing global branch relationships' });
    const globalAudit = await requestAudit(units, document, 'global', options.signal);
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
      message: `Converting chunk ${chunk.index + 1}/${totalChunks}`,
    });

    try {
      const raw = await completeLlm(buildConverterMessages(chunk.units, attempt, previousIssues), {
        temperature: 0.1,
        maxTokens: 16_000,
        signal: options.signal,
      });
      const document = parseStoryDocument(parseModelJson(raw));
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
        message: `Auditing chunk ${chunk.index + 1}/${totalChunks}`,
      });
      const audit = await requestAudit(chunk.units, document, 'chunk', options.signal);
      if (auditPassed(audit)) return { document, audit };
      lastError = formatAuditIssues(audit.issues);
      previousIssues = audit.issues;
    } catch (error) {
      if (isAbortError(error)) throw error;
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
  signal?: AbortSignal
): Promise<StoryAudit> {
  throwIfAborted(signal);
  const raw = await completeLlm(buildAuditorMessages(units, document, scope), {
    temperature: 0,
    maxTokens: 8_000,
    signal,
  });
  return parseStoryAudit(parseModelJson(raw));
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
