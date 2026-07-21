/**
 * Behavior tree runtime: depth-first evaluation of selector/sequence/condition/action nodes,
 * metric sampling from the live session, and mapping of matched action leaves to battle commands.
 */
import { getBattleSkillDefinition } from '../../../content/skills/basic-skill-catalog'
import type { BattleEntity } from '../../../domain/entities/battle-entity'
import type { BattleSession } from '../../../domain/entities/battle-session'
import type { BattleCommandWalkContext } from '../../../engine/command-processor'
import { buildBattleCellWalkFilter } from '../../../../map-battle/battleGridMovement'
import { clampDashDestination } from '../../../../map-battle/walkability'
import type {
  BehaviorActionNode,
  BehaviorTreeNode,
  BehaviorTreeState,
} from './types'

type RuntimeDecision = {
  action: 'basic_attack' | 'cast_skill' | 'dash' | 'dodge' | 'flee'
  targetId?: string
  skillId?: string
  metadata?: Record<string, unknown>
}

export type RuntimeContext = {
  session: BattleSession
  actor: BattleEntity
  target: BattleEntity
  tree: BehaviorTreeState
  /**
   * When set (e.g. map battles), dash moveTarget is ray-clamped with the same cell walk filter as
   * {@link resolveBattleDashPosition} so goals are less likely to lie inside blocked cells.
   */
  walk?: BattleCommandWalkContext
}

type EvalResult = {
  matched: boolean
  actionNode: BehaviorActionNode | null
}

/** Euclidean distance threshold treated as “in basic attack range” for metrics and fallback. */
const BASIC_ATTACK_RANGE = 1.6

/** Walk the tree once and return the first executable decision, or a heuristic fallback. */
export function evaluateBehaviorTree(input: RuntimeContext): RuntimeDecision {
  const evaluated = evaluateNode(input.tree.root, input)
  const actionNode = evaluated.matched ? evaluated.actionNode : null
  if (actionNode) {
    const mapped = mapActionNodeToDecision(actionNode, input)
    if (mapped) return mapped
  }
  return heuristicFallbackDecision(input)
}

function evaluateNode(node: BehaviorTreeNode, ctx: RuntimeContext): EvalResult {
  if (node.type === 'condition') {
    return { matched: evalCondition(node.metric, node.operator, node.value, ctx), actionNode: null }
  }

  if (node.type === 'action') {
    return { matched: true, actionNode: node }
  }

  // Sequence: every child must match in order; first propagated action wins.
  if (node.type === 'sequence') {
    for (const child of node.children) {
      const result = evaluateNode(child, ctx)
      if (!result.matched) return { matched: false, actionNode: null }
      if (result.actionNode) return result
    }
    return { matched: true, actionNode: null }
  }

  // Selector (and any other composite with children): first successful subtree wins.
  for (const child of node.children) {
    const result = evaluateNode(child, ctx)
    if (result.matched) return result
  }
  return { matched: false, actionNode: null }
}

/** Turn a matched action leaf into engine-facing metadata; returns null if the action is unusable. */
function mapActionNodeToDecision(node: BehaviorActionNode, ctx: RuntimeContext): RuntimeDecision | null {
  const metadataBase: Record<string, unknown> = {
    btNode: node.id,
    btVersion: ctx.tree.version,
  }

  if (node.action === 'cast_skill') {
    const selectedSkillId = resolveCastSkillId(node, ctx)
    if (!selectedSkillId) return null
    return {
      action: 'cast_skill',
      targetId: ctx.target.id,
      skillId: selectedSkillId,
      metadata: metadataBase,
    }
  }

  if (node.action === 'dash') {
    const dash = computeDashTarget(node, ctx)
    const goal = clampDashGoalWithWalkContext(ctx, { x: dash.targetX, y: dash.targetY })
    return {
      action: 'dash',
      targetId: ctx.target.id,
      metadata: {
        ...metadataBase,
        moveTargetX: goal.x,
        moveTargetY: goal.y,
        ...(dash.moveStep != null ? { moveStep: dash.moveStep } : {}),
      },
    }
  }

  if (node.action === 'basic_attack') {
    return {
      action: 'basic_attack',
      targetId: ctx.target.id,
      metadata: metadataBase,
    }
  }

  if (node.action === 'dodge' || node.action === 'flee') {
    return {
      action: node.action,
      targetId: node.action === 'flee' ? ctx.target.id : undefined,
      metadata: metadataBase,
    }
  }

  return null
}

/** Used when the tree yields no valid mapped action (e.g. cast_skill with no eligible skill). */
function heuristicFallbackDecision(ctx: RuntimeContext): RuntimeDecision {
  const skillId = pickBestReadySkillInRange(ctx.actor, ctx.target, ctx.session.tick)
  if (skillId) {
    return {
      action: 'cast_skill',
      targetId: ctx.target.id,
      skillId,
      metadata: {
        btNode: 'fallback_cast',
        btVersion: ctx.tree.version,
      },
    }
  }
  const distance = calcDistance(ctx.actor, ctx.target)
  if (distance <= BASIC_ATTACK_RANGE) {
    return {
      action: 'basic_attack',
      targetId: ctx.target.id,
      metadata: {
        btNode: 'fallback_basic',
        btVersion: ctx.tree.version,
      },
    }
  }
  const moveStep = 2.2
  const direction = ctx.actor.team === 'left' ? -1 : 1
  const targetX = clamp(
    ctx.target.position.x + direction * 1.4,
    ctx.session.mapBounds.minX + 0.5,
    ctx.session.mapBounds.maxX - 0.5
  )
  const targetY = clamp(
    ctx.target.position.y,
    ctx.session.mapBounds.minY + 0.5,
    ctx.session.mapBounds.maxY - 0.5
  )
  const goal = clampDashGoalWithWalkContext(ctx, { x: targetX, y: targetY })
  return {
    action: 'dash',
    targetId: ctx.target.id,
    metadata: {
      btNode: 'fallback_approach',
      btVersion: ctx.tree.version,
      moveTargetX: goal.x,
      moveTargetY: goal.y,
      moveStep,
    },
  }
}

/** Aligns with engine dash ray clamp (terrain + cannot enter opponent cell). */
function clampDashGoalWithWalkContext(
  ctx: RuntimeContext,
  goal: { x: number; y: number },
): { x: number; y: number } {
  const walk = ctx.walk
  if (!walk) return goal
  const cellWalk = buildBattleCellWalkFilter({
    session: ctx.session,
    moverId: ctx.actor.id,
    walk,
  })
  return clampDashDestination({
    from: ctx.actor.position,
    to: goal,
    mapW: walk.mapW,
    mapH: walk.mapH,
    isWalkable: cellWalk,
  })
}

/** Compare `readMetric` output to `value` (default 0) with `operator` (default >=). */
function evalCondition(
  metric: string,
  operator: string | undefined,
  value: number | undefined,
  ctx: RuntimeContext
): boolean {
  const actual = readMetric(metric, ctx)
  const expected = value ?? 0
  const op = operator ?? '>='
  if (op === '<') return actual < expected
  if (op === '<=') return actual <= expected
  if (op === '>') return actual > expected
  if (op === '>=') return actual >= expected
  if (op === '==') return actual === expected
  if (op === '!=') return actual !== expected
  return actual >= expected
}

/** Numeric features exposed to condition nodes; unknown names fall back to 0. */
function readMetric(metric: string, ctx: RuntimeContext): number {
  const actor = ctx.actor
  const target = ctx.target
  const hpRatio = safeRatio(actor.resources.hp, actor.resources.maxHp)
  const targetHpRatio = safeRatio(target.resources.hp, target.resources.maxHp)
  const distance = calcDistance(actor, target)
  const readySkillSummary = readReadySkillSummary(actor, target, ctx.session.tick, distance)
  const nearEdge = isNearEdge(actor, ctx.session) ? 1 : 0
  const dashSignals = readDashRejectSignals(ctx.session, actor.id)
  const movementState = ctx.session.movementState[actor.id] || {
    consecutiveDashCount: 0,
    dashCooldownUntilTick: -1,
  }

  if (metric === 'hp_ratio') return hpRatio
  if (metric === 'target_hp_ratio') return targetHpRatio
  if (metric === 'distance') return distance
  if (metric === 'hp_disadvantage') return targetHpRatio - hpRatio
  if (metric === 'hp_advantage') return hpRatio - targetHpRatio
  if (metric === 'battle_phase_numeric') return readBattlePhaseNumeric(hpRatio, targetHpRatio)
  if (metric === 'consecutive_losing_trade') return readConsecutiveLosingTrade(ctx.session, actor.id)
  if (metric === 'near_edge') return nearEdge
  // Legacy alias `has_ready_skill` (removed from BehaviorMetric) still resolves here.
  if (metric === 'has_any_ready_skill' || metric === 'has_ready_skill')
    return readySkillSummary.hasAnyReady ? 1 : 0
  if (metric === 'ready_skill_out_of_range') return readySkillSummary.hasReadyOutOfRange ? 1 : 0
  if (metric === 'no_ready_skill_in_range') return readySkillSummary.hasReadyInRange ? 0 : 1
  if (metric === 'basic_in_range') return distance <= BASIC_ATTACK_RANGE ? 1 : 0
  if (metric === 'recent_dash_rejects') return dashSignals.recentDashRejects
  if (metric === 'recent_blocked_rejects') return dashSignals.recentBlockedRejects
  if (metric === 'dash_cooldown_active') return movementState.dashCooldownUntilTick >= ctx.session.tick ? 1 : 0
  if (metric === 'dash_streak_locked') return movementState.consecutiveDashCount >= 3 ? 1 : 0
  return 0
}

/**
 * Count recent damage taken by `actorId` without a newer outgoing damage event from `actorId`
 * (walking backward from the newest events).
 */
function readConsecutiveLosingTrade(session: BattleSession, actorId: string): number {
  const window = session.events.slice(-80)
  let streak = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i]
    if (event.type !== 'damage_applied') continue
    const targetId = String(event.payload.targetId || '')
    const atk = String(event.payload.actorId || '')
    if (atk === actorId && targetId !== actorId) {
      break
    }
    if (targetId === actorId && atk !== actorId) {
      streak += 1
    }
  }
  return streak
}

function readBattlePhaseNumeric(actorHpRatio: number, targetHpRatio: number): number {
  if (actorHpRatio <= 0.3 || targetHpRatio <= 0.3) return 2
  if (actorHpRatio > 0.7 && targetHpRatio > 0.7) return 0
  return 1
}

function readDashRejectSignals(
  session: BattleSession,
  actorId: string
): { recentDashRejects: number; recentBlockedRejects: number } {
  const window = session.events.slice(-80)
  let recentDashRejects = 0
  let recentBlockedRejects = 0
  for (const event of window) {
    if (event.type !== 'command_rejected') continue
    if (String(event.payload.actorId || '') !== actorId) continue
    const reason = String(event.payload.reason || '')
    if (reason === 'dash_streak_limit_reached' || reason === 'dash_on_cooldown') {
      recentDashRejects += 1
    }
    if (reason === 'dash_blocked' || reason === 'dash_blocked_by_walkability') {
      recentBlockedRejects += 1
    }
  }
  return { recentDashRejects, recentBlockedRejects }
}

/** Honor `node.skillId` when legal; otherwise fall back to the best ready skill in range. */
function resolveCastSkillId(node: BehaviorActionNode, ctx: RuntimeContext): string | undefined {
  const requested = node.skillId?.trim()
  if (requested) {
    const slot = ctx.actor.skillSlots.find((item) => item.skillId === requested)
    const def = slot ? getBattleSkillDefinition(requested) : null
    if (
      slot &&
      def &&
      slot.cooldownTick <= ctx.session.tick &&
      ctx.actor.resources.mp >= def.mpCost &&
      calcDistance(ctx.actor, ctx.target) <= def.range
    ) {
      return requested
    }
  }
  return pickBestReadySkillInRange(ctx.actor, ctx.target, ctx.session.tick)
}

/** Highest `ratio` skill that is off cooldown, affordable, and in range. */
function pickBestReadySkillInRange(
  actor: BattleEntity,
  target: BattleEntity,
  tick: number
): string | undefined {
  const distance = calcDistance(actor, target)
  const ready = actor.skillSlots
    .map((slot) => ({
      slot,
      def: getBattleSkillDefinition(slot.skillId),
    }))
    .filter(
      (entry) =>
        entry.def &&
        entry.slot.cooldownTick <= tick &&
        actor.resources.mp >= entry.def.mpCost &&
        distance <= entry.def.range
    )
    .sort((a, b) => {
      if (!a.def || !b.def) return 0
      return b.def.ratio - a.def.ratio
    })
  return ready[0]?.def?.id
}

/** Aggregates ready-skill flags for condition metrics without picking a single id. */
function readReadySkillSummary(
  actor: BattleEntity,
  target: BattleEntity,
  tick: number,
  distance: number
): { hasAnyReady: boolean; hasReadyInRange: boolean; hasReadyOutOfRange: boolean } {
  let hasAnyReady = false
  let hasReadyInRange = false
  for (const slot of actor.skillSlots) {
    const def = getBattleSkillDefinition(slot.skillId)
    if (!def) continue
    const ready = slot.cooldownTick <= tick && actor.resources.mp >= def.mpCost
    if (!ready) continue
    hasAnyReady = true
    if (distance <= def.range) {
      hasReadyInRange = true
    }
  }
  return {
    hasAnyReady,
    hasReadyInRange,
    hasReadyOutOfRange: hasAnyReady && !hasReadyInRange,
  }
}

/** Resolves dash goal from `target` mode and optional `moveStep`, before walkability clamp. */
function computeDashTarget(node: BehaviorActionNode, ctx: RuntimeContext): {
  targetX: number
  targetY: number
  moveStep?: number
} {
  const actor = ctx.actor
  const target = ctx.target
  const bounds = ctx.session.mapBounds
  const step = typeof node.moveStep === 'number' && Number.isFinite(node.moveStep)
    ? clamp(node.moveStep, 0.4, 4.2)
    : undefined
  const targetMode = node.target ?? 'approach'
  const sideDirection = actor.team === 'left' ? 1 : -1

  if (targetMode === 'retreat') {
    const retreatDirection = actor.position.x >= target.position.x ? 1 : -1
    return {
      targetX: clamp(actor.position.x + retreatDirection * (step ?? 2.2), bounds.minX + 0.5, bounds.maxX - 0.5),
      targetY: clamp(actor.position.y, bounds.minY + 0.5, bounds.maxY - 0.5),
      moveStep: step,
    }
  }

  if (targetMode === 'center') {
    return {
      targetX: clamp((bounds.minX + bounds.maxX) * 0.5, bounds.minX + 0.5, bounds.maxX - 0.5),
      targetY: clamp((bounds.minY + bounds.maxY) * 0.5, bounds.minY + 0.5, bounds.maxY - 0.5),
      moveStep: step,
    }
  }

  if (targetMode === 'hold') {
    return {
      targetX: clamp(actor.position.x, bounds.minX + 0.5, bounds.maxX - 0.5),
      targetY: clamp(actor.position.y, bounds.minY + 0.5, bounds.maxY - 0.5),
      moveStep: step,
    }
  }

  return {
    targetX: clamp(target.position.x - sideDirection * 1.3, bounds.minX + 0.5, bounds.maxX - 0.5),
    targetY: clamp(target.position.y, bounds.minY + 0.5, bounds.maxY - 0.5),
    moveStep: step,
  }
}

/** True if the actor is within a small margin of any map edge (for escape heuristics). */
function isNearEdge(actor: BattleEntity, session: BattleSession): boolean {
  const gapLeft = Math.abs(actor.position.x - session.mapBounds.minX)
  const gapRight = Math.abs(session.mapBounds.maxX - actor.position.x)
  const gapTop = Math.abs(actor.position.y - session.mapBounds.minY)
  const gapBottom = Math.abs(session.mapBounds.maxY - actor.position.y)
  return Math.min(gapLeft, gapRight, gapTop, gapBottom) <= 1.1
}

function calcDistance(
  actor: { position: { x: number; y: number } },
  target: { position: { x: number; y: number } }
): number {
  const dx = actor.position.x - target.position.x
  const dy = actor.position.y - target.position.y
  return Math.sqrt(dx * dx + dy * dy)
}

function safeRatio(value: number, max: number): number {
  if (max <= 0) return 1
  return clamp(value / max, 0, 1.2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
