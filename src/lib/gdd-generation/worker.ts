import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';
import { coerceGeneratedSanctionedMdx, validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import { decorateGddWithMapReferences } from '@/lib/documents/gddMapMarkdown';
import {
  applyInlineTableResourceReferences,
  materializeTableResources,
  sanitizeTableResourcesForPersistence,
} from '@/lib/gdd-generation/tableResources';
import { loadSeriesTableLibraryIds } from '@/lib/gdd-generation/seriesTableIds';
import {
  materializeDialogueResources,
  renderDialogueReferences,
  type DialoguePlan,
} from '@/lib/gdd-generation/dialogueResources';
import {
  generateGdd,
  GddGenerationValidationError,
  renderGddMarkdown,
  type GeneratedGdd,
  hashGddGenerationInput,
} from '@/lib/gddGeneration';
import { compileGddMapBriefs } from './maps/compiler';
import { isGddGenerationRequestV2, type GddGenerationRequestV2 } from './v2/contracts';
import type { ResourceChangeSummary } from './resourceEvolution';
import {
  generateGddMarkdownV2,
  reviewGddMarkdownV2,
  GddV2GenerationValidationError,
  GddV2ResourceRecoveryError,
} from './v2/generator';
import {
  generateProfessionalStage,
  type ProfessionalCheckpoint,
  type ProfessionalStage,
} from './v2/professionalStages';
import {
  claimGddGenerationJob,
  checkpointGddGenerationJob,
  failGddGenerationJob,
  heartbeatGddGenerationJob,
  persistCompletedGddGenerationJob,
  retryGddGenerationJob,
  type GddGenerationJob,
  type GddJobPhase,
  type GddJobStatus,
  enqueueGddResourceJobs,
} from '@/lib/services/gddGenerationService';

type WorkerDependencies = {
  heartbeat: typeof heartbeatGddGenerationJob;
  revalidateContext: typeof revalidateGddJobContext;
  generate: typeof generateGdd;
  generateV2?: typeof generateGddMarkdownV2;
  generateProfessionalStage?: (...args: any[]) => Promise<any>;
  reviewV2?: (...args: any[]) => Promise<any>;
  persist: typeof persistGeneratedGddDocument;
  persistV2?: typeof persistGeneratedGddV2Document;
  retry: typeof retryGddGenerationJob;
  fail: typeof failGddGenerationJob;
  checkpoint?: (...args: any[]) => Promise<boolean>;
};

const QUICK_GDD_GENERATION_DEADLINE_MS = 120_000;
const PROFESSIONAL_GDD_GENERATION_DEADLINE_MS = 240_000;
const MIN_GDD_GENERATION_DEADLINE_MS = 30_000;
const MAX_GDD_GENERATION_DEADLINE_MS = 600_000;
const MAX_PROFESSIONAL_STAGE_DEADLINE_MS = 240_000;

function gddGenerationDeadlineMs(job: GddGenerationJob): number {
  const configured = Number(process.env.GDD_GENERATION_DEADLINE_MS);
  if (
    Number.isSafeInteger(configured)
    && configured >= MIN_GDD_GENERATION_DEADLINE_MS
    && configured <= MAX_GDD_GENERATION_DEADLINE_MS
  ) return configured;
  const input = job.input as { contractVersion?: unknown; mode?: unknown };
  return input.contractVersion === 2 && input.mode === 'professional'
    ? PROFESSIONAL_GDD_GENERATION_DEADLINE_MS
    : QUICK_GDD_GENERATION_DEADLINE_MS;
}

export function professionalStageDeadlineMs(_job: GddGenerationJob): number {
  const configured = Number(process.env.GDD_PROFESSIONAL_STAGE_DEADLINE_MS);
  if (
    Number.isSafeInteger(configured)
    && configured >= MIN_GDD_GENERATION_DEADLINE_MS
    && configured <= MAX_PROFESSIONAL_STAGE_DEADLINE_MS
  ) return configured;
  return PROFESSIONAL_GDD_GENERATION_DEADLINE_MS;
}

function tableSeriesSeed(job: Pick<GddGenerationJob, 'project_id' | 'design_system_id'>): string {
  return `${job.project_id}:${job.design_system_id}`;
}

const defaultDependencies: WorkerDependencies = {
  heartbeat: heartbeatGddGenerationJob,
  revalidateContext: revalidateGddJobContext,
  generate: generateGdd,
  generateV2: generateGddMarkdownV2,
  generateProfessionalStage,
  reviewV2: reviewGddMarkdownV2,
  persist: persistGeneratedGddDocument,
  persistV2: persistGeneratedGddV2Document,
  retry: retryGddGenerationJob,
  fail: failGddGenerationJob,
  checkpoint: checkpointGddGenerationJob,
};

export type PersistedGddGeneration = {
  id: string;
  name: string;
  status?: GddJobStatus;
  generationRevision: number | null;
  resourceChangeSummary: ResourceChangeSummary | null;
};

export function shouldWakeGddGenerationJob(
  job: Pick<GddGenerationJob, 'status' | 'available_at' | 'lease_expires_at'>,
  now = Date.now(),
): boolean {
  if (job.status === 'queued') return Date.parse(job.available_at) <= now;
  if (job.status === 'running') {
    return Boolean(job.lease_expires_at) && Date.parse(job.lease_expires_at as string) <= now;
  }
  return false;
}

export function describeGddGenerationError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 1_000);
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (parts.length > 0) {
      const code = typeof value.code === 'string' && value.code.trim() ? ` [${value.code.trim()}]` : '';
      return `${parts.join(': ')}${code}`.slice(0, 1_000);
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized.slice(0, 1_000);
    } catch {
      // Fall through to a stable message for non-serializable errors.
    }
  }
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 1_000);
  return 'GDD generation failed.';
}

export class GddJobContextInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddJobContextInvalidError';
  }
}

function isPermanentError(error: unknown): boolean {
  if (
    error instanceof GddGenerationValidationError
    || error instanceof GddV2GenerationValidationError
    || error instanceof GddV2ResourceRecoveryError
    || error instanceof GddJobContextInvalidError
  ) return true;
  // Soft-strip orphan REFs when table plans are missing; prefer repair in the
  // generator over failing the whole GDD job.
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42501' || code === '23503' || code === '23514' || code === 'P0002';
}

export async function revalidateGddJobContext(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
): Promise<void> {
  const projectPromise = serviceClient.from('projects')
    .select('owner_id')
    .eq('id', job.project_id)
    .maybeSingle();
  const collaboratorPromise = serviceClient.from('project_collaborators')
    .select('role,accepted_at')
    .eq('project_id', job.project_id)
    .eq('user_id', job.owner_id)
    .maybeSingle();
  const bindingPromise = serviceClient.from('project_game_design_systems')
    .select('design_system_id,version_id')
    .eq('project_id', job.project_id)
    .maybeSingle();
  const [project, collaborator, binding] = await Promise.all([
    projectPromise,
    collaboratorPromise,
    bindingPromise,
  ]);
  if (project.error) throw project.error;
  if (collaborator.error) throw collaborator.error;
  if (binding.error) throw binding.error;

  const isOwner = project.data?.owner_id === job.owner_id;
  const hasAcceptedWriteRole = Boolean(
    collaborator.data?.accepted_at
      && (collaborator.data.role === 'admin' || collaborator.data.role === 'editor'),
  );
  if (!project.data || (!isOwner && !hasAcceptedWriteRole)) {
    throw new GddJobContextInvalidError('GDD generation permission is no longer valid.');
  }
  if (
    !binding.data
    || binding.data.design_system_id !== job.design_system_id
    || binding.data.version_id !== job.version_id
  ) {
    throw new GddJobContextInvalidError('The project Game Design System binding changed before generation.');
  }
}

function sourceSnapshotMetadata(job: GddGenerationJob): Array<Record<string, unknown>> {
  return job.input.projectSources.map((source) => ({
    kind: source.kind,
    ...(source.projectId ? { projectId: source.projectId } : {}),
    ...(source.resourceId ? { resourceId: source.resourceId } : {}),
    label: source.label,
    contentHash: source.contentHash,
    byteCount: source.byteCount,
    truncated: source.truncated,
    ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}),
  }));
}

export async function persistGeneratedGddDocument(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
  workerId: string,
  gdd: GeneratedGdd,
  markdown: string,
): Promise<PersistedGddGeneration> {
  const existingLibraryIds = await loadSeriesTableLibraryIds(
    serviceClient,
    job.project_id,
    job.design_system_id,
  );
  const tableResources = sanitizeTableResourcesForPersistence(
    materializeTableResources(tableSeriesSeed(job), gdd.productionTables, existingLibraryIds),
  );
  const dialogueResources = materializeDialogueResources(job.id, gdd.dialogueChapters ?? []);
  const completedMarkdown = tableResources.length > 0
    ? renderGddMarkdown(gdd, { input: job.input, tableResources })
    : markdown;
  const withTableRefs = applyInlineTableResourceReferences(completedMarkdown, tableResources);
  const withDialogue = dialogueResources.length > 0
    ? `${withTableRefs.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, dialogueResources)}\n`
    : withTableRefs;
  const dialogueMarkdown = coerceGeneratedSanctionedMdx(withDialogue);
  validateSanctionedMdx(dialogueMarkdown);
  const yjsState = await documentContentCodec.markdownToYjsState(dialogueMarkdown);
  const createdAt = new Date().toISOString();
  const persisted = await persistCompletedGddGenerationJob(serviceClient, {
    jobId: job.id,
    workerId,
    markdown: dialogueMarkdown,
    yjsState,
    description: `AI-generated GDD draft from ${job.input.systemTitle} version ${job.input.versionNumber}.`,
    metadata: {
      source: 'game_design_system_generation',
      designSystemId: job.design_system_id,
      versionId: job.version_id,
      jobId: job.id,
      sourceSnapshots: sourceSnapshotMetadata(job),
      appliedRuleIds: gdd.appliedRuleIds,
      omittedRuleIds: gdd.omittedRuleIds ?? [],
      tableResources,
      dialogueResources,
      createdBy: job.owner_id,
      createdAt,
      versionSummary: `Update GDD content for ${job.input.systemTitle}`,
    },
    appliedRuleIds: gdd.appliedRuleIds,
    omittedRuleIds: gdd.omittedRuleIds ?? [],
    tableResources,
    dialogueResources,
  });
  const { error: bindError } = typeof (serviceClient as { from?: unknown }).from === 'function'
    ? await serviceClient
      .from('documents')
      .update({ gdd_generation_job_id: job.id })
      .eq('id', persisted.id)
    : { error: null };
  if (bindError) console.error('[GDD document job binding]', bindError);
  return persisted;
}

export async function persistGeneratedGddV2Document(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
  workerId: string,
  markdown: string,
  review: unknown,
  tablePlans: Parameters<typeof materializeTableResources>[1] = [],
  dialoguePlans: DialoguePlan[] = [],
): Promise<PersistedGddGeneration> {
  const input = job.input as GddGenerationRequestV2;
  const existingLibraryIds = await loadSeriesTableLibraryIds(
    serviceClient,
    job.project_id,
    job.design_system_id,
  );
  const tableResources = sanitizeTableResourcesForPersistence(
    materializeTableResources(tableSeriesSeed(job), tablePlans, existingLibraryIds),
  );
  const dialogueResources = materializeDialogueResources(job.id, dialoguePlans);
  const asyncResources = job.resource_mode === 'async' || (input as { resourceMode?: string }).resourceMode === 'async';
  const persistedTableResources = asyncResources ? [] : tableResources;
  const persistedDialogueResources = asyncResources ? [] : dialogueResources;
  const withTableRefs = applyInlineTableResourceReferences(markdown, persistedTableResources);
  const withDialogue = persistedDialogueResources.length > 0
    ? `${withTableRefs.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, persistedDialogueResources)}\n`
    : withTableRefs;
  const documentMarkdown = withDialogue;

  let mapCompilationFailed = false;
  let mapCompilationError: string | null = null;
  let briefs: Awaited<ReturnType<typeof compileGddMapBriefs>> = [];
  if (!asyncResources) {
    try {
      briefs = await compileGddMapBriefs({ markdown: withDialogue, artStyle: input.artStyle ?? null });
    } catch (error) {
      mapCompilationFailed = true;
      mapCompilationError = (error instanceof Error ? error.message : 'Map brief compilation failed.').slice(0, 1000);
      console.error('[GDD map brief compiler]', mapCompilationError);
    }
  }
  const mapArtifacts = briefs.map((brief) => ({
    id: randomUUID(),
    mapBriefId: brief.id,
    title: brief.title,
    mapBrief: brief,
    styleContract: brief.styleContract,
    inputHash: hashGddGenerationInput({ brief, styleContract: brief.styleContract }),
  }));
  const decoratedMarkdown = decorateGddWithMapReferences(documentMarkdown, briefs.map((brief, index) => ({
    artifactId: mapArtifacts[index]!.id,
    sourceHeading: brief.sourceHeading,
    fallbackTitle: brief.title,
  })));
  const completedMarkdown = coerceGeneratedSanctionedMdx(decoratedMarkdown);
  validateSanctionedMdx(completedMarkdown);
  const yjsState = await documentContentCodec.markdownToYjsState(completedMarkdown);

  const metadata = {
    source: 'game_design_system_generation',
    contractVersion: 2,
    mode: input.mode,
    designSystemId: job.design_system_id,
    versionId: job.version_id,
    jobId: job.id,
    sourceSnapshots: sourceSnapshotMetadata(job),
    appliedRuleIds: job.applied_rule_ids,
    omittedRuleIds: job.omitted_rule_ids,
    review,
    tableResources: persistedTableResources,
    dialogueResources: persistedDialogueResources,
    ...(asyncResources ? { deferredTableResources: tableResources, deferredDialogueResources: dialogueResources } : {}),
    mapCount: briefs.length,
    mapCompilationFailed,
    ...(mapCompilationError ? { mapCompilationError } : {}),
    createdBy: job.owner_id,
    createdAt: new Date().toISOString(),
    versionSummary: `Update GDD content for ${input.systemTitle}`,
  };

  // Tables/dialogue ownership stays on the resource-evolution RPC. Map
  // artifacts are attached afterward so both pipelines can coexist without a
  // unified persistence migration yet.
  const persisted = await persistCompletedGddGenerationJob(serviceClient, {
    jobId: job.id,
    workerId,
    markdown: completedMarkdown,
    yjsState,
    description: `Structured ${input.mode} GDD draft from ${input.systemTitle} version ${input.versionNumber}.`,
    metadata,
    appliedRuleIds: job.applied_rule_ids,
    omittedRuleIds: job.omitted_rule_ids,
    tableResources: persistedTableResources,
    dialogueResources: persistedDialogueResources,
  });

  // Series evolution historically omitted documents.gdd_generation_job_id.
  // Map prepare requires the Document to be bindable to this job.
  if (typeof (serviceClient as { from?: unknown }).from === 'function') {
    const { error: bindError } = await serviceClient
      .from('documents')
      .update({ gdd_generation_job_id: job.id })
      .eq('id', persisted.id);
    if (bindError) console.error('[GDD document job binding]', bindError);
  }

  if (asyncResources) {
    try {
      await enqueueGddResourceJobs(serviceClient, {
        jobId: job.id,
        projectId: job.project_id,
        documentId: persisted.id,
        resources: [
          ...(input.rules.tableGuidance.length > 0 || tableResources.length > 0 || dialogueResources.length > 0
            ? [{ kind: 'tables' as const, payload: { input, resources: tableResources, dialogueResources, markdown: documentMarkdown } }]
            : []),
          { kind: 'maps' as const, payload: { markdown: documentMarkdown, artStyle: input.artStyle ?? null } },
        ],
      });
    } catch (error) {
      console.error('[GDD async resource enqueue]', describeGddGenerationError(error));
    }
    return { ...persisted, status: 'completed' };
  }

  let status: GddJobStatus = 'completed';
  if (mapCompilationFailed) {
    status = 'completed_with_map_failures';
    const { error } = await serviceClient.from('gdd_generation_jobs').update({
      status,
      phase: 'completed',
    }).eq('id', job.id);
    if (error) console.error('[GDD map compilation failure status]', error);
  } else if (mapArtifacts.length > 0) {
    const { error: insertError } = await serviceClient.from('gdd_map_artifacts').insert(
      mapArtifacts.map((artifact) => ({
        id: artifact.id,
        gdd_generation_job_id: job.id,
        gdd_document_id: persisted.id,
        project_id: job.project_id,
        owner_id: job.owner_id,
        design_system_id: job.design_system_id,
        version_id: job.version_id,
        map_brief_id: artifact.mapBriefId,
        title: artifact.title,
        map_brief: artifact.mapBrief,
        style_contract: artifact.styleContract,
        input_hash: artifact.inputHash,
      })),
    );
    if (insertError) {
      console.error('[GDD map artifact insert]', insertError);
      status = 'completed_with_map_failures';
      await serviceClient.from('gdd_generation_jobs').update({
        status,
        phase: 'completed',
      }).eq('id', job.id);
    } else {
      status = 'waiting_for_maps';
      const { error } = await serviceClient.from('gdd_generation_jobs').update({
        status,
        phase: 'generating_maps',
        completed_at: null,
      }).eq('id', job.id);
      if (error) {
        console.error('[GDD waiting_for_maps status]', error);
        status = 'completed_with_map_failures';
      }
    }
  }

  return { ...persisted, status };
}

async function runWithLeaseHeartbeat<T>(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  heartbeat: typeof heartbeatGddGenerationJob,
  deadlineMs: number,
  generate: (signal: AbortSignal) => Promise<T>,
  options: { heartbeatPhase?: GddJobPhase; deadlineMessage?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const deadline = setTimeout(() => {
    controller.abort(new Error(options.deadlineMessage ?? 'GDD generation deadline exceeded.'));
  }, deadlineMs);
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => heartbeat(
        input.serviceClient,
        input.job.id,
        input.workerId,
        options.heartbeatPhase ?? 'generating',
      ))
      .catch((error) => {
        heartbeatFailure = error;
        controller.abort(error);
      });
  }, 30_000);
  try {
    let generated: T;
    try {
      const generation = generate(controller.signal);
      generated = await Promise.race([
        generation,
        new Promise<T>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(controller.signal.reason ?? new Error('GDD generation was aborted.'));
          }, { once: true });
        }),
      ]);
    } catch (error) {
      if (heartbeatFailure) throw heartbeatFailure;
      throw error;
    }
    await Promise.race([
      pendingHeartbeat,
      new Promise<void>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(controller.signal.reason ?? new Error('GDD generation was aborted.'));
        }, { once: true });
      }),
    ]);
    if (heartbeatFailure) throw heartbeatFailure;
    return generated;
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
  }
}

const PROFESSIONAL_PHASES = new Set<GddJobPhase>([
  'collecting',
  'planning',
  'generating_core',
  'generating_systems',
  'generating_content',
  'reviewing',
  'saving',
]);

function isProfessionalResumableJob(job: GddGenerationJob): job is GddGenerationJob & { input: GddGenerationRequestV2 } {
  return isGddGenerationRequestV2(job.input)
    && job.input.mode === 'professional'
    && PROFESSIONAL_PHASES.has(job.phase);
}

function professionalCheckpoint(job: GddGenerationJob): ProfessionalCheckpoint {
  return {
    blueprint: job.blueprint ?? null,
    section_drafts: job.section_drafts ?? [],
    review_report: job.review_report ?? null,
    repair_round: Number.isSafeInteger(job.repair_round) ? job.repair_round : 0,
  };
}

const chineseChapterNumerals = ['', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d', '\u4e03', '\u516b', '\u4e5d'];

function chineseChapterNumber(value: number): string {
  if (value <= 10) return value === 10 ? '\u5341' : chineseChapterNumerals[value]!;
  if (value < 20) return `\u5341${chineseChapterNumerals[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${chineseChapterNumerals[tens]}\u5341${ones ? chineseChapterNumerals[ones] : ''}`;
}

function numberProfessionalMajorHeadings(markdown: string, language: string): string {
  const isChinese = /^zh(?:[-_]|$)/i.test(language.trim());
  let chapter = 0;
  return markdown.split(/\r?\n/).map((line) => {
    const match = /^##(?!#)[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!match) return line;
    const title = match[1]!.replace(/[ \t]+#+[ \t]*$/, '').trim()
      .replace(/^(?:[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u96f6〇\u4e24]+、|\d+[.)、．][ \t]*)/, '')
      .trim();
    if (!title) return line;
    chapter += 1;
    const prefix = isChinese ? `${chineseChapterNumber(chapter)}、` : `${chapter}. `;
    return `## ${prefix}${title}`;
  }).join('\n');
}

function assembledProfessionalMarkdown(checkpoint: ProfessionalCheckpoint): string {
  const blueprint = checkpoint.blueprint as { title?: unknown } | null;
  const title = typeof blueprint?.title === 'string' && blueprint.title.trim()
    ? blueprint.title.trim()
    : 'Professional Game Design Document';
  const drafts = checkpoint.section_drafts
    .map((draft) => (draft && typeof draft === 'object' && typeof (draft as { markdown?: unknown }).markdown === 'string'
      ? (draft as { markdown: string }).markdown.trim()
      : ''))
    .filter(Boolean);
  if (drafts.length === 0) throw new GddV2GenerationValidationError('Professional GDD has no section drafts to review.');
  return `# ${title}\n\n${drafts.join('\n\n')}`;
}

type ProfessionalReviewReport = {
  review: unknown;
  markdown: string;
  tablePlans: Parameters<typeof materializeTableResources>[1];
  tablePlanWarning: string | null;
  dialoguePlans: DialoguePlan[];
  dialoguePlanWarning: string | null;
};

function readProfessionalReviewReport(value: unknown): ProfessionalReviewReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GddV2GenerationValidationError('Professional GDD review checkpoint is missing.');
  }
  const report = value as Record<string, unknown>;
  if (typeof report.markdown !== 'string' || !report.markdown.trim()) {
    throw new GddV2GenerationValidationError('Professional GDD review checkpoint has no Markdown.');
  }
  return {
    review: report.review,
    markdown: report.markdown,
    tablePlans: Array.isArray(report.tablePlans) ? report.tablePlans as ProfessionalReviewReport['tablePlans'] : [],
    tablePlanWarning: typeof report.tablePlanWarning === 'string' ? report.tablePlanWarning : null,
    dialoguePlans: Array.isArray(report.dialoguePlans) ? report.dialoguePlans as DialoguePlan[] : [],
    dialoguePlanWarning: typeof report.dialoguePlanWarning === 'string' ? report.dialoguePlanWarning : null,
  };
}

async function processProfessionalGddPhase(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob & { input: GddGenerationRequestV2 } },
  dependencies: WorkerDependencies,
): Promise<GddJobStatus> {
  const { serviceClient, workerId, job } = input;
  const checkpoint = dependencies.checkpoint ?? checkpointGddGenerationJob;
  const current = professionalCheckpoint(job);
  const saveCheckpoint = async (nextPhase: GddJobPhase, values: ProfessionalCheckpoint) => {
    const saved = await checkpoint(serviceClient, {
      jobId: job.id,
      workerId,
      nextPhase,
      blueprint: values.blueprint,
      sectionDrafts: values.section_drafts,
      reviewReport: values.review_report,
      repairRound: values.repair_round,
    });
    if (!saved) throw new Error('GDD generation job lease was lost while saving a professional checkpoint.');
    return 'queued' as const;
  };

  if (job.phase === 'collecting') return saveCheckpoint('planning', current);
  if (job.phase === 'saving') {
    if (!dependencies.persistV2) throw new Error('Professional GDD persistence dependency is not configured.');
    const report = readProfessionalReviewReport(current.review_report);
    const markdown = numberProfessionalMajorHeadings(report.markdown, job.input.language);
    const persisted = await runWithLeaseHeartbeat(
      input,
      dependencies.heartbeat,
      professionalStageDeadlineMs(job),
      async () => dependencies.persistV2!(
        serviceClient,
        job,
        workerId,
        markdown,
        report.review,
        report.tablePlans,
        report.dialoguePlans,
      ),
      {
        heartbeatPhase: 'saving',
        deadlineMessage: `Professional GDD stage saving exceeded its ${Math.round(professionalStageDeadlineMs(job) / 1000)}-second deadline.`,
      },
    );
    return persisted.status ?? 'completed';
  }

  if (job.phase === 'reviewing') {
    if (!dependencies.reviewV2) throw new Error('Professional GDD review dependency is not configured.');
    const markdown = assembledProfessionalMarkdown(current);
    const reviewed = await runWithLeaseHeartbeat(
      input,
      dependencies.heartbeat,
      professionalStageDeadlineMs(job),
      (signal) => dependencies.reviewV2!(job.input, markdown, {}, { signal }),
      {
        heartbeatPhase: 'reviewing',
        deadlineMessage: `Professional GDD stage reviewing exceeded its ${Math.round(professionalStageDeadlineMs(job) / 1000)}-second deadline.`,
      },
    );
    return saveCheckpoint('saving', {
      ...current,
      review_report: {
        review: reviewed.review,
        markdown: numberProfessionalMajorHeadings(reviewed.markdown, job.input.language),
        tablePlans: reviewed.tablePlans,
        tablePlanWarning: reviewed.tablePlanWarning,
        dialoguePlans: reviewed.dialoguePlans,
        dialoguePlanWarning: reviewed.dialoguePlanWarning,
      },
      repair_round: reviewed.review.repairRound ?? current.repair_round,
    });
  }

  if (!dependencies.generateProfessionalStage) throw new Error('Professional GDD stage dependency is not configured.');
  const stage = job.phase as ProfessionalStage;
  const generated = await runWithLeaseHeartbeat(
    input,
    dependencies.heartbeat,
    professionalStageDeadlineMs(job),
    (signal) => dependencies.generateProfessionalStage!(job.input, stage, current, {}, signal),
    {
      heartbeatPhase: job.phase,
      deadlineMessage: `Professional GDD stage ${job.phase} exceeded its ${Math.round(professionalStageDeadlineMs(job) / 1000)}-second deadline.`,
    },
  );
  const nextPhase: Record<ProfessionalStage, GddJobPhase> = {
    planning: 'generating_core',
    generating_core: 'generating_systems',
    generating_systems: 'generating_content',
    generating_content: 'reviewing',
  };
  return saveCheckpoint(nextPhase[stage], {
    ...current,
    blueprint: generated.blueprint,
    section_drafts: generated.sectionDrafts,
  });
}

export async function processClaimedGddJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  dependencies: WorkerDependencies = defaultDependencies,
): Promise<GddJobStatus> {
  const { serviceClient, workerId, job } = input;
  try {
    await dependencies.heartbeat(
      serviceClient,
      job.id,
      workerId,
      isProfessionalResumableJob(job) ? job.phase : 'generating',
    );
    await dependencies.revalidateContext(serviceClient, job);
    if (isProfessionalResumableJob(job)) {
      return await processProfessionalGddPhase({
        serviceClient,
        workerId,
        job,
      }, dependencies);
    }
    if (isGddGenerationRequestV2(job.input)) {
      if (!dependencies.generateV2 || !dependencies.persistV2) throw new Error('GDD v2 worker dependencies are not configured.');
      const generatedV2 = await runWithLeaseHeartbeat(input, dependencies.heartbeat, gddGenerationDeadlineMs(job), (signal) => (
        dependencies.generateV2!(job.input as GddGenerationRequestV2, undefined, { signal })
      ));
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
      const normalizedV2Markdown = coerceGeneratedSanctionedMdx(generatedV2.markdown);
      validateSanctionedMdx(normalizedV2Markdown);
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
      const persisted = await dependencies.persistV2(
        serviceClient,
        job,
        workerId,
        normalizedV2Markdown,
        generatedV2.review,
        generatedV2.tablePlans,
        generatedV2.dialoguePlans ?? [],
      );
      return persisted.status ?? 'completed';
    }
    const generated = await runWithLeaseHeartbeat(
      input,
      dependencies.heartbeat,
      gddGenerationDeadlineMs(job),
      () => dependencies.generate(job.input),
    );
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    const tableResources = materializeTableResources(tableSeriesSeed(job), generated.productionTables);
    const markdown = coerceGeneratedSanctionedMdx(renderGddMarkdown(generated, { input: job.input, tableResources }));
    validateSanctionedMdx(markdown);
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
    await dependencies.persist(serviceClient, job, workerId, generated, markdown);
    return 'completed';
  } catch (error) {
    const message = describeGddGenerationError(error);
    if (isPermanentError(error)) {
      await dependencies.fail(serviceClient, job.id, workerId, message);
      return 'failed';
    }
    const delay = job.attempt_count <= 1 ? 5 : 20;
    return (await dependencies.retry(serviceClient, job.id, workerId, message, delay)) ?? 'failed';
  }
}

export async function processNextGddJob(input: {
  serviceClient: SupabaseClient;
  workerId: string;
}): Promise<{ claimed: boolean; jobId?: string; status?: GddJobStatus }> {
  const job = await claimGddGenerationJob(input.serviceClient, input.workerId);
  if (!job) return { claimed: false };
  const status = await processClaimedGddJob({ ...input, job });
  return { claimed: true, jobId: job.id, status };
}
