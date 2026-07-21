import { BATTLE_BALANCE } from '../../../config/battle-balance'
import type { DecisionAction, DecisionContext, TacticalMode } from './decision-context'
import { KITE_EXTRA_RANGE, MELEE_RANGE } from './decision-constants'
import type { StrategyTemplateName } from './strategy-template'

export type StoredIntent = {
  mode: TacticalMode
  action: DecisionAction
  template?: StrategyTemplateName
  createdTick: number
  expiresAtTick: number
  consecutiveRejectCount: number
}

export type RefreshReason =
  | 'no_intent'
  | 'expired'
  | 'mode_changed'
  | 'consecutive_rejects'
  | 'hp_spike'
  | 'being_controlled'
  | 'target_frozen_window'
  | 'target_died'

type ActorSnapshot = {
  tick: number
  hpRatio: number
}

export type ActionRecord = {
  tick: number
  actionKey: string
}

const PLAN_REUSE_TICKS = 4
const MAX_CONSECUTIVE_REJECTS = 2
const HP_SPIKE_THRESHOLD = 0.15
const MAX_ACTION_HISTORY = 24

export class IntentStore {
  private intents = new Map<string, StoredIntent>()
  private snapshots = new Map<string, ActorSnapshot>()
  private actionHistory = new Map<string, ActionRecord[]>()

  get(actorId: string, currentTick: number, currentMode: TacticalMode): StoredIntent | null {
    const intent = this.intents.get(actorId)
    if (!intent) return null
    if (currentTick > intent.expiresAtTick) return null
    if (intent.mode !== currentMode) return null
    if (intent.consecutiveRejectCount >= MAX_CONSECUTIVE_REJECTS) return null
    return intent
  }

  /**
   * Checks whether the current plan should be refreshed.
   * Mirrors ProjectCarp's `getIntentRefreshReason` logic:
   * - No plan / expired / mode changed / consecutive rejects
   * - HP spike (sudden large drop)
   * - Being controlled (frozen/stunned)
   * - Target frozen window (opportunity to burst)
   */
  needsRefresh(actorId: string, ctx: DecisionContext): RefreshReason | null {
    const intent = this.intents.get(actorId)
    if (!intent) return 'no_intent'
    if (ctx.tick > intent.expiresAtTick) return 'expired'
    if (intent.consecutiveRejectCount >= MAX_CONSECUTIVE_REJECTS) return 'consecutive_rejects'

    const snapshot = this.snapshots.get(actorId)
    if (snapshot && ctx.actorHpRatio < snapshot.hpRatio - HP_SPIKE_THRESHOLD) {
      return 'hp_spike'
    }

    if (ctx.isControlled) {
      return 'being_controlled'
    }

    const targetFrozen = ctx.target.effects.some((e) => e.effectType === 'freeze')
    if (targetFrozen && intent.mode !== 'finish') {
      return 'target_frozen_window'
    }

    if (!ctx.target.alive) return 'target_died'

    const mode = this.inferCurrentMode(ctx)
    if (mode !== intent.mode) return 'mode_changed'

    return null
  }

  set(
    actorId: string,
    mode: TacticalMode,
    action: DecisionAction,
    currentTick: number,
    template?: StrategyTemplateName,
  ): void {
    this.intents.set(actorId, {
      mode,
      action,
      template,
      createdTick: currentTick,
      expiresAtTick: currentTick + PLAN_REUSE_TICKS,
      consecutiveRejectCount: 0,
    })
  }

  recordReject(actorId: string): void {
    const intent = this.intents.get(actorId)
    if (intent) {
      intent.consecutiveRejectCount += 1
    }
  }

  updateSnapshot(actorId: string, tick: number, hpRatio: number): void {
    this.snapshots.set(actorId, { tick, hpRatio })
  }

  recordAction(actorId: string, tick: number, action: DecisionAction): void {
    let history = this.actionHistory.get(actorId)
    if (!history) {
      history = []
      this.actionHistory.set(actorId, history)
    }
    history.push({ tick, actionKey: actionToKey(action) })
    if (history.length > MAX_ACTION_HISTORY) {
      history.shift()
    }
  }

  getRecentActionKeys(actorId: string, count: number): string[] {
    const history = this.actionHistory.get(actorId)
    if (!history) return []
    return history.slice(-count).map((r) => r.actionKey)
  }

  buildMemorySummary(actorId: string): string {
    const history = this.actionHistory.get(actorId)
    if (!history || history.length === 0) return 'No recent actions.'
    const last20 = history.slice(-20)
    return last20.map((r) => `t${r.tick}:${r.actionKey}`).join(', ')
  }

  invalidate(actorId: string): void {
    this.intents.delete(actorId)
  }

  clear(): void {
    this.intents.clear()
    this.snapshots.clear()
    this.actionHistory.clear()
  }

  private inferCurrentMode(ctx: DecisionContext): TacticalMode {
    if (
      ctx.targetHpRatio <= BATTLE_BALANCE.tacticalTargetLowHpFinishRatio &&
      ctx.distance <= Math.max(MELEE_RANGE + 0.4, ctx.preferredRange)
    ) {
      return 'finish'
    }
    if (ctx.preferredRange > MELEE_RANGE + KITE_EXTRA_RANGE) return 'kite'
    return 'trade'
  }
}

function actionToKey(action: DecisionAction): string {
  if (action.type === 'cast_skill') return `cast:${action.skillId}`
  return action.type
}
