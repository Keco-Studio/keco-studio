import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapIdentitySchema, mapResult, mapService, mapToolError } from './map-tool-support';
import { mapContentFingerprint } from './update-map-draft';

export const readMapDetailTool: AgentTool = {
  name: 'read_map_detail',
  description: 'Read the complete saved V3 plan and bounded scene for one map, including its edit version and content fingerprint.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: {
    type: 'object', properties: { mapId: { type: 'string', format: 'uuid' } },
    required: ['mapId'], additionalProperties: false,
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const { mapId } = mapIdentitySchema.strict().parse(params);
      const map = await (await mapService(ctx)).readMap({ projectId, mapId });
      const { collisionGrid, ...scene } = map.scene;
      return mapResult({
        kind: 'map', projectId, ...map.identity, sourceDocumentId: map.sourceDocumentId,
        contentFingerprint: mapContentFingerprint(map.plan, map.scene),
        plan: map.plan,
        scene: {
          ...scene,
          collisionGrid: collisionGrid ? {
            version: collisionGrid.version, cellSize: collisionGrid.cellSize,
            columns: collisionGrid.columns, rows: collisionGrid.rows,
            imageSha256: collisionGrid.imageSha256,
            blockedCells: collisionGrid.cells.filter((cell) => cell === 1).length,
          } : null,
        },
      });
    } catch (error) { return mapToolError(error); }
  },
};
