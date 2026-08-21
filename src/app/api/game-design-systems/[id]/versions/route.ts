import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import {
  createGameDesignSystemVersionRequestSchema,
  gameDesignSystemVersionIdempotencyKeySchema,
} from '@/lib/game-design-system/versionRequest';
import { getGameDesignSystem, getGameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';
import {
  createPublicGameDesignSystemVersion,
  PublicGameDesignSystemVersionError,
  type PublicGameDesignSystemVersionErrorCode,
} from '@/lib/services/gameDesignSystemWriteService.server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { redactGameDesignSystemDetailForViewer } from '@/lib/game-design-system/sourceVisibility.server';

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  try {
    const system = await getGameDesignSystemDetail(supabase, id, { snapshotClient: getSupabaseServiceRoleClient() });
    if (!system) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    const visible = await redactGameDesignSystemDetailForViewer(supabase, system, user.id);
    return NextResponse.json({ versions: visible.versions });
  } catch (error) {
    return NextResponse.json({ error: 'Versions could not be loaded.' }, { status: 404 });
  }
});

function versionRequestIssues(error: {
  flatten: () => { formErrors: string[]; fieldErrors: object };
  issues: Array<{ code: string; path: PropertyKey[]; keys?: string[]; message: string }>;
}) {
  const issues = error.flatten();
  const fieldErrors = issues.fieldErrors as Record<string, string[] | undefined>;
  for (const issue of error.issues) {
    if (issue.code !== 'unrecognized_keys' || issue.path.length !== 0) continue;
    for (const key of issue.keys ?? []) fieldErrors[key] = [issue.message];
  }
  return issues;
}

const VERSION_ERROR_STATUS: Partial<Record<PublicGameDesignSystemVersionErrorCode, number>> = {
  VERSION_REQUEST_INVALID: 400,
  VERSION_SYSTEM_NOT_FOUND: 404,
  VERSION_FORBIDDEN: 403,
  VERSION_PARENT_INVALID: 400,
  VERSION_LINEAGE_INVALID: 400,
  VERSION_RULE_REINTRODUCED: 409,
  VERSION_NO_CHANGES: 409,
  VERSION_STALE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VERSION_CREATE_FAILED: 500,
};

export const POST = withAuth(async function POST(request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  const parsedKey = gameDesignSystemVersionIdempotencyKeySchema.safeParse(
    request.headers.get('idempotency-key')?.trim(),
  );
  if (!parsedKey.success) {
    return NextResponse.json({
      error: 'A UUID Idempotency-Key header is required.',
      code: 'IDEMPOTENCY_KEY_INVALID',
    }, { status: 400 });
  }
  const parsedRequest = createGameDesignSystemVersionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsedRequest.success) {
    return NextResponse.json({
      error: 'Invalid version request.',
      code: 'VERSION_REQUEST_INVALID',
      issues: versionRequestIssues(parsedRequest.error),
    }, { status: 400 });
  }
  try {
    const version = await createPublicGameDesignSystemVersion(getSupabaseServiceRoleClient(), {
      systemId: id,
      actorId: user.id,
      idempotencyKey: parsedKey.data,
      request: parsedRequest.data,
    });
    const system = await getGameDesignSystem(supabase, id);
    if (!system) throw new PublicGameDesignSystemVersionError('VERSION_CREATE_FAILED');
    const visible = await redactGameDesignSystemDetailForViewer(supabase, {
      ...system,
      current_version_id: version.id,
      current_version: version,
      versions: [version],
    }, user.id);
    return NextResponse.json({ version: visible.current_version ?? visible.versions[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof PublicGameDesignSystemVersionError) {
      const publicCode = error.code === 'VERSION_SYSTEM_NOT_FOUND'
        ? 'GDS_NOT_FOUND'
        : error.code;
      return NextResponse.json({
        error: error.publicMessage,
        code: publicCode,
        ...(error.ruleIds ? { ruleIds: error.ruleIds } : {}),
      }, { status: VERSION_ERROR_STATUS[error.code] ?? 500 });
    }
    console.error('[POST /api/game-design-systems/:id/versions] code=VERSION_CREATE_FAILED');
    return NextResponse.json({
      error: 'Version could not be created.',
      code: 'VERSION_CREATE_FAILED',
    }, { status: 500 });
  }
});
