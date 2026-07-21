/**
 * Maps battle-core continuous coordinates to grid index (consistent with GameMap's isWalkable)
 */
export function floatToCell(
  x: number,
  y: number,
  mapW: number,
  mapH: number,
): { ix: number; iy: number } {
  const ix = Math.min(mapW - 1, Math.max(0, Math.floor(x)))
  const iy = Math.min(mapH - 1, Math.max(0, Math.floor(y)))
  return { ix, iy }
}

/**
 * From from moving linearly toward to, stopping before the first non-walkable cell; used for dash moveTarget clipping.
 */
export function clampDashDestination(input: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  mapW: number
  mapH: number
  isWalkable: (ix: number, iy: number) => boolean
  /** Ray sampling step (in cells) */
  step?: number
}): { x: number; y: number } {
  const step = input.step ?? 0.35
  const dx = input.to.x - input.from.x
  const dy = input.to.y - input.from.y
  const maxDist = Math.hypot(dx, dy)
  if (maxDist < 1e-6) {
    return { x: input.from.x, y: input.from.y }
  }
  const ux = dx / maxDist
  const uy = dy / maxDist

  let bestX = input.from.x
  let bestY = input.from.y
  let travelled = 0

  while (travelled < maxDist) {
    travelled = Math.min(travelled + step, maxDist)
    const nx = input.from.x + ux * travelled
    const ny = input.from.y + uy * travelled
    const { ix, iy } = floatToCell(nx, ny, input.mapW, input.mapH)
    if (!input.isWalkable(ix, iy)) {
      break
    }
    bestX = nx
    bestY = ny
  }

  return { x: bestX, y: bestY }
}

/**
 * If the current floating-point position falls on a blocked cell, snaps to the nearest walkable cell center (4-neighbor BFS).
 */
export function snapPositionToWalkable(input: {
  pos: { x: number; y: number }
  mapW: number
  mapH: number
  isWalkable: (ix: number, iy: number) => boolean
}): { x: number; y: number } {
  const start = floatToCell(input.pos.x, input.pos.y, input.mapW, input.mapH)
  if (input.isWalkable(start.ix, start.iy)) {
    return { ...input.pos }
  }

  const queue: Array<{ ix: number; iy: number }> = [start]
  const visited = new Set<string>([`${start.ix},${start.iy}`])
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]

  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const [dx, dy] of dirs) {
      const nx = cur.ix + dx
      const ny = cur.iy + dy
      if (nx < 0 || ny < 0 || nx >= input.mapW || ny >= input.mapH) continue
      const key = `${nx},${ny}`
      if (visited.has(key)) continue
      visited.add(key)
      if (input.isWalkable(nx, ny)) {
        return { x: nx + 0.5, y: ny + 0.5 }
      }
      queue.push({ ix: nx, iy: ny })
    }
  }

  return { ...input.pos }
}
