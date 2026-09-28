import 'server-only';

import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getDialogueGenerationJob, retryDialogueGenerationJob } from '@/lib/services/dialogueGenerationService';
import { getGddResourceJob, retryFailedGddResourceJob } from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const id = z.string().uuid();
const base = z.object({ projectId: id, gddJobId: id }).strict();
const resourceInput = base.extend({ resourceJobId: id, acknowledgeDuplicateBilling: z.boolean().optional() }).strict();
const dialogueInput = base.extend({ dialogueJobId: id }).strict();
const snapshot = { expectedUpdatedAt: z.string().min(1), expectedAttemptCount: z.number().int().min(0) };
const sealedResource = resourceInput.extend({ ...snapshot, expectedKind: z.enum(['tables', 'dialogue', 'maps']),
  expectedCompletedAt: z.string().min(1), expectedAvailableAt: z.string().min(1) }).strict();
const sealedDialogue = dialogueInput.extend(snapshot).strict();

class RetryError extends Error {}

function failure(error: unknown): ToolResult {
  return { success: false, error: error instanceof z.ZodError ? 'Invalid GDD retry parameters.'
    : error instanceof RetryError ? error.message : 'GDD retry failed. Check access and job state.' };
}

async function authorized(ctx: ToolContext, projectId: string) {
  if (!ctx.userId) throw new RetryError('Authentication required.');
  const access = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  if (access.role !== 'admin' && access.role !== 'editor') {
    throw new RetryError('Retrying GDD jobs requires editor or admin permission.');
  }
}

async function failedResource(ctx: ToolContext, input: z.infer<typeof resourceInput>) {
  await authorized(ctx, input.projectId);
  const resource = await getGddResourceJob(getSupabaseServiceRoleClient(), {
    projectId: input.projectId, jobId: input.gddJobId, resourceJobId: input.resourceJobId,
  });
  if (!resource) throw new RetryError('GDD resource job not found.');
  if (resource.status !== 'failed') throw new RetryError('Only failed GDD resource jobs can be retried.');
  if (resource.kind === 'maps' && input.acknowledgeDuplicateBilling !== true) {
    throw new RetryError('Map resource retry requires acknowledgeDuplicateBilling=true.');
  }
  const updatedAt = (resource as typeof resource & { updated_at?: string }).updated_at;
  if (!updatedAt || !resource.completed_at || !resource.available_at) {
    throw new RetryError('GDD resource job snapshot is unavailable.');
  }
  return { ...resource, updated_at: updatedAt };
}

async function failedDialogue(ctx: ToolContext, input: z.infer<typeof dialogueInput>) {
  await authorized(ctx, input.projectId);
  const job = await getDialogueGenerationJob(getSupabaseServiceRoleClient(),
    input.projectId, input.gddJobId, input.dialogueJobId);
  if (!job) throw new RetryError('Dialogue generation job not found.');
  if (job.status !== 'failed') throw new RetryError('Only failed dialogue jobs can be retried.');
  if (!job.updated_at) throw new RetryError('Dialogue job snapshot is unavailable.');
  return job;
}

function wake(kind: 'resource' | 'dialogue'): void {
  const work = async () => {
    try {
      const serviceClient = getSupabaseServiceRoleClient();
      if (kind === 'resource') {
        const { processNextGddResourceJob } = await import('@/lib/gdd-generation/resources/worker');
        await processNextGddResourceJob({ serviceClient, workerId: `assistant-gdd-resource-${randomUUID()}` });
      } else {
        const { processNextDialogueJob } = await import('@/lib/gdd-generation/dialogueWorker');
        await processNextDialogueJob({ serviceClient, workerId: `assistant-gdd-dialogue-${randomUUID()}` });
      }
    } catch (error) {
      console.error('[Assistant GDD retry worker]', error);
    }
  };
  try { after(work); }
  catch (error) {
    if (process.env.NODE_ENV === 'test' && error instanceof Error &&
      error.message.includes('`after` was called outside a request scope')) return;
    throw error;
  }
}

export async function prepareResourceRetry(ctx: ToolContext, params: unknown) {
  const input = resourceInput.parse(params);
  const current = await failedResource(ctx, input);
  return { args: { ...input, expectedUpdatedAt: current.updated_at,
    expectedAttemptCount: current.attempt_count, expectedKind: current.kind,
    expectedCompletedAt: current.completed_at, expectedAvailableAt: current.available_at },
    preview: { action: 'retry_gdd_resource_job', projectId: input.projectId,
      gddJobId: input.gddJobId, resourceJobId: input.resourceJobId, kind: current.kind,
      consequence: current.kind === 'maps'
        ? 'Retry map generation. This may submit up to three paid map images and may incur duplicate charges.'
        : `Retry failed ${current.kind} generation. This may incur AI provider charges.` } };
}

export async function retryResource(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedResource.parse(params);
    const current = await failedResource(ctx, input);
    if (current.updated_at !== input.expectedUpdatedAt ||
      current.attempt_count !== input.expectedAttemptCount || current.kind !== input.expectedKind ||
      current.completed_at !== input.expectedCompletedAt || current.available_at !== input.expectedAvailableAt) {
      throw new RetryError('GDD resource job changed after approval. Request confirmation again.');
    }
    const result = await retryFailedGddResourceJob(getSupabaseServiceRoleClient(), input.resourceJobId);
    wake('resource');
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      gddJobId: input.gddJobId, resourceJobId: result.id, kind: result.kind, status: result.status },
      invalidations: [{ type: 'game-design-systems' }] };
  } catch (error) { return failure(error); }
}

export async function prepareDialogueRetry(ctx: ToolContext, params: unknown) {
  const input = dialogueInput.parse(params);
  const current = await failedDialogue(ctx, input);
  return { args: { ...input, expectedUpdatedAt: current.updated_at,
    expectedAttemptCount: current.attempt_count },
    preview: { action: 'retry_gdd_dialogue_job', projectId: input.projectId,
      gddJobId: input.gddJobId, dialogueJobId: input.dialogueJobId, title: current.title.slice(0, 160),
      consequence: 'Retry failed dialogue generation. This may incur AI provider charges.' } };
}

export async function retryDialogue(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedDialogue.parse(params);
    const current = await failedDialogue(ctx, input);
    if (current.updated_at !== input.expectedUpdatedAt || current.attempt_count !== input.expectedAttemptCount) {
      throw new RetryError('Dialogue job changed after approval. Request confirmation again.');
    }
    const result = await retryDialogueGenerationJob(getSupabaseServiceRoleClient(), input.dialogueJobId, ctx.userId);
    wake('dialogue');
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      gddJobId: input.gddJobId, dialogueJobId: result.id, status: result.status },
      invalidations: [{ type: 'game-design-systems' }] };
  } catch (error) { return failure(error); }
}

export function preparationFailure(error: unknown) {
  return { success: false as const, error: failure(error).error! };
}
