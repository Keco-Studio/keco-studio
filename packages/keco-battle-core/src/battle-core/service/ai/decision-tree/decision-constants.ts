/**
 * Shared decision-tree constants. Centralizes magic numbers that were
 * previously duplicated across action-selector / strategy-template /
 * decision-guardrail / tactical-selector / intent-store / llm-prompt-builder.
 *
 * Game-balance values live in `BATTLE_BALANCE`; values here are
 * structural knobs of the AI decision pipeline itself.
 */

/** Basic-attack melee range (shared with command-processor authoritative checks). */
export const MELEE_RANGE = 1.6

/** Kite trees treat "too close" as preferredRange minus this (min MELEE+extra). */
export const KITE_EXTRA_RANGE = 0.6

/** Minimum displacement a dash target must have, otherwise returned as null. */
export const MIN_MOVE_DELTA = 0.15

/** Approach helper: stay this far from target's cast range edge. */
export const APPROACH_STAY_OFFSET = 0.5

/** Approach helper: minimum stay distance from target regardless of skill range. */
export const APPROACH_MIN_STAY = 1.1

/** Retreat step scaling factors from preferred range. */
export const RETREAT_STEP = {
  xMin: 1.2,
  xMax: 3.6,
  xScale: 0.55,
  yMin: 0.8,
  yMax: 2.1,
  yScale: 0.35,
} as const

/** Clearance buffers for map bounds clamping. */
export const MAP_EDGE = {
  corner: 1.1,
  halfCell: 0.5,
} as const

/** Movement speeds used by specific templates/trees. */
export const MOVE_STEP = {
  pressureChase: 2.2,
  kiteBack: 2.4,
  burstClose: 2.4,
  retreatFast: 2.8,
  baitRetreat: 1.8,
} as const

/** Guardrail thresholds. */
export const GUARDRAIL = {
  criticalHpRatio: 0.15,
  criticalHpFarDistance: 4,
  criticalHpHpAdvantageGap: 0.1,
  earlyTickThreshold: 8,
  earlyFleeHpGate: 0.35,
  highHpFleeGate: 0.42,
  consecutiveDashLimit: 3,
} as const
