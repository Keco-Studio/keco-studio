import { newId as uuidv4 } from '../util/id'
import { resolveBattleDashPosition, type BattleWalkTerrainContext } from '../../map-battle/battleGridMovement'
import { BattleEntity } from '../domain/entities/battle-entity'
import { BattleSession } from '../domain/entities/battle-session'
import { BattleCommand } from '../domain/types/command-types'
import { BattleEvent } from '../domain/types/event-types'
import { BattleStatusEffect } from '../domain/types/effect-types'
import { getBattleSkillDefinition } from '../content/skills/basic-skill-catalog'
import { applyFreezeToEntity } from './effect-processor'
import { BATTLE_BALANCE } from '../config/battle-balance'
import { applyFinalDamageVariance } from '@keco/battle-engine'
import { resolveKecoCastSkill } from '../../keco/resolveKecoCastSkill'
import { defaultBasicKecoSkill } from '../../keco/kecoSkillBridge'

export type BattleCommandWalkContext = BattleWalkTerrainContext

const AUTO_FLEE_GUARANTEE_AFTER_FAILURES = 3
const CHASE_WINDOW_TICKS = 3

export type CommandProcessorResult = {
  session: BattleSession
  appliedCommandCount: number
}

export function enqueueBattleCommand(
  session: BattleSession,
  command: BattleCommand
): BattleSession {
  if (command.sessionId !== session.id) {
    throw new Error('command sessionId does not match battle session')
  }
  const actor = getEntityById(session, command.actorId)
  if (!actor) {
    throw new Error(`battle actor not found: ${command.actorId}`)
  }
  const nextQueue = [...session.commandQueue, command]
  const events = [
    ...session.events,
    createEvent(session.id, session.tick, 'command_received', {
      commandId: command.commandId,
      actorId: command.actorId,
      action: command.action,
      targetId: command.targetId,
      skillId: command.skillId,
      metadata: command.metadata || {}
    })
  ]
  return {
    ...session,
    commandQueue: nextQueue,
    events,
    updatedAt: Date.now()
  }
}

export function processBattleCommands(
  session: BattleSession,
  walk?: BattleCommandWalkContext,
): CommandProcessorResult {
  if (session.result !== 'ongoing') {
    return { session, appliedCommandCount: 0 }
  }
  const currentTick = session.tick
  const executable = session.commandQueue.filter((command) => command.tick <= currentTick)
  const pending = session.commandQueue.filter((command) => command.tick > currentTick)
  if (executable.length === 0) {
    const withChase = resolveChaseByTimeout(resolveChaseByPosition(session))
    return {
      session: {
        ...withChase,
        commandQueue: pending
      },
      appliedCommandCount: 0
    }
  }

  const sorted = [...executable].sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick
    const speedA = getEntityById(session, a.actorId)?.spd || 0
    const speedB = getEntityById(session, b.actorId)?.spd || 0
    if (speedA !== speedB) return speedB - speedA
    const teamA = getEntityById(session, a.actorId)?.team
    const teamB = getEntityById(session, b.actorId)?.team
    if (teamA && teamB && teamA !== teamB) {
      const leftFirst = currentTick % 2 === 1
      if (leftFirst) return teamA === 'left' ? -1 : 1
      return teamA === 'right' ? -1 : 1
    }
    if (a.actorId !== b.actorId) return a.actorId.localeCompare(b.actorId)
    return a.commandId.localeCompare(b.commandId)
  })

  let nextSession: BattleSession = {
    ...session,
    commandQueue: pending
  }
  let applied = 0

  sorted.forEach((command) => {
    const result = applySingleCommand(nextSession, command, walk)
    nextSession = result.session
    if (result.applied) {
      applied += 1
    }
  })

  return {
    session: {
      ...nextSession,
      updatedAt: Date.now()
    },
    appliedCommandCount: applied
  }
}

function applySingleCommand(
  session: BattleSession,
  command: BattleCommand,
  walk?: BattleCommandWalkContext,
): { session: BattleSession; applied: boolean } {
  session = resolveChaseByTimeout(resolveChaseByPosition(session))
  if (session.result !== 'ongoing') {
    return {
      session: appendEvent(session, 'command_rejected', {
        commandId: command.commandId,
        actorId: command.actorId,
        reason: 'battle_ended'
      }),
      applied: false
    }
  }

  const actor = getEntityById(session, command.actorId)
  if (!actor) {
    return {
      session: appendEvent(session, 'command_rejected', {
        commandId: command.commandId,
        actorId: command.actorId,
        reason: 'actor_not_found'
      }),
      applied: false
    }
  }
  if (!actor.alive || actor.resources.hp <= 0) {
    return {
      session: appendEvent(session, 'command_rejected', {
        commandId: command.commandId,
        actorId: actor.id,
        reason: 'actor_dead'
      }),
      applied: false
    }
  }
  if (isActorControlled(actor, session.tick)) {
    return {
      session: appendEvent(session, 'command_rejected', {
        commandId: command.commandId,
        reason: 'actor_controlled',
        actorId: actor.id
      }),
      applied: false
    }
  }

  if (session.phase === 'preparation' && isBlockedInPreparation(command.action)) {
    return { session, applied: false }
  }

  const target = command.targetId
    ? getEntityById(session, command.targetId)
    : getOpponent(session, actor.id)
  const movementState = getMovementState(session, actor.id)

  if (command.action === 'basic_attack') {
    if (!target || !target.alive) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'target_not_found'
        }),
        applied: false
      }
    }
    const distance = getDistance(actor, target)
    if (distance > 1.6) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'target_out_of_range',
          distance: Number(distance.toFixed(2))
        }),
        applied: false
      }
    }
    if (session.keco) {
      const basicId =
        actor.skillSlots[0]?.skillId ??
        defaultBasicKecoSkill().id
      const kecoResult = resolveKecoCastSkill({
        session,
        keco: session.keco,
        actor,
        target,
        skillId: basicId,
        commandId: command.commandId,
        tick: session.tick,
      })
      if (!kecoResult.applied) {
        return {
          session: appendEvent(session, 'command_rejected', {
            commandId: command.commandId,
            actorId: actor.id,
            reason: 'keco_basic_failed',
          }),
          applied: false,
        }
      }
      const withResult = resolveChaseByPosition(
        applyVictoryIfNeeded({ ...kecoResult.session, keco: kecoResult.keco }),
      )
      return { session: applyDashCooldownIfNeeded(withResult, actor.id), applied: true }
    }
    const damage = computeBasicDamage(actor, target)
    const withDamage = applyDamageWithShieldAndRage(session, actor, target, damage, {
      commandId: command.commandId,
      action: command.action
    })
    const withActionEvent = appendEvent(withDamage, 'action_executed', {
      commandId: command.commandId,
      actorId: actor.id,
      action: command.action,
      targetId: target.id
    })
    const withResult = resolveChaseByPosition(applyVictoryIfNeeded(withActionEvent))
    return { session: applyDashCooldownIfNeeded(withResult, actor.id), applied: true }
  }

  if (command.action === 'dash') {
    if (movementState.dashCooldownUntilTick >= session.tick) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'dash_on_cooldown',
          readyAtTick: movementState.dashCooldownUntilTick
        }),
        applied: false
      }
    }
    if (movementState.consecutiveDashCount >= 3) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'dash_streak_limit_reached',
          maxConsecutive: 3
        }),
        applied: false
      }
    }
    const opponent = getOpponent(session, actor.id)
    const rawTargetX =
      typeof command.metadata?.moveTargetX === 'number'
        ? Number(command.metadata.moveTargetX)
        : opponent
          ? actor.team === 'left'
            ? opponent.position.x - 1.4
            : opponent.position.x + 1.4
          : actor.position.x
    const moveStep =
      typeof command.metadata?.moveStep === 'number'
        ? Math.max(0.4, Math.min(4.2, Number(command.metadata.moveStep)))
        : 2.2
    const rawTargetY =
      typeof command.metadata?.moveTargetY === 'number'
        ? Number(command.metadata.moveTargetY)
        : opponent
          ? opponent.position.y
          : actor.position.y
    const clampedTargetX = clamp(rawTargetX, session.mapBounds.minX + 0.5, session.mapBounds.maxX - 0.5)
    const clampedTargetY = clamp(rawTargetY, session.mapBounds.minY + 0.5, session.mapBounds.maxY - 0.5)

    let safeX: number
    let safeY: number
    if (walk) {
      const resolved = resolveBattleDashPosition({
        session,
        actor,
        opponent,
        clampedTargetX,
        clampedTargetY,
        moveStep,
        walk,
      })
      safeX = resolved.x
      safeY = resolved.y
    } else {
      const delta = clampedTargetX - actor.position.x
      const direction = delta === 0 ? 0 : delta > 0 ? 1 : -1
      const movedX =
        direction === 0
          ? actor.position.x
          : actor.position.x + direction * Math.min(Math.abs(delta), moveStep)
      safeX = ensureSpacingWithOpponent(
        movedX,
        actor.team,
        opponent,
        session.mapBounds.minX + 0.5,
        session.mapBounds.maxX - 0.5,
      )
      const yDelta = clampedTargetY - actor.position.y
      const movedY =
        yDelta === 0
          ? actor.position.y
          : actor.position.y + Math.sign(yDelta) * Math.min(Math.abs(yDelta), moveStep * 0.6)
      safeY = clamp(movedY, session.mapBounds.minY + 0.5, session.mapBounds.maxY - 0.5)
    }
    const nextActor: BattleEntity = {
      ...actor,
      position: {
        ...actor.position,
        x: safeX,
        y: safeY
      }
    }
    const movedDist = Math.hypot(nextActor.position.x - actor.position.x, nextActor.position.y - actor.position.y)
    if (movedDist <= 0.12) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'dash_blocked',
          fromX: Number(actor.position.x.toFixed(2)),
          fromY: Number(actor.position.y.toFixed(2)),
          targetX: Number(clampedTargetX.toFixed(2)),
          targetY: Number(clampedTargetY.toFixed(2)),
        }),
        applied: false
      }
    }
    let movedSession = resolveChaseByPosition(updateEntity(session, nextActor))
    movedSession = setMovementState(movedSession, actor.id, {
      consecutiveDashCount: movementState.consecutiveDashCount + 1,
      dashCooldownUntilTick: movementState.dashCooldownUntilTick
    })
    return {
      session: appendEvent(movedSession, 'action_executed', {
        commandId: command.commandId,
        actorId: actor.id,
        action: command.action,
        fromX: Number(actor.position.x.toFixed(2)),
        toX: Number(safeX.toFixed(2)),
        fromY: Number(actor.position.y.toFixed(2)),
        toY: Number(safeY.toFixed(2)),
        targetX: Number(clampedTargetX.toFixed(2)),
        targetY: Number(clampedTargetY.toFixed(2)),
        moveStep: Number(moveStep.toFixed(2))
      }),
      applied: true
    }
  }

  if (command.action === 'dodge') {
    const cost = Math.max(0, Number(BATTLE_BALANCE.dodgeStaminaCost || 0))
    if (actor.resources.stamina < cost) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'not_enough_stamina',
          action: command.action,
          need: cost,
          current: actor.resources.stamina
        }),
        applied: false
      }
    }
    const evadeChance = Math.max(
      0.05,
      Math.min(0.95, Number(BATTLE_BALANCE.dodgeEvadeChance || 0.7))
    )
    const dodgeEffect: BattleStatusEffect = {
      instanceId: uuidv4(),
      effectType: 'buff',
      sourceId: actor.id,
      ownerId: actor.id,
      appliedTick: session.tick,
      durationTick: 1,
      remainingTick: 1,
      stackRule: 'replace',
      tags: ['dodge_ready'],
      params: {
        evadeChance
      }
    }
    const nextActor: BattleEntity = {
      ...actor,
      defending: false,
      resources: {
        ...actor.resources,
        stamina: Math.max(0, actor.resources.stamina - cost)
      },
      effects: [
        ...actor.effects.filter(
          (effect) => !(effect.effectType === 'buff' && hasTag(effect, 'dodge_ready'))
        ),
        dodgeEffect
      ]
    }
    const withDodge = updateEntity(session, nextActor)
    const withAction = appendEvent(withDodge, 'action_executed', {
      commandId: command.commandId,
      actorId: actor.id,
      action: command.action,
      evadeChance: Number(evadeChance.toFixed(2)),
      staminaCost: cost
    })
    const nextSession = appendEvent(withAction, 'effect_applied', {
      effectType: 'dodge_ready',
      ownerId: actor.id,
      sourceId: actor.id,
      durationTick: 1,
      evadeChance: Number(evadeChance.toFixed(2))
    })
    return {
      session: applyDashCooldownIfNeeded(nextSession, actor.id),
      applied: true
    }
  }

  if (command.action === 'flee') {
    const bounds = session.mapBounds
    const centerX = (bounds.minX + bounds.maxX) * 0.5
    const centerY = (bounds.minY + bounds.maxY) * 0.5
    const edgeTargetX = actor.team === 'left' ? bounds.minX + 0.5 : bounds.maxX - 0.5
    const nearHorizontalEdge =
      actor.position.x <= bounds.minX + 1.2 || actor.position.x >= bounds.maxX - 1.2
    const preferOpenField = nearHorizontalEdge || command.metadata?.fleeMode === 'open_field'
    const targetX = preferOpenField ? centerX : edgeTargetX
    const rawTargetY =
      typeof command.metadata?.moveTargetY === 'number'
        ? Number(command.metadata.moveTargetY)
        : preferOpenField
          ? centerY
          : actor.position.y
    const clampedTargetY = clamp(rawTargetY, bounds.minY + 0.5, bounds.maxY - 0.5)
    const delta = targetX - actor.position.x
    const step = Math.min(3.4, Math.max(1.6, Math.abs(delta)))
    let toX: number
    let toY: number
    if (walk) {
      const resolved = resolveBattleDashPosition({
        session,
        actor,
        opponent: getOpponent(session, actor.id),
        clampedTargetX: targetX,
        clampedTargetY,
        moveStep: step,
        walk,
      })
      toX = resolved.x
      toY = resolved.y
    } else {
      toX =
        actor.position.x + (delta === 0 ? 0 : delta > 0 ? Math.min(step, delta) : -Math.min(step, Math.abs(delta)))
      toY =
        actor.position.y +
        Math.sign(clampedTargetY - actor.position.y) * Math.min(Math.abs(clampedTargetY - actor.position.y), 1.8)
    }
    const nextActor: BattleEntity = {
      ...actor,
      position: {
        ...actor.position,
        x: clamp(toX, session.mapBounds.minX + 0.5, session.mapBounds.maxX - 0.5),
        y: clamp(toY, session.mapBounds.minY + 0.5, session.mapBounds.maxY - 0.5)
      }
    }
    const movedSession = updateEntity(session, nextActor)
    const hpRatio = actor.resources.maxHp > 0 ? actor.resources.hp / actor.resources.maxHp : 1
    const atEdge = isAtMapEdge(nextActor.position, session.mapBounds)
    const chaserAfterMove = getOpponent(movedSession, actor.id)
    const distanceAfterMove = chaserAfterMove ? getDistance(nextActor, chaserAfterMove) : Number.POSITIVE_INFINITY
    const alreadyEscapedByDistance = distanceAfterMove >= 3.0
    const fleeReason = typeof command.metadata?.reason === 'string' ? command.metadata.reason : ''
    const isAutoFlee = fleeReason === 'auto_flee'
    const autoFleeFailStreak = Math.max(0, Number(session.chaseState.autoFleeFailStreak || 0))
    const nonEdgeFleeChance = isAutoFlee ? 0.5 : 0.3
    const fleeChance = atEdge ? (hpRatio < 0.3 ? 0.9 : 0.55) : nonEdgeFleeChance
    const deterministicSuccess = atEdge || alreadyEscapedByDistance
    const guaranteedByFailStreak = isAutoFlee && autoFleeFailStreak >= AUTO_FLEE_GUARANTEE_AFTER_FAILURES
    const fleeSucceed = deterministicSuccess || guaranteedByFailStreak || Math.random() < fleeChance
    const withAction = appendEvent(movedSession, 'action_executed', {
      commandId: command.commandId,
      actorId: actor.id,
      action: command.action,
      fromX: Number(actor.position.x.toFixed(2)),
      toX: Number(nextActor.position.x.toFixed(2)),
      fromY: Number(actor.position.y.toFixed(2)),
      toY: Number(nextActor.position.y.toFixed(2)),
      fleeChance: Number(fleeChance.toFixed(2)),
      guaranteedByFailStreak
    })
    if (!fleeSucceed) {
      const nextFailStreak = isAutoFlee ? autoFleeFailStreak + 1 : 0
      const withFailStreak: BattleSession = {
        ...withAction,
        chaseState: {
          ...withAction.chaseState,
          status: 'none',
          autoFleeFailStreak: nextFailStreak
        }
      }
      return {
        session: appendEvent(withFailStreak, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'flee_failed',
          autoFleeFailStreak: nextFailStreak
        }),
        applied: false
      }
    }
    const chaser = getOpponent(withAction, actor.id)
    if (!chaser) {
      return {
        session: appendEvent(withAction, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'target_not_found'
        }),
        applied: false
      }
    }
    const withChaseState: BattleSession = {
      ...withAction,
      chaseState: {
        status: 'flee_pending',
        runnerId: actor.id,
        chaserId: chaser.id,
        startTick: withAction.tick,
        expireTick: withAction.tick + CHASE_WINDOW_TICKS,
        autoFleeFailStreak: 0
      }
    }
    const nextSession = appendEvent(withChaseState, 'chase_started', {
      runnerId: actor.id,
      chaserId: chaser.id,
      startTick: withAction.tick,
      expireTick: withAction.tick + CHASE_WINDOW_TICKS
    })
    return {
      session: applyDashCooldownIfNeeded(nextSession, actor.id),
      applied: true
    }
  }
  if (command.action === 'cast_skill') {
    if (!target || !target.alive) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'target_not_found'
        }),
        applied: false
      }
    }
    if (!command.skillId) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'missing_skill_id'
        }),
        applied: false
      }
    }
    const skill = getBattleSkillDefinition(command.skillId)
    if (!skill) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'skill_not_found',
          skillId: command.skillId
        }),
        applied: false
      }
    }
    const slot = actor.skillSlots.find((skillSlot) => skillSlot.skillId === skill.id)
    if (!slot) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'skill_not_equipped',
          skillId: skill.id
        }),
        applied: false
      }
    }
    if (slot.cooldownTick > session.tick) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'skill_on_cooldown',
          skillId: skill.id,
          readyAtTick: slot.cooldownTick
        }),
        applied: false
      }
    }
    if (actor.resources.mp < skill.mpCost) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'not_enough_mp',
          skillId: skill.id
        }),
        applied: false
      }
    }
    const distance = getDistance(actor, target)
    if (distance > skill.range) {
      return {
        session: appendEvent(session, 'command_rejected', {
          commandId: command.commandId,
          actorId: actor.id,
          reason: 'target_out_of_range',
          skillId: skill.id,
          distance: Number(distance.toFixed(2)),
          range: skill.range
        }),
        applied: false
      }
    }
    if (session.keco) {
      const kecoResult = resolveKecoCastSkill({
        session,
        keco: session.keco,
        actor,
        target,
        skillId: skill.id,
        commandId: command.commandId,
        tick: session.tick,
      })
      if (!kecoResult.applied) {
        return {
          session: appendEvent(session, 'command_rejected', {
            commandId: command.commandId,
            actorId: actor.id,
            reason: 'keco_cast_failed',
            skillId: skill.id,
          }),
          applied: false,
        }
      }
      const resolvedSession = resolveChaseByPosition(
        applyVictoryIfNeeded({ ...kecoResult.session, keco: kecoResult.keco }),
      )
      return {
        session: applyDashCooldownIfNeeded(resolvedSession, actor.id),
        applied: true,
      }
    }

    const shatterContext = computeFreezeShatterContext(skill, target)
    const baseDamage = computeSkillDamage(actor, target, skill.ratio)
    const shatterBonusDamage = shatterContext.triggered
      ? Math.max(1, Math.floor(baseDamage * shatterContext.bonusRatio))
      : 0
    const damage = baseDamage + shatterBonusDamage
    const updatedSlots = actor.skillSlots.map((skillSlot) =>
      skillSlot.skillId === skill.id
        ? { ...skillSlot, cooldownTick: session.tick + skill.cooldownTicks }
        : skillSlot
    )
    const nextActor: BattleEntity = {
      ...actor,
      skillSlots: updatedSlots,
      resources: {
        ...actor.resources,
        mp: Math.max(0, actor.resources.mp - skill.mpCost)
      }
    }
    let nextSession = updateEntity(session, nextActor)
    if (shatterContext.triggered) {
      nextSession = updateEntity(nextSession, shatterContext.nextTarget)
      nextSession = appendEvent(nextSession, 'effect_expired', {
        effectType: 'freeze',
        ownerId: target.id,
        sourceId: actor.id,
        reason: 'combo_shatter'
      })
    }
    nextSession = applyDamageWithShieldAndRage(nextSession, nextActor, shatterContext.nextTarget, damage, {
      commandId: command.commandId,
      action: command.action,
      skillId: skill.id
    })
    nextSession = appendEvent(nextSession, 'action_executed', {
      commandId: command.commandId,
      actorId: actor.id,
      targetId: target.id,
      action: command.action,
      skillId: skill.id,
      skillName: skill.name
    })
    if (shatterContext.triggered) {
      nextSession = appendEvent(nextSession, 'combo_triggered', {
        actorId: actor.id,
        targetId: target.id,
        comboId: 'freeze_shatter',
        skillId: skill.id,
        bonusDamage: shatterBonusDamage
      })
    }
    const latestTarget = getEntityById(nextSession, target.id)
    if (skill.applyFreezeTicks && latestTarget && latestTarget.alive) {
      nextSession = applyFreezeToEntity(nextSession, latestTarget, actor.id, skill.applyFreezeTicks)
    }
    const resolvedSession = resolveChaseByPosition(applyVictoryIfNeeded(nextSession))
    return {
      session: applyDashCooldownIfNeeded(resolvedSession, actor.id),
      applied: true
    }
  }

  return {
    session: appendEvent(session, 'command_rejected', {
      commandId: command.commandId,
      actorId: command.actorId,
      reason: 'action_not_implemented',
      action: command.action
    }),
    applied: false
  }
}

function getMovementState(
  session: BattleSession,
  actorId: string
): { consecutiveDashCount: number; dashCooldownUntilTick: number } {
  return (
    session.movementState[actorId] || {
      consecutiveDashCount: 0,
      dashCooldownUntilTick: -1
    }
  )
}

function setMovementState(
  session: BattleSession,
  actorId: string,
  state: { consecutiveDashCount: number; dashCooldownUntilTick: number }
): BattleSession {
  return {
    ...session,
    movementState: {
      ...session.movementState,
      [actorId]: state
    }
  }
}

function applyDashCooldownIfNeeded(session: BattleSession, actorId: string): BattleSession {
  const movementState = getMovementState(session, actorId)
  if (movementState.consecutiveDashCount <= 0) return session
  return setMovementState(session, actorId, {
    consecutiveDashCount: 0,
    // Stop moving this tick => cooldown starts this tick and lasts equal rounds.
    dashCooldownUntilTick: session.tick + movementState.consecutiveDashCount - 1
  })
}

function isBlockedInPreparation(action: BattleCommand['action']): boolean {
  return (
    action === 'basic_attack' ||
    action === 'cast_skill' ||
    action === 'dash' ||
    action === 'flee'
  )
}

function ensureSpacingWithOpponent(
  x: number,
  team: 'left' | 'right',
  opponent: BattleEntity | undefined,
  minX: number,
  maxX: number
): number {
  if (!opponent) return clamp(x, minX, maxX)
  const minGap = 1.2
  if (team === 'left') {
    return clamp(Math.min(x, opponent.position.x - minGap), minX, maxX)
  }
  return clamp(Math.max(x, opponent.position.x + minGap), minX, maxX)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function isAtMapEdge(
  position: { x: number; y: number },
  bounds: BattleSession['mapBounds'],
  threshold = 0.7
): boolean {
  return (
    position.x <= bounds.minX + threshold ||
    position.x >= bounds.maxX - threshold ||
    position.y <= bounds.minY + threshold ||
    position.y >= bounds.maxY - threshold
  )
}

function isActorControlled(actor: BattleEntity, currentTick: number): boolean {
  return actor.effects.some(
    (effect) =>
      effect.remainingTick > 0 &&
      Number(effect.appliedTick || 0) < currentTick &&
      (effect.effectType === 'freeze' || effect.effectType === 'stun')
  )
}

function computeBasicDamage(actor: BattleEntity, target: BattleEntity): number {
  const raw =
    (actor.atk - target.def * 0.5 + Math.random() * 2) * BATTLE_BALANCE.basicDamageMultiplier
  const reduced = target.defending ? raw * 0.6 : raw
  return Math.max(1, applyFinalDamageVariance(Math.max(1, reduced)))
}

function computeSkillDamage(actor: BattleEntity, target: BattleEntity, ratio: number): number {
  const raw =
    (actor.atk * Math.max(0.5, ratio) - target.def * 0.45 + Math.random() * 2.5) *
    BATTLE_BALANCE.skillDamageMultiplier
  const reduced = target.defending ? raw * 0.62 : raw
  return Math.max(1, applyFinalDamageVariance(Math.max(1, reduced)))
}

function applyDamageWithShieldAndRage(
  session: BattleSession,
  actor: BattleEntity,
  target: BattleEntity,
  incomingDamage: number,
  payloadExtra?: Record<string, unknown>
): BattleSession {
  let effectiveTarget = target
  const dodgeContext = consumeDodgeIfAny(target)
  if (dodgeContext.triggered) {
    const evasionRolled = Math.random()
    if (evasionRolled < dodgeContext.evadeChance) {
      let nextSession = updateEntity(session, dodgeContext.nextTarget)
      nextSession = appendEvent(nextSession, 'effect_expired', {
        effectType: 'dodge_ready',
        ownerId: target.id,
        sourceId: target.id,
        reason: 'evade_success'
      })
      nextSession = appendEvent(nextSession, 'command_rejected', {
        reason: 'target_dodged',
        commandId: payloadExtra?.commandId,
        action: payloadExtra?.action,
        actorId: actor.id,
        targetId: target.id,
        evadeChance: Number(dodgeContext.evadeChance.toFixed(2)),
        rolled: Number(evasionRolled.toFixed(3))
      })
      return nextSession
    }
    effectiveTarget = dodgeContext.nextTarget
    session = updateEntity(session, effectiveTarget)
    session = appendEvent(session, 'effect_expired', {
      effectType: 'dodge_ready',
      ownerId: target.id,
      sourceId: target.id,
      reason: 'evade_failed'
    })
  }

  const shieldBefore = Math.max(0, Number(effectiveTarget.resources.shield || 0))
  const shieldAbsorbed = Math.min(shieldBefore, incomingDamage)
  const hpDamage = Math.max(0, incomingDamage - shieldAbsorbed)
  const shieldAfter = Math.max(0, shieldBefore - shieldAbsorbed)
  const actorRageGain = computeRageGain(
    incomingDamage,
    actor.resources.maxRage,
    BATTLE_BALANCE.rageGainOnDealScale
  )
  const targetRageGain = computeRageGain(
    incomingDamage,
    effectiveTarget.resources.maxRage,
    BATTLE_BALANCE.rageGainOnTakenScale
  )
  const nextActor: BattleEntity = {
    ...actor,
    resources: {
      ...actor.resources,
      rage: clamp(actor.resources.rage + actorRageGain, 0, actor.resources.maxRage)
    }
  }
  const nextTarget: BattleEntity = {
    ...effectiveTarget,
    defending: false,
    resources: {
      ...effectiveTarget.resources,
      hp: Math.max(0, effectiveTarget.resources.hp - hpDamage),
      shield: shieldAfter,
      rage: clamp(
        effectiveTarget.resources.rage + targetRageGain,
        0,
        effectiveTarget.resources.maxRage
      )
    },
    alive: effectiveTarget.resources.hp - hpDamage > 0
  }
  let nextSession = updateEntity(session, nextActor)
  nextSession = updateEntity(nextSession, nextTarget)
  nextSession = appendEvent(nextSession, 'damage_applied', {
    actorId: actor.id,
    targetId: target.id,
    damage: hpDamage,
    rawDamage: incomingDamage,
    shieldAbsorbed,
    ...(payloadExtra || {})
  })
  if (shieldAbsorbed > 0 && shieldBefore > 0 && shieldAfter <= 0) {
    nextSession = appendEvent(nextSession, 'shield_broken', {
      actorId: actor.id,
      targetId: target.id,
      absorbed: shieldAbsorbed
    })
  }
  if (actorRageGain > 0) {
    nextSession = appendEvent(nextSession, 'rage_changed', {
      actorId: actor.id,
      amount: actorRageGain,
      rage: nextActor.resources.rage,
      maxRage: nextActor.resources.maxRage
    })
  }
  if (targetRageGain > 0) {
    nextSession = appendEvent(nextSession, 'rage_changed', {
      actorId: target.id,
      amount: targetRageGain,
      rage: nextTarget.resources.rage,
      maxRage: nextTarget.resources.maxRage
    })
  }
  return nextSession
}

function computeRageGain(incomingDamage: number, maxRage: number, scale: number): number {
  if (maxRage <= 0 || incomingDamage <= 0) return 0
  const raw = incomingDamage * Math.max(0, scale)
  return Math.max(0, Math.floor(raw))
}

function computeFreezeShatterContext(
  skill: {
    consumeFreezeOnHit?: boolean
    shatterBonusRatio?: number
  },
  target: BattleEntity
): { triggered: boolean; bonusRatio: number; nextTarget: BattleEntity } {
  if (!skill.consumeFreezeOnHit || !skill.shatterBonusRatio || skill.shatterBonusRatio <= 0) {
    return { triggered: false, bonusRatio: 0, nextTarget: target }
  }
  const hasFreeze = target.effects.some(
    (effect) => effect.effectType === 'freeze' && effect.remainingTick > 0
  )
  if (!hasFreeze) {
    return { triggered: false, bonusRatio: 0, nextTarget: target }
  }
  const filteredEffects = target.effects.filter((effect) => effect.effectType !== 'freeze')
  return {
    triggered: true,
    bonusRatio: skill.shatterBonusRatio,
    nextTarget: {
      ...target,
      effects: filteredEffects
    }
  }
}

function consumeDodgeIfAny(target: BattleEntity): {
  triggered: boolean
  evadeChance: number
  nextTarget: BattleEntity
} {
  const dodgeEffect = target.effects.find(
    (effect) => effect.effectType === 'buff' && hasTag(effect, 'dodge_ready')
  )
  if (!dodgeEffect) {
    return { triggered: false, evadeChance: 0, nextTarget: target }
  }
  const evadeChance = Math.max(
    0.05,
    Math.min(
      0.95,
      Number(dodgeEffect.params?.evadeChance || BATTLE_BALANCE.dodgeEvadeChance || 0.7)
    )
  )
  return {
    triggered: true,
    evadeChance,
    nextTarget: {
      ...target,
      effects: target.effects.filter((effect) => effect.instanceId !== dodgeEffect.instanceId)
    }
  }
}

function hasTag(effect: BattleStatusEffect, tag: string): boolean {
  if (!Array.isArray(effect.tags)) return false
  return effect.tags.includes(tag)
}

function getDistance(a: BattleEntity, b: BattleEntity): number {
  const dx = a.position.x - b.position.x
  const dy = a.position.y - b.position.y
  return Math.sqrt(dx * dx + dy * dy)
}

function getEntityById(session: BattleSession, entityId: string): BattleEntity | undefined {
  if (session.left.id === entityId) return session.left
  if (session.right.id === entityId) return session.right
  return undefined
}

function getOpponent(session: BattleSession, actorId: string): BattleEntity | undefined {
  if (session.left.id === actorId) return session.right
  if (session.right.id === actorId) return session.left
  return undefined
}

function updateEntity(session: BattleSession, entity: BattleEntity): BattleSession {
  if (session.left.id === entity.id) {
    return { ...session, left: entity }
  }
  if (session.right.id === entity.id) {
    return { ...session, right: entity }
  }
  return session
}

function resolveChaseByPosition(session: BattleSession): BattleSession {
  if (session.result !== 'ongoing') return session
  if (session.chaseState.status !== 'flee_pending') return session
  const runnerId = session.chaseState.runnerId
  const chaserId = session.chaseState.chaserId
  if (!runnerId || !chaserId) return session
  const runner = getEntityById(session, runnerId)
  const chaser = getEntityById(session, chaserId)
  if (!runner || !chaser || !runner.alive || !chaser.alive) return session
  if (isAtMapEdge(runner.position, session.mapBounds) || getDistance(runner, chaser) >= 3.0) {
    const result = runner.team === 'left' ? 'left_win' : 'right_win'
    const withResolved = appendEvent(
      {
        ...session,
        result,
        chaseState: {
          status: 'none'
        }
      },
      'chase_resolved',
      {
        type: 'escaped',
        runnerId,
        chaserId,
        expireTick: Number(session.chaseState.expireTick || session.tick),
        escapedBy: isAtMapEdge(runner.position, session.mapBounds) ? 'edge' : 'distance',
        distance: Number(getDistance(runner, chaser).toFixed(2)),
        result
      }
    )
    return appendEvent(withResolved, 'battle_ended', {
      result,
      reason: 'flee_success',
      escapedBy: runnerId
    })
  }
  const distance = getDistance(runner, chaser)
  if (distance > 1.5) return session
  return appendEvent(
    {
      ...session,
      chaseState: {
        status: 'none'
      }
    },
    'chase_resolved',
    {
      type: 'captured',
      runnerId,
      chaserId,
      distance: Number(distance.toFixed(2))
    }
  )
}

function resolveChaseByTimeout(session: BattleSession): BattleSession {
  if (session.result !== 'ongoing') return session
  if (session.chaseState.status !== 'flee_pending') return session
  const expireTick = Number(session.chaseState.expireTick || 0)
  const runnerId = session.chaseState.runnerId
  const chaserId = session.chaseState.chaserId
  if (!runnerId) return session
  if (session.tick < expireTick) return session
  const runner = getEntityById(session, runnerId)
  const chaser = chaserId ? getEntityById(session, chaserId) : undefined
  if (!runner) return session
  const atEscapeEdge = isAtMapEdge(runner.position, session.mapBounds)
  const distanceFromChaser = chaser ? getDistance(runner, chaser) : Number.POSITIVE_INFINITY
  const escapedByDistance = distanceFromChaser >= 3.0
  const result = runner.team === 'left' ? 'left_win' : 'right_win'
  const withResolved = appendEvent(
    {
      ...session,
      result,
      chaseState: {
        status: 'none'
      }
    },
    'chase_resolved',
    {
      type: 'escaped',
      runnerId,
      chaserId: chaserId || null,
      expireTick,
      escapedBy: atEscapeEdge ? 'edge' : escapedByDistance ? 'distance' : 'timeout',
      distance: Number(distanceFromChaser.toFixed(2)),
      result
    }
  )
  return appendEvent(withResolved, 'battle_ended', {
    result,
    reason: 'flee_success',
    escapedBy: runnerId
  })
}

function applyVictoryIfNeeded(session: BattleSession): BattleSession {
  if (!session.left.alive || session.left.resources.hp <= 0) {
    return appendEvent(
      {
        ...session,
        result: 'right_win',
        chaseState: {
          status: 'none'
        }
      },
      'battle_ended',
      {
        result: 'right_win',
        reason: 'left_defeated'
      }
    )
  }
  if (!session.right.alive || session.right.resources.hp <= 0) {
    return appendEvent(
      {
        ...session,
        result: 'left_win',
        chaseState: {
          status: 'none'
        }
      },
      'battle_ended',
      {
        result: 'left_win',
        reason: 'right_defeated'
      }
    )
  }
  return session
}

function appendEvent(
  session: BattleSession,
  type: BattleEvent['type'],
  payload: Record<string, unknown>
): BattleSession {
  return {
    ...session,
    events: [...session.events, createEvent(session.id, session.tick, type, payload)]
  }
}

function createEvent(
  sessionId: string,
  tick: number,
  type: BattleEvent['type'],
  payload: Record<string, unknown>
): BattleEvent {
  return {
    eventId: uuidv4(),
    sessionId,
    tick,
    type,
    payload,
    createdAt: Date.now()
  }
}

