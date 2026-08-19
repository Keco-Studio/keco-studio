import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import {
  materializeTableResources,
  renderTableReferences,
  sanitizeTableResourcesForPersistence,
} from '@/lib/gdd-generation/tableResources';
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
} from '@/lib/gddGeneration';
import { isGddGenerationRequestV2, type GddGenerationRequestV2 } from './v2/contracts';
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
  if (error instanceof GddGenerationValidationError || error instanceof GddV2GenerationValidationError || error instanceof GddJobContextInvalidError) return true;
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
): Promise<{ id: string; name: string }> {
  const tableResources = sanitizeTableResourcesForPersistence(
    materializeTableResources(job.id, gdd.productionTables),
  );
  const dialogueResources = materializeDialogueResources(job.id, gdd.dialogueChapters ?? []);
  const completedMarkdown = tableResources.length > 0
    ? renderGddMarkdown(gdd, { input: job.input, tableResources })
    : markdown;
  const dialogueMarkdown = dialogueResources.length > 0
    ? `${completedMarkdown.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, dialogueResources)}\n`
    : completedMarkdown;
  validateSanctionedMdx(dialogueMarkdown);
  const yjsState = await documentContentCodec.markdownToYjsState(dialogueMarkdown);
  const createdAt = new Date().toISOString();
  return persistCompletedGddGenerationJob(serviceClient, {
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
}

export async function persistGeneratedGddV2Document(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
  workerId: string,
  markdown: string,
  review: unknown,
  tablePlans: Parameters<typeof materializeTableResources>[1] = [],
  dialoguePlans: DialoguePlan[] = [],
): Promise<{ id: string; name: string }> {
  const input = job.input as GddGenerationRequestV2;
  const tableResources = sanitizeTableResourcesForPersistence(
    materializeTableResources(job.id, tablePlans),
  );
  const dialogueResources = materializeDialogueResources(job.id, dialoguePlans);
  const tableMarkdown = tableResources.length > 0
    ? `${markdown.trim()}\n\n## Keco Tables\n\n${renderTableReferences(job.project_id, tableResources)}\n`
    : markdown;
  const completedMarkdown = dialogueResources.length > 0
    ? `${tableMarkdown.trim()}\n\n## Dialogue Resources\n\n${renderDialogueReferences(job.project_id, dialogueResources)}\n`
    : tableMarkdown;
  validateSanctionedMdx(completedMarkdown);
  const yjsState = await documentContentCodec.markdownToYjsState(completedMarkdown);
  return persistCompletedGddGenerationJob(serviceClient, {
    jobId: job.id,
    workerId,
    markdown: completedMarkdown,
    yjsState,
    description: `Structured ${input.mode} GDD draft from ${input.systemTitle} version ${input.versionNumber}.`,
    metadata: {
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
      createdBy: job.owner_id,
      createdAt: new Date().toISOString(),
    },
    appliedRuleIds: job.applied_rule_ids,
    omittedRuleIds: job.omitted_rule_ids,
    tableResources,
    dialogueResources,
  });
}

async function runWithLeaseHeartbeat<T>(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  heartbeat: typeof heartbeatGddGenerationJob,
  generate: () => Promise<T>,
): Promise<T> {
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => heartbeat(input.serviceClient, input.job.id, input.workerId, 'generating'))
      .catch((error) => { heartbeatFailure = error; });
  }, 30_000);
  try {
    const generated = await generate();
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
      const generatedV2 = await runWithLeaseHeartbeat(input, dependencies.heartbeat, () => dependencies.generateV2!(job.input as GddGenerationRequestV2));
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
      validateSanctionedMdx(generatedV2.markdown);
      await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
      await dependencies.persistV2(
        serviceClient,
        job,
        workerId,
        generatedV2.markdown,
        generatedV2.review,
        generatedV2.tablePlans,
        ...((generatedV2.dialoguePlans ?? []).length > 0 ? [generatedV2.dialoguePlans] : []),
      );
      return 'completed';
    }
    const generated = await runWithLeaseHeartbeat(input, dependencies.heartbeat, () => dependencies.generate(job.input));
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    const tableResources = materializeTableResources(job.id, generated.productionTables);
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
