import type { BattleEntity } from '../../../domain/entities/battle-entity'
import { getBattleSkillRoleSignatures } from '../../../content/skills/basic-skill-catalog'

export type InferredRole = 'hero' | 'tank' | 'archer' | 'mage' | 'healer' | 'assassin'

const ROLE_STRATEGY_HINTS: Record<InferredRole, string> = {
  hero: 'Balanced frontline, balances damage and control, maintains pressure rhythm',
  tank: 'Heavy armor frontline, absorbs damage to protect allies, uses taunt and control to disrupt enemy rhythm',
  archer: 'Ranged physical DPS, maintains safe distance for sustained pressure, uses kiting and slows to keep distance',
  mage: 'Ranged magic DPS, uses control skills to open combo windows for burst, follows up freeze with shatter damage',
  healer: 'Team support, prioritizes keeping allies alive, uses debuffs and cleanse to disrupt enemies',
  assassin: 'Melee assassin, uses displacement skills to flank and dive, executes low-HP targets',
}

const ROLE_PREFERRED_RANGE: Record<InferredRole, 'melee' | 'mid' | 'ranged'> = {
  hero: 'melee',
  tank: 'melee',
  archer: 'ranged',
  mage: 'ranged',
  healer: 'mid',
  assassin: 'melee',
}

export type RoleProfile = {
  role: InferredRole
  strategyHint: string
  preferredRangeClass: 'melee' | 'mid' | 'ranged'
}

/**
 * Picks the role whose signature skills best overlap with the provided ids.
 * Signature data lives in basic-skill-catalog so adding new role-defining
 * skills only requires touching the catalog file.
 *
 * Tie-breaking: first signature in declaration order wins (hero before tank
 * before archer before mage before healer before assassin).
 */
export function inferRoleBySkills(skillIds: string[]): InferredRole {
  const ids = new Set(skillIds.map((id) => String(id || '')))
  let bestRole: InferredRole = 'hero'
  let bestScore = -1
  for (const [role, signatures] of getBattleSkillRoleSignatures()) {
    let score = 0
    for (const skillId of signatures) {
      if (ids.has(skillId)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestRole = role as InferredRole
    }
  }
  return bestRole
}

export function inferRoleProfile(entity: BattleEntity): RoleProfile {
  const skillIds = entity.skillSlots.map((s) => s.skillId)
  const role = inferRoleBySkills(skillIds)
  return {
    role,
    strategyHint: ROLE_STRATEGY_HINTS[role],
    preferredRangeClass: ROLE_PREFERRED_RANGE[role],
  }
}
