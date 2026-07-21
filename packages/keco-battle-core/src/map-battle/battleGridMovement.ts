import type { BattleEntity } from '../battle-core/domain/entities/battle-entity'
import type { BattleSession } from '../battle-core/domain/entities/battle-session'
import { findShortestGridPath4 } from './gridPathfinding'
import { clampDashDestination, floatToCell } from './walkability'

export type BattleWalkTerrainContext = {
  mapW: number
  mapH: number
  isTerrainWalkable: (gx: number, gy: number) => boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function cellCenter(ix: number, iy: number): { x: number; y: number } {
  return { x: ix + 0.5, y: iy + 0.5 }
}

function ensureSpacingWithOpponent(
  x: number,
  team: 'left' | 'right',
  opponent: BattleEntity | undefined,
  minX: number,
  maxX: number,
): number {
  if (!opponent) return clamp(x, minX, maxX)
  const minGap = 1.2
  if (team === 'left') {
    return clamp(Math.min(x, opponent.position.x - minGap), minX, maxX)
  }
  return clamp(Math.max(x, opponent.position.x + minGap), minX, maxX)
}

/**
 * Terrain + “cannot enter opponent’s cell”; mover’s current cell is passable for BFS start.
 */
export function buildBattleCellWalkFilter(input: {
  session: BattleSession
  moverId: string
  walk: BattleWalkTerrainContext
}): (gx: number, gy: number) => boolean {
  const { session, moverId, walk } = input
  const left = session.left
  const right = session.right
  const mover = left.id === moverId ? left : right
  const opp = left.id === moverId ? right : left
  const { ix: oix, iy: oiy } = floatToCell(opp.position.x, opp.position.y, walk.mapW, walk.mapH)
  const { ix: mix, iy: miy } = floatToCell(mover.position.x, mover.position.y, walk.mapW, walk.mapH)

  return (gx: number, gy: number) => {
    if (!walk.isTerrainWalkable(gx, gy)) return false
    if (gx === oix && gy === oiy) return false
    if (gx === mix && gy === miy) return true
    return true
  }
}

/**
 * Walk up to `budget` distance along polyline through cell centers following `path` (grid indices).
 */
function advanceAlongCellCenterPath(input: {
  from: { x: number; y: number }
  path: { x: number; y: number }[]
  budget: number
}): { x: number; y: number } {
  const { from, path, budget } = input
  if (path.length === 0) return { ...from }
  const waypoints = path.map((c) => cellCenter(c.x, c.y))
  let remaining = Math.max(0, budget)
  let pos = { x: from.x, y: from.y }
  let wpIdx = 0
  while (remaining > 1e-6 && wpIdx < waypoints.length) {
    const target = waypoints[wpIdx]
    const dx = target.x - pos.x
    const dy = target.y - pos.y
    const d = Math.hypot(dx, dy)
    if (d < 1e-9) {
      wpIdx += 1
      continue
    }
    if (d <= remaining) {
      pos = { x: target.x, y: target.y }
      remaining -= d
      wpIdx += 1
    } else {
      const s = remaining / d
      pos = { x: pos.x + dx * s, y: pos.y + dy * s }
      remaining = 0
    }
  }
  return pos
}

function rayStepToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  moveStep: number,
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-9) return { ...from }
  const step = Math.min(moveStep, dist)
  return {
    x: from.x + (dx / dist) * step,
    y: from.y + (dy / dist) * step,
  }
}

/**
 * Resolve dash end position: grid shortest path toward clamped target, then move ≤ moveStep along that polyline.
 * Falls back to sampled-ray clamp when BFS cannot reach the goal.
 */
export function resolveBattleDashPosition(input: {
  session: BattleSession
  actor: BattleEntity
  opponent: BattleEntity | undefined
  clampedTargetX: number
  clampedTargetY: number
  moveStep: number
  walk: BattleWalkTerrainContext
}): { x: number; y: number } {
  const { session, actor, opponent, clampedTargetX, clampedTargetY, moveStep, walk } = input
  const cellWalk = buildBattleCellWalkFilter({ session, moverId: actor.id, walk })

  const start = floatToCell(actor.position.x, actor.position.y, walk.mapW, walk.mapH)
  const goal = floatToCell(clampedTargetX, clampedTargetY, walk.mapW, walk.mapH)

  const path = findShortestGridPath4({
    start: { x: start.ix, y: start.iy },
    goal: { x: goal.ix, y: goal.iy },
    mapWidth: walk.mapW,
    mapHeight: walk.mapH,
    isWalkable: cellWalk,
  })

  let candidate: { x: number; y: number }

  if (path && path.length >= 2) {
    candidate = advanceAlongCellCenterPath({
      from: actor.position,
      path,
      budget: moveStep,
    })
  } else {
    const rayEnd = clampDashDestination({
      from: actor.position,
      to: { x: clampedTargetX, y: clampedTargetY },
      mapW: walk.mapW,
      mapH: walk.mapH,
      isWalkable: cellWalk,
    })
    candidate = rayStepToward(actor.position, rayEnd, moveStep)
  }

  const minX = session.mapBounds.minX + 0.5
  const maxX = session.mapBounds.maxX - 0.5
  const minY = session.mapBounds.minY + 0.5
  const maxY = session.mapBounds.maxY - 0.5

  const safeX = ensureSpacingWithOpponent(candidate.x, actor.team, opponent, minX, maxX)
  const safeY = clamp(candidate.y, minY, maxY)

  return { x: safeX, y: safeY }
}
