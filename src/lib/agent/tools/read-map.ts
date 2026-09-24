import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedGeneration, boundedPlan, mapIdParameters, mapIdentitySchema, mapResult, mapService, mapToolError } from './map-tool-support';

export const readMapTool: AgentTool = {
  name: 'read_map', description: 'Read a saved map plan summary, current version and generation state in the selected project.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: mapIdParameters, required: ['mapId'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = mapIdentitySchema.strict().parse(params);
      const map = await (await mapService(ctx)).readMap({ projectId, mapId: input.mapId });
      return mapResult({
        kind: 'map', projectId, ...map.identity, plan: boundedPlan(map.plan),
        generation: map.generation ? {
          ...boundedGeneration({ ...map.generation, assetId: map.generation.id }),
          revisionId: map.generationRevisionId ?? map.identity.revisionId,
        } : null,
      });
    } catch (error) { return mapToolError(error); }
  },
};
