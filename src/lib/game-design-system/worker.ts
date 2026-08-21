import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateGameDesignSystemOutput, RuleSetGenerationValidationError, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import {
  claimGameDesignSystemGenerationJob,
  completeGameDesignSystemGenerationJob,
  createGameDesignSystem,
  failGameDesignSystemGenerationJob,
  getGameDesignSystemVersionByGenerationJobId,
  heartbeatGameDesignSystemGenerationJob,
  retryGameDesignSystemGenerationJob,
  type GameDesignSystem,
  type GameDesignSystemGenerationJob,
  type GameDesignSystemJobStatus,
} from '@/lib/services/gameDesignSystemService';

type WorkerDependencies = {
  findGenerationOutput: typeof getGameDesignSystemVersionByGenerationJobId;
  heartbeat: typeof heartbeatGameDesignSystemGenerationJob;
  generate: typeof generateGameDesignSystemOutput;
  createSystem: typeof createGameDesignSystem;
  complete: typeof completeGameDesignSystemGenerationJob;
  retry: typeof retryGameDesignSystemGenerationJob;
  fail: typeof failGameDesignSystemGenerationJob;
};

const GENERATION_OUTPUT_LOOKUP_TIMEOUT_MS = 15_000;

export function shouldWakeGameDesignSystemGenerationJob(
  job: Pick<GameDesignSystemGenerationJob, 'status' | 'available_at' | 'lease_expires_at'>,
  now = Date.now(),
): boolean {
  if (job.status === 'queued') return Date.parse(job.available_at) <= now;
  if (job.status === 'running') {
    return Boolean(job.lease_expires_at) && Date.parse(job.lease_expires_at as string) <= now;
  }
  return false;
}

export function describeGenerationError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [value.message, value.details, value.hint].find((item) => typeof item === 'string' && item.trim());
    if (typeof message === 'string') {
      return typeof value.code === 'string' && value.code.trim()
        ? `${message} [${value.code}]`
        : message;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized.slice(0, 1_000);
    } catch {
      // Fall through to a stable user-facing message for non-serializable errors.
    }
  }
  if (typeof error === 'string' && error.trim()) return error;
  return 'Game Design System generation failed.';
}

const defaultDependencies: WorkerDependencies = {
  findGenerationOutput: getGameDesignSystemVersionByGenerationJobId,
  heartbeat: heartbeatGameDesignSystemGenerationJob,
  generate: generateGameDesignSystemOutput,
  createSystem: createGameDesignSystem,
  complete: completeGameDesignSystemGenerationJob,
  retry: retryGameDesignSystemGenerationJob,
  fail: failGameDesignSystemGenerationJob,
};

function isPermanentGenerationError(error: unknown): boolean {
  if (error instanceof RuleSetGenerationValidationError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42501' || code === '23514' || code === 'P0002';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateWithLeaseHeartbeat(
  input: { serviceClient: SupabaseClient; workerId: string; jobId: string; generationInput: ResolvedGameDesignGenerationInput },
  dependencies: Pick<WorkerDependencies, 'heartbeat' | 'generate'>,
) {
  let heartbeatFailure: unknown;
  let pendingHeartbeat = Promise.resolve();
  const timer = setInterval(() => {
    pendingHeartbeat = pendingHeartbeat
      .then(() => dependencies.heartbeat(input.serviceClient, input.jobId, input.workerId, 'generating'))
      .catch((error) => { heartbeatFailure = error; });
  }, 30_000);
  try {
    const rules = await dependencies.generate(input.generationInput);
    await pendingHeartbeat;
    if (heartbeatFailure) throw heartbeatFailure;
    return rules;
  } finally {
    clearInterval(timer);
  }
}

export async function processClaimedGameDesignSystemJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: GameDesignSystemGenerationJob },
  dependencies: WorkerDependencies = defaultDependencies,
): Promise<GameDesignSystemJobStatus> {
  const { serviceClient, workerId, job } = input;
  try {
    const existingOutput = await withTimeout(
      dependencies.findGenerationOutput(serviceClient, job.id),
      GENERATION_OUTPUT_LOOKUP_TIMEOUT_MS,
      'Timed out while checking the generation output. The job will be retried.',
    );
    if (existingOutput) {
      await dependencies.complete(serviceClient, job, workerId, existingOutput);
      return 'completed';
    }
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'generating');
    const generationInput = job.input as unknown as ResolvedGameDesignGenerationInput;
    const generated = await generateWithLeaseHeartbeat({
      serviceClient,
      workerId,
      jobId: job.id,
      generationInput,
    }, dependencies);
    const { document, rules } = generated;
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'validating');
    await dependencies.heartbeat(serviceClient, job.id, workerId, 'saving');
    const created = await dependencies.createSystem(serviceClient, job.owner_id, {
      title: generationInput.title,
      summary: generationInput.description,
      genres: rules.genres,
      philosophies: rules.philosophies,
      suitableFor: rules.suitableFor,
      document,
      rules,
      artStyle: generationInput.artStyle,
      sourceSnapshots: generationInput.sourceSnapshots,
      generationJobId: job.id,
      parentVersion: generationInput.baseVersionId && generationInput.baseSystemId && generationInput.baseRules ? {
        id: generationInput.baseVersionId,
        system_id: generationInput.baseSystemId,
        version_number: 0,
        document: generationInput.baseDocument,
        rules: generationInput.baseRules,
        source_snapshots: [],
      } : null,
      provenance: {
        description: generationInput.description,
        baseSystemId: generationInput.baseSystemId,
        referenceGames: generationInput.referenceGames,
      },
      status: 'draft',
    }) as GameDesignSystem;
    if (!created.current_version_id) throw new Error('Generated system has no saved version.');
    await dependencies.complete(serviceClient, job, workerId, {
      systemId: created.id,
      versionId: created.current_version_id,
    });
    return 'completed';
  } catch (error) {
    const message = describeGenerationError(error);
    if (isPermanentGenerationError(error)) {
      await dependencies.fail(serviceClient, job.id, workerId, message);
      return 'failed';
    }
    const delay = job.attempt_count <= 1 ? 5 : 20;
    return (await dependencies.retry(serviceClient, job.id, workerId, message, delay)) ?? 'failed';
  }
}

export async function processNextGameDesignSystemJob(input: {
  serviceClient: SupabaseClient;
  workerId: string;
}): Promise<{ claimed: boolean; jobId?: string; status?: GameDesignSystemJobStatus }> {
  const job = await claimGameDesignSystemGenerationJob(input.serviceClient, input.workerId);
  if (!job) return { claimed: false };
  const status = await processClaimedGameDesignSystemJob({ ...input, job });
  return { claimed: true, jobId: job.id, status };
}
