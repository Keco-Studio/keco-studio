import { newId as uuidv4 } from '../util/id'
import { BattleEntity } from '../domain/entities/battle-entity'
import { BattleSession } from '../domain/entities/battle-session'
import { BattleEvent } from '../domain/types/event-types'
import { BattleStatusEffect } from '../domain/types/effect-types'

export function tickStatusEffects(session: BattleSession): BattleSession {
  const leftResult = tickEntityEffects(session, session.left)
  const rightResult = tickEntityEffects(leftResult.session, leftResult.session.right)
  return rightResult.session
}

export function applyFreezeToEntity(
  session: BattleSession,
  owner: BattleEntity,
  sourceId: string,
  durationTick: number
): BattleSession {
  const safeDuration = Math.max(1, Math.floor(durationTick))
  const nextEffects: BattleStatusEffect[] = [
    ...owner.effects.filter((effect) => effect.effectType !== 'freeze'),
    {
      instanceId: uuidv4(),
      effectType: 'freeze',
      sourceId,
      ownerId: owner.id,
      appliedTick: session.tick,
      durationTick: safeDuration,
      remainingTick: safeDuration,
      stackRule: 'replace',
      tags: ['control'],
      params: {
        disableMove: true,
        disableCast: true
      }
    }
  ]
  const updatedOwner: BattleEntity = {
    ...owner,
    effects: nextEffects
  }
  const updatedSession = updateEntity(session, updatedOwner)
  return appendEvent(updatedSession, 'effect_applied', {
    effectType: 'freeze',
    ownerId: owner.id,
    sourceId,
    durationTick: safeDuration
  })
}

function tickEntityEffects(
  session: BattleSession,
  entity: BattleEntity
): { session: BattleSession } {
  if (entity.effects.length === 0) {
    return { session }
  }
  const remaining: BattleStatusEffect[] = []
  let nextSession = session

  entity.effects.forEach((effect) => {
    const nextRemain = Math.max(0, effect.remainingTick - 1)
    if (nextRemain <= 0) {
      nextSession = appendEvent(nextSession, 'effect_expired', {
        effectType: effect.effectType,
        ownerId: entity.id,
        sourceId: effect.sourceId,
        effectInstanceId: effect.instanceId
      })
      return
    }
    remaining.push({
      ...effect,
      remainingTick: nextRemain
    })
  })

  const updatedEntity: BattleEntity = {
    ...entity,
    effects: remaining
  }
  return {
    session: updateEntity(nextSession, updatedEntity)
  }
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

function appendEvent(
  session: BattleSession,
  type: BattleEvent['type'],
  payload: Record<string, unknown>
): BattleSession {
  const event: BattleEvent = {
    eventId: uuidv4(),
    sessionId: session.id,
    tick: session.tick,
    type,
    payload,
    createdAt: Date.now()
  }
  return {
    ...session,
    events: [...session.events, event]
  }
}

