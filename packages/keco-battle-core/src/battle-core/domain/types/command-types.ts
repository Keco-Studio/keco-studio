import {
  BattleActionType,
  BattleEntityId,
  BattleSessionId,
  BattleTick
} from './battle-types'

export type BattleCommand = {
  commandId: string
  sessionId: BattleSessionId
  actorId: BattleEntityId
  tick: BattleTick
  action: BattleActionType
  targetId?: BattleEntityId
  skillId?: string
  metadata?: Record<string, unknown>
}

