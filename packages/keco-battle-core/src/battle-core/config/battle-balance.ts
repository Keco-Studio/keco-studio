export const BATTLE_BALANCE = {
  // A1: extend default auto battle duration for demos.
  defaultAutoSimMaxTicks: 60,
  hardMaxAutoSimTicks: 180,
  shortBattleTicksThreshold: 18,
  // A1: reduce burstiness so fights are less likely to end too quickly.
  basicDamageMultiplier: 0.72,
  skillDamageMultiplier: 0.82,
  // A2: introduce simple shield/rage economy.
  dodgeStaminaCost: 20,
  dodgeEvadeChance: 0.7,
  rageGainOnDealScale: 0.7,
  rageGainOnTakenScale: 1,
  // A3: tactical behavior tuning for map battle.
  tacticalRangeBuffer: 0.2,
  tacticalKiteMinDistance: 2.4,
  /** Below this ratio = "low HP" for retreat *candidate*; retreat only if also blood-disadvantaged (see selectTacticalMode). */
  tacticalLowHpRetreatRatio: 0.3,
  tacticalTargetLowHpFinishRatio: 0.22
} as const

