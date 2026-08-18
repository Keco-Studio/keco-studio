import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateGameDesignSystemOutput, RuleSetGenerationValidationError, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import {
  claimGameDesignSystemGenerationJob,
  completeGameDesignSystemGenerationJob,
  createGameDesignSystem,
  failGameDesignSystemGenerationJob,
  heartbeatGameDesignSystemGenerationJob,
  retryGameDesignSystemGenerationJob,
  type GameDesignSystem,
  type GameDesignSystemGenerationJob,
  type GameDesignSystemJobStatus,
} from '@/lib/services/gameDesignSystemService';

type WorkerDependencies = {
  heartbeat: typeof heartbeatGameDesignSystemGenerationJob;
  generate: typeof generateGameDesignSystemOutput;
  createSystem: typeof createGameDesignSystem;
  complete: typeof completeGameDesignSystemGenerationJob;
  retry: typeof retryGameDesignSystemGenerationJob;
  fail: typeof failGameDesignSystemGenerationJob;
};

const defaultDependencies: WorkerDependencies = {
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
    const message = error instanceof Error ? error.message : 'Game Design System generation failed.';
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
