import { z } from 'zod';

export const DIRECT_MAP_COLLISION_CELL_SIZE = 8 as const;
export const DIRECT_MAP_COLLISION_VALUES = [0, 1] as const;

export type DirectMapCollisionCell = typeof DIRECT_MAP_COLLISION_VALUES[number];

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUPPORTED_GRIDS = new Set(['64x64', '86x48', '48x86']);

export const DirectMapCollisionGridSchema = z.object({
  version: z.literal(1),
  cellSize: z.literal(DIRECT_MAP_COLLISION_CELL_SIZE),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  cells: z.array(z.union([z.literal(0), z.literal(1)])),
  imageSha256: z.string().regex(SHA256_PATTERN),
}).strict().superRefine((grid, context) => {
  if (!SUPPORTED_GRIDS.has(`${grid.columns}x${grid.rows}`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['columns'],
      message: 'Collision grid dimensions are not supported',
    });
  }
  if (grid.cells.length !== grid.columns * grid.rows) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cells'],
      message: 'Collision cell count must match rows multiplied by columns',
    });
  }
});

export type DirectMapCollisionGrid = z.infer<typeof DirectMapCollisionGridSchema>;

export function createEmptyCollisionGrid(
  width: number,
  height: number,
  imageSha256: string,
): DirectMapCollisionGrid {
  const grid = {
    version: 1 as const,
    cellSize: DIRECT_MAP_COLLISION_CELL_SIZE,
    columns: width / DIRECT_MAP_COLLISION_CELL_SIZE,
    rows: height / DIRECT_MAP_COLLISION_CELL_SIZE,
    cells: Array.from(
      { length: (width / DIRECT_MAP_COLLISION_CELL_SIZE) * (height / DIRECT_MAP_COLLISION_CELL_SIZE) },
      () => 0 as const,
    ),
    imageSha256,
  };
  return DirectMapCollisionGridSchema.parse(grid);
}

export function setCollisionCell(
  grid: DirectMapCollisionGrid,
  column: number,
  row: number,
  value: DirectMapCollisionCell,
): DirectMapCollisionGrid {
  if (!Number.isInteger(column) || !Number.isInteger(row)
    || column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) {
    return grid;
  }
  const index = row * grid.columns + column;
  if (grid.cells[index] === value) return grid;
  const cells = [...grid.cells];
  cells[index] = value;
  return { ...grid, cells };
}

export function countCollisionCells(grid: DirectMapCollisionGrid): Record<DirectMapCollisionCell, number> {
  const counts: Record<DirectMapCollisionCell, number> = { 0: 0, 1: 0 };
  grid.cells.forEach((cell) => { counts[cell] += 1; });
  return counts;
}

export function collisionGridMatchesImage(
  grid: DirectMapCollisionGrid | null,
  image: { sha256: string; width: number; height: number } | null,
): boolean {
  return Boolean(grid && image
    && grid.imageSha256 === image.sha256
    && grid.columns * grid.cellSize === image.width
    && grid.rows * grid.cellSize === image.height);
}
