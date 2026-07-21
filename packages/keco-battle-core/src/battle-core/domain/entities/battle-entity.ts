import { BattlePosition, BattleResourcePool, BattleTeam } from '../types/battle-types'
import { BattleStatusEffect } from '../types/effect-types'

export type BattleSkillSlot = {
  skillId: string
  cooldownTick: number
}

export type BattleEntity = {
  id: string
  name: string
  team: BattleTeam
  position: BattlePosition
  resources: BattleResourcePool
  atk: number
  def: number
  spd: number
  skillSlots: BattleSkillSlot[]
  defending: boolean
  alive: boolean
  effects: BattleStatusEffect[]
}

