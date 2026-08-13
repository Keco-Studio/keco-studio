import { describe, expect, it } from '@jest/globals';
import {
  DirectMapCollisionGridSchema,
  collisionGridMatchesImage,
  countCollisionCells,
  createEmptyCollisionGrid,
  setCollisionCell,
} from '@/features/create-map/model/directMapCollisionGrid';
import { resolveDirectMapCollisionPhase } from '@/features/create-map/hooks/useDirectMapCollisionGrid';

describe('Direct Map collision grid', () => {
  it.each([
    [512, 512, 64, 64],
    [688, 384, 86, 48],
    [384, 688, 48, 86],
  ])('creates an exact 8px grid for %ix%i', (width, height, columns, rows) => {
    const grid = createEmptyCollisionGrid(width, height, 'a'.repeat(64));
    expect(grid).toMatchObject({ version: 1, cellSize: 8, columns, rows });
    expect(grid.cells).toHaveLength(columns * rows);
    expect(countCollisionCells(grid)).toEqual({ 0: columns * rows, 1: 0 });
  });

  it('edits cells immutably in row-major order and ignores out-of-bounds input', () => {
    const grid = createEmptyCollisionGrid(512, 512, 'b'.repeat(64));
    const changed = setCollisionCell(grid, 3, 2, 1);
    expect(changed).not.toBe(grid);
    expect(changed.cells[2 * 64 + 3]).toBe(1);
    expect(grid.cells[2 * 64 + 3]).toBe(0);
    expect(setCollisionCell(changed, 64, 2, 1)).toBe(changed);
  });

  it('rejects invalid dimensions, counts, values, and hashes', () => {
    const valid = createEmptyCollisionGrid(512, 512, 'c'.repeat(64));
    expect(DirectMapCollisionGridSchema.safeParse({ ...valid, columns: 65 }).success).toBe(false);
    expect(DirectMapCollisionGridSchema.safeParse({ ...valid, cells: valid.cells.slice(1) }).success).toBe(false);
    expect(DirectMapCollisionGridSchema.safeParse({ ...valid, cells: [...valid.cells.slice(1), 2] }).success).toBe(false);
    expect(DirectMapCollisionGridSchema.safeParse({ ...valid, imageSha256: 'C'.repeat(64) }).success).toBe(false);
  });

  it('matches only the exact image hash and dimensions', () => {
    const grid = createEmptyCollisionGrid(688, 384, 'd'.repeat(64));
    expect(collisionGridMatchesImage(grid, { width: 688, height: 384, sha256: 'd'.repeat(64) })).toBe(true);
    expect(collisionGridMatchesImage(grid, { width: 688, height: 384, sha256: 'e'.repeat(64) })).toBe(false);
    expect(collisionGridMatchesImage(grid, { width: 512, height: 512, sha256: 'd'.repeat(64) })).toBe(false);
  });

  it('keeps explicit analysis states visible when an older matching grid exists', () => {
    expect(resolveDirectMapCollisionPhase(true, 'analyzing')).toBe('analyzing');
    expect(resolveDirectMapCollisionPhase(true, 'failed')).toBe('failed');
    expect(resolveDirectMapCollisionPhase(true, 'idle')).toBe('ready');
    expect(resolveDirectMapCollisionPhase(false, 'failed')).toBe('failed');
  });
});
