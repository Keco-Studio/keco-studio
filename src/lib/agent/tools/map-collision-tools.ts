import { z } from 'zod';
import {
  countCollisionCells, createEmptyCollisionGrid, setCollisionCell,
} from '@/features/create-map/model/directMapCollisionGrid';
import type { MapSceneV3 } from '@/features/create-map/model/directMapSchema';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';
import { mapContentFingerprint } from './update-map-draft';
import { mapSnapshotFields, mapSnapshotParameters, readMapForMutation, type MapSnapshot } from './map-saved-action-support';

const readSchema = z.object({ mapId: z.string().uuid() }).strict();
const cellSchema = z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative(), value: z.union([z.literal(0), z.literal(1)]) }).strict();
const actionSchema = z.object({
  ...mapSnapshotFields,
  action: z.enum(['paint', 'clear']),
  cells: z.array(cellSchema).min(1).max(128).optional(),
}).strict().superRefine((input, issue) => {
  if (input.action === 'paint' && !input.cells) issue.addIssue({ code: z.ZodIssueCode.custom, message: 'Paint requires cells.' });
  if (input.action === 'clear' && input.cells) issue.addIssue({ code: z.ZodIssueCode.custom, message: 'Clear does not accept cells.' });
});
const sealedSchema = z.object({
  ...mapSnapshotFields,
  action: z.enum(['paint', 'clear']),
  cells: z.array(cellSchema).min(1).max(128).optional(),
  projectId: z.string().uuid(), confirmedChange: z.literal(true),
}).strict();

function boundImage(map: { scene: MapSceneV3; generation: { sha256: string | null; status: string } | null; generationRevisionId?: string | null }) {
  const binding = map.scene.mapImage;
  if (!binding?.locked || !map.generation || map.generation.status !== 'ready'
    || !map.generation.sha256 || map.generationRevisionId !== binding.sourceRevisionId) {
    throw new Error('A validated ready map image is required for collision edits.');
  }
  return { binding, sha256: map.generation.sha256 };
}

function changedScene(map: Parameters<typeof boundImage>[0], action: 'paint' | 'clear', cells?: Array<z.infer<typeof cellSchema>>): MapSceneV3 {
  const image = boundImage(map);
  const current = map.scene.collisionGrid;
  let grid = current && current.imageSha256 === image.sha256
    ? current : createEmptyCollisionGrid(image.binding.width, image.binding.height, image.sha256);
  if (action === 'clear') grid = createEmptyCollisionGrid(image.binding.width, image.binding.height, image.sha256);
  else for (const cell of cells ?? []) {
    if (cell.column >= grid.columns || cell.row >= grid.rows) throw new Error('Collision cell is outside the map.');
    grid = setCollisionCell(grid, cell.column, cell.row, cell.value);
  }
  return { ...map.scene, collisionGrid: grid };
}

export const readMapCollisionGridTool: AgentTool = {
  name: 'read_map_collision_grid', description: 'Read the selected map collision grid as bounded row strings of walkable (0) and blocked (1) cells.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: { mapId: { type: 'string', format: 'uuid' } }, required: ['mapId'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const { mapId } = readSchema.parse(params);
      const map = await (await mapService(ctx)).readMap({ projectId, mapId });
      const grid = map.scene.collisionGrid;
      return mapResult({ kind: 'map_collision_grid', projectId, ...map.identity,
        contentFingerprint: mapContentFingerprint(map.plan, map.scene),
        grid: grid ? { version: grid.version, cellSize: grid.cellSize, columns: grid.columns,
          rows: grid.rows, imageSha256: grid.imageSha256, counts: countCollisionCells(grid),
          rowValues: Array.from({ length: grid.rows }, (_, row) => grid.cells.slice(row * grid.columns, (row + 1) * grid.columns).join('')) } : null,
      });
    } catch (error) { return mapToolError(error); }
  },
};

export const changeMapCollisionGridTool: AgentTool = {
  name: 'change_map_collision_grid',
  description: 'Paint up to 128 collision cells or clear the grid to walkable. Requires approval and a current map fingerprint; uses a CAS save.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    ...mapSnapshotParameters,
    action: { type: 'string', enum: ['paint', 'clear'] },
    cells: { type: 'array', maxItems: 128, items: { type: 'object', properties: {
      column: { type: 'integer', minimum: 0 }, row: { type: 'integer', minimum: 0 }, value: { type: 'integer', enum: [0, 1] },
    }, required: ['column', 'row', 'value'], additionalProperties: false } },
  }, required: ['mapId', 'revisionId', 'saveVersion', 'expectedFingerprint', 'action'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = actionSchema.parse(params);
      const map = await readMapForMutation(ctx, projectId, input as MapSnapshot);
      const scene = changedScene(map, input.action, input.cells);
      return { success: true, args: { ...input, projectId, confirmedChange: true },
        preview: { type: 'map_collision_change', projectId, mapId: input.mapId,
          revisionId: input.revisionId, saveVersion: input.saveVersion,
          action: input.action, cellCount: input.cells?.length ?? scene.collisionGrid?.cells.length ?? 0,
          consequence: input.action === 'clear' ? 'Clear all blocked cells in this map collision grid.' : 'Overwrite the selected collision cells.',
        } };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      const map = await readMapForMutation(ctx, projectId, input as MapSnapshot);
      const scene = changedScene(map, input.action, input.cells);
      const saved = await (await mapService(ctx)).updateDraft({
        projectId, mapId: input.mapId, revisionId: input.revisionId,
        saveVersion: input.saveVersion, plan: map.plan, scene,
      });
      return mapResult({ kind: 'map_collision_grid', projectId, mapId: input.mapId,
        revisionId: input.revisionId, saveVersion: saved.saveVersion,
        contentFingerprint: mapContentFingerprint(map.plan, scene),
        counts: countCollisionCells(scene.collisionGrid!),
      }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
