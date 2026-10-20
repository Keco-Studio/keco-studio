import { z } from 'zod';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { normalizeManualImage } from '@/lib/services/gameAssetsService';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';

const paramsSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export const listGameMediaTool: AgentTool = {
  name: 'list_game_media',
  description: 'List uploaded project media assets by stable ID in the selected project, 20 by default and at most 50.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params);
      await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
      const { data, error } = await ctx.supabase.from('project_game_assets')
        .select('id,project_id,name,file_name,category,status,mime_type,storage_bucket,storage_path,sha256,width,height,has_transparency,file_size,created_at,updated_at')
        .eq('project_id', projectId)
        .eq('category', 'media')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(input.offset!, input.offset! + input.limit!);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.some((row) => row.project_id !== projectId || row.category !== 'media')) {
        throw new Error('Media results did not match the selected project.');
      }
      const assets = rows.slice(0, input.limit!).map((row) => normalizeManualImage(row as Record<string, unknown>));
      return { success: true, displayHint: 'list', data: {
        kind: 'game_media', projectId,
        assets: assets.map((asset) => ({
          assetId: asset.sourceRef.id, name: asset.name.slice(0, 255),
          mimeType: asset.mimeType, format: asset.format, status: asset.status,
          fileSize: asset.fileSize, width: asset.width, height: asset.height,
          createdAt: asset.createdAt,
        })),
        nextOffset: rows.length > input.limit! ? input.offset! + input.limit! : null,
      } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Media list failed.' };
    }
  },
};
