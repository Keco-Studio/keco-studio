import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import {
  MapPlanV3Schema,
  MapSceneV3Schema,
} from '@/features/create-map/model/directMapSchema';
import {
  CreateMapMcpError,
  createMapMcpService,
  createMapMcpPublicMessage,
  type CreateMapMcpErrorCode,
} from '@/lib/server/createMapMcpService';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };
const Uuid = z.string().uuid();
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const Project = { projectId: Uuid };
const GenerationIdentity = {
  ...Project,
  mapId: Uuid,
  revisionId: Uuid,
  assetId: Uuid,
  generationId: Uuid,
  planFingerprint: Fingerprint,
};

const ListMaps = z.object({
  action: z.literal('list_maps'),
  ...Project,
}).strict();
const ReadMap = z.object({
  action: z.literal('read_map'),
  ...Project,
  mapId: Uuid,
}).strict();
const CreateDraft = z.object({
  action: z.literal('create_map_draft'),
  ...Project,
  description: z.string().trim().max(4000),
  documentId: Uuid.nullable().default(null),
  referenceIds: z.array(Uuid).max(4).default([]),
  styleReferenceId: Uuid.nullable().default(null),
  referenceRoles: z.record(Uuid, z.enum(['content', 'layout'])).default({}),
  referenceUsage: z.record(Uuid, z.string().trim().min(1).max(240)).default({}),
  styleCopy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).max(4).default([]),
  idempotencyKey: Uuid,
}).strict();
const UpdateDraft = z.object({
  action: z.literal('update_map_draft'),
  ...Project,
  mapId: Uuid,
  revisionId: Uuid,
  saveVersion: z.number().int().nonnegative(),
  plan: MapPlanV3Schema,
  scene: MapSceneV3Schema,
}).strict();
const PrepareGeneration = z.object({
  action: z.literal('prepare_map_generation'),
  ...Project,
  mapId: Uuid,
  revisionId: Uuid,
  saveVersion: z.number().int().nonnegative(),
}).strict();
const StartGeneration = z.object({
  action: z.literal('start_map_generation'),
  ...GenerationIdentity,
  confirmationToken: z.string().min(1).max(4096),
  confirmPaidGeneration: z.literal(true),
}).strict();
const GetGeneration = z.object({
  action: z.literal('get_map_generation'),
  ...GenerationIdentity,
}).strict();
const AdvanceGeneration = z.object({
  action: z.literal('advance_map_generation'),
  ...GenerationIdentity,
}).strict();

const RequestBody = z.discriminatedUnion('action', [
  ListMaps,
  ReadMap,
  CreateDraft,
  UpdateDraft,
  PrepareGeneration,
  StartGeneration,
  GetGeneration,
  AdvanceGeneration,
]).refine(
  (value) => value.action !== 'create_map_draft'
    || value.description.length > 0
    || value.documentId !== null,
  { message: 'A description or source document is required.' },
);

const ERROR_STATUS: Record<CreateMapMcpErrorCode, number> = {
  PROJECT_WRITE_FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  MAP_CREATION_IN_PROGRESS: 409,
  MAP_NOT_FOUND: 404,
  MAP_REVISION_STALE: 409,
  MAP_CONFIRMATION_REQUIRED: 409,
  MAP_CONFIRMATION_EXPIRED: 409,
  MAP_CONFIRMATION_MISMATCH: 409,
  MAP_GENERATION_BLOCKED: 409,
  MAP_GENERATION_FAILED: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_QUOTA_EXCEEDED: 429,
  FIELD_VALIDATION_FAILED: 400,
  UPSTREAM_UNAVAILABLE: 503,
};

type CreateMapMcpService = ReturnType<typeof createMapMcpService>;
type ValidatedRequest =
  | ({ action: 'list_maps' } & Parameters<CreateMapMcpService['listMaps']>[0])
  | ({ action: 'read_map' } & Parameters<CreateMapMcpService['readMap']>[0])
  | ({ action: 'create_map_draft' } & Parameters<CreateMapMcpService['createDraft']>[0])
  | ({ action: 'update_map_draft' } & Parameters<CreateMapMcpService['updateDraft']>[0])
  | ({ action: 'prepare_map_generation' } & Parameters<CreateMapMcpService['prepareGeneration']>[0])
  | ({ action: 'start_map_generation' } & Parameters<CreateMapMcpService['startGeneration']>[0])
  | ({ action: 'get_map_generation' } & Parameters<CreateMapMcpService['getGeneration']>[0])
  | ({ action: 'advance_map_generation' } & Parameters<CreateMapMcpService['advanceGeneration']>[0]);

function withoutAction<T extends { action: string }>({ action: _action, ...input }: T): Omit<T, 'action'> {
  return input;
}

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const parsed = RequestBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid Create Map MCP request.', code: 'FIELD_VALIDATION_FAILED' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const body = parsed.data as unknown as ValidatedRequest;
  const service = createMapMcpService({ supabase, userId: user.id });
  try {
    let result: unknown;
    switch (body.action) {
      case 'list_maps':
        result = await service.listMaps(withoutAction(body));
        break;
      case 'read_map':
        result = await service.readMap(withoutAction(body));
        break;
      case 'create_map_draft':
        result = await service.createDraft(withoutAction(body));
        break;
      case 'update_map_draft':
        result = await service.updateDraft(withoutAction(body));
        break;
      case 'prepare_map_generation':
        result = await service.prepareGeneration(withoutAction(body));
        break;
      case 'start_map_generation':
        result = await service.startGeneration(withoutAction(body));
        break;
      case 'get_map_generation':
        result = await service.getGeneration(withoutAction(body));
        break;
      case 'advance_map_generation':
        result = await service.advanceGeneration(withoutAction(body));
        break;
    }
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof CreateMapMcpError) {
      const publicErrorMessage = createMapMcpPublicMessage(error.code, error.message);
      return NextResponse.json(
        { error: publicErrorMessage, code: error.code },
        { status: ERROR_STATUS[error.code], headers: NO_STORE_HEADERS },
      );
    }
    console.error('[POST /api/mcp/create-map] Create Map MCP operation failed');
    return NextResponse.json(
      { error: 'The Create Map service is temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'Please sign in to continue' },
    { status: 401, headers: NO_STORE_HEADERS },
  ),
});
