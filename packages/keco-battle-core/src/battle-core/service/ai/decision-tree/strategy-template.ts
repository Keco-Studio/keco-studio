import { BATTLE_BALANCE } from '../../../config/battle-balance'
import type { DecisionAction, DecisionContext } from './decision-context'
import { KITE_EXTRA_RANGE, MELEE_RANGE, MOVE_STEP } from './decision-constants'
import {
  computeApproach,
  computeKiteRetreat,
  pickBestInRange,
  pickByCategoryInRange,
} from './decision-helpers'
import type { InferredRole } from './role-inference'

export type StrategyTemplateName =
  | 'opening_probe'
  | 'pressure_chase'
  | 'control_chain'
  | 'burst_window'
  | 'kite_cycle'
  | 'retreat_edge'
  | 'safe_trade'
  | 'guerrilla_warfare'
  | 'bait_and_punish'

const CONTROL_TARGET_HP_GATE = 0.15
const FINISH_HP_GATE = 0.2
const SAFE_TRADE_DEFEND_HP = 0.5
const GUERRILLA_RETREAT_HP = 0.25
const OPENING_PROBE_SLACK = 0.2

export function defaultTemplateForRole(role: InferredRole): StrategyTemplateName {
  switch (role) {
    case 'mage': return 'control_chain'
    case 'archer': return 'kite_cycle'
    case 'assassin': return 'burst_window'
    case 'tank': return 'safe_trade'
    case 'healer': return 'kite_cycle'
    case 'hero': return 'pressure_chase'
  }
}

/**
 * Execute a named strategy template. Returns a DecisionAction with the
 * template's decision-path prefix. Template logic is deterministic; only
 * the tactical trees should fall back to `selectAction` for mode-driven
 * decisions.
 */
export function executeStrategyTemplate(
  template: StrategyTemplateName,
  ctx: DecisionContext,
  phaseTick?: number,
): DecisionAction {
  switch (template) {
    case 'opening_probe': return openingProbe(ctx)
    case 'pressure_chase': return pressureChase(ctx)
    case 'control_chain': return controlChain(ctx)
    case 'burst_window': return burstWindow(ctx)
    case 'kite_cycle': return kiteCycle(ctx)
    case 'retreat_edge': return safeTrade(ctx)
    case 'safe_trade': return safeTrade(ctx)
    case 'guerrilla_warfare': return guerrillaWarfare(ctx, phaseTick ?? 0)
    case 'bait_and_punish': return baitAndPunish(ctx, phaseTick ?? 0)
  }
}

function openingProbe(ctx: DecisionContext): DecisionAction {
  if (ctx.distance <= MELEE_RANGE + OPENING_PROBE_SLACK) {
    return { type: 'basic_attack', path: 'tpl:opening_probe>basic' }
  }
  const approach = computeApproach(ctx, MELEE_RANGE)
  if (approach) return { type: 'dash', target: approach, path: 'tpl:opening_probe>dash_approach' }
  return { type: 'noop', path: 'tpl:opening_probe>noop' }
}

function pressureChase(ctx: DecisionContext): DecisionAction {
  const best = pickBestInRange(ctx)
  if (best) return { type: 'cast_skill', skillId: best.definition.id, path: 'tpl:pressure_chase>cast' }
  if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: 'tpl:pressure_chase>basic' }
  const approach = computeApproach(ctx, MELEE_RANGE)
  if (approach) return { type: 'dash', target: approach, moveStep: MOVE_STEP.pressureChase, path: 'tpl:pressure_chase>dash_close' }
  return { type: 'basic_attack', path: 'tpl:pressure_chase>basic_fallback' }
}

function controlChain(ctx: DecisionContext): DecisionAction {
  const control = pickByCategoryInRange(ctx, 'control')
  if (control && ctx.targetHpRatio > CONTROL_TARGET_HP_GATE) {
    return { type: 'cast_skill', skillId: control.definition.id, path: 'tpl:control_chain>cast_control' }
  }
  const burst = pickByCategoryInRange(ctx, 'burst')
  if (burst) {
    return { type: 'cast_skill', skillId: burst.definition.id, path: 'tpl:control_chain>cast_burst' }
  }
  const any = pickBestInRange(ctx)
  if (any) return { type: 'cast_skill', skillId: any.definition.id, path: 'tpl:control_chain>cast_any' }
  const approach = computeApproach(ctx, ctx.preferredRange)
  if (approach) return { type: 'dash', target: approach, path: 'tpl:control_chain>dash_to_range' }
  return { type: 'noop', path: 'tpl:control_chain>noop' }
}

function burstWindow(ctx: DecisionContext): DecisionAction {
  const burst = pickByCategoryInRange(ctx, 'burst')
  if (burst) {
    return { type: 'cast_skill', skillId: burst.definition.id, path: 'tpl:burst_window>cast_burst' }
  }
  const execute = pickByCategoryInRange(ctx, 'execute')
  if (execute) {
    return { type: 'cast_skill', skillId: execute.definition.id, path: 'tpl:burst_window>cast_execute' }
  }
  const best = pickBestInRange(ctx)
  if (best) return { type: 'cast_skill', skillId: best.definition.id, path: 'tpl:burst_window>cast_best' }
  if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: 'tpl:burst_window>basic' }
  const approach = computeApproach(ctx, MELEE_RANGE)
  if (approach) return { type: 'dash', target: approach, moveStep: MOVE_STEP.burstClose, path: 'tpl:burst_window>dash_close' }
  return { type: 'noop', path: 'tpl:burst_window>noop' }
}

function kiteCycle(ctx: DecisionContext): DecisionAction {
  const kiteTooClose = Math.max(MELEE_RANGE + KITE_EXTRA_RANGE, ctx.preferredRange - KITE_EXTRA_RANGE)
  if (ctx.distance < kiteTooClose) {
    const retreat = computeKiteRetreat(ctx)
    if (retreat) return { type: 'dash', target: retreat, moveStep: MOVE_STEP.kiteBack, path: 'tpl:kite_cycle>dash_back' }
  }
  const control = pickByCategoryInRange(ctx, 'control')
  if (control && ctx.targetHpRatio > CONTROL_TARGET_HP_GATE) {
    return { type: 'cast_skill', skillId: control.definition.id, path: 'tpl:kite_cycle>cast_control' }
  }
  const burst = pickByCategoryInRange(ctx, 'burst')
  if (burst) {
    return { type: 'cast_skill', skillId: burst.definition.id, path: 'tpl:kite_cycle>cast_burst' }
  }
  const any = pickBestInRange(ctx)
  if (any) return { type: 'cast_skill', skillId: any.definition.id, path: 'tpl:kite_cycle>cast_any' }
  if (ctx.distance > ctx.preferredRange + 0.5) {
    const approach = computeApproach(ctx, ctx.preferredRange)
    if (approach) return { type: 'dash', target: approach, path: 'tpl:kite_cycle>dash_to_range' }
  }
  if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: 'tpl:kite_cycle>basic' }
  return { type: 'noop', path: 'tpl:kite_cycle>noop' }
}

function safeTrade(ctx: DecisionContext): DecisionAction {
  if (ctx.actorHpRatio < SAFE_TRADE_DEFEND_HP && ctx.actor.resources.stamina >= BATTLE_BALANCE.dodgeStaminaCost) {
    return { type: 'dodge', path: 'tpl:safe_trade>dodge' }
  }
  const best = pickBestInRange(ctx)
  if (best) return { type: 'cast_skill', skillId: best.definition.id, path: 'tpl:safe_trade>cast' }
  if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: 'tpl:safe_trade>basic' }
  const approach = computeApproach(ctx, ctx.preferredRange)
  if (approach) return { type: 'dash', target: approach, path: 'tpl:safe_trade>dash_approach' }
  return { type: 'noop', path: 'tpl:safe_trade>noop' }
}

/**
 * Guerrilla warfare: 6-tick phase cycle.
 * Phase 0-1: approach / poke
 * Phase 2-3: retreat / kite
 * Phase 4-5: burst if window, else hold
 */
function guerrillaWarfare(ctx: DecisionContext, phaseTick: number): DecisionAction {
  const phase = phaseTick % 6

  if (ctx.targetHpRatio <= FINISH_HP_GATE) return pressureChase(ctx)
  if (ctx.actorHpRatio <= GUERRILLA_RETREAT_HP) return safeTrade(ctx)

  if (phase <= 1) {
    const best = pickBestInRange(ctx)
    if (best) return { type: 'cast_skill', skillId: best.definition.id, path: `tpl:guerrilla[${phase}]>poke` }
    const approach = computeApproach(ctx, ctx.preferredRange)
    if (approach) return { type: 'dash', target: approach, path: `tpl:guerrilla[${phase}]>dash_in` }
    if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: `tpl:guerrilla[${phase}]>basic` }
    return { type: 'noop', path: `tpl:guerrilla[${phase}]>noop` }
  }

  if (phase <= 3) {
    const control = pickByCategoryInRange(ctx, 'control')
    if (control) {
      return { type: 'cast_skill', skillId: control.definition.id, path: `tpl:guerrilla[${phase}]>control` }
    }
    const best = pickBestInRange(ctx)
    if (best) return { type: 'cast_skill', skillId: best.definition.id, path: `tpl:guerrilla[${phase}]>cast` }
    return { type: 'noop', path: `tpl:guerrilla[${phase}]>hold` }
  }

  const burst = pickByCategoryInRange(ctx, 'burst')
  if (burst) {
    return { type: 'cast_skill', skillId: burst.definition.id, path: `tpl:guerrilla[${phase}]>burst` }
  }
  const best = pickBestInRange(ctx)
  if (best) return { type: 'cast_skill', skillId: best.definition.id, path: `tpl:guerrilla[${phase}]>poke` }
  return { type: 'noop', path: `tpl:guerrilla[${phase}]>hold_fallback` }
}

/**
 * Bait and punish: 4-tick phase cycle.
 * Phase 0: retreat / bait
 * Phase 1: hold / absorb
 * Phase 2-3: counter-attack
 */
function baitAndPunish(ctx: DecisionContext, phaseTick: number): DecisionAction {
  const phase = phaseTick % 4

  if (ctx.targetHpRatio <= FINISH_HP_GATE) return pressureChase(ctx)

  if (phase === 0) {
    return { type: 'noop', path: 'tpl:bait[0]>bait_hold' }
  }

  if (phase === 1) {
    return { type: 'noop', path: 'tpl:bait[1]>absorb' }
  }

  const burst = pickByCategoryInRange(ctx, 'burst')
  if (burst) {
    return { type: 'cast_skill', skillId: burst.definition.id, path: `tpl:bait[${phase}]>counter_burst` }
  }
  const best = pickBestInRange(ctx)
  if (best) return { type: 'cast_skill', skillId: best.definition.id, path: `tpl:bait[${phase}]>counter_cast` }
  if (ctx.distance <= MELEE_RANGE) return { type: 'basic_attack', path: `tpl:bait[${phase}]>counter_basic` }
  const approach = computeApproach(ctx, MELEE_RANGE)
  if (approach) return { type: 'dash', target: approach, moveStep: MOVE_STEP.burstClose, path: `tpl:bait[${phase}]>counter_dash` }
  return { type: 'noop', path: `tpl:bait[${phase}]>noop` }
}
