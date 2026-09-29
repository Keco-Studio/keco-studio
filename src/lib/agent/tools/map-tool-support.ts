import { z } from 'zod';
import type { MapPlanV3 } from '@/features/create-map/model/directMapSchema';
import type { CreateMapMcpErrorCode } from '@/lib/server/createMapMcpService';
import type { ToolContext, ToolResult } from '../types';

const publicMapErrors: Record<CreateMapMcpErrorCode, string> = {
  PROJECT_WRITE_FORBIDDEN: 'This project requires admin or editor access.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key was already used with different map input.',
  MAP_CREATION_IN_PROGRESS: 'The idempotent map draft is still being planned. Retry this same request shortly.',
  MAP_NOT_FOUND: 'The requested V3 map was not found.',
  MAP_REVISION_STALE: 'The map revision or save version is stale.',
  MAP_RESIZE_REQUIRES_NEW_DRAFT: 'Map size changes require a new map draft because the generated image and collision grid are bound to the current dimensions.',
  MAP_CONFIRMATION_REQUIRED: 'Explicit paid map generation confirmation is required.',
  MAP_CONFIRMATION_EXPIRED: 'The map generation confirmation has expired.',
  MAP_CONFIRMATION_MISMATCH: 'The map generation confirmation does not match the current map state.',
  MAP_GENERATION_BLOCKED: 'Map generation is blocked and cannot be retried safely.',
  MAP_GENERATION_FAILED: 'Map generation failed.',
  PROVIDER_RATE_LIMITED: 'The map provider is temporarily rate limited.',
  PROVIDER_QUOTA_EXCEEDED: 'The map provider quota is exhausted.',
  FIELD_VALIDATION_FAILED: 'The Create Map request is invalid.',
  UPSTREAM_UNAVAILABLE: 'The Create Map service is temporarily unavailable.',
};

const unsafeDescriptionMessage = 'The map description contains unsupported instructions. Remove provider or API controls, credentials, URLs, and dynamic Keco UI instructions, then create a new draft request.';
const localMapErrors = new Set([
  'This project requires admin or editor access.',
  'The map changed. Read its latest detail and confirm again.',
  'A validated reference, role, and usage are required.',
  'This asset is already bound to the map.',
  'A validated style reference and copy directives are required.',
  'This asset is already a content reference.',
  'This reference is not bound to the selected map.',
  'Reference asset was not found in this project.',
  'A validated ready map image is required for collision edits.',
  'Collision cell is outside the map.',
]);

export const mapIdParameters = { mapId: { type: 'string', format: 'uuid' } };
export const generationParameters = {
  ...mapIdParameters,
  revisionId: { type: 'string', format: 'uuid' },
  assetId: { type: 'string', format: 'uuid' },
};
export const mapIdentitySchema = z.object({ mapId: z.string().uuid() });
export const generationIdentitySchema = mapIdentitySchema.extend({
  revisionId: z.string().uuid(), assetId: z.string().uuid(),
});
export const sealedGenerationSchema = generationIdentitySchema.extend({
  projectId: z.string().uuid(),
  generationId: z.string().uuid(),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationToken: z.string().min(1).max(8192),
  confirmationPurpose: z.enum(['submit', 'retry', 'replace-unknown']),
  confirmPaidGeneration: z.literal(true),
}).strict();

export async function mapService(ctx: ToolContext) {
  const { createMapMcpService } = await import('@/lib/server/createMapMcpService');
  return createMapMcpService({ supabase: ctx.supabase, userId: ctx.userId });
}

export function mapToolError(error: unknown): { success: false; error: string } {
  if (error instanceof z.ZodError) return { success: false, error: 'Invalid map parameters.' };
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const message = error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' ? error.message : '';
  if (code === 'FIELD_VALIDATION_FAILED' && message === unsafeDescriptionMessage) {
    return { success: false, error: unsafeDescriptionMessage };
  }
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(publicMapErrors, code)) {
    return { success: false, error: publicMapErrors[code as CreateMapMcpErrorCode] };
  }
  if (localMapErrors.has(message)) return { success: false, error: message };
  if (message.startsWith('Invalid map references:')) return { success: false, error: 'Invalid map references.' };
  if (code === 'PT409') return { success: false, error: 'The map changed. Read its latest detail and confirm again.' };
  if (code === '42501') return { success: false, error: 'This project requires admin or editor access.' };
  return { success: false, error: 'Map operation failed.' };
}

export function boundedPlan(plan: MapPlanV3) {
  return {
    title: plan.name.slice(0, 160),
    summary: plan.summary.slice(0, 500),
    width: plan.map.width,
    height: plan.map.height,
    referenceCount: plan.references.length,
  };
}

export function boundedGeneration(asset: {
  assetId: string; status: string; attemptCount: number; imageUrl: string | null;
  lastErrorCode: string | null;
}) {
  return {
    assetId: asset.assetId, status: asset.status, attemptCount: asset.attemptCount,
    imageUrl: asset.imageUrl, lastErrorCode: asset.lastErrorCode?.slice(0, 200) ?? null,
  };
}

export function mapResult(data: unknown, projectId?: string, mapId?: string): ToolResult {
  return {
    success: true, displayHint: 'map', data,
    ...(projectId ? { invalidations: [{ type: 'create-map' as const, projectId, mapId }] } : {}),
  };
}

export function sealGeneration(projectId: string, prepared: {
  mapId: string; revisionId: string; assetId: string; generationId: string;
  planFingerprint: string; confirmationToken: string;
  confirmationPurpose: 'submit' | 'retry' | 'replace-unknown';
}) {
  return {
    projectId, mapId: prepared.mapId, revisionId: prepared.revisionId,
    assetId: prepared.assetId, generationId: prepared.generationId,
    planFingerprint: prepared.planFingerprint, confirmationToken: prepared.confirmationToken,
    confirmationPurpose: prepared.confirmationPurpose,
    confirmPaidGeneration: true as const,
  };
}
