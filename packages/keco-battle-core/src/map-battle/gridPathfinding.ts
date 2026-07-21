/**
 * Shortest path on a 4-connected grid (axis-aligned steps only).
 * Shared by map UI click-move and battle dash resolution.
 */
export function findShortestGridPath4(input: {
  start: { x: number; y: number }
  goal: { x: number; y: number }
  mapWidth: number
  mapHeight: number
  isWalkable: (x: number, y: number) => boolean
}): { x: number; y: number }[] | null {
  const { start, goal, mapWidth: W, mapHeight: H, isWalkable } = input
  const sx = start.x
  const sy = start.y
  const gx = goal.x
  const gy = goal.y

  if (sx < 0 || sy < 0 || sx >= W || sy >= H || gx < 0 || gy < 0 || gx >= W || gy >= H) {
    return null
  }
  if (!isWalkable(gx, gy)) return null
  if (!isWalkable(sx, sy)) return null
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }]

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  const startKey = `${sx},${sy}`
  const parent = new Map<string, string | null>([[startKey, null]])
  const queue: Array<{ x: number; y: number }> = [{ x: sx, y: sy }]

  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx
      const ny = cur.y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const key = `${nx},${ny}`
      if (parent.has(key)) continue
      if (!isWalkable(nx, ny)) continue
      parent.set(key, `${cur.x},${cur.y}`)
      if (nx === gx && ny === gy) {
        const out: { x: number; y: number }[] = []
        let walk: string | null = key
        while (walk !== null) {
          const [px, py] = walk.split(',').map(Number)
          out.push({ x: px, y: py })
          walk = parent.get(walk) ?? null
        }
        out.reverse()
        return out
      }
      queue.push({ x: nx, y: ny })
    }
  }

  return null
}
