import { after, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { buildAgentRulePolicy } from '@/lib/game-design-system/agentPolicy';
import { hashGddGenerationInput } from '@/lib/gddGeneration';
import type { GddGenerationRequestV2 } from '@/lib/gdd-generation/v2/contracts';
import { processNextGddJob } from '@/lib/gdd-generation/worker';
import { isGddSchemaUnavailable, safeGddRouteErrorIdentity } from '@/lib/gdd-generation/routeErrors';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getGameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';
import {
  createGddGenerationJob,
  GddActiveJobConflictError,
  GddIdempotencyConflictError,
  getLatestPublicGddGenerationJob,
  toPublicGddGenerationJob,
} from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

export const maxDuration = 300;

type Params = { params: Promise<{ projectId: string }> };

const requestSchema = z.object({
  designSystemId: z.string().uuid(),
  versionId: z.string().uuid(),
  mode: z.enum(['quick', 'professional']).default('quick'),
  creativeBrief: z.string().trim().max(4_000).optional(),
}).strict();

const latestQuerySchema = z.object({
  designSystemId: z.string().uuid(),
  versionId: z.string().uuid(),
});

function idempotencyKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim();
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}

function scheduleWorker(): void {
  after(async () => {
    try {
      await processNextGddJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `gdd-request-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[GDD opportunistic worker]', error);
    }
  });
}

export const GET = withAuth(async function GET(request: Request, { params }: Params, { supabase, user }) {
  const { projectId } = await params;
  const query = latestQuerySchema.safeParse({
    designSystemId: new URL(request.url).searchParams.get('designSystemId'),
    versionId: new URL(request.url).searchParams.get('versionId'),
  });
  if (!query.success) return NextResponse.json({ error: 'designSystemId and versionId are required.' }, { status: 400 });
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Reading a GDD generation job requires editor or admin permission.' }, { status: 403 });
    }
    // Access is checked above; use the service client for the bounded DTO so
    // column-level grants on the private job table cannot break refresh.
    const job = await getLatestPublicGddGenerationJob(getSupabaseServiceRoleClient(), {
      projectId,
      designSystemId: query.data.designSystemId,
      versionId: query.data.versionId,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const identity = safeGddRouteErrorIdentity(error);
    if (isGddSchemaUnavailable(error)) {
      console.error('[GET project GDD generation jobs]', identity);
      return NextResponse.json({ error: 'GDD generation database migration is not applied.' }, { status: 503 });
    }
    if (identity.code === '42501') {
      console.error('[GET project GDD generation jobs]', identity);
      return NextResponse.json({ error: 'GDD generation database permissions are not applied.' }, { status: 503 });
    }
    console.error('[GET project GDD generation jobs]', identity);
    return NextResponse.json({ error: 'Failed to read GDD generation jobs.' }, { status: 400 });
  }
});

export const POST = withAuth(async function POST(request, { params }: Params, { supabase, user }) {
  const { projectId } = await params;
  const key = idempotencyKey(request);
  if (!key) return NextResponse.json({ error: 'A valid Idempotency-Key header is required.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid GDD generation request.', issues: parsed.error.flatten() }, { status: 400 });
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Generating a GDD requires editor or admin permission.' }, { status: 403 });
    }
    const binding = await supabase.from('project_game_design_systems')
      .select('design_system_id,version_id')
      .eq('project_id', projectId)
      .maybeSingle();
    if (binding.error) throw binding.error;
    if (!binding.data || binding.data.design_system_id !== parsed.data.designSystemId || binding.data.version_id !== parsed.data.versionId) {
      return NextResponse.json({ error: 'Bind the selected Game Design System version to this project before generating a GDD.' }, { status: 409 });
    }
    const detail = await getGameDesignSystemDetail(supabase, parsed.data.designSystemId, {
      snapshotClient: getSupabaseServiceRoleClient(),
    });
    const version = detail?.versions.find((candidate) => candidate.id === parsed.data.versionId) ?? null;
    if (!detail || detail.migration_status !== 'ready' || !version) {
      return NextResponse.json({ error: 'The pinned Game Design System version is not available.' }, { status: 404 });
    }
    if (version.conflicts.length > 0) {
      return NextResponse.json({ error: 'Resolve Game Design System version conflicts before generating a GDD.' }, { status: 409 });
    }
    const project = await supabase.from('projects').select('name').eq('id', projectId).single();
    if (project.error || !project.data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const policy = buildAgentRulePolicy(version.rules);
    const input: GddGenerationRequestV2 = {
      contractVersion: 2,
      mode: parsed.data.mode,
      ...(parsed.data.creativeBrief ? { creativeBrief: parsed.data.creativeBrief } : {}),
      language: 'zh-CN',
      projectId,
      projectName: project.data.name,
      designSystemId: detail.id,
      versionId: version.id,
      versionNumber: version.version_number,
      systemTitle: detail.title,
      rules: version.rules,
      designDocument: version.document,
      artStyle: version.artStyle,
      projectSources: [],
    };
    const job = await createGddGenerationJob(getSupabaseServiceRoleClient(), {
      ownerId: user.id,
      projectId,
      designSystemId: detail.id,
      versionId: version.id,
      input,
      idempotencyKey: key,
      inputHash: hashGddGenerationInput(input),
    });
    if (job.status === 'queued') scheduleWorker();
    const publicJob = toPublicGddGenerationJob(job);
    return NextResponse.json({
      job: {
        ...publicJob,
        applied_rule_ids: publicJob.applied_rule_ids.length ? publicJob.applied_rule_ids : policy.appliedRuleIds,
        omitted_rule_ids: publicJob.omitted_rule_ids.length ? publicJob.omitted_rule_ids : policy.omittedRuleIds,
      },
    }, { status: 202 });
  } catch (error) {
    const identity = safeGddRouteErrorIdentity(error);
    if (error instanceof GddActiveJobConflictError) {
      return NextResponse.json({
        error: 'A GDD generation is already active for this project.',
        code: 'GDD_ACTIVE_JOB_EXISTS',
        job: toPublicGddGenerationJob(error.job),
      }, { status: 409 });
    }
    if (error instanceof GddIdempotencyConflictError) {
      return NextResponse.json({ error: 'Idempotency key was already used with a different GDD request.' }, { status: 409 });
    }
    if (isGddSchemaUnavailable(error)) {
      console.error('[POST project GDD generation job]', identity);
      return NextResponse.json({ error: 'GDD generation database migration is not applied.' }, { status: 503 });
    }
    if (identity.code === '42501') {
      console.error('[POST project GDD generation job]', identity);
      return NextResponse.json({ error: 'GDD generation database permissions are not applied.' }, { status: 503 });
    }
    console.error('[POST project GDD generation job]', identity);
    return NextResponse.json({ error: 'Failed to start GDD generation.' }, { status: 400 });
  }
});
