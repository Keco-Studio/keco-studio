import 'server-only';

import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import {
  copyGameDesignSystem, createGameDesignSystemGenerationJob,
  findGameDesignSystemGenerationJobByIdempotencyKey, getGameDesignSystem,
  getGameDesignSystemDetail, getGameDesignSystemVersion, IdempotencyConflictError,
  listGameDesignSystemsPage, setProjectGameDesignSystem,
  type GameDesignSystem, type GameDesignSystemVersion,
} from '@/lib/services/gameDesignSystemService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { redactGameDesignSystemDetailForViewer } from '@/lib/game-design-system/sourceVisibility.server';
import { gameDesignGenerationRequestSchema } from '@/lib/game-design-system/generationRequest';
import { resolveGameDesignSourceSnapshots } from '@/lib/game-design-system/sourceSnapshots';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { createGddGenerationJob } from '@/lib/services/gddGenerationService';
import { hashGddGenerationInput } from '@/lib/gddGeneration';
import { inferGddOutputLanguage, type GddGenerationRequestV2 } from '@/lib/gdd-generation/v2/contracts';

export const GDD_GENERATION_WARNING = 'Professional GDD generation may automatically submit up to three paid map images. Quick mode does not automatically submit paid map images.';
const keySchema = z.string().trim().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const applySystemSchema = z.object({ projectId: z.string().uuid(), designSystemId: z.string().uuid(), versionId: z.string().uuid() }).strict();
export const generateGddSchema = z.object({ projectId: z.string().uuid(), mode: z.enum(['quick', 'professional']), idempotencyKey: keySchema }).strict();
export const sealedGddSchema = generateGddSchema.extend({ designSystemId: z.string().uuid(), versionId: z.string().uuid(), warning: z.literal(GDD_GENERATION_WARNING) }).strict();
export const generateSystemSchema = z.object({ input: gameDesignGenerationRequestSchema, idempotencyKey: keySchema }).strict();

function authenticate(ctx: ToolContext) {
  if (!ctx.userId) throw new Error('Authentication required.');
}

export async function designToolResult(operation: () => Promise<unknown>, displayHint: 'text' | 'list' = 'text'): Promise<ToolResult> {
  try { return { success: true, displayHint, data: await operation() }; }
  catch (error) {
    // Never expose provider, database, source, or private job payloads in errors.
    return { success: false, error: error instanceof z.ZodError ? 'Invalid game design parameters.'
      : error instanceof DesignToolError || error instanceof IdempotencyConflictError ? error.message
        : 'Game design operation failed. Check access and request parameters.' };
  }
}

class DesignToolError extends Error {}

function summary(system: GameDesignSystem) {
  return { id: system.id, title: system.title.slice(0, 160), summary: system.summary?.slice(0, 600) ?? null,
    source: system.source, status: system.status, latestVersionId: system.current_version_id, updatedAt: system.updated_at };
}

async function visibleSystem(ctx: ToolContext, id: string) {
  authenticate(ctx);
  const system = await getGameDesignSystem(ctx.supabase, id);
  if (!system) throw new DesignToolError('Game Design System not found.');
  return system;
}

async function visibleVersion(ctx: ToolContext, systemId: string, versionId: string) {
  // Check visibility using the actor client before reading private snapshot columns.
  const { data, error } = await ctx.supabase.from('game_design_system_versions')
    .select('id,system_id').eq('id', versionId).eq('system_id', systemId).maybeSingle();
  if (error || !data || data.system_id !== systemId) throw new DesignToolError('Game Design System version not found.');
  const version = await getGameDesignSystemVersion(getSupabaseServiceRoleClient(), versionId);
  if (!version || version.system_id !== systemId) throw new DesignToolError('Game Design System version not found.');
  return version;
}

async function projectAccess(ctx: ToolContext, projectId: string, operation: 'apply' | 'gdd') {
  authenticate(ctx);
  // Do not use ctx.userRole or a request cache: approval can outlive permissions.
  const access = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  const allowed = operation === 'apply' ? access.isOwner || access.role === 'admin'
    : access.role === 'editor' || access.role === 'admin';
  if (!allowed) throw new DesignToolError(operation === 'apply'
    ? 'Only project owners and admins can apply a Game Design System.'
    : 'Generating a GDD requires editor or admin permission.');
}

export async function listDesignSystems(ctx: ToolContext, params: unknown) {
  authenticate(ctx);
  const input = z.object({ limit: z.number().int().positive().optional(), offset: z.number().int().min(0).max(100_000).default(0) }).strict().parse(params);
  const limit = Math.min(input.limit ?? 20, 50);
  const page = await listGameDesignSystemsPage(ctx.supabase, { limit, offset: input.offset });
  return { systems: page.systems.slice(0, limit).map(summary), hasMore: page.hasMore, nextOffset: page.nextOffset };
}

export async function readDesignSystem(ctx: ToolContext, params: unknown) {
  authenticate(ctx);
  const input = z.object({ designSystemId: z.string().uuid(), versionId: z.string().uuid().optional() }).strict().parse(params);
  const detail = await getGameDesignSystemDetail(ctx.supabase, input.designSystemId, { versionLimit: 20 });
  if (!detail) throw new DesignToolError('Game Design System not found.');
  const versionId = input.versionId ?? detail.current_version_id;
  const version = versionId ? await visibleVersion(ctx, detail.id, versionId) : null;
  // Only the selected version needs source data. Limit source checks and output before redaction.
  const selected = version ? { ...version, source_snapshots: version.source_snapshots.slice(0, 20) } : null;
  const redacted = await redactGameDesignSystemDetailForViewer(ctx.supabase, {
    ...detail, current_version: selected, versions: selected ? [selected] : [],
  }, ctx.userId);
  const safe = redacted.current_version;
  return { ...summary(detail), versions: detail.versions.slice(0, 20).map(versionSummary),
    version: safe ? { ...versionSummary(safe), markdown: safe.rendered_markdown.slice(0, 16_000),
      truncated: safe.rendered_markdown.length > 16_000 || safe.source_snapshots.length < (version?.source_snapshots.length ?? 0),
      sources: safe.source_snapshots.map((source) => ({ kind: source.kind, projectId: source.projectId,
        resourceId: source.resourceId, label: source.label.slice(0, 160), excerpt: source.excerpt?.slice(0, 500),
        truncated: source.truncated || (source.excerpt?.length ?? 0) > 500 })) } : null };
}

function versionSummary(version: GameDesignSystemVersion) {
  return { id: version.id, versionNumber: version.version_number, createdAt: version.created_at };
}

export async function copyDesignSystem(ctx: ToolContext, params: unknown) {
  const input = z.object({ designSystemId: z.string().uuid() }).strict().parse(params);
  const system = await visibleSystem(ctx, input.designSystemId);
  if (system.source !== 'official' && system.owner_id !== ctx.userId) throw new DesignToolError('Only official or owned Game Design Systems can be copied.');
  return summary(await copyGameDesignSystem(getSupabaseServiceRoleClient(), system, ctx.userId));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}

export async function generateDesignSystem(ctx: ToolContext, params: unknown) {
  authenticate(ctx);
  const { input: body, idempotencyKey } = generateSystemSchema.parse(params);
  if (!body.genres.length && !body.philosophies.length && !body.description && !body.pastedMarkdown && !body.references.length && !body.referenceGames.length && !body.baseSystemId) {
    throw new DesignToolError('Add a genre, philosophy, description, source, or base system.');
  }
  const artStyle = compileGameArtStyle(body.artStyle);
  const service = getSupabaseServiceRoleClient();
  const existing = await findGameDesignSystemGenerationJobByIdempotencyKey(service, ctx.userId, idempotencyKey);
  if (existing) {
    const prior = existing.input as ResolvedGameDesignGenerationInput;
    if (!Array.isArray(prior?.sourceSnapshots)) throw new IdempotencyConflictError();
    const identity = (input: typeof body | ResolvedGameDesignGenerationInput, references: unknown, style: unknown) => ({
      title: input.title, genres: input.genres, philosophies: input.philosophies, description: input.description,
      suitableFor: input.suitableFor, references, referenceGames: input.referenceGames, artStyle: style,
      baseSystemId: input.baseSystemId, pastedMarkdown: input.pastedMarkdown,
    });
    const refs = (values: Array<{ kind?: string; projectId?: string; resourceId?: string }>) => values.map(({ kind, projectId, resourceId }) => ({ kind, projectId, resourceId }));
    if (canonicalJson(identity(body, refs(body.references), artStyle)) !== canonicalJson(identity(prior, refs(prior.sourceSnapshots), prior.artStyle))) throw new IdempotencyConflictError();
    return { jobType: 'game-design-system', jobId: existing.id, status: existing.status };
  }
  const sourceSnapshots = await resolveGameDesignSourceSnapshots(ctx.supabase, body.references.map((ref) => ({ kind: ref.kind!, projectId: ref.projectId!, resourceId: ref.resourceId! })));
  const base = body.baseSystemId ? await visibleSystem(ctx, body.baseSystemId) : null;
  if (base && base.source !== 'official' && base.owner_id !== ctx.userId) throw new DesignToolError('Only official or owned Game Design Systems can be used as a base.');
  const version = base?.current_version_id ? await visibleVersion(ctx, base.id, base.current_version_id) : null;
  if (base && !version) throw new DesignToolError('Base Game Design System has no usable version.');
  const input: ResolvedGameDesignGenerationInput = { title: body.title, genres: body.genres, philosophies: body.philosophies,
    description: body.description, suitableFor: body.suitableFor, sourceSnapshots,
    referenceGames: body.referenceGames.map((game) => ({ name: game.name!, reference: game.reference!, avoid: game.avoid! })),
    artStyle, baseSystemId: base?.id, baseVersionId: version?.id, baseDocument: version?.document,
    baseRules: version?.rules, pastedMarkdown: body.pastedMarkdown };
  const job = await createGameDesignSystemGenerationJob(service, ctx.userId, input as never, { idempotencyKey, inputHash: hashResolvedGenerationInput(input) });
  return { jobType: 'game-design-system', jobId: job.id, status: job.status };
}

export async function applyDesignSystem(ctx: ToolContext, params: unknown) {
  const input = applySystemSchema.parse(params);
  await projectAccess(ctx, input.projectId, 'apply');
  await visibleSystem(ctx, input.designSystemId);
  const version = await visibleVersion(ctx, input.designSystemId, input.versionId);
  if (version.conflicts.length) throw new DesignToolError('Resolve version conflicts before applying it.');
  await setProjectGameDesignSystem(ctx.supabase, input.projectId, input.designSystemId, input.versionId, ctx.userId);
  return input;
}

async function pinnedSystem(ctx: ToolContext, projectId: string) {
  await projectAccess(ctx, projectId, 'gdd');
  const { data, error } = await ctx.supabase.from('project_game_design_systems')
    .select('design_system_id,version_id').eq('project_id', projectId).maybeSingle();
  if (error || !data) throw new DesignToolError('Bind a Game Design System version to this project before generating a GDD.');
  const system = await visibleSystem(ctx, data.design_system_id);
  const version = await visibleVersion(ctx, system.id, data.version_id);
  if (system.migration_status !== 'ready' || version.conflicts.length) throw new DesignToolError('The pinned version is unavailable or has unresolved conflicts.');
  return { system, version };
}

export async function prepareGdd(ctx: ToolContext, params: unknown) {
  const input = generateGddSchema.parse(params);
  const { system, version } = await pinnedSystem(ctx, input.projectId);
  return { ...input, designSystemId: system.id, versionId: version.id, warning: GDD_GENERATION_WARNING };
}

export async function generateGdd(ctx: ToolContext, params: unknown) {
  const sealed = sealedGddSchema.parse(params);
  const { system, version } = await pinnedSystem(ctx, sealed.projectId);
  if (system.id !== sealed.designSystemId || version.id !== sealed.versionId) throw new DesignToolError('The pinned Game Design System changed. Request confirmation again.');
  const project = await ctx.supabase.from('projects').select('name').eq('id', sealed.projectId).single();
  if (project.error || !project.data) throw new DesignToolError('Project not found.');
  const chineseIdentity = [system.title, project.data.name].some((text) => (text.match(/[\u3400-\u9fff]/g) ?? []).length >= 2);
  const input: GddGenerationRequestV2 = { contractVersion: 2, mode: sealed.mode, resourceMode: 'async',
    language: chineseIdentity ? 'zh-CN' : inferGddOutputLanguage([project.data.name, system.title, JSON.stringify(version.document), JSON.stringify(version.rules)]),
    projectId: sealed.projectId, projectName: project.data.name, designSystemId: system.id,
    versionId: version.id, versionNumber: version.version_number, systemTitle: system.title,
    rules: version.rules, designDocument: version.document, artStyle: version.artStyle, projectSources: [] };
  const job = await createGddGenerationJob(getSupabaseServiceRoleClient(), { ownerId: ctx.userId,
    projectId: sealed.projectId, designSystemId: system.id, versionId: version.id, input,
    idempotencyKey: sealed.idempotencyKey, inputHash: hashGddGenerationInput(input) });
  return { jobType: 'gdd', jobId: job.id, status: job.status };
}

export async function generationStatus(ctx: ToolContext, params: unknown) {
  authenticate(ctx);
  const input = z.object({ jobType: z.enum(['game-design-system', 'gdd']), jobId: z.string().uuid() }).strict().parse(params);
  const table = input.jobType === 'gdd' ? 'gdd_generation_jobs' : 'game_design_system_generation_jobs';
  // One bounded read, filtered by owner before private data leaves the database.
  const columns: string = input.jobType === 'gdd' ? 'id,owner_id,project_id,status,phase' : 'id,owner_id,status,phase';
  const { data: raw, error } = await getSupabaseServiceRoleClient().from(table)
    .select(columns)
    .eq('id', input.jobId).eq('owner_id', ctx.userId).maybeSingle();
  if (error || !raw) throw new DesignToolError('Generation job not found.');
  const data = z.object({ id: z.string().uuid(), owner_id: z.string(), project_id: z.string().uuid().optional(), status: z.string().max(80), phase: z.string().max(80) }).parse(raw);
  if (data.owner_id !== ctx.userId) throw new DesignToolError('Generation job not found.');
  if (input.jobType === 'gdd') {
    if (!data.project_id) throw new DesignToolError('Generation job not found.');
    await projectAccess(ctx, data.project_id, 'gdd');
  }
  return { jobType: input.jobType, jobId: data.id, status: data.status, phase: data.phase };
}
