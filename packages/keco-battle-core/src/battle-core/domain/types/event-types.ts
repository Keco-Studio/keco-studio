import { BattleEntityId, BattleSessionId, BattleTick } from './battle-types'

export type BattleEventType =
  | 'battle_started'
  | 'command_received'
  | 'command_rejected'
  | 'chase_started'
  | 'chase_updated'
  | 'chase_resolved'
  | 'action_executed'
  | 'damage_applied'
  | 'combo_triggered'
  | 'shield_gained'
  | 'shield_broken'
  | 'rage_changed'
  | 'effect_applied'
  | 'effect_expired'
  | 'battle_ended'

export type BattleEvent = {
  eventId: string
  sessionId: BattleSessionId
  tick: BattleTick
  type: BattleEventType
  actorId?: BattleEntityId
  targetId?: BattleEntityId
  payload: Record<string, unknown>
  createdAt: number
}

