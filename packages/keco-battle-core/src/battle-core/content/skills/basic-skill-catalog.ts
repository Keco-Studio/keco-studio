import { BattleSkillDefinition } from '../../domain/types/skill-types'

const SKILL_COOLDOWN_MULTIPLIER = 10

const SKILLS: BattleSkillDefinition[] = [
  {
    id: 'arcane_bolt',
    name: 'Arcane Bolt',
    description: 'Single target arcane burst, strong after control.',
    category: 'burst',
    ratio: 1.35,
    mpCost: 4,
    range: 6.5,
    cooldownTicks: 2,
    shatterBonusRatio: 0.45,
    consumeFreezeOnHit: true
  },
  {
    id: 'frost_lock',
    name: 'Frost Lock',
    description: 'Applies freeze and opens combo windows.',
    category: 'control',
    ratio: 1.1,
    mpCost: 6,
    range: 7.2,
    cooldownTicks: 3,
    applyFreezeTicks: 2
  },
  {
    id: 'fireball',
    name: 'Fireball',
    description: 'Reliable mid-range burst projectile.',
    category: 'burst',
    ratio: 1.5,
    mpCost: 6,
    range: 6.2,
    cooldownTicks: 3
  },
  {
    id: 'ice_nova',
    name: 'Ice Nova',
    description: 'Short freeze setup spell for control mages.',
    category: 'control',
    ratio: 1.0,
    mpCost: 5,
    range: 6.8,
    cooldownTicks: 4,
    applyFreezeTicks: 1
  },
  {
    id: 'frost_lock_wave',
    name: 'Frost Lock Wave',
    description: 'Imported frost control wave; freeze-oriented setup.',
    category: 'control',
    ratio: 1.92,
    mpCost: 14,
    range: 8,
    cooldownTicks: 2,
    applyFreezeTicks: 2
  },
  {
    id: 'ice_shard_beam',
    name: 'Ice Shard Beam',
    description: 'Imported shard beam; sustained frost pressure.',
    category: 'burst',
    ratio: 1.48,
    mpCost: 9,
    range: 7,
    cooldownTicks: 1,
    shatterBonusRatio: 0.25
  },
  {
    id: 'arcane_prison_wave',
    name: 'Arcane Prison Wave',
    description: 'Imported arcane control spell; prison-like lock.',
    category: 'control',
    ratio: 1.84,
    mpCost: 13,
    range: 9,
    cooldownTicks: 2,
    applyFreezeTicks: 1
  },
  {
    id: 'mana_pulse_beam',
    name: 'Mana Pulse Beam',
    description: 'Imported arcane pulse beam; medium burst.',
    category: 'burst',
    ratio: 1.52,
    mpCost: 10,
    range: 8,
    cooldownTicks: 1
  },
  {
    id: 'command_aura',
    name: 'Command Aura',
    description: 'Hero pressure pulse that keeps tempo.',
    category: 'utility',
    ratio: 1.18,
    mpCost: 3,
    range: 4.8,
    cooldownTicks: 2
  },
  {
    id: 'rally_call',
    name: 'Rally Call',
    description: 'Hero burst call to quickly re-engage.',
    category: 'burst',
    ratio: 1.4,
    mpCost: 5,
    range: 4.6,
    cooldownTicks: 4
  },
  {
    id: 'shield_wall',
    name: 'Shield Wall',
    description: 'Tank shove with stable frontline damage.',
    category: 'utility',
    ratio: 1.05,
    mpCost: 3,
    range: 2.4,
    cooldownTicks: 2
  },
  {
    id: 'taunt',
    name: 'Taunt',
    description: 'Tank control poke that briefly hinders target.',
    category: 'control',
    ratio: 0.95,
    mpCost: 4,
    range: 2.6,
    cooldownTicks: 3
  },
  {
    id: 'focus_shot',
    name: 'Focus Shot',
    description: 'High precision archer poke.',
    category: 'burst',
    ratio: 1.3,
    mpCost: 4,
    range: 7,
    cooldownTicks: 2
  },
  {
    id: 'volley',
    name: 'Volley',
    description: 'Archer sustained ranged pressure.',
    category: 'sustain',
    ratio: 1.12,
    mpCost: 4,
    range: 6.6,
    cooldownTicks: 3
  },
  {
    id: 'shadow_step',
    name: 'Shadow Step',
    description: 'Assassin gap-close burst.',
    category: 'mobility',
    ratio: 1.55,
    mpCost: 5,
    range: 3.1,
    cooldownTicks: 3
  },
  {
    id: 'backstab',
    name: 'Backstab',
    description: 'Assassin close-range spike damage.',
    category: 'execute',
    ratio: 1.78,
    mpCost: 6,
    range: 2.3,
    cooldownTicks: 4
  },
  {
    id: 'heal_wave',
    name: 'Heal Wave',
    description: 'Support pulse; modeled as low damage utility for now.',
    category: 'sustain',
    ratio: 0.9,
    mpCost: 4,
    range: 5.2,
    cooldownTicks: 2
  },
  {
    id: 'barrier',
    name: 'Barrier',
    description: 'Support control layer that can freeze shortly.',
    category: 'utility',
    ratio: 0.95,
    mpCost: 5,
    range: 5.6,
    cooldownTicks: 3
  },

  // ═══════════════════════════════════════════════════════════
  // Frost Mage — Freeze chain + Shatter burst + AOE control
  // ═══════════════════════════════════════════════════════════
  {
    id: 'chilling_touch',
    name: 'Chilling Touch',
    description: 'DOT freeze skill; extends control window on frozen targets.',
    category: 'control',
    ratio: 1.1,
    mpCost: 6,
    range: 7.5,
    cooldownTicks: 3,
    params: { dotDamage: 0.25, dotTicks: 3, freezeExtension: 2 }
  },
  {
    id: 'arctic_storm',
    name: 'Arctic Storm',
    description: 'Large AOE freeze; strong team fight control.',
    category: 'control',
    ratio: 1.6,
    mpCost: 10,
    range: 7,
    cooldownTicks: 3,
    applyFreezeTicks: 2
  },
  {
    id: 'frostslow_field',
    name: 'Frostslow Field',
    description: 'Massive slow zone; no freeze but heavy kite utility.',
    category: 'control',
    ratio: 0.85,
    mpCost: 7,
    range: 6,
    cooldownTicks: 2,
    params: { slowAmount: 0.7 }
  },
  {
    id: 'void_chain',
    name: 'Void Chain',
    description: 'Silences target; pairs with freeze for double lock.',
    category: 'control',
    ratio: 1.05,
    mpCost: 8,
    range: 7.5,
    cooldownTicks: 3,
    params: { silenceTicks: 2 }
  },
  {
    id: 'glacial_pierce',
    name: 'Glacial Pierce',
    description: 'Piercing shard; hits multiple enemies in a line.',
    category: 'burst',
    ratio: 1.3,
    mpCost: 7,
    range: 8.5,
    cooldownTicks: 2,
    shatterBonusRatio: 0.3
  },

  // ═══════════════════════════════════════════════════════════
  // Fire Mage — Burn DOT + AOE burst + Anti-freeze
  // ═══════════════════════════════════════════════════════════
  {
    id: 'burning_ground',
    name: 'Burning Ground',
    description: 'Undispellable burn DOT; anti-heal pressure.',
    category: 'sustain',
    ratio: 1.15,
    mpCost: 6,
    range: 6.5,
    cooldownTicks: 3,
    params: { dotDamage: 0.35, dotTicks: 4 }
  },
  {
    id: 'infernal_orb',
    name: 'Infernal Orb',
    description: 'High damage AOE fireball; team fight core burst.',
    category: 'burst',
    ratio: 1.7,
    mpCost: 10,
    range: 7,
    cooldownTicks: 3
  },
  {
    id: 'scorching_aura',
    name: 'Scorching Aura',
    description: 'Reduces enemy healing; anti-sustain pressure.',
    category: 'control',
    ratio: 0.9,
    mpCost: 5,
    range: 5,
    cooldownTicks: 2,
    params: { healReductionRatio: 0.45 }
  },
  {
    id: 'icefire_collision',
    name: 'Icefire Collision',
    description: 'Shatters frozen enemies; massive bonus vs frozen.',
    category: 'execute',
    ratio: 1.55,
    mpCost: 8,
    range: 7,
    cooldownTicks: 2,
    shatterBonusRatio: 0.6
  },

  // ═══════════════════════════════════════════════════════════
  // Heavy Tank — Group taunt + Block retaliation + Frontline damage absorption
  // ═══════════════════════════════════════════════════════════
  {
    id: 'iron_bastion',
    name: 'Iron Bastion',
    description: 'Shield absorbs burst; tanks frontlinePk.',
    category: 'utility',
    ratio: 0.9,
    mpCost: 6,
    range: 4,
    cooldownTicks: 3,
    params: { shieldRatio: 0.25 }
  },
  {
    id: 'shield_retaliation',
    name: 'Shield Retaliation',
    description: 'Reflects blocked magic damage back to attacker.',
    category: 'control',
    ratio: 1.05,
    mpCost: 7,
    range: 3.5,
    cooldownTicks: 3,
    params: { reflectRatio: 0.4 }
  },
  {
    id: 'warpull',
    name: 'Warpull',
    description: 'Pulls enemy to self; disruption + combo setup.',
    category: 'control',
    ratio: 0.95,
    mpCost: 8,
    range: 5,
    cooldownTicks: 3,
    params: { pullDistance: 3.5 }
  },
  {
    id: 'aegis_blessing',
    name: 'Aegis Blessing',
    description: 'Team-wide damage reduction aura; team survival core.',
    category: 'utility',
    ratio: 0.8,
    mpCost: 7,
    range: 4.5,
    cooldownTicks: 4,
    params: { teamDamageReduction: 0.2 }
  },
  {
    id: 'unstoppable_charge',
    name: 'Unstoppable Charge',
    description: 'Immunity dash; team fight initiation breakthrough skill.',
    category: 'mobility',
    ratio: 1.25,
    mpCost: 8,
    range: 2.5,
    cooldownTicks: 3,
    params: { immunityTicks: 2 }
  },

  // ═══════════════════════════════════════════════════════════
  // Ranged Archer — Pierce kiting + Charged sniper + Multi-shot scatter
  // ═══════════════════════════════════════════════════════════
  {
    id: 'piercing_arrow',
    name: 'Piercing Arrow',
    description: 'Pierces multiple enemies in a straight line.',
    category: 'burst',
    ratio: 1.35,
    mpCost: 5,
    range: 7.5,
    cooldownTicks: 2,
    params: { pierceCount: 3 }
  },
  {
    id: 'aimed_snipe',
    name: 'Aimed Snipe',
    description: 'Charged long-range execute; high risk reward.',
    category: 'execute',
    ratio: 1.95,
    mpCost: 9,
    range: 8.5,
    cooldownTicks: 4,
    params: { slowAmount: 0.4 }
  },
  {
    id: 'frost_trap',
    name: 'Frost Trap',
    description: 'Slow zone; remote kite and chase tool.',
    category: 'control',
    ratio: 1.05,
    mpCost: 4,
    range: 6,
    cooldownTicks: 2,
    params: { slowAmount: 0.55 }
  },
  {
    id: 'rain_of_arrows',
    name: 'Rain of Arrows',
    description: 'AOE sustained pressure; group poke.',
    category: 'sustain',
    ratio: 1.2,
    mpCost: 7,
    range: 7,
    cooldownTicks: 3
  },
  {
    id: 'keen_eye',
    name: 'Keen Eye',
    description: 'Mark target; team crit buff + damage amp.',
    category: 'utility',
    ratio: 0.9,
    mpCost: 4,
    range: 6,
    cooldownTicks: 3,
    params: { critBonus: 0.3, damageAmp: 0.2 }
  },

  // ═══════════════════════════════════════════════════════════
  // Shadow Assassin — Stealth + Multi-hit displacement + Backstab execute
  // ═══════════════════════════════════════════════════════════
  {
    id: 'shadow_cloak',
    name: 'Shadow Cloak',
    description: 'Invisibility on use; ambush / reposition tool.',
    category: 'mobility',
    ratio: 0.85,
    mpCost: 5,
    range: 4,
    cooldownTicks: 3,
    params: { invisibilityTicks: 3 }
  },
  {
    id: 'afterimage',
    name: 'Afterimage',
    description: 'Second dash; deals damage while leaving decoy.',
    category: 'mobility',
    ratio: 1.75,
    mpCost: 6,
    range: 4,
    cooldownTicks: 2,
    params: { dashDistance: 4 }
  },
  {
    id: 'lacerate',
    name: 'Lacerate',
    description: 'Bleed DOT; execute bonus at low HP.',
    category: 'execute',
    ratio: 1.3,
    mpCost: 5,
    range: 3,
    cooldownTicks: 3,
    params: { dotDamage: 0.3, dotTicks: 4, executeBonus: 0.45 }
  },
  {
    id: 'phantom_edge',
    name: 'Phantom Edge',
    description: 'Gap-close dash; second instance for flexible engage.',
    category: 'mobility',
    ratio: 1.5,
    mpCost: 6,
    range: 4.5,
    cooldownTicks: 2,
    params: { dashDistance: 5 }
  },
  {
    id: 'nox_strike',
    name: 'Nox Strike',
    description: 'Instant no-animation strike; no warning for target.',
    category: 'burst',
    ratio: 1.7,
    mpCost: 6,
    range: 3,
    cooldownTicks: 3
  },

  // ═══════════════════════════════════════════════════════════
  // Team Support — Group heal + ATK/DEF buff + Cleanse and healing reduction
  // ═══════════════════════════════════════════════════════════
  {
    id: 'radiance',
    name: 'Radiance',
    description: 'Team HOT plus shield; sustainable sustain.',
    category: 'sustain',
    ratio: 1.35,
    mpCost: 8,
    range: 5.5,
    cooldownTicks: 3,
    params: { hotTickHeal: 0.2, hotTicks: 3, shieldRatio: 0.1 }
  },
  {
    id: 'blessing_might',
    name: 'Blessing of Might',
    description: 'Ally ATK buff; damage amp for allies.',
    category: 'utility',
    ratio: 0.9,
    mpCost: 5,
    range: 4.5,
    cooldownTicks: 3,
    params: { atkBonus: 0.35, buffTicks: 4 }
  },
  {
    id: 'weakening_hex',
    name: 'Weakening Hex',
    description: 'Enemy ATK/DEF debuff; weakens overall enemy combat capability.',
    category: 'control',
    ratio: 0.95,
    mpCost: 6,
    range: 4,
    cooldownTicks: 3,
    params: { atkDebuff: 0.3, defDebuff: 0.25, debuffTicks: 3 }
  },
  {
    id: 'purification',
    name: 'Purification',
    description: 'Cleanses 2 debuffs from ally plus shield absorb.',
    category: 'utility',
    ratio: 0.8,
    mpCost: 7,
    range: 5,
    cooldownTicks: 4,
    params: { cleanseCount: 2, shieldRatio: 0.15 }
  },
  {
    id: 'guardian_angel',
    name: 'Guardian Angel',
    description: 'Short invulnerability plus full debuff cleanse; clutch save.',
    category: 'utility',
    ratio: 0.85,
    mpCost: 10,
    range: 5.5,
    cooldownTicks: 5,
    params: { invulTicks: 2 }
  }
]

function withScaledCooldown(skill: BattleSkillDefinition): BattleSkillDefinition {
  return {
    ...skill,
    cooldownTicks: Math.max(0, Math.floor(Number(skill.cooldownTicks || 0))) * SKILL_COOLDOWN_MULTIPLIER,
  }
}

const SKILL_MAP = new Map(SKILLS.map((skill) => {
  const scaled = withScaledCooldown(skill)
  return [scaled.id, scaled] as const
}))
const ROLE_SKILL_LOADOUTS: Record<string, string[]> = {
  hero: ['rally_call', 'command_aura', 'shield_wall', 'arcane_bolt', 'frost_lock', 'focus_shot'],
  tank: ['shield_wall', 'taunt', 'barrier', 'iron_bastion', 'shield_retaliation', 'warpull', 'aegis_blessing', 'unstoppable_charge'],
  archer: ['focus_shot', 'volley', 'arcane_bolt', 'piercing_arrow', 'aimed_snipe', 'frost_trap', 'rain_of_arrows', 'keen_eye'],
  mage: ['fireball', 'ice_nova', 'arcane_bolt', 'frost_lock', 'chilling_touch', 'arctic_storm', 'frostslow_field', 'void_chain', 'glacial_pierce', 'burning_ground', 'infernal_orb', 'scorching_aura', 'icefire_collision'],
  healer: ['heal_wave', 'barrier', 'command_aura', 'radiance', 'blessing_might', 'weakening_hex', 'purification', 'guardian_angel'],
  assassin: ['shadow_step', 'backstab', 'arcane_bolt', 'shadow_cloak', 'afterimage', 'lacerate', 'phantom_edge', 'nox_strike']
}

/**
 * Tight signature set used by role inference (role-inference.ts).
 * Only skills that are STRONGLY characteristic of a role belong here —
 * unlike `ROLE_SKILL_LOADOUTS`, which lists all skills a role can use.
 *
 * Iteration order matters when multiple roles tie: first-declared wins.
 */
const ROLE_SKILL_SIGNATURES: Record<string, readonly string[]> = {
  hero: ['rally_call', 'command_aura', 'shield_wall'],
  tank: ['shield_wall', 'taunt', 'iron_bastion', 'shield_retaliation', 'warpull', 'aegis_blessing', 'unstoppable_charge'],
  archer: ['focus_shot', 'volley', 'piercing_arrow', 'aimed_snipe', 'frost_trap', 'rain_of_arrows', 'keen_eye'],
  mage: ['fireball', 'ice_nova', 'arcane_bolt', 'frost_lock', 'chilling_touch', 'arctic_storm', 'glacial_pierce', 'infernal_orb'],
  healer: ['heal_wave', 'radiance', 'blessing_might', 'weakening_hex', 'purification', 'guardian_angel'],
  assassin: ['shadow_step', 'backstab', 'shadow_cloak', 'afterimage', 'lacerate', 'phantom_edge', 'nox_strike'],
}

export function getBattleSkillDefinition(skillId: string): BattleSkillDefinition | undefined {
  return SKILL_MAP.get(skillId)
}

export function getAllBattleSkillDefinitions(): BattleSkillDefinition[] {
  return Array.from(SKILL_MAP.values())
}

export function upsertBattleSkillDefinition(
  skill: BattleSkillDefinition,
  options?: { cooldownTickMultiplier?: number },
): BattleSkillDefinition {
  const cdMult = options?.cooldownTickMultiplier ?? SKILL_COOLDOWN_MULTIPLIER
  const normalized: BattleSkillDefinition = {
    ...skill,
    id: String(skill.id || '').trim(),
    name: String(skill.name || skill.id || '').trim(),
    ratio: Number(skill.ratio || 1),
    mpCost: Math.max(0, Number(skill.mpCost || 0)),
    range: Math.max(0.5, Number(skill.range || 1)),
    cooldownTicks:
      Math.max(0, Math.floor(Number(skill.cooldownTicks || 0))) * cdMult,
    applyFreezeTicks:
      typeof skill.applyFreezeTicks === 'number'
        ? Math.max(0, Math.floor(Number(skill.applyFreezeTicks)))
        : undefined,
    shatterBonusRatio:
      typeof skill.shatterBonusRatio === 'number' ? Number(skill.shatterBonusRatio) : undefined,
    consumeFreezeOnHit:
      typeof skill.consumeFreezeOnHit === 'boolean' ? skill.consumeFreezeOnHit : undefined
  }
  SKILL_MAP.set(normalized.id, normalized)
  return normalized
}

export function upsertBattleSkillDefinitions(skills: BattleSkillDefinition[]): BattleSkillDefinition[] {
  return skills.map((skill) => upsertBattleSkillDefinition(skill))
}

export function getRoleSkillLoadout(role: string): string[] {
  const key = String(role || '').trim().toLowerCase()
  return ROLE_SKILL_LOADOUTS[key] ? [...ROLE_SKILL_LOADOUTS[key]] : ['arcane_bolt', 'frost_lock']
}

/**
 * Ordered list of (role, signature skill ids) entries used by role inference.
 * Returning an array of tuples (vs a Record) preserves declaration order so
 * that ties are broken predictably without relying on JS object-key iteration.
 */
export function getBattleSkillRoleSignatures(): Array<readonly [string, readonly string[]]> {
  return Object.entries(ROLE_SKILL_SIGNATURES)
}

