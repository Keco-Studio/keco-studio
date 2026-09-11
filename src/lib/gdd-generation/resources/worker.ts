import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { compileGddMapBriefs } from '../maps/compiler';
import {
  claimGddResourceJob,
  enqueueGddMapArtifacts,
  finishGddResourceJob,
  materializeGddResourcePayload,
  retryGddResourceJob,
  type GddResourceJob,
} from '@/lib/services/gddGenerationService';
import { hashGddGenerationInput } from '@/lib/gddGeneration';
import { randomUUID } from 'node:crypto';

type Dependencies = {
  claim: typeof claimGddResourceJob;
  finish: typeof finishGddResourceJob;
  retry: typeof retryGddResourceJob;
  compile: typeof compileGddMapBriefs;
  materialize: typeof materializeGddResourcePayload;
};

const defaults: Dependencies = { claim: claimGddResourceJob, finish: finishGddResourceJob, retry: retryGddResourceJob, compile: compileGddMapBriefs, materialize: materializeGddResourcePayload };

function message(error: unknown): string {
  return (error instanceof Error ? error.message : 'GDD resource generation failed.').slice(0, 1000);
}

export async function processClaimedGddResourceJob(
  input: { serviceClient: SupabaseClient; workerId: string; job: GddResourceJob },
  dependencies: Dependencies = defaults,
): Promise<'completed' | 'queued' | 'failed'> {
  const { serviceClient, workerId, job } = input;
  try {
    if (job.kind === 'maps') {
      const payload = job.payload as { markdown?: unknown; artStyle?: unknown };
      if (typeof payload.markdown !== 'string') throw new Error('Map resource payload is missing Markdown.');
      const briefs = await dependencies.compile({ markdown: payload.markdown, artStyle: payload.artStyle ?? null });
      const artifacts = briefs.map((brief) => ({
        id: randomUUID(),
        mapBriefId: brief.id,
        title: brief.title,
        mapBrief: brief,
        styleContract: brief.styleContract,
        inputHash: hashGddGenerationInput({ brief, styleContract: brief.styleContract }),
      }));
      if (artifacts.length > 0) await enqueueGddMapArtifacts(serviceClient, job.gdd_generation_job_id, artifacts);
    } else if (job.kind === 'tables') {
      const payload = job.payload as { markdown?: unknown; resources?: unknown[]; dialogueResources?: unknown[] };
      if (typeof payload.markdown !== 'string') throw new Error('Resource payload is missing Markdown.');
      await dependencies.materialize(serviceClient, {
        jobId: job.gdd_generation_job_id,
        documentId: job.document_id,
        workerId,
        metadata: { source: 'gdd_async_resource_worker', resourceJobId: job.id },
        tableResources: payload.resources ?? [],
        dialogueResources: payload.dialogueResources ?? [],
      });
    }
    const result = await dependencies.finish(serviceClient, { jobId: job.id, workerId, status: 'completed' });
    return result === 'completed' ? 'completed' : 'failed';
  } catch (error) {
    const result = await dependencies.retry(serviceClient, { jobId: job.id, workerId, error: message(error), delaySeconds: job.attempt_count <= 1 ? 5 : 20 });
    return result === 'queued' ? 'queued' : 'failed';
  }
}

export async function processNextGddResourceJob(input: { serviceClient: SupabaseClient; workerId: string }, dependencies: Dependencies = defaults) {
  const job = await dependencies.claim(input.serviceClient, input.workerId);
  if (!job) return { claimed: false as const };
  const status = await processClaimedGddResourceJob({ ...input, job }, dependencies);
  return { claimed: true as const, jobId: job.id, status };
}
