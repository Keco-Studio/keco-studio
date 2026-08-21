import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';
import { coerceSanctionedMdx, validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
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
import { generateGddMarkdownV2, GddV2GenerationValidationError } from './v2/generator';
import {
  claimGddGenerationJob,
  failGddGenerationJob,
  heartbeatGddGenerationJob,
  persistCompletedGddGenerationJob,
  retryGddGenerationJob,
  type GddGenerationJob,
  type GddJobStatus,
} from '@/lib/services/gddGenerationService';

type WorkerDependencies = {
  heartbeat: typeof heartbeatGddGenerationJob;
  revalidateContext: typeof revalidateGddJobContext;
  generate: typeof generateGdd;
  generateV2?: typeof generateGddMarkdownV2;
  persist: typeof persistGeneratedGddDocument;
  persistV2?: typeof persistGeneratedGddV2Document;
  retry: typeof retryGddGenerationJob;
  fail: typeof failGddGenerationJob;
};

const defaultDependencies: WorkerDependencies = {
  heartbeat: heartbeatGddGenerationJob,
  revalidateContext: revalidateGddJobContext,
  generate: generateGdd,
  generateV2: generateGddMarkdownV2,
  persist: persistGeneratedGddDocument,
  persistV2: persistGeneratedGddV2Document,
  retry: retryGddGenerationJob,
  fail: failGddGenerationJob,
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
    materializeTableResources(job.design_system_id, gdd.productionTables, existingLibraryIds),
  );
  const dialogueResources = materializeDialogueResources(job.id, gdd.dialogueChapters ?? []);
  const completedMarkdown = tableResources.length > 0
    ? renderGddMarkdown(gdd, { input: job.input, tableResources })
    : markdown;
  const withTableRefs = applyInlineTableResourceReferences(completedMarkdown, tableResources);
  const withDialogue = dialogueResources.length > 0
    ? `${withTableRefs.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, dialogueResources)}\n`
    : withTableRefs;
  const dialogueMarkdown = coerceSanctionedMdx(withDialogue);
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
    materializeTableResources(job.design_system_id, tablePlans, existingLibraryIds),
  );
  const dialogueResources = materializeDialogueResources(job.id, dialoguePlans);
  const withTableRefs = applyInlineTableResourceReferences(markdown, tableResources);
  const withDialogue = dialogueResources.length > 0
    ? `${withTableRefs.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, dialogueResources)}\n`
    : withTableRefs;

  let mapCompilationFailed = false;
  let mapCompilationError: string | null = null;
  let briefs: Awaited<ReturnType<typeof compileGddMapBriefs>> = [];
  try {
    briefs = await compileGddMapBriefs({ markdown: withDialogue, artStyle: input.artStyle ?? null });
  } catch (error) {
    mapCompilationFailed = true;
    mapCompilationError = (error instanceof Error ? error.message : 'Map brief compilation failed.').slice(0, 1000);
    console.error('[GDD map brief compiler]', mapCompilationError);
  }
  const mapArtifacts = briefs.map((brief) => ({
    id: randomUUID(),
    mapBriefId: brief.id,
    title: brief.title,
    mapBrief: brief,
    styleContract: brief.styleContract,
    inputHash: hashGddGenerationInput({ brief, styleContract: brief.styleContract }),
  }));
  const decoratedMarkdown = decorateGddWithMapReferences(withDialogue, briefs.map((brief, index) => ({
    artifactId: mapArtifacts[index]!.id,
    sourceHeading: brief.sourceHeading,
    fallbackTitle: brief.title,
  })));
  const completedMarkdown = coerceSanctionedMdx(decoratedMarkdown);
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
    tableResources,
    dialogueResources,
    mapCount: briefs.length,
    mapCompilationFailed,
    ...(mapCompilationError ? { mapCompilationError } : {}),
    createdBy: job.owner_id,
    createdAt: new Date().toISOString(),
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
    tableResources,
    dialogueResources,
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
  generate: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => heartbeat(input.serviceClient, input.job.id, input.workerId, 'generating'))
      .catch((error) => {
        heartbeatFailure = error;
        controller.abort(error);
      });
  }, 30_000);
  try {
    let generated: T;
    try {
      generated = await generate(controller.signal);
    } catch (error) {
      if (heartbeatFailure) throw heartbeatFailure;
      throw error;
    }
    await pendingHeartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    return generated;
  } finally {
    clearInterval(timer);
  }
}

export async function processClaimedGddJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  dependencies: WorkerDependencies = defaultDependencies,
): Promise<GddJobStatus> {
  const { serviceClient, workerId, job } = input;
  try {
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'generating');
    await dependencies.revalidateContext(serviceClient, job);
    if (isGddGenerationRequestV2(job.input)) {
      if (!dependencies.generateV2 || !dependencies.persistV2) throw new Error('GDD v2 worker dependencies are not configured.');
      const generatedV2 = await runWithLeaseHeartbeat(input, dependencies.heartbeat, (signal) => (
        dependencies.generateV2!(job.input as GddGenerationRequestV2, undefined, { signal })
      ));
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
      validateSanctionedMdx(generatedV2.markdown);
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
      const persisted = await dependencies.persistV2(
        serviceClient,
        job,
        workerId,
        generatedV2.markdown,
        generatedV2.review,
        generatedV2.tablePlans,
        generatedV2.dialoguePlans ?? [],
      );
      return persisted.status ?? 'completed';
    }
    const generated = await runWithLeaseHeartbeat(input, dependencies.heartbeat, () => dependencies.generate(job.input));
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    const tableResources = materializeTableResources(job.design_system_id, generated.productionTables);
    const markdown = renderGddMarkdown(generated, { input: job.input, tableResources });
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
