/**
 * Builds a row-major walkable matrix for LLM prompts.
 * Indexing: walkableRows[rowY][colX] matches grid cell (colX, rowY) as used by map walkability callbacks.
 */
export function buildWalkableRowsForLlm(
  mapW: number,
  mapH: number,
  isWalkable: (gx: number, gy: number) => boolean,
): boolean[][] {
  const rows: boolean[][] = []
  for (let iy = 0; iy < mapH; iy++) {
    const row: boolean[] = []
    for (let ix = 0; ix < mapW; ix++) {
      row.push(isWalkable(ix, iy))
    }
    rows.push(row)
  }
  return rows
}
