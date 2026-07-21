import type { BattleSession } from '../../domain/entities/battle-session'
import type { RawBattleDecision } from './auto-decision-engine'

export type ArbitrationContext = {
  session: BattleSession
  actorId: string
}

/**
 * Chooses between the current behavior-tree single-step decision and the macro LLM payload
 * (single action or multi-step sequence). Higher heuristic score wins.
 */
export function arbitrateBehaviorTreeVsLlmMacro(
  bt: RawBattleDecision,
  llmExpanded: RawBattleDecision | null | undefined,
  ctx: ArbitrationContext,
): RawBattleDecision {
  if (!llmExpanded || typeof llmExpanded !== 'object') {
    return tagPick(bt, 'bt', null, null)
  }

  const hasSeq = Array.isArray(llmExpanded.sequence) && llmExpanded.sequence.length > 0
  const hasSingle =
    typeof llmExpanded.action === 'string' && llmExpanded.action.trim().length > 0

  if (!hasSeq && !hasSingle) {
    return tagPick(bt, 'bt', null, null)
  }

  const scoreBt = scoreRawDecision(bt, ctx)
  const scoreLlm = hasSeq ? scoreLlmSequencePlan(llmExpanded, ctx) : scoreRawDecision(llmExpanded, ctx)

  if (scoreLlm > scoreBt) {
    return tagPick(llmExpanded, 'llm_macro', scoreBt, scoreLlm)
  }
  return tagPick(bt, 'bt', scoreBt, scoreLlm)
}

function tagPick(
  raw: RawBattleDecision,
  picked: 'bt' | 'llm_macro',
  scoreBt: number | null,
  scoreLlm: number | null,
): RawBattleDecision {
  const meta = {
    ...(typeof raw.metadata === 'object' && raw.metadata ? raw.metadata : {}),
    arbitrationPicked: picked,
    ...(scoreBt != null && scoreLlm != null ? { arbitrationScores: { bt: scoreBt, llm: scoreLlm } } : {}),
  }
  return { ...raw, metadata: meta }
}

function hpRatioForActor(session: BattleSession, actorId: string): number {
  const actor = session.left.id === actorId ? session.left : session.right
  const maxHp = Math.max(1, actor.resources.maxHp)
  return actor.resources.hp / maxHp
}

function opponentHpRatioForActor(session: BattleSession, actorId: string): number {
  const opponent = session.left.id === actorId ? session.right : session.left
  const maxHp = Math.max(1, opponent.resources.maxHp)
  return opponent.resources.hp / maxHp
}

/** Self HP in the same band as the legacy "critical" row in `scoreRawDecision`. */
const SELF_CRITICAL_HP = 0.3
/** Opponent also low: mutual finish / trade window; do not treat `flee` as the automatic best pick. */
const OPP_CRITICAL_HP = 0.3

function scoreRawDecision(raw: RawBattleDecision, ctx: ArbitrationContext): number {
  const hpRatio = hpRatioForActor(ctx.session, ctx.actorId)
  const oppHpRatio = opponentHpRatioForActor(ctx.session, ctx.actorId)
  const action = typeof raw.action === 'string' ? raw.action : ''

  if (hpRatio <= SELF_CRITICAL_HP) {
    const bothCritical = oppHpRatio <= OPP_CRITICAL_HP
    if (bothCritical) {
      if (action === 'cast_skill') return 92
      if (action === 'basic_attack') return 86
      if (action === 'dash' || action === 'dodge') return 78
      if (action === 'flee') return 58
      return 52
    }
    if (action === 'flee') return 95
    if (action === 'dash' || action === 'dodge') return 88
    if (action === 'cast_skill') return 48
    if (action === 'basic_attack') return 28
    return 35
  }

  if (hpRatio <= 0.55) {
    const defensive = action === 'dodge' || action === 'dash' || action === 'flee'
    if (defensive) return 72
  }

  const weights: Record<string, number> = {
    cast_skill: 74,
    basic_attack: 70,
    dash: 58,
    dodge: 56,
    flee: 78,
  }
  return weights[action] ?? 42
}

function scoreLlmSequencePlan(llm: RawBattleDecision, ctx: ArbitrationContext): number {
  const seq = llm.sequence as unknown[]
  const first = seq[0]
  const firstScore = scoreSequenceStepLoose(first, ctx)
  const depth = Math.min(seq.length, 24)
  const depthBonus = depth * 0.3
  return firstScore + depthBonus
}

function scoreSequenceStepLoose(step: unknown, ctx: ArbitrationContext): number {
  if (!step || typeof step !== 'object') return 20
  const s = step as Record<string, unknown>
  const action = typeof s.action === 'string' ? s.action : ''
  const pseudo: RawBattleDecision = { action }
  return scoreRawDecision(pseudo, ctx)
}
