export type BattleSkillDefinition = {
  id: string
  name: string
  description?: string
  category?: 'burst' | 'control' | 'sustain' | 'mobility' | 'utility' | 'execute'
  ratio: number
  mpCost: number
  range: number
  cooldownTicks: number
  applyFreezeTicks?: number
  shatterBonusRatio?: number
  consumeFreezeOnHit?: boolean
  params?: Record<string, unknown>
}

