import { z } from 'zod';
import type { MapPlanV3 } from '@/features/create-map/model/directMapSchema';
import type { ToolContext, ToolResult } from '../types';

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
  return { success: false, error: error instanceof Error ? error.message : 'Map operation failed.' };
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
