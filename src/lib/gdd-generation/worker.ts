import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import {
  generateGdd,
  GddGenerationValidationError,
  renderGddMarkdown,
  type GeneratedGdd,
} from '@/lib/gddGeneration';
import {
  claimGddGenerationJob,
  completeGddGenerationJob,
  failGddGenerationJob,
  heartbeatGddGenerationJob,
  retryGddGenerationJob,
  type GddGenerationJob,
  type GddJobStatus,
} from '@/lib/services/gddGenerationService';

type WorkerDependencies = {
  heartbeat: typeof heartbeatGddGenerationJob;
  generate: typeof generateGdd;
  createDocument: typeof createGeneratedGddDocument;
  complete: typeof completeGddGenerationJob;
  retry: typeof retryGddGenerationJob;
  fail: typeof failGddGenerationJob;
};

const defaultDependencies: WorkerDependencies = {
  heartbeat: heartbeatGddGenerationJob,
  generate: generateGdd,
  createDocument: createGeneratedGddDocument,
  complete: completeGddGenerationJob,
  retry: retryGddGenerationJob,
  fail: failGddGenerationJob,
};

function isPermanentError(error: unknown): boolean {
  if (error instanceof GddGenerationValidationError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42501' || code === '23503' || code === '23514' || code === 'P0002';
}

async function nextDocumentName(serviceClient: SupabaseClient, projectId: string): Promise<string> {
  const base = 'Game Design Document - Draft';
  const { data, error } = await serviceClient.from('documents').select('name').eq('project_id', projectId);
  if (error) throw error;
  const names = new Set((data ?? []).map((row) => String(row.name)));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

export async function createGeneratedGddDocument(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
  _gdd: GeneratedGdd,
  markdown: string,
): Promise<{ id: string; name: string }> {
  validateSanctionedMdx(markdown);
  const name = await nextDocumentName(serviceClient, job.project_id);
  const { data, error } = await serviceClient.from('documents').insert({
    project_id: job.project_id,
    folder_id: null,
    name,
    description: `AI-generated GDD draft from ${job.input.systemTitle} version ${job.input.versionNumber}.`,
    content: markdown,
    created_by: job.owner_id,
  }).select('id,name').single();
  if (error || !data) throw error ?? new Error('Failed to create generated GDD Document.');
  try {
    await documentStateGateway.initialize(serviceClient, data.id as string, markdown);
  } catch (initializationError) {
    await serviceClient.from('documents').delete().eq('id', data.id).eq('project_id', job.project_id);
    throw initializationError;
  }
  return { id: data.id as string, name: data.name as string };
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
    const generated = await generateWithLeaseHeartbeat(input, dependencies);
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    const markdown = renderGddMarkdown(generated, { input: job.input });
    validateSanctionedMdx(markdown);
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
    const document = await dependencies.createDocument(serviceClient, job, generated, markdown);
    await dependencies.complete(serviceClient, job, workerId, {
      documentId: document.id,
      documentName: document.name,
      appliedRuleIds: generated.appliedRuleIds,
      omittedRuleIds: generated.omittedRuleIds ?? [],
    });
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
