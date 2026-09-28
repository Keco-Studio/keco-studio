import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';

const paramsSchema = z.object({
  mapId: z.string().uuid(),
  beforeRevisionNumber: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export const listMapGenerationHistoryTool: AgentTool = {
  name: 'list_map_generation_history',
  description: 'List ready generated image revisions for one saved map, 20 by default and at most 50, with a stable revision-number cursor.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {
    mapId: { type: 'string', format: 'uuid' },
    beforeRevisionNumber: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, required: ['mapId'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params);
      const map = await (await mapService(ctx)).readMap({ projectId, mapId: input.mapId });
      let query = ctx.supabase.from('map_revisions')
        .select('id,revision_number,map_assets!inner(id)')
        .eq('map_project_id', input.mapId)
        .eq('schema_version', 3)
        .eq('map_assets.kind', 'map_image')
        .eq('map_assets.status', 'ready')
        .order('revision_number', { ascending: false })
        .limit(input.limit + 1);
      if (input.beforeRevisionNumber !== undefined) query = query.lt('revision_number', input.beforeRevisionNumber);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      const revisions = rows.slice(0, input.limit).map((row) => ({
        revisionId: String(row.id), revisionNumber: Number(row.revision_number),
        isBound: row.id === map.scene.mapImage?.sourceRevisionId,
      }));
      return mapResult({ kind: 'map_generation_history', projectId, mapId: input.mapId,
        boundRevisionId: map.scene.mapImage?.sourceRevisionId ?? null,
        revisions,
        nextBeforeRevisionNumber: rows.length > input.limit
          ? revisions.at(-1)?.revisionNumber ?? null : null,
      });
    } catch (error) { return mapToolError(error); }
  },
};
