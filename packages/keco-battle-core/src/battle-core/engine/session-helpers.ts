import type { BattleEntity } from '../domain/entities/battle-entity';
import type { BattleSession } from '../domain/entities/battle-session';
import type { BattleEvent } from '../domain/types/event-types';

function createEvent(
  sessionId: string,
  tick: number,
  type: BattleEvent['type'],
  payload: Record<string, unknown>,
): BattleEvent {
  return {
    eventId: `${sessionId}-${tick}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    tick,
    type,
    payload,
    createdAt: Date.now(),
  };
}

export function getEntityById(session: BattleSession, entityId: string): BattleEntity | undefined {
  if (session.left.id === entityId) return session.left;
  if (session.right.id === entityId) return session.right;
  return undefined;
}

export function updateEntity(session: BattleSession, entity: BattleEntity): BattleSession {
  if (session.left.id === entity.id) {
    return { ...session, left: entity, updatedAt: Date.now() };
  }
  if (session.right.id === entity.id) {
    return { ...session, right: entity, updatedAt: Date.now() };
  }
  return session;
}

export function appendEvent(
  session: BattleSession,
  type: BattleEvent['type'],
  payload: Record<string, unknown>,
): BattleSession {
  return {
    ...session,
    events: [...session.events, createEvent(session.id, session.tick, type, payload)],
    updatedAt: Date.now(),
  };
}
