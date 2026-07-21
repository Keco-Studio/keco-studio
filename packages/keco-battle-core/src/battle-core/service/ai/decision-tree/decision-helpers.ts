/**
 * Shared selection & geometry helpers used by both action-selector
 * (4 tactical trees) and strategy-template (9 named templates).
 *
 * All helpers are pure and deterministic so battle replays stay reproducible.
 */
import { canTriggerElementReaction } from '@keco/battle-engine'
import type { Element } from '@keco/battle-engine'
import type { DecisionAction, DecisionContext, ReadySkill } from './decision-context'
import {
  APPROACH_MIN_STAY,
  APPROACH_STAY_OFFSET,
  MAP_EDGE,
  MIN_MOVE_DELTA,
  RETREAT_STEP,
} from './decision-constants'

function targetElementAura(ctx: DecisionContext): Element | null {
  const keco = ctx.session.keco
  if (!keco) return null
  const unit = keco.units[ctx.target.id]
  return unit?.element?.element ?? null
}

/**
 * Prefer a ready in-range skill that triggers a keco elemental reaction on the target.
 */
export function pickReactionSkillInRange(ctx: DecisionContext): ReadySkill | null {
  const targetElem = targetElementAura(ctx)
  if (!targetElem || !ctx.session.keco) return null

  const skillById = ctx.session.keco.skillById
  const candidates = ctx.readySkills.filter((s) => {
    if (!s.inRange) return false
    const kecoSkill = skillById[s.definition.id]
    const skillElem = kecoSkill?.attachElement?.element
    if (!skillElem || skillElem === 'random') return false
    return canTriggerElementReaction(skillElem, targetElem)
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.definition.ratio - a.definition.ratio)
  return candidates[0]
}

/**
 * Ready in-range skill that applies an element aura (setup for later reactions).
 */
export function pickElementSetupSkillInRange(ctx: DecisionContext): ReadySkill | null {
  if (!ctx.session.keco || targetElementAura(ctx)) return null
  const skillById = ctx.session.keco.skillById
  const candidates = ctx.readySkills.filter((s) => {
    if (!s.inRange) return false
    const kecoSkill = skillById[s.definition.id]
    const skillElem = kecoSkill?.attachElement?.element
    return Boolean(skillElem && skillElem !== 'random')
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.definition.ratio - a.definition.ratio)
  return candidates[0]
}

function pickBestReactionReadySkill(ctx: DecisionContext): ReadySkill | null {
  const targetElem = targetElementAura(ctx)
  if (!targetElem || !ctx.session.keco) return null

  const skillById = ctx.session.keco.skillById
  const candidates = ctx.readySkills.filter((s) => {
    const kecoSkill = skillById[s.definition.id]
    const skillElem = kecoSkill?.attachElement?.element
    if (!skillElem || skillElem === 'random') return false
    return canTriggerElementReaction(skillElem, targetElem)
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.definition.ratio - a.definition.ratio)
  return candidates[0]
}

function pickBestElementSetupReadySkill(ctx: DecisionContext): ReadySkill | null {
  if (!ctx.session.keco || targetElementAura(ctx)) return null

  const skillById = ctx.session.keco.skillById
  const candidates = ctx.readySkills.filter((s) => {
    const kecoSkill = skillById[s.definition.id]
    const skillElem = kecoSkill?.attachElement?.element
    return Boolean(skillElem && skillElem !== 'random')
  })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.definition.ratio - a.definition.ratio)
  return candidates[0]
}

/**
 * Global element-reaction priority: cast in-range reaction, dash to reaction range,
 * then apply element setup when the target has no aura yet.
 */
export function preferElementReactionAction(ctx: DecisionContext): DecisionAction | null {
  if (!ctx.session.keco) return null

  const inRangeReaction = pickReactionSkillInRange(ctx)
  if (inRangeReaction) {
    return {
      type: 'cast_skill',
      skillId: inRangeReaction.definition.id,
      path: 'root>priority>cast_reaction',
    }
  }

  const reactionSkill = pickBestReactionReadySkill(ctx)
  if (reactionSkill && !reactionSkill.inRange) {
    const approach = computeApproach(ctx, reactionSkill.definition.range)
    if (approach) {
      return { type: 'dash', target: approach, path: 'root>priority>dash_for_reaction' }
    }
  }

  const setupInRange = pickElementSetupSkillInRange(ctx)
  if (setupInRange) {
    return {
      type: 'cast_skill',
      skillId: setupInRange.definition.id,
      path: 'root>priority>cast_element_setup',
    }
  }

  const setupSkill = pickBestElementSetupReadySkill(ctx)
  if (setupSkill && !setupSkill.inRange) {
    const approach = computeApproach(ctx, setupSkill.definition.range)
    if (approach) {
      return { type: 'dash', target: approach, path: 'root>priority>dash_for_element_setup' }
    }
  }

  return null
}

/**
 * Picks the highest-ratio ready skill whose range covers the current distance.
 * Callers should treat a returned skill as "cast-worthy" without further
 * in-range checks.
 */
export function pickBestInRange(ctx: DecisionContext): ReadySkill | null {
  const candidates = ctx.readySkills.filter((s) => s.inRange)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.definition.ratio - a.definition.ratio)
  return candidates[0]
}

/**
 * Like `pickBestInRange` but falls back to any ready skill (even out-of-range)
 * when no in-range skill exists. Used by trees that want to telegraph
 * "there is *a* skill available" so later branches can dash into range.
 */
export function pickBestReadyOrAny(ctx: DecisionContext): ReadySkill | null {
  const inRange = pickBestInRange(ctx)
  if (inRange) return inRange
  return ctx.readySkills[0] ?? null
}

/**
 * Picks the first ready skill matching a category AND in range.
 * Returns null if no match — unlike the older action-selector variant
 * which returned out-of-range skills and relied on callers to re-check.
 */
export function pickByCategoryInRange(ctx: DecisionContext, category: string): ReadySkill | null {
  return ctx.readySkills.find((s) => s.definition.category === category && s.inRange) ?? null
}

/**
 * Computes a dash target that closes distance until we sit just inside
 * `desiredRange`. Returns null if the displacement is below MIN_MOVE_DELTA
 * (i.e. the actor is already close enough).
 */
export function computeApproach(
  ctx: DecisionContext,
  desiredRange: number,
): { x: number; y: number } | null {
  const stayDistance = Math.max(APPROACH_MIN_STAY, desiredRange - APPROACH_STAY_OFFSET)
  const tx = ctx.actor.team === 'left'
    ? Math.min(ctx.mapBounds.maxX - MAP_EDGE.halfCell, ctx.target.position.x - stayDistance)
    : Math.max(ctx.mapBounds.minX + MAP_EDGE.halfCell, ctx.target.position.x + stayDistance)
  const ty = ctx.target.position.y
  if (Math.hypot(tx - ctx.actor.position.x, ty - ctx.actor.position.y) < MIN_MOVE_DELTA) return null
  return { x: tx, y: ty }
}

/**
 * Straight back-away dash along the team's rear axis (left team moves -X,
 * right team moves +X). Keeps Y identical. Used by retreat trees that want
 * to create separation without touching the Y axis.
 */
export function computeRetreatAlongX(ctx: DecisionContext): { x: number; y: number } | null {
  const step = clamp(ctx.preferredRange * RETREAT_STEP.xScale, RETREAT_STEP.xMin, RETREAT_STEP.xMax)
  const tx = ctx.actor.team === 'left'
    ? ctx.actor.position.x - step
    : ctx.actor.position.x + step
  const ty = ctx.actor.position.y
  const cx = clamp(tx, ctx.mapBounds.minX + MAP_EDGE.halfCell, ctx.mapBounds.maxX - MAP_EDGE.halfCell)
  const cy = clamp(ty, ctx.mapBounds.minY + MAP_EDGE.halfCell, ctx.mapBounds.maxY - MAP_EDGE.halfCell)
  if (Math.hypot(cx - ctx.actor.position.x, cy - ctx.actor.position.y) < MIN_MOVE_DELTA) return null
  return { x: cx, y: cy }
}

/**
 * Kite retreat: back away on X plus "perpendicular jink" on Y.
 * When cornered against the X edge the Y axis takes over. Deterministic:
 * when neither Y boundary forces a direction we alternate based on tick
 * parity (previously `Math.random() < 0.5`, which broke replayability).
 */
export function computeKiteRetreat(ctx: DecisionContext): { x: number; y: number } | null {
  const stepX = clamp(ctx.preferredRange * RETREAT_STEP.xScale, RETREAT_STEP.xMin, RETREAT_STEP.xMax)
  let rawX = ctx.actor.team === 'left'
    ? ctx.actor.position.x - stepX
    : ctx.actor.position.x + stepX

  const stepY = clamp(ctx.preferredRange * RETREAT_STEP.yScale, RETREAT_STEP.yMin, RETREAT_STEP.yMax)
  const awayY = ctx.actor.position.y >= ctx.target.position.y
    ? ctx.actor.position.y + stepY
    : ctx.actor.position.y - stepY

  const nearXEdge =
    ctx.actor.position.x <= ctx.mapBounds.minX + MAP_EDGE.corner ||
    ctx.actor.position.x >= ctx.mapBounds.maxX - MAP_EDGE.corner
  const nearXMin = ctx.actor.position.x <= ctx.mapBounds.minX + MAP_EDGE.corner
  const nearXMax = ctx.actor.position.x >= ctx.mapBounds.maxX - MAP_EDGE.corner
  const nearYBottom = ctx.actor.position.y >= ctx.mapBounds.maxY - MAP_EDGE.corner
  const nearYTop = ctx.actor.position.y <= ctx.mapBounds.minY + MAP_EDGE.corner

  let y = awayY
  if (nearXEdge) {
    // Escaping side walls takes priority over pure "back away" X motion.
    // Otherwise the actor can get trapped in long single-axis Y loops.
    const inwardStepX = Math.max(RETREAT_STEP.xMin * 0.7, stepX * 0.45)
    if (nearXMin) rawX = ctx.actor.position.x + inwardStepX
    else if (nearXMax) rawX = ctx.actor.position.x - inwardStepX

    if (nearYBottom) y = ctx.actor.position.y - stepY
    else if (nearYTop) y = ctx.actor.position.y + stepY
    else {
      // Keep a stable escape direction near side walls. Tick-parity flipping
      // causes up/down jitter loops in corners and can starve real actions.
      const upRoom = ctx.mapBounds.maxY - ctx.actor.position.y
      const downRoom = ctx.actor.position.y - ctx.mapBounds.minY
      if (Math.abs(upRoom - downRoom) < 1e-6) {
        y = awayY
      } else {
        y = ctx.actor.position.y + (upRoom > downRoom ? stepY : -stepY)
      }
    }
  }

  const tx = clamp(rawX, ctx.mapBounds.minX + MAP_EDGE.halfCell, ctx.mapBounds.maxX - MAP_EDGE.halfCell)
  const ty = clamp(y, ctx.mapBounds.minY + MAP_EDGE.halfCell, ctx.mapBounds.maxY - MAP_EDGE.halfCell)
  if (Math.hypot(tx - ctx.actor.position.x, ty - ctx.actor.position.y) < MIN_MOVE_DELTA) return null
  return { x: tx, y: ty }
}

/**
 * Straight retreat toward own team's back edge. Preserves Y.
 * Returns null if already within half-cell of the edge.
 */
export function computeRetreatToEdge(ctx: DecisionContext): { x: number; y: number } | null {
  const edgeX = ctx.actor.team === 'left'
    ? ctx.mapBounds.minX + MAP_EDGE.halfCell
    : ctx.mapBounds.maxX - MAP_EDGE.halfCell
  if (Math.abs(edgeX - ctx.actor.position.x) < MIN_MOVE_DELTA * 2) return null
  return { x: edgeX, y: ctx.actor.position.y }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}

