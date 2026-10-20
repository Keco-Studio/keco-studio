import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedGeneration, generationIdentitySchema, generationParameters, mapResult, mapService, mapToolError } from './map-tool-support';

export const getMapGenerationStatusTool: AgentTool = {
  name: 'get_map_generation_status', description: 'Read the current durable map generation status once. Does not poll the provider or wait for completion.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: generationParameters, required: ['mapId', 'revisionId', 'assetId'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = generationIdentitySchema.strict().parse(params);
      const asset = await (await mapService(ctx)).getGeneration({ mapId: input.mapId, revisionId: input.revisionId, assetId: input.assetId, projectId });
      return mapResult({ kind: 'map', projectId, mapId: input.mapId, revisionId: input.revisionId, generation: boundedGeneration(asset) });
    } catch (error) { return mapToolError(error); }
  },
};
