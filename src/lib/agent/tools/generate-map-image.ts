import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedGeneration, mapIdentitySchema, mapResult, mapService, mapToolError, sealGeneration, sealedGenerationSchema } from './map-tool-support';

const paramsSchema = mapIdentitySchema.extend({ revisionId: z.string().uuid(), saveVersion: z.number().int().nonnegative() }).strict();
const sealedSubmitSchema = sealedGenerationSchema.extend({ confirmationPurpose: z.literal('submit') });

export const generateMapImageTool: AgentTool = {
  name: 'generate_map_image',
  description: 'Prepare an exact saved map plan for paid image generation. Always requires user approval, including Auto mode. Submits once and returns immediately; the workbench monitors progress. Use retry_map_generation for a failed attempt.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    mapId: { type: 'string', format: 'uuid' }, revisionId: { type: 'string', format: 'uuid' }, saveVersion: { type: 'integer', minimum: 0 },
  }, required: ['mapId', 'revisionId', 'saveVersion'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params);
      const prepared = await (await mapService(ctx)).prepareGeneration({ mapId: input.mapId, revisionId: input.revisionId, saveVersion: input.saveVersion, projectId });
      if (prepared.confirmationPurpose !== 'submit') return { success: false, error: 'Use retry_map_generation and acknowledge duplicate billing for this attempt.' };
      const { confirmationToken: _confirmationToken, ...preview } = prepared;
      return {
        success: true, args: sealGeneration(projectId, prepared),
        preview: { type: 'map_generation', ...preview },
      };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSubmitSchema.parse(params) as Required<z.infer<typeof sealedSubmitSchema>>;
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      const asset = await (await mapService(ctx)).startGeneration({ ...input, requireFreshConfirmation: true });
      return mapResult({ kind: 'map', projectId, mapId: input.mapId, revisionId: input.revisionId, generation: boundedGeneration(asset) }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
