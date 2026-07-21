import type { DecisionAction, DecisionContext, TacticalMode } from './decision-context'

/**
 * A single step in a multi-tick action sequence returned by LLM.
 * The engine executes one step per tick until the sequence is consumed or invalidated.
 */
export type SequenceStep = {
  action: DecisionAction
  conditionHint?: string
}

export type ActionSequence = {
  name: string
  steps: SequenceStep[]
  mode: TacticalMode
  createdTick: number
  expireTick: number
  cursor: number
}

export type SequenceInvalidateReason =
  | 'expired'
  | 'consumed'
  | 'mode_changed'
  | 'hp_spike'
  | 'being_controlled'
  | 'target_died'
  | 'forced'

/** Default / max TTL (battle ticks) for an LLM sequence plan; new LLM response replaces the plan. */
const DEFAULT_SEQUENCE_TTL = 128
const MIN_SEQUENCE_TTL = 3
const MAX_SEQUENCE_TTL = 192
/** LLM `sequence` array length (inclusive). */
export const MIN_SEQUENCE_LENGTH = 20
export const MAX_SEQUENCE_LENGTH = 24
const HP_SPIKE_THRESHOLD = 0.15

export class ActionSequenceStore {
  private sequences = new Map<string, ActionSequence>()
  private lastHpRatio = new Map<string, number>()

  /**
   * Register a new multi-step sequence for an actor.
   * Validates length and normalizes TTL.
   */
  register(
    actorId: string,
    name: string,
    steps: SequenceStep[],
    mode: TacticalMode,
    currentTick: number,
    ttlTicks?: number,
  ): boolean {
    if (steps.length < MIN_SEQUENCE_LENGTH || steps.length > MAX_SEQUENCE_LENGTH) return false
    const ttl = Math.max(MIN_SEQUENCE_TTL, Math.min(MAX_SEQUENCE_TTL, ttlTicks ?? DEFAULT_SEQUENCE_TTL))
    this.sequences.set(actorId, {
      name,
      steps,
      mode,
      createdTick: currentTick,
      expireTick: currentTick + ttl,
      cursor: 0,
    })
    return true
  }

  /**
   * Get the next step from the active sequence, or null if no valid sequence exists.
   * Automatically checks for invalidation conditions.
   */
  nextStep(actorId: string, ctx: DecisionContext): { step: SequenceStep; sequenceName: string } | null {
    const seq = this.sequences.get(actorId)
    if (!seq) return null

    const invalidReason = this.checkInvalidation(actorId, seq, ctx)
    if (invalidReason) {
      this.sequences.delete(actorId)
      return null
    }

    if (seq.cursor >= seq.steps.length) {
      this.sequences.delete(actorId)
      return null
    }

    const step = seq.steps[seq.cursor]
    seq.cursor += 1

    if (seq.cursor >= seq.steps.length) {
      this.sequences.delete(actorId)
    }

    return { step, sequenceName: seq.name }
  }

  hasActiveSequence(actorId: string): boolean {
    return this.sequences.has(actorId)
  }

  getActiveSequenceInfo(actorId: string): { name: string; remaining: number; total: number } | null {
    const seq = this.sequences.get(actorId)
    if (!seq) return null
    return {
      name: seq.name,
      remaining: seq.steps.length - seq.cursor,
      total: seq.steps.length,
    }
  }

  invalidate(actorId: string): void {
    this.sequences.delete(actorId)
  }

  updateHpSnapshot(actorId: string, hpRatio: number): void {
    this.lastHpRatio.set(actorId, hpRatio)
  }

  clear(): void {
    this.sequences.clear()
    this.lastHpRatio.clear()
  }

  private checkInvalidation(
    actorId: string,
    seq: ActionSequence,
    ctx: DecisionContext,
  ): SequenceInvalidateReason | null {
    if (ctx.tick > seq.expireTick) return 'expired'
    if (!ctx.target.alive) return 'target_died'
    if (ctx.isControlled) return 'being_controlled'

    const lastHp = this.lastHpRatio.get(actorId)
    if (lastHp != null && ctx.actorHpRatio < lastHp - HP_SPIKE_THRESHOLD) {
      return 'hp_spike'
    }

    return null
  }
}

/**
 * Parse a raw LLM response that contains a multi-step action sequence.
 * Expected format:
 * {
 *   "sequence": [
 *     { "action": "cast_skill", "skillId": "frost_lock" },
 *     { "action": "dash", "moveTargetX": 5, "moveTargetY": 3 },
 *     { "action": "cast_skill", "skillId": "arcane_bolt" }
 *   ],
 *   "name": "freeze_shatter_combo",
 *   "ttlTicks": 128
 * }
 */
export function parseSequenceFromLlm(
  raw: Record<string, unknown>,
  fallbackPath: string,
): { name: string; steps: SequenceStep[]; ttlTicks: number } | null {
  const rawSeq = raw.sequence
  if (
    !Array.isArray(rawSeq) ||
    rawSeq.length < MIN_SEQUENCE_LENGTH ||
    rawSeq.length > MAX_SEQUENCE_LENGTH
  ) {
    return null
  }

  const name = typeof raw.name === 'string' ? raw.name : 'llm_sequence'
  const ttlTicks = typeof raw.ttlTicks === 'number' ? raw.ttlTicks : DEFAULT_SEQUENCE_TTL

  const steps: SequenceStep[] = []
  for (let i = 0; i < rawSeq.length; i++) {
    const item = rawSeq[i]
    if (!item || typeof item !== 'object') continue
    const parsed = parseOneStep(item as Record<string, unknown>, `${fallbackPath}>seq[${i}]`)
    if (parsed) steps.push(parsed)
  }

  if (steps.length < MIN_SEQUENCE_LENGTH) return null
  return { name, steps, ttlTicks }
}

function parseOneStep(raw: Record<string, unknown>, pathPrefix: string): SequenceStep | null {
  const action = normalizeActionString(raw.action)
  if (!action) return null

  switch (action) {
    case 'basic_attack':
      return { action: { type: 'basic_attack', path: pathPrefix + '>basic' } }
    case 'cast_skill': {
      const skillId = typeof raw.skillId === 'string' ? raw.skillId : null
      if (!skillId) return null
      return { action: { type: 'cast_skill', skillId, path: pathPrefix + '>cast' } }
    }
    case 'dash': {
      const x = typeof raw.moveTargetX === 'number' ? raw.moveTargetX : null
      const y = typeof raw.moveTargetY === 'number' ? raw.moveTargetY : null
      if (x == null) return null
      return {
        action: {
          type: 'dash',
          target: { x, y: y ?? 0 },
          moveStep: typeof raw.moveStep === 'number' ? raw.moveStep : undefined,
          path: pathPrefix + '>dash',
        },
      }
    }
    case 'dodge':
      return { action: { type: 'dodge', path: pathPrefix + '>dodge' } }
    default:
      return null
  }
}

const ACTION_ALIASES: Record<string, string> = {
  basic_attack: 'basic_attack',
  attack: 'basic_attack',
  melee: 'basic_attack',
  cast_skill: 'cast_skill',
  cast: 'cast_skill',
  skill: 'cast_skill',
  dash: 'dash',
  move: 'dash',
  dodge: 'dodge',
  evade: 'dodge',
  defend: 'dodge',
  block: 'dodge',
  shield: 'dodge',
}

function normalizeActionString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const lower = raw.trim().toLowerCase()
  return ACTION_ALIASES[lower] ?? null
}
