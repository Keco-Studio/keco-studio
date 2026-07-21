import type { BattleEntity } from '../../../domain/entities/battle-entity'
import type { BattleSession } from '../../../domain/entities/battle-session'
import { getBattleSkillDefinition } from '../../../content/skills/basic-skill-catalog'
import { BATTLE_BALANCE } from '../../../config/battle-balance'
import { MELEE_RANGE } from './decision-constants'
import { inferRoleProfile, type RoleProfile } from './role-inference'
import type { StrategyTemplateName } from './strategy-template'
import type { RefreshReason } from './intent-store'
import type { TacticalMode } from './decision-context'

/** Walkable matrix for prompts: walkableRows[rowY][colX] === true → cell (colX, rowY) is walkable. */
export type LlmMapGridSnapshot = {
  width: number
  height: number
  walkableRows: boolean[][]
}

export type LlmEffectPayload = {
  type: string
  remainingTicks: number
  stackRule?: string
}

export type LlmCombatantPayload = {
  id: string
  name: string
  team: string
  position: { x: number; y: number }
  resources: {
    hp: number
    maxHp: number
    mp: number
    maxMp: number
    stamina: number
    maxStamina: number
    rage: number
    maxRage: number
    shield: number
    maxShield: number
  }
  attributes: { atk: number; def: number; spd: number }
  effects: LlmEffectPayload[]
  roleProfile: RoleProfile
  skills: SkillDetail[]
}

export type LlmOutputContractPayload = {
  /** One HTTP round-trip to the LLM is often several seconds; plan multiple steps in one JSON. */
  oneRequestCovers: string
  /** Engine accepts 20–24 steps for `sequence` (ActionSequenceStore). */
  sequenceSteps: { min: number; max: number }
  /** Clamped to 3–192 in engine; default 128. New LLM response replaces the prior sequence. */
  ttlTicksSuggest: { min: number; max: number }
}

export type StructuredLlmPayload = {
  meta: {
    tick: number
    phase: string
    battleId?: string
    decisionRefreshReason: string
    currentIntent: string
    memorySummary: string
    recentEventsSummary?: string
    outputContract: LlmOutputContractPayload
  }
  map: {
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
    coordinateSystem: string
    grid?: LlmMapGridSnapshot
  }
  actor: LlmCombatantPayload
  target: LlmCombatantPayload
  relative: {
    distance: number
    actorHpRatio: number
    targetHpRatio: number
  }
  battleRules: BattleRulesPayload
  availableActions: string[]
  availableStrategyTemplates: StrategyTemplateName[]
}

type SkillDetail = {
  id: string
  name: string
  category: string
  ratio: number
  mpCost: number
  range: number
  cooldownTicks: number
  remainingCooldown: number
  canCast: boolean
  inRange: boolean
  effectHint: string
}

type BattleRulesPayload = {
  basicAttackRange: number
  dodgeStaminaCost: number
  dodgeEvadeChance: number
  mapBounds: { minX: number; maxX: number; minY: number; maxY: number }
}

const ALL_TEMPLATES: StrategyTemplateName[] = [
  'opening_probe', 'pressure_chase', 'control_chain', 'burst_window',
  'kite_cycle', 'retreat_edge', 'safe_trade', 'guerrilla_warfare', 'bait_and_punish',
]

const COORDINATE_SYSTEM_NOTE =
  'Continuous coordinates align with battle-core: float positions; grid cells use integer (colX,rowY). map.grid.walkableRows[rowY][colX] matches isWalkable(colX,rowY). Dash targets are clamped server-side to walkable ray.'

export function buildStructuredPayload(input: {
  session: BattleSession
  actor: BattleEntity
  target: BattleEntity
  refreshReason: RefreshReason | string
  currentIntent: TacticalMode | string
  memorySummary: string
  battleId?: string
  recentEventsSummary?: string
  mapGrid?: LlmMapGridSnapshot
}): StructuredLlmPayload {
  const { session, actor, target } = input
  const distance = Math.hypot(
    actor.position.x - target.position.x,
    actor.position.y - target.position.y,
  )
  const roundedDist = Math.round(distance * 100) / 100
  const actorHpRatio =
    actor.resources.maxHp > 0 ? Math.round((actor.resources.hp / actor.resources.maxHp) * 100) / 100 : 1
  const targetHpRatio =
    target.resources.maxHp > 0 ? Math.round((target.resources.hp / target.resources.maxHp) * 100) / 100 : 1

  return {
    meta: {
      tick: session.tick,
      phase: session.phase,
      ...(input.battleId ? { battleId: input.battleId } : {}),
      decisionRefreshReason: String(input.refreshReason),
      currentIntent: String(input.currentIntent),
      memorySummary: input.memorySummary,
      ...(input.recentEventsSummary ? { recentEventsSummary: input.recentEventsSummary } : {}),
      outputContract: {
        oneRequestCovers:
          'One model call may take many seconds. Prefer a 20-24 step `sequence` and set `ttlTicks` to 128 (engine default). When a new response arrives, the prior sequence is discarded. Avoid returning only one bare `action` unless the situation is trivial.',
        sequenceSteps: { min: 20, max: 24 },
        ttlTicksSuggest: { min: 128, max: 128 },
      },
    },
    map: {
      bounds: { ...session.mapBounds },
      coordinateSystem: COORDINATE_SYSTEM_NOTE,
      ...(input.mapGrid ? { grid: input.mapGrid } : {}),
    },
    actor: buildCombatantPayload(actor, session.tick, roundedDist),
    target: buildCombatantPayload(target, session.tick, roundedDist),
    relative: {
      distance: roundedDist,
      actorHpRatio,
      targetHpRatio,
    },
    battleRules: {
      basicAttackRange: MELEE_RANGE,
      dodgeStaminaCost: BATTLE_BALANCE.dodgeStaminaCost,
      dodgeEvadeChance: BATTLE_BALANCE.dodgeEvadeChance,
      mapBounds: session.mapBounds,
    },
    availableActions: ['basic_attack', 'cast_skill', 'dash', 'dodge', 'flee'],
    availableStrategyTemplates: ALL_TEMPLATES,
  }
}

function buildCombatantPayload(
  self: BattleEntity,
  currentTick: number,
  distanceToOpponent: number,
): LlmCombatantPayload {
  const dist = distanceToOpponent
  return {
    id: self.id,
    name: self.name,
    team: self.team,
    position: {
      x: Math.round(self.position.x * 100) / 100,
      y: Math.round(self.position.y * 100) / 100,
    },
    resources: {
      hp: self.resources.hp,
      maxHp: self.resources.maxHp,
      mp: self.resources.mp,
      maxMp: self.resources.maxMp,
      stamina: self.resources.stamina,
      maxStamina: self.resources.maxStamina,
      rage: self.resources.rage,
      maxRage: self.resources.maxRage,
      shield: self.resources.shield,
      maxShield: self.resources.maxShield,
    },
    attributes: { atk: self.atk, def: self.def, spd: self.spd },
    effects: self.effects.map((e) => ({
      type: e.effectType,
      remainingTicks: e.remainingTick,
      stackRule: e.stackRule,
    })),
    roleProfile: inferRoleProfile(self),
    skills: buildSkillDetails(self, currentTick, dist),
  }
}

export function buildSystemPrompt(): string {
  return [
    'You are a tactical battle AI. Output ONLY valid JSON, no extra text.',
    '',
    'LATENCY / PLANNING: Each HTTP call to you may take many seconds. meta.outputContract explains it: one response must amortize that cost — prefer style (A) with 20–24 steps so the battle can consume many ticks from one JSON.',
    '',
    'INPUT you receive includes:',
    '- meta: tick, phase, battleId?, decisionRefreshReason, currentIntent (engine tactical mode: retreat | finish | kite | trade — retreat only when low HP, close, and lower HP% than target to avoid both sides fleeing), memorySummary, meta.outputContract (sequence length + ttlTicks guidance), optional recentEventsSummary (when present: recent windowHpLost totals plus compact damage_applied / shield_broken lines)',
    '- map.bounds and optional map.grid.walkableRows[rowY][colX] (true = walkable); use it to avoid suggesting paths through blocked cells',
    '- actor / target: position, resources, attributes, effects, roleProfile, skills (with canCast, inRange, cooldowns)',
    '- relative.distance and HP ratios',
    '',
    'OUTPUT — choose ONE style:',
    '',
    '(A) Multi-step sequence (DEFAULT — use whenever combat is not trivial), exactly 20–24 steps (engine requirement; fewer or more are rejected), one step consumed each time this actor gets a turn:',
    '{',
    '  "name": "<short combo name>",',
    '  "sequence": [',
    '    ... exactly 20 to 24 objects; mix dash (with moveTargetX/Y), cast_skill (skillId from actor.skills), basic_attack, dodge as appropriate ...',
    '  ],',
    '  "ttlTicks": 128,',
    '  "reasoning": "<1-sentence explanation>"',
    '}',
    'Use ttlTicks: 128 (engine default; max plan window 192 ticks). A new LLM response replaces the previous plan.',
    '',
    '(B) Single-tick intent (only for very simple micro-adjustments):',
    '{',
    '  "intent": "move_and_act | cast_only | move_only | dodge",',
    '  "move": { "targetX": 5.5, "targetY": 3.0 },',
    '  "action": { "type": "basic_attack | cast_skill | dodge | none", "skillId": "<when cast_skill>" },',
    '  "priority": "move_first | act_first",',
    '  "ttlTicks": 128,',
    '  "reasoning": "..."',
    '}',
    'Use priority move_first to dash then attack/cast; act_first to strike then reposition. Server expands this into dash/skill commands.',
    '',
    '(C) Legacy single action (last resort): top-level "action": "cast_skill" with "skillId", or "dash" with metadata.moveTargetX/Y.',
    '',
    'Sequence step fields:',
    '- "action": "basic_attack" | "cast_skill" | "dash" | "dodge"',
    '- "skillId": required if action="cast_skill"',
    '- "moveTargetX", "moveTargetY": required if action="dash" — goal position in continuous map coords (not teleport); each tick the engine advances one step along the shortest *walkable grid path* toward that goal (same as metadata.moveTargetX/Y on a lone dash).',
    '',
    'Rules:',
    '- Align with meta.currentIntent when it conflicts with a greedy plan: retreat → prioritize dodge/dash away; finish → pressure/burst; kite → keep spacing while casting; trade → measured exchanges.',
    `- basic_attack range is ${MELEE_RANGE}; if distance > ${MELEE_RANGE}, dash into range first`,
    '- cast_skill requires: skill ready, enough MP, target in range',
    '- dodge costs stamina and grants a short evade window',
    '- If HP critically low, prefer retreat/dodge sequences; invalid moves are clamped server-side',
    '- ALWAYS plan: out of range → dash toward valid walkable target THEN cast',
    '- Avoid repeating the same move direction every tick; if movement was blocked or made no progress, choose a different reachable target cell',
    '- Prefer dynamic adaptation from current context and memorySummary; do not output fixed hardcoded loops',
    '',
    'Strategy template names (for context): opening_probe, pressure_chase, control_chain, burst_window, kite_cycle, retreat_edge, safe_trade, guerrilla_warfare, bait_and_punish.',
  ].join('\n')
}

function buildSkillDetails(
  entity: BattleEntity,
  currentTick: number,
  distance: number,
): SkillDetail[] {
  return entity.skillSlots.map((slot) => {
    const def = getBattleSkillDefinition(slot.skillId)
    const remainingCd = Math.max(0, slot.cooldownTick - currentTick)
    const canCast = !!def && remainingCd === 0 && entity.resources.mp >= (def?.mpCost ?? 0)
    const inRange = !!def && distance <= def.range
    return {
      id: slot.skillId,
      name: def?.name ?? slot.skillId,
      category: def?.category ?? 'unknown',
      ratio: def?.ratio ?? 0,
      mpCost: def?.mpCost ?? 0,
      range: def?.range ?? 0,
      cooldownTicks: def?.cooldownTicks ?? 0,
      remainingCooldown: remainingCd,
      canCast,
      inRange,
      effectHint: buildEffectHint(def),
    }
  })
}

function buildEffectHint(def: ReturnType<typeof getBattleSkillDefinition>): string {
  if (!def) return 'unknown'
  const parts: string[] = [`dmg:${def.ratio}x`]
  if (def.applyFreezeTicks) parts.push(`freeze:${def.applyFreezeTicks}t`)
  if (def.shatterBonusRatio) parts.push(`shatter:+${def.shatterBonusRatio}x`)
  if (def.consumeFreezeOnHit) parts.push('consumes_freeze')
  return parts.join(', ')
}
