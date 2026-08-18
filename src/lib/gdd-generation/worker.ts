import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import {
  generateGdd,
  GddGenerationValidationError,
  renderGddMarkdown,
  type GeneratedGdd,
} from '@/lib/gddGeneration';
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
  persist: typeof persistGeneratedGddDocument;
  retry: typeof retryGddGenerationJob;
  fail: typeof failGddGenerationJob;
};

const defaultDependencies: WorkerDependencies = {
  heartbeat: heartbeatGddGenerationJob,
  revalidateContext: revalidateGddJobContext,
  generate: generateGdd,
  persist: persistGeneratedGddDocument,
  retry: retryGddGenerationJob,
  fail: failGddGenerationJob,
};

export class GddJobContextInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddJobContextInvalidError';
  }
}

function isPermanentError(error: unknown): boolean {
  if (error instanceof GddGenerationValidationError || error instanceof GddJobContextInvalidError) return true;
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
  validateSanctionedMdx(markdown);
  const yjsState = await documentContentCodec.markdownToYjsState(markdown);
  const createdAt = new Date().toISOString();
  return persistCompletedGddGenerationJob(serviceClient, {
    jobId: job.id,
    workerId,
    markdown,
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
      createdBy: job.owner_id,
      createdAt,
    },
    appliedRuleIds: gdd.appliedRuleIds,
    omittedRuleIds: gdd.omittedRuleIds ?? [],
  });
}

async function generateWithLeaseHeartbeat(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddGenerationJob },
  dependencies: Pick<WorkerDependencies, 'heartbeat' | 'generate'>,
): Promise<GeneratedGdd> {
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => dependencies.heartbeat(input.serviceClient, input.job.id, input.workerId, 'generating'))
      .catch((error) => { heartbeatFailure = error; });
  }, 30_000);
  try {
    const generated = await dependencies.generate(input.job.input);
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
    const generated = await generateWithLeaseHeartbeat(input, dependencies);
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    const markdown = renderGddMarkdown(generated, { input: job.input });
    validateSanctionedMdx(markdown);
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
    await dependencies.persist(serviceClient, job, workerId, generated, markdown);
    return 'completed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GDD generation failed.';
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
