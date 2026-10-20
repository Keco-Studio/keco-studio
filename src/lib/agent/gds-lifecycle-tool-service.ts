import 'server-only';

import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';
import { getGameDesignSystem } from '@/lib/services/gameDesignSystemService';
import { gameDesignSystemTitleSchema } from '@/lib/game-design-system/ruleSchema';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const id = z.string().uuid();
const metadataBase = z.object({
  designSystemId: id,
  title: gameDesignSystemTitleSchema.optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
}).strict();
const hasMetadataChange = (value: { title?: string; summary?: string | null; status?: string }) =>
  value.title !== undefined || value.summary !== undefined || value.status !== undefined;
const metadata = metadataBase.refine(hasMetadataChange,
  'Supply at least one metadata change.');
const deletion = z.object({ designSystemId: id }).strict();
const snapshot = z.object({
  designSystemId: id,
  expectedUpdatedAt: z.string(),
  expectedVersionId: id.nullable(),
}).strict();
const sealedMetadata = metadataBase.extend({
  expectedUpdatedAt: z.string(), expectedVersionId: id.nullable(),
}).refine(hasMetadataChange, 'Supply at least one metadata change.');

async function ownedTarget(ctx: ToolContext, designSystemId: string) {
  if (!ctx.userId) throw new Error('Authentication required.');
  const system = await getGameDesignSystem(ctx.supabase, designSystemId);
  if (!system) throw new Error('Game Design System not found.');
  if (system.source !== 'user' || system.owner_id !== ctx.userId) {
    throw new Error('Only the owner can change this Game Design System.');
  }
  return system;
}

async function bindingExists(designSystemId: string) {
  const { data, error } = await getSupabaseServiceRoleClient().from('project_game_design_systems')
    .select('project_id').eq('design_system_id', designSystemId).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

function assertSnapshot(system: Awaited<ReturnType<typeof ownedTarget>>, expected: z.infer<typeof snapshot>) {
  if (system.updated_at !== expected.expectedUpdatedAt || system.current_version_id !== expected.expectedVersionId) {
    throw new Error('The Game Design System changed after approval. Request confirmation again.');
  }
}

function failure(error: unknown): ToolResult {
  return { success: false, error: error instanceof z.ZodError ? 'Invalid Game Design System parameters.'
    : error instanceof Error && /^(Authentication required|Game Design System not found|Only the owner|The Game Design System changed|Unbind this Game Design System)/.test(error.message)
      ? error.message : 'Game Design System operation failed.' };
}

export async function prepareMetadata(ctx: ToolContext, params: unknown) {
  const input = metadata.parse(params);
  const target = await ownedTarget(ctx, input.designSystemId);
  return {
    args: { ...input, expectedUpdatedAt: target.updated_at, expectedVersionId: target.current_version_id },
    preview: { action: 'update_game_design_system', designSystemId: target.id, title: target.title,
      current: { title: target.title, summary: target.summary, status: target.status },
      changes: { title: input.title, summary: input.summary, status: input.status } },
  };
}

export async function updateMetadata(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = sealedMetadata.parse(params);
    const target = await ownedTarget(ctx, input.designSystemId);
    assertSnapshot(target, input);
    const patch = Object.fromEntries(['title', 'summary', 'status']
      .filter((key) => input[key as 'title' | 'summary' | 'status'] !== undefined)
      .map((key) => [key, input[key as 'title' | 'summary' | 'status']]));
    // Match the UI's metadata-only update, with approval-time state as a CAS guard.
    let query = ctx.supabase.from('game_design_systems').update(patch)
      .eq('id', target.id).eq('owner_id', ctx.userId).eq('source', 'user')
      .eq('updated_at', input.expectedUpdatedAt);
    query = input.expectedVersionId === null ? query.is('current_version_id', null)
      : query.eq('current_version_id', input.expectedVersionId);
    const { data, error } = await query.select('id,title,summary,status,current_version_id,updated_at').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('The Game Design System changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { designSystemId: data.id,
      before: { title: target.title, summary: target.summary, status: target.status },
      after: { title: data.title, summary: data.summary, status: data.status },
      currentVersionId: data.current_version_id, updatedAt: data.updated_at },
      invalidations: [{ type: 'game-design-systems', designSystemId: data.id }] };
  } catch (error) { return failure(error); }
}

export async function prepareDeletion(ctx: ToolContext, params: unknown) {
  const input = deletion.parse(params);
  const target = await ownedTarget(ctx, input.designSystemId);
  if (await bindingExists(target.id)) throw new Error('Unbind this Game Design System from all projects before deleting it.');
  return { args: { ...input, expectedUpdatedAt: target.updated_at, expectedVersionId: target.current_version_id },
    preview: { action: 'delete_game_design_system', designSystemId: target.id, title: target.title,
      consequence: 'Permanently delete this Game Design System and its versions.' } };
}

export async function deleteSystem(ctx: ToolContext, params: unknown): Promise<ToolResult> {
  try {
    const input = snapshot.parse(params);
    const target = await ownedTarget(ctx, input.designSystemId);
    assertSnapshot(target, input);
    if (await bindingExists(target.id)) throw new Error('Unbind this Game Design System from all projects before deleting it.');
    let query = ctx.supabase.from('game_design_systems').delete()
      .eq('id', target.id).eq('owner_id', ctx.userId).eq('source', 'user')
      .eq('updated_at', input.expectedUpdatedAt);
    query = input.expectedVersionId === null ? query.is('current_version_id', null)
      : query.eq('current_version_id', input.expectedVersionId);
    const { data, error } = await query.select('id').maybeSingle();
    if (error?.code === '23503') throw new Error('Unbind this Game Design System from all projects before deleting it.');
    if (error) throw error;
    if (!data) throw new Error('The Game Design System changed after approval. Request confirmation again.');
    return { success: true, displayHint: 'text', data: { designSystemId: target.id, title: target.title, deleted: true },
      invalidations: [{ type: 'game-design-systems', designSystemId: target.id }] };
  } catch (error) { return failure(error); }
}

export function preparationFailure(error: unknown) {
  return { success: false as const, error: failure(error).error! };
}
