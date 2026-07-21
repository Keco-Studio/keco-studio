import { BATTLE_BALANCE } from '../../../config/battle-balance'
import type { DecisionContext, TacticalMode } from './decision-context'
import { KITE_EXTRA_RANGE, MELEE_RANGE } from './decision-constants'

export function selectTacticalMode(ctx: DecisionContext): TacticalMode {
  // Retreat tactical mode disabled — low HP still fights via finish/kite/trade.

  if (
    ctx.targetHpRatio <= BATTLE_BALANCE.tacticalTargetLowHpFinishRatio &&
    ctx.distance <= Math.max(MELEE_RANGE + 0.4, ctx.preferredRange)
  ) {
    return 'finish'
  }

  if (ctx.preferredRange > MELEE_RANGE + KITE_EXTRA_RANGE) {
    return 'kite'
  }

  return 'trade'
}
