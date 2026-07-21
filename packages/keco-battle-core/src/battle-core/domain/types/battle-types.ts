export type BattleSessionId = string
export type BattleEntityId = string
export type BattleTick = number

export type BattleTeam = 'left' | 'right'
export type BattleResult = 'ongoing' | 'left_win' | 'right_win' | 'draw' | 'fled'
export type BattlePhase = 'preparation' | 'battle'

export type BattleActionType =
  | 'basic_attack'
  | 'cast_skill'
  | 'dash'
  | 'dodge'
  | 'flee'

export type BattleResourcePool = {
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  stamina: number
  maxStamina: number
  rage: number
  maxRage: number
  shield: number
  maxShield: number
}

export type BattlePosition = {
  x: number
  y: number
}

export type BattleMapBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

