import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedGeneration, generationIdentitySchema, generationParameters, mapResult, mapService, mapToolError, sealGeneration, sealedGenerationSchema } from './map-tool-support';

const paramsSchema = generationIdentitySchema.extend({ acknowledgeDuplicateBilling: z.literal(true) }).strict();
const sealedRetrySchema = sealedGenerationSchema.extend({
  acknowledgeDuplicateBilling: z.literal(true), confirmationPurpose: z.enum(['retry', 'replace-unknown']),
});

export const retryMapGenerationTool: AgentTool = {
  name: 'retry_map_generation',
  description: 'Prepare a paid retry of a failed or blocked map generation. Requires acknowledgeDuplicateBilling=true and explicit approval even in Auto mode. Submits once and returns immediately.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: { ...generationParameters, acknowledgeDuplicateBilling: { type: 'boolean', const: true } }, required: ['mapId', 'revisionId', 'assetId', 'acknowledgeDuplicateBilling'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params);
      const prepared = await (await mapService(ctx)).prepareRetryGeneration({ mapId: input.mapId, revisionId: input.revisionId, assetId: input.assetId, acknowledgeDuplicateBilling: input.acknowledgeDuplicateBilling, projectId });
      const { confirmationToken: _confirmationToken, ...preview } = prepared;
      return {
        success: true, args: { ...sealGeneration(projectId, prepared), acknowledgeDuplicateBilling: true },
        preview: { type: 'map_generation', ...preview },
      };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedRetrySchema.parse(params) as Required<z.infer<typeof sealedRetrySchema>>;
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      const asset = await (await mapService(ctx)).startGeneration({ ...input, requireFreshConfirmation: true });
      return mapResult({ kind: 'map', projectId, mapId: input.mapId, revisionId: input.revisionId, generation: boundedGeneration(asset) }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
