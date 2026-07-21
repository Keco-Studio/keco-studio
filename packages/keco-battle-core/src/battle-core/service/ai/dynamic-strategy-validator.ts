import { newId as uuidv4 } from '../../util/id'
import type { BattleSession } from '../../domain/entities/battle-session'
import type { BattleCommand } from '../../domain/types/command-types'
import { getBattleSkillDefinition } from '../../content/skills/basic-skill-catalog'
import type { RawBattleDecision } from './auto-decision-engine'

/**
 * Expands spec-style `{ intent, move, action, priority }` into legacy `action` or `sequence`
 * so existing enqueue + sequence parsing keep working.
 */
export function expandIntentStyleDecision(
  raw: RawBattleDecision | Record<string, unknown> | null | undefined,
): RawBattleDecision | null {
  if (raw == null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  if (Array.isArray(r.sequence) && r.sequence.length > 0) {
    return raw as RawBattleDecision
  }

  if (typeof r.action === 'string' && r.action.length > 0 && typeof r.intent !== 'string') {
    return raw as RawBattleDecision
  }

  const intent = typeof r.intent === 'string' ? r.intent.trim().toLowerCase() : ''
  const ttlTicks = typeof r.ttlTicks === 'number' && Number.isFinite(r.ttlTicks) ? r.ttlTicks : 6
  const comboName = typeof r.name === 'string' ? r.name : 'intent_combo'
  const priority = r.priority === 'act_first' ? 'act_first' : 'move_first'

  const move = r.move && typeof r.move === 'object' ? (r.move as Record<string, unknown>) : null
  const moveTx = move && typeof move.targetX === 'number' && Number.isFinite(move.targetX) ? move.targetX : null
  const moveTy = move && typeof move.targetY === 'number' && Number.isFinite(move.targetY) ? move.targetY : null

  const actionObj = r.action && typeof r.action === 'object' ? (r.action as Record<string, unknown>) : null
  let actType = actionObj && typeof actionObj.type === 'string' ? actionObj.type.trim().toLowerCase() : ''
  if (actType === '' || actType === 'none') actType = 'none'
  const skillId = actionObj && typeof actionObj.skillId === 'string' ? actionObj.skillId : ''

  const dashStep =
    moveTx != null
      ? { action: 'dash', moveTargetX: moveTx, moveTargetY: moveTy ?? 0 }
      : null

  if (intent === 'defend' || actType === 'defend') {
    return { action: 'dodge', ttlTicks }
  }
  if (intent === 'dodge' || actType === 'dodge') {
    return { action: 'dodge', ttlTicks }
  }

  if (intent === 'move_only') {
    if (moveTx != null) {
      return { action: 'dash', ttlTicks, metadata: { moveTargetX: moveTx, moveTargetY: moveTy ?? 0 } }
    }
    return raw as RawBattleDecision
  }

  if (intent === 'cast_only') {
    if (actType === 'cast_skill' && skillId) return { action: 'cast_skill', skillId, ttlTicks }
    if (actType === 'basic_attack') return { action: 'basic_attack', ttlTicks }
    return raw as RawBattleDecision
  }

  if (dashStep && (actType === 'cast_skill' || actType === 'basic_attack')) {
    if (actType === 'cast_skill' && skillId) {
      if (priority === 'act_first') {
        return {
          name: comboName,
          sequence: [{ action: 'cast_skill', skillId }, dashStep],
          ttlTicks,
        } as RawBattleDecision
      }
      return {
        name: comboName,
        sequence: [dashStep, { action: 'cast_skill', skillId }],
        ttlTicks,
      } as RawBattleDecision
    }
    if (actType === 'basic_attack') {
      if (priority === 'act_first') {
        return {
          name: comboName,
          sequence: [{ action: 'basic_attack' }, dashStep],
          ttlTicks,
        } as RawBattleDecision
      }
      return {
        name: comboName,
        sequence: [dashStep, { action: 'basic_attack' }],
        ttlTicks,
      } as RawBattleDecision
    }
  }

  if (dashStep && actType === 'none') {
    return { action: 'dash', ttlTicks, metadata: { moveTargetX: moveTx!, moveTargetY: moveTy ?? 0 } }
  }

  return raw as RawBattleDecision
}

export type ValidationResult = {
  ok: boolean
  command?: BattleCommand
  reason?: string
}

export function normalizeDecisionToCommand(input: {
  session: BattleSession
  actorId: string
  executeAtTick: number
  rawDecision: RawBattleDecision | null
}): ValidationResult {
  const actor = getActor(input.session, input.actorId)
  const target = getOpponent(input.session, input.actorId)
  if (!actor || !target) {
    return {
      ok: false,
      reason: 'actor_or_target_missing'
    }
  }

  const expanded = expandIntentStyleDecision(input.rawDecision)

  if (!expanded?.action) {
    return {
      ok: false,
      reason: 'empty_decision'
    }
  }

  const action = String(expanded.action)
  if (!isAllowedAction(action)) {
    return {
      ok: false,
      reason: 'invalid_action'
    }
  }

  if (action === 'dash') {
    const downgraded = remapUnsafeDash(input.session, actor.id, expanded)
    if (downgraded) {
      return normalizeDecisionToCommand({
        ...input,
        rawDecision: downgraded,
      })
    }
  }

  if (action === 'cast_skill') {
    const skillId = String(expanded.skillId || '')
    if (!skillId) {
      return {
        ok: false,
        reason: 'missing_skill'
      }
    }
    const slot = actor.skillSlots.find((item) => item.skillId === skillId)
    const skill = getBattleSkillDefinition(skillId)
    if (!slot || !skill) {
      return {
        ok: false,
        reason: 'skill_not_equipped_or_missing'
      }
    }
    const distance = getDistance(actor, target)
    if (slot.cooldownTick > input.session.tick || actor.resources.mp < skill.mpCost || distance > skill.range) {
      return {
        ok: false,
        reason: 'skill_not_ready'
      }
    }
    return {
      ok: true,
      command: buildCommand(
        input.session.id,
        actor.id,
        input.executeAtTick,
        'cast_skill',
        target.id,
        skill.id,
        sanitizeMetadata(expanded.metadata)
      )
    }
  }

  if (action === 'basic_attack') {
    const distance = getDistance(actor, target)
    if (distance > 1.6) {
      return {
        ok: false,
        reason: 'target_out_of_range'
      }
    }
    return {
      ok: true,
      command: buildCommand(
        input.session.id,
        actor.id,
        input.executeAtTick,
        'basic_attack',
        target.id,
        undefined,
        sanitizeMetadata(expanded.metadata)
      )
    }
  }

  if (action === 'dash' || action === 'flee') {
    const metadata = sanitizeMetadata(expanded.metadata)
    return {
      ok: true,
      command: buildCommand(input.session.id, actor.id, input.executeAtTick, action, target.id, undefined, metadata)
    }
  }

  return {
    ok: true,
    command: buildCommand(input.session.id, actor.id, input.executeAtTick, action)
  }
}

function remapUnsafeDash(
  session: BattleSession,
  actorId: string,
  decision: RawBattleDecision
): RawBattleDecision | null {
  const movementState = session.movementState[actorId] || {
    consecutiveDashCount: 0,
    dashCooldownUntilTick: -1
  }
  const recent = session.events.slice(-40)
  const blockedCount = recent.reduce((acc, event) => {
    if (event.type !== 'command_rejected') return acc
    if (String(event.payload.actorId || '') !== actorId) return acc
    const reason = String(event.payload.reason || '')
    if (reason === 'dash_blocked' || reason === 'dash_blocked_by_walkability') return acc + 1
    return acc
  }, 0)
  const dashLocked =
    movementState.consecutiveDashCount >= 3 || movementState.dashCooldownUntilTick >= session.tick || blockedCount >= 2
  if (!dashLocked) return null
  return {
    action: 'dodge',
    metadata: {
      ...(decision.metadata || {}),
      remapReason: 'dash_unavailable'
    }
  }
}

function buildCommand(
  sessionId: string,
  actorId: string,
  tick: number,
  action: BattleCommand['action'],
  targetId?: string,
  skillId?: string,
  metadata?: Record<string, unknown>
): BattleCommand {
  const command: BattleCommand = {
    commandId: uuidv4(),
    sessionId,
    actorId,
    tick,
    action
  }
  if (targetId) command.targetId = targetId
  if (skillId) command.skillId = skillId
  if (metadata && Object.keys(metadata).length > 0) command.metadata = metadata
  return command
}

function sanitizeMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined
  const source = metadata as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof source.moveTargetX === 'number' && Number.isFinite(source.moveTargetX)) {
    out.moveTargetX = Number(source.moveTargetX)
  }
  if (typeof source.moveTargetY === 'number' && Number.isFinite(source.moveTargetY)) {
    out.moveTargetY = Number(source.moveTargetY)
  }
  if (typeof source.moveStep === 'number' && Number.isFinite(source.moveStep)) {
    out.moveStep = Math.max(0.4, Math.min(4.2, Number(source.moveStep)))
  }
  if (typeof source.btNode === 'string' && source.btNode.length > 0) {
    out.btNode = source.btNode
  }
  if (typeof source.btVersion === 'number' && Number.isFinite(source.btVersion)) {
    out.btVersion = Math.max(1, Math.floor(Number(source.btVersion)))
  }
  if (Array.isArray(source.btPlannedPath)) {
    const path = source.btPlannedPath
      .filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { x?: unknown }).x === 'number' &&
          typeof (entry as { y?: unknown }).y === 'number'
      )
      .slice(0, 12)
      .map((entry) => ({
        x: Number(((entry as { x: number }).x).toFixed(2)),
        y: Number(((entry as { y: number }).y).toFixed(2))
      }))
    if (path.length > 0) {
      out.btPlannedPath = path
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function isAllowedAction(action: string): action is BattleCommand['action'] {
  return (
    action === 'basic_attack' ||
    action === 'cast_skill' ||
    action === 'dash' ||
    action === 'dodge' ||
    action === 'flee'
  )
}

function getActor(session: BattleSession, actorId: string) {
  if (session.left.id === actorId) return session.left
  if (session.right.id === actorId) return session.right
  return undefined
}

function getOpponent(session: BattleSession, actorId: string) {
  if (session.left.id === actorId) return session.right
  if (session.right.id === actorId) return session.left
  return undefined
}

function getDistance(
  a: { position: { x: number; y: number } },
  b: { position: { x: number; y: number } }
): number {
  const dx = a.position.x - b.position.x
  const dy = a.position.y - b.position.y
  return Math.sqrt(dx * dx + dy * dy)
}

