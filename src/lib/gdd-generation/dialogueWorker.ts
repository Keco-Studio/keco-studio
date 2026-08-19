import type { SupabaseClient } from '@supabase/supabase-js';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { DocumentAccessError } from '@/lib/documents/documentStateTypes';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { replaceDialogueReference } from '@/lib/documents/serverDocumentReplacement';
import {
  claimDialogueGenerationJob,
  completeDialogueGenerationJob,
  failDialogueGenerationJob,
  heartbeatDialogueGenerationJob,
  retryDialogueGenerationJob,
  type DialogueGenerationJob,
  type DialogueJobStatus,
} from '@/lib/services/dialogueGenerationService';

export function describeDialogueGenerationError(error: unknown): string {
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
  }
  return typeof error === 'string' && error.trim() ? error.trim().slice(0, 1_000) : 'Dialogue generation failed.';
}

function isPermanentError(error: unknown): boolean {
  if (error instanceof DocumentAccessError) return true;
  if (error instanceof Error && /source document|empty dialogue|no valid content|not accessible/i.test(error.message)) return true;
  if (!error || typeof error !== 'object') return false;
  return ['42501', '23503', '23514', 'P0002'].includes(String((error as { code?: unknown }).code ?? ''));
}

export type DialogueWorkerDependencies = {
  claim: typeof claimDialogueGenerationJob;
  heartbeat: typeof heartbeatDialogueGenerationJob;
  complete: typeof completeDialogueGenerationJob;
  fail: typeof failDialogueGenerationJob;
  retry: (serviceClient: SupabaseClient, jobId: string, workerId: string, errorMessage: string, delaySeconds: number) => Promise<DialogueJobStatus | null>;
  read: typeof documentStateGateway.read;
  resolve: typeof resolveStoryForImport;
  importStory: typeof importStoryDocument;
  resolveOwner: (serviceClient: SupabaseClient, job: DialogueGenerationJob) => Promise<string>;
  findExistingScript: (serviceClient: SupabaseClient, job: DialogueGenerationJob, sourceState: { epoch: number; revision: number; updateIds: string[] }) => Promise<string | null>;
  updateReference: (serviceClient: SupabaseClient, job: DialogueGenerationJob, scriptLibraryId: string) => Promise<void>;
};

const defaultDependencies: DialogueWorkerDependencies = {
  claim: claimDialogueGenerationJob,
  heartbeat: heartbeatDialogueGenerationJob,
  complete: completeDialogueGenerationJob,
  fail: async (client, jobId, workerId, errorMessage, delaySeconds) => {
    await failDialogueGenerationJob(client, jobId, workerId, errorMessage, delaySeconds);
    return true;
  },
  retry: async (client, jobId, workerId, errorMessage, delaySeconds) => {
    await failDialogueGenerationJob(client, jobId, workerId, errorMessage, delaySeconds);
    return 'queued';
  },
  read: documentStateGateway.read,
  resolve: resolveStoryForImport,
  importStory: importStoryDocument,
  resolveOwner: async (client, job) => {
    const { data, error } = await client.from('gdd_generation_jobs')
      .select('owner_id')
      .eq('id', job.gdd_generation_job_id)
      .eq('project_id', job.project_id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.owner_id) throw new Error('Dialogue source GDD owner is not available.');
    return data.owner_id;
  },
  findExistingScript: async (client, job, sourceState) => {
    const { data, error } = await client.from('libraries')
      .select('id,dialogue_generation_ready,dialogue_generation_source_epoch,dialogue_generation_source_revision,dialogue_generation_source_update_ids')
      .eq('project_id', job.project_id)
      .eq('dialogue_generation_job_id', job.id)
      .eq('document_export_type', 'script')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.dialogue_generation_ready === true
      && data.dialogue_generation_source_epoch === sourceState.epoch
      && data.dialogue_generation_source_revision === sourceState.revision
      && JSON.stringify(data.dialogue_generation_source_update_ids ?? []) === JSON.stringify(sourceState.updateIds)) return data.id;
    const cleanup = await client.from('libraries')
      .delete()
      .eq('id', data.id)
      .eq('dialogue_generation_job_id', job.id)
      .eq('dialogue_generation_ready', false);
    if (cleanup.error) throw cleanup.error;
    return null;
  },
  updateReference: async (client, job, scriptLibraryId) => {
    const { data, error } = await client.from('gdd_generation_jobs')
      .select('owner_id,output_document_id')
      .eq('id', job.gdd_generation_job_id)
      .eq('project_id', job.project_id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.owner_id || !data.output_document_id) return;
    await replaceDialogueReference(client, {
      actorUserId: data.owner_id,
      projectId: job.project_id,
      documentId: data.output_document_id,
      dialogueJobId: job.id,
      scriptLibraryId,
    });
  },
};

export function shouldWakeDialogueGenerationJob(
  job: Pick<DialogueGenerationJob, 'status' | 'available_at' | 'lease_expires_at'>,
  now = Date.now(),
): boolean {
  if (job.status === 'queued') return Date.parse(job.available_at) <= now;
  return job.status === 'running'
    && Boolean(job.lease_expires_at)
    && Date.parse(job.lease_expires_at as string) <= now;
}

async function runWithLeaseHeartbeat<T>(
  input: { serviceClient: SupabaseClient; workerId: string; job: DialogueGenerationJob },
  heartbeat: DialogueWorkerDependencies['heartbeat'],
  operation: () => Promise<T>,
): Promise<T> {
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => heartbeat(input.serviceClient, input.job.id, input.workerId, 90))
      .catch((error) => { heartbeatFailure = error; });
  }, 30_000);
  try {
    const result = await operation();
    await pendingHeartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    return result;
  } finally {
    clearInterval(timer);
  }
}

export async function processClaimedDialogueJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: DialogueGenerationJob },
  overrides: Partial<DialogueWorkerDependencies> = {},
): Promise<DialogueJobStatus> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const { serviceClient, workerId, job } = input;
  try {
    await dependencies.heartbeat(serviceClient, job.id, workerId, 90);
    const source = await dependencies.read(serviceClient, job.document_id);
    const content = source.markdown.trim();
    if (!content) throw new Error('Source dialogue Document is empty.');
    const sourceState = {
      epoch: source.token?.epoch ?? 0,
      revision: source.token?.revision ?? 0,
      updateIds: (source.updateTail ?? []).map((update) => update.id).sort(),
    };
    const existingScriptId = await dependencies.findExistingScript(serviceClient, job, sourceState);
    if (existingScriptId) {
      await dependencies.complete(serviceClient, job.id, workerId, existingScriptId);
      try {
        await dependencies.updateReference(serviceClient, job, existingScriptId);
      } catch {
        // Job status remains authoritative when a user edit wins the GDD CAS race.
      }
      return 'completed';
    }
    await dependencies.heartbeat(serviceClient, job.id, workerId, 90);
    const imported = await runWithLeaseHeartbeat(
      input,
      dependencies.heartbeat,
      async () => {
        const resolved = await dependencies.resolve(content, {
          sourceId: job.document_id,
          skipSemanticAuditAfterValidation: true,
          enableAiPlotPlanning: false,
        });
        const ownerId = await dependencies.resolveOwner(serviceClient, job);
        return dependencies.importStory(serviceClient, {
          userId: ownerId,
          projectId: job.project_id,
          folderId: null,
          libraryName: `${job.title} Script (${job.chapter_key})`,
          fileName: `${job.title}.md`,
          document: resolved.document,
          plotPlan: resolved.plotPlan,
          documentSource: { sourceDocumentId: job.document_id, exportType: 'script' },
          dialogueGenerationJobId: job.id,
          dialogueGenerationWorkerId: workerId,
          dialogueSourceState: sourceState,
        });
      },
    );
    try {
      await dependencies.updateReference(serviceClient, job, imported.libraryId);
    } catch {
      // Job status remains authoritative when a user edit wins the GDD CAS race.
    }
    return 'completed';
  } catch (error) {
    const message = describeDialogueGenerationError(error);
    if (isPermanentError(error) || job.attempt_count >= job.max_attempts) {
      await dependencies.fail(serviceClient, job.id, workerId, message, 0);
      return 'failed';
    }
    const delay = Math.min(300, Math.max(5, 5 * (2 ** Math.max(0, job.attempt_count - 1))));
    return (await dependencies.retry(serviceClient, job.id, workerId, message, delay)) ?? 'failed';
  }
}

export async function processNextDialogueJob(
  input: { serviceClient: SupabaseClient; workerId: string },
  overrides: Partial<DialogueWorkerDependencies> & {
    process?: (input: { serviceClient: SupabaseClient; workerId: string; job: DialogueGenerationJob }) => Promise<DialogueJobStatus>;
  } = {},
): Promise<{ claimed: boolean; jobId?: string; status?: DialogueJobStatus }> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const job = await dependencies.claim(input.serviceClient, input.workerId);
  if (!job) return { claimed: false };
  const status = overrides.process
    ? await overrides.process({ ...input, job })
    : await processClaimedDialogueJob({ ...input, job }, overrides);
  return { claimed: true, jobId: job.id, status };
}
