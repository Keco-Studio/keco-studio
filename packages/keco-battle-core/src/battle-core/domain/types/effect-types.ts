import { BattleEntityId, BattleTick } from './battle-types'

export type BattleEffectType =
  | 'freeze'
  | 'stun'
  | 'silence'
  | 'slow'
  | 'dot'
  | 'shield'
  | 'buff'
  | 'debuff'

export type BattleEffectStackRule = 'replace' | 'refresh' | 'stack'

export type BattleStatusEffect = {
  instanceId: string
  effectType: BattleEffectType
  sourceId: BattleEntityId
  ownerId: BattleEntityId
  appliedTick: BattleTick
  durationTick: number
  remainingTick: number
  stackRule: BattleEffectStackRule
  maxStack?: number
  tags?: string[]
  params?: Record<string, unknown>
}

