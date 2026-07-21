import { BATTLE_BALANCE } from '../../../config/battle-balance'
import { getBattleSkillDefinition } from '../../../content/skills/basic-skill-catalog'
import type { DecisionAction, DecisionContext, GuardrailResult } from './decision-context'
import { GUARDRAIL, MAP_EDGE, MELEE_RANGE, MIN_MOVE_DELTA, MOVE_STEP, APPROACH_MIN_STAY, APPROACH_STAY_OFFSET } from './decision-constants'

const { criticalHpRatio: CRITICAL_HP_RATIO, earlyTickThreshold: EARLY_TICK_THRESHOLD, earlyFleeHpGate: EARLY_FLEE_HP_GATE, highHpFleeGate: HIGH_HP_FLEE_GATE, criticalHpFarDistance: CRITICAL_HP_FAR_DISTANCE, criticalHpHpAdvantageGap: CRITICAL_HP_ADVANTAGE_GAP, consecutiveDashLimit: CONSECUTIVE_DASH_LIMIT } = GUARDRAIL

/**
 * Validates a DecisionAction against current battle state and remaps
 * invalid actions to the best valid alternative. Includes loop detection,
 * early-flee prevention, and critical-HP fallbacks (no forced map-edge retreat).
 */
export function applyGuardrail(
  ctx: DecisionContext,
  action: DecisionAction,
  recentActions?: string[],
): GuardrailResult {
  const criticalOverride = guardCriticalHp(ctx, action)
  if (criticalOverride) return criticalOverride

  const earlyFleeOverride = guardEarlyFlee(ctx, action)
  if (earlyFleeOverride) return earlyFleeOverride

  const highHpFleeOverride = guardHighHpFlee(ctx, action)
  if (highHpFleeOverride) return highHpFleeOverride

  let result: GuardrailResult
  switch (action.type) {
    case 'basic_attack':
      result = guardBasicAttack(ctx, action)
      break
    case 'cast_skill':
      result = guardCastSkill(ctx, action)
      break
    case 'dodge':
      result = guardDodge(ctx, action)
      break
    case 'dash':
      result = guardDash(ctx, action)
      break
    case 'noop':
      result = { action, rewritten: false }
      break
  }

  if (recentActions && recentActions.length >= 3) {
    const loopBreak = guardLoop(ctx, result.action, recentActions)
    if (loopBreak) return loopBreak
  }

  return result
}

// ── Critical HP: prefer in-range skills / basic attack; never dash to map edge ──

function guardCriticalHp(ctx: DecisionContext, action: DecisionAction): GuardrailResult | null {
  if (ctx.actorHpRatio >= CRITICAL_HP_RATIO) return null
  if (action.type === 'dodge') return null
  if (action.type === 'dash') return null

  if (ctx.distance > CRITICAL_HP_FAR_DISTANCE && ctx.actorHpRatio < ctx.targetHpRatio - CRITICAL_HP_ADVANTAGE_GAP) {
    return {
      action: { type: 'noop', path: action.path + '>guardrail:critical_hp_far' },
      rewritten: true,
      rewriteReason: 'critical_hp_forced_wait',
    }
  }

  const best = ctx.readySkills.filter((s) => s.inRange).sort((a, b) => b.definition.ratio - a.definition.ratio)[0]
  if (best) {
    return {
      action: { type: 'cast_skill', skillId: best.definition.id, path: action.path + '>guardrail:critical_hp_cast' },
      rewritten: true,
      rewriteReason: 'critical_hp_fight_back',
    }
  }
  if (ctx.distance <= MELEE_RANGE) {
    return {
      action: { type: 'basic_attack', path: action.path + '>guardrail:critical_hp_basic' },
      rewritten: true,
      rewriteReason: 'critical_hp_fight_back',
    }
  }
  return null
}

// ── Early flee: prevent flee in first few ticks when HP is still OK ──

function guardEarlyFlee(ctx: DecisionContext, action: DecisionAction): GuardrailResult | null {
  if (action.type !== 'dodge') return null
  if (ctx.tick > EARLY_TICK_THRESHOLD) return null
  if (ctx.actorHpRatio <= EARLY_FLEE_HP_GATE) return null

  return {
    action: { type: 'noop', path: action.path + '>guardrail:no_early_flee' },
    rewritten: true,
    rewriteReason: 'early_flee_blocked',
  }
}

// ── High HP flee: prevent retreat when HP is still healthy ──

function guardHighHpFlee(ctx: DecisionContext, action: DecisionAction): GuardrailResult | null {
  if (action.type !== 'dodge') return null
  if (ctx.actorHpRatio <= HIGH_HP_FLEE_GATE) return null

  const best = ctx.readySkills.filter((s) => s.inRange).sort((a, b) => b.definition.ratio - a.definition.ratio)[0]
  if (best) {
    return {
      action: { type: 'cast_skill', skillId: best.definition.id, path: action.path + '>guardrail:high_hp_no_flee' },
      rewritten: true,
      rewriteReason: 'high_hp_flee_blocked',
    }
  }
  return {
    action: { type: 'noop', path: action.path + '>guardrail:high_hp_no_flee_fallback' },
    rewritten: true,
    rewriteReason: 'high_hp_flee_blocked',
  }
}

// ── Loop detection: break repeated/alternating/low-variety action patterns ──

function guardLoop(
  ctx: DecisionContext,
  currentAction: DecisionAction,
  recentActions: string[],
): GuardrailResult | null {
  const current = actionTypeKey(currentAction)
  const last4 = [...recentActions.slice(-3), current]

  const allSame = last4.length >= 4 && last4.every((a) => a === last4[0])
  if (allSame) {
    return breakLoop(ctx, currentAction, 'repeated_same_action')
  }

  if (last4.length >= 4) {
    const isABAB =
      last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]
    if (isABAB) {
      return breakLoop(ctx, currentAction, 'alternating_loop')
    }
  }

  const uniqueActions = new Set(last4)
  if (last4.length >= 4 && uniqueActions.size <= 2 && recentActions.length >= 6) {
    const last6 = [...recentActions.slice(-5), current]
    const unique6 = new Set(last6)
    if (unique6.size <= 2) {
      return breakLoop(ctx, currentAction, 'low_variety_loop')
    }
  }

  return null
}

function breakLoop(
  ctx: DecisionContext,
  currentAction: DecisionAction,
  reason: string,
): GuardrailResult | null {
  const current = currentAction.type

  if (current !== 'cast_skill') {
    const skill = ctx.readySkills.filter((s) => s.inRange).sort((a, b) => b.definition.ratio - a.definition.ratio)[0]
    if (skill) {
      return {
        action: { type: 'cast_skill', skillId: skill.definition.id, path: currentAction.path + '>break_loop:cast' },
        rewritten: true,
        rewriteReason: reason,
      }
    }
  }

  if (current !== 'basic_attack' && ctx.distance <= MELEE_RANGE) {
    return {
      action: { type: 'basic_attack', path: currentAction.path + '>break_loop:basic' },
      rewritten: true,
      rewriteReason: reason,
    }
  }

  const approach = computeFallbackApproach(ctx)
  if (approach) {
    return {
      action: { type: 'dash', target: approach, path: currentAction.path + '>break_loop:dash' },
      rewritten: true,
      rewriteReason: reason,
    }
  }

  return {
    action: { type: 'noop', path: currentAction.path + '>break_loop:noop' },
    rewritten: true,
    rewriteReason: reason,
  }
}

function actionTypeKey(action: DecisionAction): string {
  if (action.type === 'cast_skill') return `cast:${action.skillId}`
  return action.type
}

// ── Basic action guards (unchanged from prior version) ──

function guardBasicAttack(ctx: DecisionContext, action: DecisionAction): GuardrailResult {
  if (ctx.distance > MELEE_RANGE) {
    const dashTarget = computeFallbackApproach(ctx)
    if (dashTarget) {
      return {
        action: { type: 'dash', target: dashTarget, path: action.path + '>remap:dash_to_melee' },
        rewritten: true,
        rewriteReason: 'basic_attack_out_of_range',
      }
    }
    return {
      action: { type: 'noop', path: action.path + '>remap:noop_cant_reach' },
      rewritten: true,
      rewriteReason: 'basic_attack_out_of_range_no_dash',
    }
  }
  return { action, rewritten: false }
}

function guardCastSkill(ctx: DecisionContext, action: DecisionAction): GuardrailResult {
  if (action.type !== 'cast_skill') return { action, rewritten: false }
  const def = getBattleSkillDefinition(action.skillId)
  if (!def) {
    return {
      action: { type: 'noop', path: action.path + '>remap:unknown_skill' },
      rewritten: true,
      rewriteReason: 'skill_not_found',
    }
  }

  const slot = ctx.actor.skillSlots.find((s) => s.skillId === action.skillId)
  if (slot && slot.cooldownTick > ctx.tick) {
    const alt = ctx.readySkills.filter((s) => s.inRange && s.definition.id !== action.skillId)
    if (alt.length > 0) {
      alt.sort((a, b) => b.definition.ratio - a.definition.ratio)
      return {
        action: { type: 'cast_skill', skillId: alt[0].definition.id, path: action.path + '>remap:swap_cd_skill' },
        rewritten: true,
        rewriteReason: 'skill_on_cooldown',
      }
    }
    if (ctx.distance <= MELEE_RANGE) {
      return {
        action: { type: 'basic_attack', path: action.path + '>remap:basic_cd' },
        rewritten: true,
        rewriteReason: 'skill_on_cooldown_fallback_basic',
      }
    }
    return {
      action: { type: 'noop', path: action.path + '>remap:noop_cd' },
      rewritten: true,
      rewriteReason: 'skill_on_cooldown_no_fallback',
    }
  }

  if (ctx.actor.resources.mp < def.mpCost) {
    if (ctx.distance <= MELEE_RANGE) {
      return {
        action: { type: 'basic_attack', path: action.path + '>remap:basic_no_mp' },
        rewritten: true,
        rewriteReason: 'insufficient_mp',
      }
    }
    return {
      action: { type: 'noop', path: action.path + '>remap:noop_no_mp' },
      rewritten: true,
      rewriteReason: 'insufficient_mp_no_fallback',
    }
  }

  if (ctx.distance > def.range) {
    const dashTarget = computeFallbackApproach(ctx, def.range)
    if (dashTarget) {
      return {
        action: { type: 'dash', target: dashTarget, path: action.path + '>remap:dash_to_range' },
        rewritten: true,
        rewriteReason: 'skill_out_of_range',
      }
    }
    return {
      action: { type: 'noop', path: action.path + '>remap:noop_out_of_range' },
      rewritten: true,
      rewriteReason: 'skill_out_of_range_no_dash',
    }
  }

  return { action, rewritten: false }
}

function guardDodge(ctx: DecisionContext, action: DecisionAction): GuardrailResult {
  if (ctx.actor.resources.stamina < BATTLE_BALANCE.dodgeStaminaCost) {
    if (ctx.distance <= MELEE_RANGE) {
      return {
        action: { type: 'basic_attack', path: action.path + '>remap:basic_no_stamina' },
        rewritten: true,
        rewriteReason: 'insufficient_stamina',
      }
    }
    return {
      action: { type: 'noop', path: action.path + '>remap:noop_no_stamina' },
      rewritten: true,
      rewriteReason: 'insufficient_stamina_no_fallback',
    }
  }
  return { action, rewritten: false }
}

function guardDash(ctx: DecisionContext, action: DecisionAction): GuardrailResult {
  if (action.type !== 'dash') return { action, rewritten: false }
  const movement = ctx.session.movementState[ctx.actor.id]
  const dashCooldownUntilTick = Number(movement?.dashCooldownUntilTick ?? -1)
  const consecutiveDashCount = Number(movement?.consecutiveDashCount ?? 0)

  if (dashCooldownUntilTick >= ctx.tick) {
    return remapDashUnavailable(ctx, action, 'dash_on_cooldown')
  }
  if (consecutiveDashCount >= CONSECUTIVE_DASH_LIMIT) {
    return remapDashUnavailable(ctx, action, 'dash_streak_limit_reached')
  }
  return { action, rewritten: false }
}

/**
 * Remap a dash action to a safe alternative (best in-range skill / basic
 * attack / noop) when dash is unavailable. Exposed so callers outside
 * decision-guardrail (e.g. MapBattleController) can reuse the same fallback
 * policy when dash is blocked by world walkability instead of cooldowns.
 */
export function remapDashToAlternative(
  ctx: DecisionContext,
  action: DecisionAction,
  reason: string,
): GuardrailResult {
  return remapDashUnavailable(ctx, action, reason as 'dash_on_cooldown')
}

function remapDashUnavailable(
  ctx: DecisionContext,
  action: DecisionAction,
  reason: 'dash_on_cooldown' | 'dash_streak_limit_reached' | string,
): GuardrailResult {
  const bestInRangeSkill = ctx.readySkills
    .filter((s) => ctx.distance <= s.definition.range)
    .sort((a, b) => b.definition.ratio - a.definition.ratio)[0]
  if (bestInRangeSkill) {
    return {
      action: {
        type: 'cast_skill',
        skillId: bestInRangeSkill.definition.id,
        path: action.path + '>remap:cast_dash_unavailable',
      },
      rewritten: true,
      rewriteReason: reason,
    }
  }
  if (ctx.distance <= MELEE_RANGE) {
    return {
      action: { type: 'basic_attack', path: action.path + '>remap:basic_dash_unavailable' },
      rewritten: true,
      rewriteReason: reason,
    }
  }
  return {
    action: { type: 'noop', path: action.path + '>remap:noop_dash_unavailable' },
    rewritten: true,
    rewriteReason: reason,
  }
}

function computeFallbackApproach(ctx: DecisionContext, desiredRange?: number): { x: number; y: number } | null {
  const range = desiredRange ?? MELEE_RANGE
  const stayDistance = Math.max(APPROACH_MIN_STAY, range - APPROACH_STAY_OFFSET)
  const tx = ctx.actor.team === 'left'
    ? Math.min(ctx.mapBounds.maxX - MAP_EDGE.halfCell, ctx.target.position.x - stayDistance)
    : Math.max(ctx.mapBounds.minX + MAP_EDGE.halfCell, ctx.target.position.x + stayDistance)
  const ty = ctx.target.position.y
  const dx = tx - ctx.actor.position.x
  const dy = ty - ctx.actor.position.y
  if (Math.hypot(dx, dy) < MIN_MOVE_DELTA) return null
  return { x: tx, y: ty }
}
