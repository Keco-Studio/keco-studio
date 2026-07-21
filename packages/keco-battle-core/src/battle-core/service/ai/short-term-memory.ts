/**
 * Short-term (single-battle) memory: built from the tail of `session.events` each time the LLM path runs.
 * Cross-battle BT persistence lives in `long-term-bt-memory.ts`.
 */
import type { BattleSession } from '../../domain/entities/battle-session'
import type { BattleEvent } from '../../domain/types/event-types'

export type ShortTermMemory = {
  actorId: string
  targetId: string
  windowSize: number
  recentEvents: BattleEvent[]
  recentActionSummary: string[]
  recentCombatOutcomeSummary: string[]
  recentRejectReasons: Record<string, number>
  /** `maxHp - hp` at decision time (0 = full). Not window damage. */
  actorMissingHpFromMax: number
  targetMissingHpFromMax: number
  /** Sum of `damage_applied.payload.damage` where this entity is the victim, within `recentEvents` only. */
  actorHpLostInWindow: number
  targetHpLostInWindow: number
}

/** Max executed-action lines merged into LLM `memorySummary` (after scanning recent events). */
export const MEMORY_SUMMARY_ACTION_LIMIT = 20

/** Max combat outcome lines merged into `recentEventsSummary` / prompt text. */
export const MEMORY_SUMMARY_OUTCOME_LIMIT = 20

function numPayload(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Compact text for `meta.recentEventsSummary` when the caller does not override it.
 * Omits when there is no damage/outcome signal in the window.
 */
export function memoryDerivedRecentEventsSummary(memory: ShortTermMemory): string | undefined {
  const chunks: string[] = []
  if (memory.actorHpLostInWindow > 0 || memory.targetHpLostInWindow > 0) {
    chunks.push(
      `windowHpLost:${memory.actorId}=${memory.actorHpLostInWindow},${memory.targetId}=${memory.targetHpLostInWindow}`
    )
  }
  if (memory.recentCombatOutcomeSummary.length > 0) {
    chunks.push(memory.recentCombatOutcomeSummary.join('/'))
  }
  if (chunks.length === 0) return undefined
  const joined = chunks.join(' | ')
  return joined.length > 900 ? joined.slice(-900) : joined
}

export function buildShortTermMemory(
  session: BattleSession,
  actorId: string,
  /** Recent raw events window; widen when fights emit many non-action events between strikes */
  windowSize = 200
): ShortTermMemory {
  const actor = session.left.id === actorId ? session.left : session.right
  const target = actor.id === session.left.id ? session.right : session.left
  const events = session.events.slice(-Math.max(1, windowSize))
  const rejectReasons: Record<string, number> = {}
  const actionSummary: string[] = []
  const outcomeLines: string[] = []
  let actorHpLostInWindow = 0
  let targetHpLostInWindow = 0

  for (const event of events) {
    if (event.type === 'command_rejected') {
      const reason = String(event.payload.reason || 'unknown')
      rejectReasons[reason] = (rejectReasons[reason] || 0) + 1
    }
    if (event.type === 'action_executed') {
      const action = String(event.payload.action || 'unknown')
      const who = String(event.payload.actorId || 'unknown')
      actionSummary.push(`${who}:${action}@${event.tick}`)
    }
    if (event.type === 'damage_applied') {
      const tgt = String(event.payload.targetId || '')
      const dmg = numPayload(event.payload.damage)
      if (tgt === actor.id) actorHpLostInWindow += dmg
      if (tgt === target.id) targetHpLostInWindow += dmg
      const src = String(event.payload.actorId || '?')
      const raw = numPayload(event.payload.rawDamage)
      const shield = numPayload(event.payload.shieldAbsorbed)
      outcomeLines.push(`dmg:${src}->${tgt}:hp=${dmg},raw=${raw},sh=${shield}@${event.tick}`)
    }
    if (event.type === 'shield_broken') {
      const src = String(event.payload.actorId || '?')
      const tgt = String(event.payload.targetId || '?')
      const absorbed = numPayload(event.payload.absorbed)
      outcomeLines.push(`shieldBreak:${src}->${tgt}:abs=${absorbed}@${event.tick}`)
    }
  }

  const actorMissingHpFromMax = Math.max(0, actor.resources.maxHp - actor.resources.hp)
  const targetMissingHpFromMax = Math.max(0, target.resources.maxHp - target.resources.hp)

  return {
    actorId: actor.id,
    targetId: target.id,
    windowSize,
    recentEvents: events,
    recentActionSummary: actionSummary.slice(-MEMORY_SUMMARY_ACTION_LIMIT),
    recentCombatOutcomeSummary: outcomeLines.slice(-MEMORY_SUMMARY_OUTCOME_LIMIT),
    recentRejectReasons: rejectReasons,
    actorMissingHpFromMax,
    targetMissingHpFromMax,
    actorHpLostInWindow,
    targetHpLostInWindow
  }
}
