import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';

const paramsSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().positive().default(20).transform((value) => Math.min(50, value)),
}).strict();

export const listMapsTool: AgentTool = {
  name: 'list_maps', description: 'List saved maps in the selected project. Returns up to 50 map summaries and a next cursor.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {
    cursor: { type: 'string', format: 'uuid' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  }, additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const { cursor, limit } = paramsSchema.parse(params);
      const { items, nextCursor } = await (await mapService(ctx)).listMaps({ projectId, cursor, limit });
      return mapResult({
        kind: 'list', projectId,
        maps: items.map((map) => ({ mapId: map.id, revisionId: map.currentRevisionId, title: map.name.slice(0, 160) })),
        nextCursor,
      });
    } catch (error) { return mapToolError(error); }
  },
};
