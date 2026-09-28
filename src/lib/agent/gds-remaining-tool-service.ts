import 'server-only';

import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import { gameDesignRuleSetSchema, gameDesignSystemTitleSchema } from '@/lib/game-design-system/ruleSchema';
import { createGameDesignSystemVersionRequestSchema, gameDesignSystemVersionIdempotencyKeySchema } from '@/lib/game-design-system/versionRequest';
import { createAgentStructuredGameDesignSystem, createGameDesignSystemGenerationJob,
  getGameDesignSystem, getGameDesignSystemGenerationJob, getGameDesignSystemVersion,
  IdempotencyConflictError } from '@/lib/services/gameDesignSystemService';
import { createPublicGameDesignSystemVersion, PublicGameDesignSystemVersionError } from '@/lib/services/gameDesignSystemWriteService.server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getPublicGddGenerationJob, cancelGddGenerationJob } from '@/lib/services/gddGenerationService';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { resolveGameDesignSourceSnapshots } from '@/lib/game-design-system/sourceSnapshots';
import { wakeQueuedGameDesignSystemJob } from './gds-job-wake';

const uuid = z.string().uuid();
const retryKey = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const createSchema = z.object({ title: gameDesignSystemTitleSchema,
  summary: z.string().trim().max(1000).optional(), rules: gameDesignRuleSetSchema,
  idempotencyKey: uuid }).strict();
const versionSchema = z.object({ designSystemId: uuid, idempotencyKey: gameDesignSystemVersionIdempotencyKeySchema,
  request: createGameDesignSystemVersionRequestSchema }).strict();
const unbindSchema = z.object({ projectId: uuid }).strict();
const sealedUnbind = unbindSchema.extend({ expectedDesignSystemId: uuid, expectedVersionId: uuid,
  expectedUpdatedAt: z.string() }).strict();
const retrySchema = z.object({ jobId: uuid, idempotencyKey: retryKey }).strict();
const cancelGddSchema = z.object({ projectId: uuid, jobId: uuid }).strict();
const sealedCancelGddSchema = cancelGddSchema.extend({ expectedStatus: z.enum(['queued', 'running']) }).strict();
const retrySourceSchema = z.object({ kind: z.enum(['document', 'table']), projectId: uuid,
  resourceId: uuid }).passthrough();
const RETRY_INPUT_CHANGED = 'Generation sources or access changed. Start a new generation request.';

function authenticate(ctx: ToolContext) {
  if (!ctx.userId) throw new Error('Authentication required.');
}

function failure(error: unknown): ToolResult {
  const known = error instanceof PublicGameDesignSystemVersionError ? error.publicMessage
    : error instanceof IdempotencyConflictError ? error.message
      : error instanceof Error && (error.message === RETRY_INPUT_CHANGED || /^(Authentication required|The Game Design System from this request|Only project owners|Only failed jobs|Generation job not found|GDD generation job not found|GDD generation job changed|Project Game Design System changed|No Game Design System is bound|Generating a GDD requires)/.test(error.message)) ? error.message : null;
  return { success: false, error: error instanceof z.ZodError ? 'Invalid Game Design System parameters.'
    : known ?? 'Game Design System operation failed.' };
}

export async function createStructuredSystem(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    authenticate(ctx);
    const input = createSchema.parse(params);
    const system = await createAgentStructuredGameDesignSystem(getSupabaseServiceRoleClient(), ctx.userId, {
      title: input.title!, summary: input.summary, rules: input.rules!, idempotencyKey: input.idempotencyKey!,
    });
    return { success: true, displayHint: 'text', data: { designSystemId: system.id,
      title: system.title, status: system.status, currentVersionId: system.current_version_id,
      updatedAt: system.updated_at },
      invalidations: [{ type: 'game-design-systems', designSystemId: system.id }] };
  } catch (error) { return failure(error); }
}

export async function prepareVersion(ctx: ToolContext, params: unknown) {
  authenticate(ctx);
  const input = versionSchema.parse(params);
  const system = await getGameDesignSystem(ctx.supabase, input.designSystemId);
  if (!system || system.source !== 'user' || system.owner_id !== ctx.userId) {
    throw new PublicGameDesignSystemVersionError('VERSION_FORBIDDEN');
  }
  if (system.current_version_id !== input.request.expectedCurrentVersionId) {
    throw new PublicGameDesignSystemVersionError('VERSION_STALE');
  }
  return { args: input, preview: { action: 'create_game_design_system_version',
    designSystemId: system.id, title: system.title,
    parentVersionId: input.request.parentVersionId,
    expectedCurrentVersionId: input.request.expectedCurrentVersionId,
    consequence: 'Create a new current version of this Game Design System.' } };
}

export async function createVersion(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    authenticate(ctx);
    const input = versionSchema.parse(params);
    const version = await createPublicGameDesignSystemVersion(getSupabaseServiceRoleClient(), {
      systemId: input.designSystemId, actorId: ctx.userId,
      idempotencyKey: input.idempotencyKey, request: input.request,
    });
    return { success: true, displayHint: 'text', data: { designSystemId: input.designSystemId,
      versionId: version.id, versionNumber: version.version_number, parentVersionId: version.parent_version_id },
      invalidations: [{ type: 'game-design-systems', designSystemId: input.designSystemId }] };
  } catch (error) { return failure(error); }
}

async function ownerOrAdmin(ctx: ToolContext, projectId: string) {
  authenticate(ctx);
  const access = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  if (!access.isOwner && access.role !== 'admin') {
    throw new Error('Only project owners and admins can change the Game Design System.');
  }
}

async function boundSystem(ctx: ToolContext, projectId: string) {
  await ownerOrAdmin(ctx, projectId);
  const { data, error } = await ctx.supabase.from('project_game_design_systems')
    .select('design_system_id,version_id,updated_at').eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No Game Design System is bound to this project.');
  return data;
}

export async function prepareUnbind(ctx: ToolContext, params: unknown) {
  const input = unbindSchema.parse(params);
  const binding = await boundSystem(ctx, input.projectId);
  const system = await getGameDesignSystem(ctx.supabase, binding.design_system_id);
  if (!system) throw new Error('No Game Design System is bound to this project.');
  return { args: { ...input, expectedDesignSystemId: binding.design_system_id,
    expectedVersionId: binding.version_id, expectedUpdatedAt: binding.updated_at },
    preview: { action: 'unbind_game_design_system', projectId: input.projectId,
      designSystemId: system.id, title: system.title, versionId: binding.version_id,
      consequence: 'Remove the Game Design System binding from this project.' } };
}

export async function unbindSystem(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedUnbind.parse(params);
    const binding = await boundSystem(ctx, input.projectId);
    if (binding.design_system_id !== input.expectedDesignSystemId ||
        binding.version_id !== input.expectedVersionId || binding.updated_at !== input.expectedUpdatedAt) {
      throw new Error('Project Game Design System changed after approval. Request confirmation again.');
    }
    const { data, error } = await ctx.supabase.from('project_game_design_systems').delete()
      .eq('project_id', input.projectId).eq('design_system_id', input.expectedDesignSystemId)
      .eq('version_id', input.expectedVersionId).eq('updated_at', input.expectedUpdatedAt)
      .select('project_id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Project Game Design System changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { projectId: input.projectId,
      designSystemId: input.expectedDesignSystemId, versionId: input.expectedVersionId, unbound: true },
      invalidations: [{ type: 'game-design-systems', designSystemId: input.expectedDesignSystemId,
        projectId: input.projectId }] };
  } catch (error) { return failure(error); }
}

async function failedSystemJob(ctx: ToolContext, jobId: string) {
  authenticate(ctx);
  const previous = await getGameDesignSystemGenerationJob(ctx.supabase, jobId);
  if (!previous || previous.owner_id !== ctx.userId) throw new Error('Generation job not found.');
  if (previous.status !== 'failed') throw new Error('Only failed jobs can be retried.');
  return previous;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function authorizeRetryInput(ctx: ToolContext, raw: unknown): Promise<ResolvedGameDesignGenerationInput> {
  const input = raw as ResolvedGameDesignGenerationInput | null;
  if (!input || !Array.isArray(input.sourceSnapshots) || input.sourceSnapshots.length > 10) {
    throw new Error(RETRY_INPUT_CHANGED);
  }
  const references = z.array(retrySourceSchema).safeParse(input.sourceSnapshots);
  if (!references.success) throw new Error(RETRY_INPUT_CHANGED);
  try {
    const current = await resolveGameDesignSourceSnapshots(ctx.supabase, references.data.map(
      ({ kind, projectId, resourceId }) => ({ kind, projectId, resourceId })));
    if (canonicalJson(current) !== canonicalJson(input.sourceSnapshots)) throw new Error(RETRY_INPUT_CHANGED);

    if (input.baseSystemId !== undefined) {
      if (!uuid.safeParse(input.baseSystemId).success || !uuid.safeParse(input.baseVersionId).success
        || !input.baseDocument || !input.baseRules) throw new Error(RETRY_INPUT_CHANGED);
      const base = await getGameDesignSystem(ctx.supabase, input.baseSystemId);
      if (!base || (base.source !== 'official' && base.owner_id !== ctx.userId)
        || base.current_version_id !== input.baseVersionId) throw new Error(RETRY_INPUT_CHANGED);
      const visible = await ctx.supabase.from('game_design_system_versions').select('id,system_id')
        .eq('id', input.baseVersionId).eq('system_id', input.baseSystemId).maybeSingle();
      if (visible.error || !visible.data) throw new Error(RETRY_INPUT_CHANGED);
      const version = await getGameDesignSystemVersion(getSupabaseServiceRoleClient(), input.baseVersionId);
      if (!version || version.system_id !== input.baseSystemId
        || canonicalJson(version.document) !== canonicalJson(input.baseDocument)
        || canonicalJson(version.rules) !== canonicalJson(input.baseRules)) throw new Error(RETRY_INPUT_CHANGED);
    } else if (input.baseVersionId || input.baseDocument || input.baseRules) {
      throw new Error(RETRY_INPUT_CHANGED);
    }
  } catch {
    throw new Error(RETRY_INPUT_CHANGED);
  }
  return input;
}

export async function prepareSystemRetry(ctx: ToolContext, params: unknown) {
  const input = retrySchema.parse(params);
  const previous = await failedSystemJob(ctx, input.jobId);
  await authorizeRetryInput(ctx, previous.input);
  return { args: input, preview: { action: 'retry_game_design_system_generation', jobId: input.jobId,
    consequence: 'Submit a new paid Game Design System generation job.' } };
}

export async function retrySystemGeneration(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = retrySchema.parse(params);
    const previous = await failedSystemJob(ctx, input.jobId);
    const authorizedInput = await authorizeRetryInput(ctx, previous.input);
    const job = await createGameDesignSystemGenerationJob(getSupabaseServiceRoleClient(), ctx.userId, authorizedInput, {
      idempotencyKey: input.idempotencyKey,
      inputHash: hashResolvedGenerationInput(authorizedInput),
    });
    wakeQueuedGameDesignSystemJob(job.status);
    return { success: true, displayHint: 'text', data: { jobType: 'game-design-system',
      previousJobId: input.jobId, jobId: job.id, status: job.status } };
  } catch (error) { return failure(error); }
}

async function authorizedGddJob(ctx: ToolContext, input: z.infer<typeof cancelGddSchema>) {
  authenticate(ctx);
  const access = await getUserProjectRole(ctx.supabase, input.projectId, ctx.userId);
  if (access.role !== 'editor' && access.role !== 'admin') {
    throw new Error('Generating a GDD requires editor or admin permission.');
  }
  const current = await getPublicGddGenerationJob(getSupabaseServiceRoleClient(), input.jobId);
  if (!current || current.project_id !== input.projectId) throw new Error('GDD generation job not found.');
  return current;
}

export async function prepareGddCancellation(ctx: ToolContext, params: unknown) {
  const input = cancelGddSchema.parse(params);
  const current = await authorizedGddJob(ctx, input);
  if (current.status !== 'queued' && current.status !== 'running') throw new Error('GDD generation job changed after approval. Request confirmation again.');
  return { args: { ...input, expectedStatus: current.status },
    preview: { action: 'cancel_gdd_generation', projectId: input.projectId, jobId: input.jobId,
      status: current.status, consequence: 'Stop this GDD generation job.' } };
}

export async function cancelGdd(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedCancelGddSchema.parse(params);
    const current = await authorizedGddJob(ctx, input);
    if (current.status !== input.expectedStatus) throw new Error('GDD generation job changed after approval. Request confirmation again.');
    const service = getSupabaseServiceRoleClient();
    const job = await cancelGddGenerationJob(service, input.jobId, input.expectedStatus);
    if (!job) throw new Error('GDD generation job changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { jobType: 'gdd', jobId: job.id,
      projectId: input.projectId, status: job.status, phase: job.phase } };
  } catch (error) { return failure(error); }
}

export function preparationFailure(error: unknown) {
  return { success: false as const, error: failure(error).error! };
}
