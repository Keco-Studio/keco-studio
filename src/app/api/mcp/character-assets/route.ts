import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { CharacterAssetPlanV1Schema } from '@/features/character-assets/model/characterAssetSchema';
import type { CharacterAssetPlanV1 } from '@/features/character-assets/model/characterAssetSchema';
import {
  CharacterAssetMcpError,
  characterAssetMcpPublicMessage,
  createCharacterAssetMcpService,
  type CharacterAssetMcpErrorCode,
} from '@/lib/server/characterAssetMcpService';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const Uuid = z.string().uuid();
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const Project = { projectId: Uuid };
const GenerationIdentity = {
  ...Project,
  assetId: Uuid,
  attemptId: Uuid,
  generationId: Uuid,
  planFingerprint: Fingerprint,
};

const RequestBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_character_assets'), ...Project }).strict(),
  z.object({ action: z.literal('read_character_asset'), ...Project, assetId: Uuid }).strict(),
  z.object({
    action: z.literal('create_character_asset_draft'), ...Project,
    plan: CharacterAssetPlanV1Schema, idempotencyKey: Uuid,
  }).strict(),
  z.object({
    action: z.literal('update_character_asset_draft'), ...Project,
    assetId: Uuid, saveVersion: z.number().int().nonnegative(), plan: CharacterAssetPlanV1Schema,
  }).strict(),
  z.object({
    action: z.literal('prepare_character_asset_generation'), ...Project,
    assetId: Uuid, saveVersion: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    action: z.literal('start_character_asset_generation'), ...GenerationIdentity,
    attemptCount: z.number().int().nonnegative(), confirmationToken: z.string().min(1).max(4_096),
    confirmPaidGeneration: z.literal(true),
  }).strict(),
  z.object({ action: z.literal('get_character_asset_generation'), ...GenerationIdentity }).strict(),
  z.object({ action: z.literal('advance_character_asset_generation'), ...GenerationIdentity }).strict(),
]);

const ERROR_STATUS: Record<CharacterAssetMcpErrorCode, number> = {
  PROJECT_WRITE_FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  CHARACTER_ASSET_NOT_FOUND: 404,
  CHARACTER_ASSET_REVISION_STALE: 409,
  CHARACTER_CONFIRMATION_REQUIRED: 409,
  CHARACTER_CONFIRMATION_EXPIRED: 409,
  CHARACTER_CONFIRMATION_MISMATCH: 409,
  CHARACTER_GENERATION_BLOCKED: 409,
  CHARACTER_SUBMISSION_UNKNOWN: 409,
  CHARACTER_PROVIDER_JOB_FAILED: 502,
  SOURCE_CHARACTER_UNAVAILABLE: 409,
  PROVIDER_CAPABILITY_MISSING: 409,
  PROVIDER_AUTHENTICATION_FAILED: 503,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_QUOTA_EXCEEDED: 429,
  INVALID_PROVIDER_OUTPUT: 502,
  FIELD_VALIDATION_FAILED: 400,
  UPSTREAM_UNAVAILABLE: 503,
};

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const parsed = RequestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid character asset MCP request.', code: 'FIELD_VALIDATION_FAILED' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const body = parsed.data;
  const service = createCharacterAssetMcpService({ supabase, userId: user.id });
  try {
    let result: unknown;
    switch (body.action) {
      case 'list_character_assets': result = await service.listAssets({ projectId: body.projectId! }); break;
      case 'read_character_asset': result = await service.readAsset({ projectId: body.projectId!, assetId: body.assetId! }); break;
      case 'create_character_asset_draft': result = await service.createDraft({ projectId: body.projectId!, plan: body.plan as CharacterAssetPlanV1, idempotencyKey: body.idempotencyKey! }); break;
      case 'update_character_asset_draft': result = await service.updateDraft({ projectId: body.projectId!, assetId: body.assetId!, saveVersion: body.saveVersion!, plan: body.plan as CharacterAssetPlanV1 }); break;
      case 'prepare_character_asset_generation': result = await service.prepareGeneration({ projectId: body.projectId!, assetId: body.assetId!, saveVersion: body.saveVersion! }); break;
      case 'start_character_asset_generation': result = await service.startGeneration({ projectId: body.projectId!, assetId: body.assetId!, attemptId: body.attemptId!, generationId: body.generationId!, planFingerprint: body.planFingerprint!, attemptCount: body.attemptCount!, confirmationToken: body.confirmationToken!, confirmPaidGeneration: true }); break;
      case 'get_character_asset_generation': result = await service.getGeneration({ projectId: body.projectId!, assetId: body.assetId!, attemptId: body.attemptId!, generationId: body.generationId!, planFingerprint: body.planFingerprint! }); break;
      case 'advance_character_asset_generation': result = await service.advanceGeneration({ projectId: body.projectId!, assetId: body.assetId!, attemptId: body.attemptId!, generationId: body.generationId!, planFingerprint: body.planFingerprint! }); break;
    }
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof CharacterAssetMcpError) {
      return NextResponse.json(
        { error: characterAssetMcpPublicMessage(error.code), code: error.code },
        { status: ERROR_STATUS[error.code], headers: NO_STORE_HEADERS },
      );
    }
    console.error('[POST /api/mcp/character-assets] Character asset operation failed');
    return NextResponse.json(
      { error: 'The character asset service is temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
