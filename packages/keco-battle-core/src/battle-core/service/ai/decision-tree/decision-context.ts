import type { BattleEntity } from '../../../domain/entities/battle-entity'
import type { BattleSession } from '../../../domain/entities/battle-session'
import type { BattleSkillDefinition } from '../../../domain/types/skill-types'
import type { RoleProfile } from './role-inference'

export type TacticalMode = 'retreat' | 'finish' | 'kite' | 'trade'

export type DecisionAction =
  | { type: 'cast_skill'; skillId: string; path: string }
  | { type: 'basic_attack'; path: string }
  | { type: 'dash'; target: { x: number; y: number }; moveStep?: number; path: string }
  | { type: 'dodge'; path: string }
  | { type: 'noop'; path: string }

export type ReadySkill = {
  definition: BattleSkillDefinition
  slotIndex: number
  inRange: boolean
}

export type DecisionContext = {
  session: BattleSession
  actor: BattleEntity
  target: BattleEntity
  tick: number
  distance: number
  actorHpRatio: number
  targetHpRatio: number
  readySkills: ReadySkill[]
  preferredRange: number
  isControlled: boolean
  mapBounds: { minX: number; maxX: number; minY: number; maxY: number }
  actorRole?: RoleProfile
  targetRole?: RoleProfile
}

export type GuardrailResult = {
  action: DecisionAction
  rewritten: boolean
  rewriteReason?: string
}
