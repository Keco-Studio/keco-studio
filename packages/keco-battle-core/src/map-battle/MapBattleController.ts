import { BattleTickEngine } from '../battle-core/engine/tick-engine'
import { enqueueBattleCommand } from '../battle-core/engine/command-processor'
import type { BattleCommand } from '../battle-core/domain/types/command-types'
import type { BattleEntity } from '../battle-core/domain/entities/battle-entity'
import type { BattleSession } from '../battle-core/domain/entities/battle-session'
import { createMapBattleSession, newCommandId, type MapBattleStartConfig } from './createMapBattleSession'
import { getPocBattleUiOutcome } from './battleOutcome'
import { cooldownMsFromTicks, getSkillById, BASIC_ATTACK } from '../compat/pocSkills'
import { getBattleSkillDefinition } from '../battle-core/content/skills/basic-skill-catalog'
import { BATTLE_BALANCE } from '../battle-core/config/battle-balance'
import { BattleCoreOrchestrator, type RawSequenceData } from '../battle-core/service/ai/battle-core-orchestrator'
import { pickLongTermBtSeed, updateLongTermBtAfterBattle } from '../battle-core/service/ai/long-term-bt-memory'
import { ActionSequenceStore, parseSequenceFromLlm } from '../battle-core/service/ai/decision-tree/action-sequence'
import { clampDashDestination } from './walkability'
import { resolveBattleDashPosition } from './battleGridMovement'
import type { BattleCommandWalkContext } from '../battle-core/engine/command-processor'
import {
  selectTacticalMode,
  selectAction,
  applyGuardrail,
  remapDashToAlternative,
  IntentStore,
  inferRoleProfile,
  defaultTemplateForRole,
  executeStrategyTemplate,
  preferElementReactionAction,
  type DecisionContext,
  type DecisionAction,
  type TacticalMode,
  type ReadySkill,
} from '../battle-core/service/ai/decision-tree'
import { buildWalkableRowsForLlm } from '../battle-core/service/ai/decision-tree/map-grid-for-llm'

const MELEE_RANGE = 1.6
const RANGE_BUFFER = BATTLE_BALANCE.tacticalRangeBuffer
const DEFAULT_BATTLE_TICK_MS = 200
// const MAX_BATTLE_TICKS = 300 — stalemate timeout disabled (see applyStalemateTimeoutIfNeeded)

function distBetween(session: BattleSession): number {
  const a = session.left.position
  const b = session.right.position
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function intervalTicksForSpd(spd: number, battleTickMs: number): number {
  const mappedAttackSpeed = Math.max(0.4, 0.8 + (Math.max(1, spd) - 3) * 0.05)
  const secondsPerAction = Math.max(0.8, 0.8 / mappedAttackSpeed)
  const ticks = Math.round((secondsPerAction * 1000) / Math.max(80, battleTickMs))
  return Math.max(1, ticks)
}

function buildReadySkills(actor: BattleEntity, tick: number, distance: number): ReadySkill[] {
  const result: ReadySkill[] = []
  for (let i = 0; i < actor.skillSlots.length; i++) {
    const slot = actor.skillSlots[i]
    const def = getBattleSkillDefinition(slot.skillId)
    if (!def) continue
    if (slot.cooldownTick > tick) continue
    if (actor.resources.mp < def.mpCost) continue
    result.push({
      definition: def,
      slotIndex: i,
      inRange: distance <= def.range + RANGE_BUFFER,
    })
  }
  return result
}

function buildDecisionContext(
  session: BattleSession,
  actor: BattleEntity,
  target: BattleEntity,
  tick: number,
  distance: number,
  readySkills: ReadySkill[],
): DecisionContext {
  const bestRanged = readySkills.reduce(
    (best, s) => (s.definition.range > best ? s.definition.range : best),
    MELEE_RANGE,
  )
  const preferredRange = readySkills.length > 0 ? bestRanged : MELEE_RANGE
  const isControlled = actor.effects.some(
    (e) => e.effectType === 'freeze' || e.effectType === 'stun',
  )
  return {
    session,
    actor,
    target,
    tick,
    distance,
    actorHpRatio: actor.resources.maxHp > 0 ? actor.resources.hp / actor.resources.maxHp : 1,
    targetHpRatio: target.resources.maxHp > 0 ? target.resources.hp / target.resources.maxHp : 1,
    readySkills,
    preferredRange,
    isControlled,
    mapBounds: {
      minX: session.mapBounds.minX,
      maxX: session.mapBounds.maxX,
      minY: session.mapBounds.minY,
      maxY: session.mapBounds.maxY,
    },
    actorRole: inferRoleProfile(actor),
    targetRole: inferRoleProfile(target),
  }
}

export type MapBattleStepResult = {
  session: BattleSession
  uiOutcome: ReturnType<typeof getPocBattleUiOutcome>
  newEventCount: number
  remainingPreparationTicks: number
}

export class MapBattleController {
  session: BattleSession
  private readonly engine = new BattleTickEngine()
  private readonly decisionMode: 'manual' | 'dual_llm'
  private readonly llmOrchestrator: BattleCoreOrchestrator | null
  private nextPlayerDue = 1
  private nextEnemyDue = 1
  private playerInterval: number
  private enemyInterval: number
  private readonly mapW: number
  private readonly mapH: number
  private readonly isWalkable?: (gx: number, gy: number) => boolean
  private readonly intentStore = new IntentStore()
  private readonly sequenceStore = new ActionSequenceStore()
  private battleStartTick = 0

  constructor(cfg: MapBattleStartConfig) {
    const mapW = cfg.mapWidth
    const mapH = cfg.mapHeight
    const isWalkable = cfg.isWalkable
    this.mapW = mapW
    this.mapH = mapH
    this.isWalkable = isWalkable

    this.session = cfg.initialSession ?? createMapBattleSession(cfg)
    this.decisionMode = cfg.battleDecisionMode || 'manual'
    this.llmOrchestrator =
      this.decisionMode === 'dual_llm'
        ? new BattleCoreOrchestrator({
          llmConfig: cfg.llmConfig,
          behaviorTreeLog: process.env.NODE_ENV === 'development',
          resolveSeedBehaviorTree: ({ session, actorId }) => {
            if (actorId === session.left.id) {
              return pickLongTermBtSeed({
                role: 'human',
                opponentKey: session.right.id,
                currentActorId: session.left.id,
              })
            }
            if (actorId === session.right.id) {
              return pickLongTermBtSeed({
                role: 'enemy',
                opponentKey: session.right.id,
                currentActorId: session.right.id,
              })
            }
            return null
          },
          augmentLlmContext: ({ session, actor, target }) => {
            const dist = Math.hypot(actor.position.x - target.position.x, actor.position.y - target.position.y)
            const readySkills = buildReadySkills(actor, session.tick, dist)
            const ctx = buildDecisionContext(session, actor, target, session.tick, dist, readySkills)
            const tacticalMode = selectTacticalMode(ctx)
            return {
              mapGrid: isWalkable
                ? {
                  width: mapW,
                  height: mapH,
                  walkableRows: buildWalkableRowsForLlm(mapW, mapH, isWalkable),
                }
                : undefined,
              battleId: session.id,
              currentIntent: tacticalMode,
            }
          },
          onLlmSingleActionCommitted: (actorId) => {
            this.sequenceStore.invalidate(actorId)
          },
          shouldDeferPrefetch: (actorId) => this.sequenceStore.hasActiveSequence(actorId),
        })
        : null
    this.llmOrchestrator?.ensureLlmAvailability()
    const battleTickMs = Math.max(80, Math.floor(Number(cfg.battleTickMs || DEFAULT_BATTLE_TICK_MS)))
    this.playerInterval = intervalTicksForSpd(this.session.left.spd, battleTickMs)
    this.enemyInterval = intervalTicksForSpd(this.session.right.spd, battleTickMs)
    this.battleStartTick = this.session.preparationEndTick
  }

  public getDecisionMode(): 'manual' | 'dual_llm' {
    return this.decisionMode
  }

  public getLlmRuntimeStatus(): 'available' | 'unavailable' | 'unknown' | 'disabled' {
    if (this.decisionMode !== 'dual_llm') return 'disabled'
    if (!this.llmOrchestrator) return 'unavailable'
    return this.llmOrchestrator.getLlmRuntimeStatus()
  }

  private buildCommandWalkContext(): BattleCommandWalkContext | undefined {
    if (!this.isWalkable) return undefined
    return {
      mapW: this.mapW,
      mapH: this.mapH,
      isTerrainWalkable: this.isWalkable,
    }
  }

  private clampDashMoveTarget(actor: BattleEntity, tx: number, ty: number): { x: number; y: number } {
    if (!this.isWalkable) {
      return { x: tx, y: ty }
    }
    return clampDashDestination({
      from: actor.position,
      to: { x: tx, y: ty },
      mapW: this.mapW,
      mapH: this.mapH,
      isWalkable: this.isWalkable,
    })
  }

  private clampDashGoal(tx: number, ty: number): { x: number; y: number } {
    const minX = this.session.mapBounds.minX + 0.5
    const maxX = this.session.mapBounds.maxX - 0.5
    const minY = this.session.mapBounds.minY + 0.5
    const maxY = this.session.mapBounds.maxY - 0.5
    return {
      x: Math.max(minX, Math.min(maxX, tx)),
      y: Math.max(minY, Math.min(maxY, ty)),
    }
  }

  private resolveDashMoveStep(action: Extract<DecisionAction, { type: 'dash' }>): number {
    return action.moveStep != null
      ? Math.max(0.4, Math.min(4.2, Number(action.moveStep)))
      : 2.2
  }

  /**
   * When there is no walk grid, approximate one dash step (axis-aligned) toward the clamped ray target — matches command-processor fallback.
   */
  private lineDashOneStepNoTerrain(
    actor: BattleEntity,
    target: BattleEntity,
    goalX: number,
    goalY: number,
    moveStep: number,
  ): { x: number; y: number } | null {
    const c = this.clampDashMoveTarget(actor, goalX, goalY)
    const minX = this.session.mapBounds.minX + 0.5
    const maxX = this.session.mapBounds.maxX - 0.5
    const minY = this.session.mapBounds.minY + 0.5
    const maxY = this.session.mapBounds.maxY - 0.5

    const deltaX = c.x - actor.position.x
    const movedX =
      deltaX === 0
        ? actor.position.x
        : actor.position.x + Math.sign(deltaX) * Math.min(Math.abs(deltaX), moveStep)
    const minGap = 1.2
    const safeX = actor.team === 'left'
      ? Math.max(minX, Math.min(maxX, Math.min(movedX, target.position.x - minGap)))
      : Math.max(minX, Math.min(maxX, Math.max(movedX, target.position.x + minGap)))

    const deltaY = c.y - actor.position.y
    const movedY =
      deltaY === 0
        ? actor.position.y
        : actor.position.y + Math.sign(deltaY) * Math.min(Math.abs(deltaY), moveStep * 0.6)
    const safeY = Math.max(minY, Math.min(maxY, movedY))

    if (Math.hypot(safeX - actor.position.x, safeY - actor.position.y) <= 0.12) {
      return null
    }
    return { x: safeX, y: safeY }
  }

  /** Whether a dash toward goal would move this tick (pathfinding when terrain exists). */
  private canDashReachGoal(
    actor: BattleEntity,
    opponent: BattleEntity,
    goalX: number,
    goalY: number,
    action: Extract<DecisionAction, { type: 'dash' }>,
  ): boolean {
    const goal = this.clampDashGoal(goalX, goalY)
    const moveStep = this.resolveDashMoveStep(action)
    const walk = this.buildCommandWalkContext()
    if (walk) {
      const next = resolveBattleDashPosition({
        session: this.session,
        actor,
        opponent,
        clampedTargetX: goal.x,
        clampedTargetY: goal.y,
        moveStep,
        walk,
      })
      return Math.hypot(next.x - actor.position.x, next.y - actor.position.y) > 0.12
    }
    const step = this.lineDashOneStepNoTerrain(actor, opponent, goal.x, goal.y, moveStep)
    return step != null
  }

  step(input: {
    executeAtTick: number
    nextAttackSkillId: string | null
    pendingFlee: boolean
    pendingFleeSource?: 'manual' | 'auto' | null
    onClearQueuedSkill?: () => void
    onSkillCooldown?: (skillId: string, cooldownMs: number) => void
  }): MapBattleStepResult {
    const eventsBefore = this.session.events.length
    const wasOngoingAtEntry = this.session.result === 'ongoing'

    if (!wasOngoingAtEntry) {
      return {
        session: this.session,
        uiOutcome: getPocBattleUiOutcome(this.session),
        newEventCount: 0,
        remainingPreparationTicks: Math.max(0, this.session.preparationEndTick - this.session.tick),
      }
    }

    if (input.pendingFlee) {
      const fleeReason = input.pendingFleeSource === 'auto' ? 'auto_flee' : 'manual_flee'
      const cmd: BattleCommand = {
        commandId: newCommandId(),
        sessionId: this.session.id,
        actorId: this.session.left.id,
        tick: input.executeAtTick,
        action: 'flee',
        targetId: this.session.right.id,
      }
      this.enqueueIntentCommand(cmd, 'retreat', fleeReason, 'root>flee')
      const out = this.engine.tick(this.session, this.buildCommandWalkContext())
      this.session = out.session
    } else if (this.decisionMode === 'dual_llm' && this.llmOrchestrator) {
      this.llmOrchestrator.ensureLlmAvailability()
      if (!this.llmOrchestrator.shouldUseLlm()) {
        const dist = distBetween(this.session)
        this.enqueueEnemyIntent(input.executeAtTick, dist)
        this.enqueuePlayerIntent(input.executeAtTick, dist, input)
        const out = this.engine.tick(this.session, this.buildCommandWalkContext())
        this.session = out.session
      } else {
        const prepared = this.llmOrchestrator.prepareCommands(
          this.session,
          input.executeAtTick,
          this.buildCommandWalkContext(),
        )
        this.session = prepared.session
        this.registerLlmSequences(prepared.sequences, input.executeAtTick)
        const dist = distBetween(this.session)
        const tick = input.executeAtTick
        const orch = this.llmOrchestrator
        const leftId = this.session.left.id
        const rightId = this.session.right.id
        // LLM 可用时：仅使用 prepareCommands 入队的指令 + 多步 sequence（经 enqueue* 里的 resolveDecision 消费）。
        // 请求进行中则等待；无指令且无 sequence 时不走本地战术树（与 shouldUseLlm===false 分支区分）。
        if (this.hasBattleCommandForActorAtTick(this.session, leftId, tick)) {
          this.nextPlayerDue = tick + this.playerInterval
        } else if (!orch.isPrefetchPending(leftId) && this.sequenceStore.hasActiveSequence(leftId)) {
          this.enqueuePlayerIntent(tick, dist, input)
        }
        if (this.hasBattleCommandForActorAtTick(this.session, rightId, tick)) {
          this.nextEnemyDue = tick + this.enemyInterval
        } else if (!orch.isPrefetchPending(rightId) && this.sequenceStore.hasActiveSequence(rightId)) {
          this.enqueueEnemyIntent(tick, dist)
        }
        const out = this.engine.tick(this.session, this.buildCommandWalkContext())
        this.session = out.session
        this.llmOrchestrator.onTickFinished(this.session, this.buildCommandWalkContext())
      }
    } else {
      const dist = distBetween(this.session)
      this.enqueueEnemyIntent(input.executeAtTick, dist)
      this.enqueuePlayerIntent(input.executeAtTick, dist, input)
      const out = this.engine.tick(this.session, this.buildCommandWalkContext())
      this.session = out.session
    }

    // Stalemate cap disabled: battles are not force-ended by tick count.
    // this.applyStalemateTimeoutIfNeeded()

    const uiOutcome = getPocBattleUiOutcome(this.session)

    if (
      wasOngoingAtEntry &&
      this.session.result !== 'ongoing' &&
      this.decisionMode === 'dual_llm' &&
      this.llmOrchestrator
    ) {
      updateLongTermBtAfterBattle({
        result: this.session.result,
        opponentKey: this.session.right.id,
        leftActorId: this.session.left.id,
        rightActorId: this.session.right.id,
        leftTree: this.llmOrchestrator.getBehaviorTreeSnapshot(this.session.left.id),
        rightTree: this.llmOrchestrator.getBehaviorTreeSnapshot(this.session.right.id),
        behaviorTreeLog: process.env.NODE_ENV === 'development',
      })
    }

    return {
      session: this.session,
      uiOutcome,
      newEventCount: this.session.events.length - eventsBefore,
      remainingPreparationTicks: Math.max(0, this.session.preparationEndTick - this.session.tick),
    }
  }

  /*
  private applyStalemateTimeoutIfNeeded(): void {
    if (this.session.result !== 'ongoing') return
    if (this.session.phase !== 'battle') return
    if (this.session.tick < MAX_BATTLE_TICKS) return
    // … force end by remaining HP …
  }
  */

  private resolveDecision(ctx: DecisionContext, actorId: string, mode: TacticalMode): DecisionAction {
    this.sequenceStore.updateHpSnapshot(actorId, ctx.actorHpRatio)
    const seqStep = this.sequenceStore.nextStep(actorId, ctx)
    if (seqStep) {
      return {
        ...seqStep.step.action,
        path: `llm_seq:${seqStep.sequenceName}>${seqStep.step.action.path}`,
      } as DecisionAction
    }

    const reactionFirst = preferElementReactionAction(ctx)
    if (reactionFirst) {
      const role = ctx.actorRole ?? inferRoleProfile(ctx.actor)
      this.intentStore.set(actorId, mode, reactionFirst, ctx.tick, defaultTemplateForRole(role.role))
      return reactionFirst
    }

    const refreshReason = this.intentStore.needsRefresh(actorId, ctx)
    if (!refreshReason) {
      const cached = this.intentStore.get(actorId, ctx.tick, mode)
      if (cached) return cached.action
    }

    const role = ctx.actorRole ?? inferRoleProfile(ctx.actor)
    const phaseTick = Math.max(0, ctx.tick - this.battleStartTick)

    let action: DecisionAction

    if (refreshReason === 'target_frozen_window') {
      action = selectAction(ctx, 'finish')
    } else if (refreshReason === 'hp_spike' || refreshReason === 'being_controlled') {
      action = selectAction(ctx, mode)
    } else {
      const template = defaultTemplateForRole(role.role)
      action = executeStrategyTemplate(template, ctx, phaseTick)
    }

    this.intentStore.set(actorId, mode, action, ctx.tick, defaultTemplateForRole(role.role))
    return action
  }

  private hasBattleCommandForActorAtTick(
    session: BattleSession,
    actorId: string,
    tick: number,
  ): boolean {
    return session.commandQueue.some((c) => c.actorId === actorId && c.tick === tick)
  }

  private registerLlmSequences(sequences: RawSequenceData[] | undefined, currentTick: number): void {
    if (!sequences) return
    for (const { actorId, raw } of sequences) {
      this.sequenceStore.invalidate(actorId)
      const parsed = parseSequenceFromLlm(raw, 'llm')
      if (!parsed) {
        if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
          const len = Array.isArray(raw.sequence) ? raw.sequence.length : -1
          console.warn(
            `[battle] LLM sequence rejected for ${actorId} (invalid length or steps); raw length=${len}`,
          )
        }
        continue
      }
      const actor = this.session.left.id === actorId ? this.session.left : this.session.right
      const readySkills = buildReadySkills(actor, currentTick, distBetween(this.session))
      const ctx = buildDecisionContext(this.session, actor,
        actorId === this.session.left.id ? this.session.right : this.session.left,
        currentTick, distBetween(this.session), readySkills)
      const mode = selectTacticalMode(ctx)
      this.sequenceStore.register(actorId, parsed.name, parsed.steps, mode, currentTick, parsed.ttlTicks)
    }
  }

  private enqueueEnemyIntent(executeAtTick: number, dist: number): void {
    if (this.session.result !== 'ongoing') return
    const actor = this.session.right
    const target = this.session.left
    if (!actor.alive || !target.alive) return
    if (executeAtTick < this.nextEnemyDue) return

    const readySkills = buildReadySkills(actor, executeAtTick, dist)
    const ctx = buildDecisionContext(this.session, actor, target, executeAtTick, dist, readySkills)
    const mode = selectTacticalMode(ctx)

    this.intentStore.updateSnapshot(actor.id, executeAtTick, ctx.actorHpRatio)
    const action = this.resolveDecision(ctx, actor.id, mode)
    const recentActions = this.intentStore.getRecentActionKeys(actor.id, 4)
    const guarded = applyGuardrail(ctx, action, recentActions)
    if (guarded.rewritten) {
      this.intentStore.recordReject(actor.id)
    }

    const resolved = this.resolveActionToCommand(ctx, actor, target, executeAtTick, guarded.action)
    if (!resolved.command) {
      this.intentStore.recordReject(actor.id)
      this.nextEnemyDue = executeAtTick + this.enemyInterval
      return
    }

    const finalAction = resolved.action
    const reason =
      resolved.rewriteReason
      ?? guarded.rewriteReason
      ?? this.reasonForAction(finalAction, 'enemy')
    this.intentStore.recordAction(actor.id, executeAtTick, finalAction)
    this.enqueueIntentCommand(resolved.command, mode, reason, finalAction.path)
    this.nextEnemyDue = executeAtTick + this.enemyInterval
  }

  private enqueuePlayerIntent(
    executeAtTick: number,
    dist: number,
    input: {
      nextAttackSkillId: string | null
      onClearQueuedSkill?: () => void
      onSkillCooldown?: (skillId: string, cooldownMs: number) => void
    },
  ): void {
    if (this.session.result !== 'ongoing') return
    const actor = this.session.left
    const target = this.session.right
    if (!actor.alive || !target.alive) return

    const skillId = input.nextAttackSkillId
    const chosen = skillId !== null && skillId !== BASIC_ATTACK.id ? skillId : BASIC_ATTACK.id
    const selectedSkill = chosen === BASIC_ATTACK.id ? BASIC_ATTACK : getSkillById(chosen)
    const skillAction = selectedSkill?.action

    const readySkills = buildReadySkills(actor, executeAtTick, dist)
    const ctx = buildDecisionContext(this.session, actor, target, executeAtTick, dist, readySkills)
    const mode = selectTacticalMode(ctx)

    this.intentStore.updateSnapshot(actor.id, executeAtTick, ctx.actorHpRatio)

    if (executeAtTick < this.nextPlayerDue) return
    this.nextPlayerDue = executeAtTick + this.playerInterval

    if (chosen !== BASIC_ATTACK.id && skillAction && selectedSkill) {
      const playerAction = this.resolvePlayerManualAction(ctx, selectedSkill, chosen, dist)
      if (playerAction) {
        const recentActions = this.intentStore.getRecentActionKeys(actor.id, 4)
        const guarded = applyGuardrail(ctx, playerAction, recentActions)
        const resolved = this.resolveActionToCommand(ctx, actor, target, executeAtTick, guarded.action)
        if (resolved.command) {
          const finalAction = resolved.action
          const reason =
            resolved.rewriteReason
            ?? guarded.rewriteReason
            ?? this.reasonForAction(finalAction, 'player')
          this.intentStore.recordAction(actor.id, executeAtTick, finalAction)
          this.enqueueIntentCommand(resolved.command, mode, reason, finalAction.path)

          if (finalAction.type !== 'dash') {
            input.onClearQueuedSkill?.()
          }
        }
        return
      }
    }

    const treeAction = this.resolveDecision(ctx, actor.id, mode)
    const recentActions = this.intentStore.getRecentActionKeys(actor.id, 4)
    const guarded = applyGuardrail(ctx, treeAction, recentActions)
    if (guarded.rewritten) {
      this.intentStore.recordReject(actor.id)
    }

    const resolved = this.resolveActionToCommand(ctx, actor, target, executeAtTick, guarded.action)
    if (!resolved.command) return

    const finalAction = resolved.action
    const reason =
      resolved.rewriteReason
      ?? guarded.rewriteReason
      ?? this.reasonForAction(finalAction, 'player')
    this.intentStore.recordAction(actor.id, executeAtTick, finalAction)
    this.enqueueIntentCommand(resolved.command, mode, reason, finalAction.path)
    if (finalAction.type === 'basic_attack') {
      input.onClearQueuedSkill?.()
    }
  }

  private resolvePlayerManualAction(
    ctx: DecisionContext,
    selectedSkill: ReturnType<typeof getSkillById>,
    _chosenId: string,
    dist: number,
  ): DecisionAction | null {
    if (!selectedSkill) return null

    if (selectedSkill.action === 'cast_skill' && selectedSkill.coreSkillId) {
      return {
        type: 'cast_skill',
        skillId: selectedSkill.coreSkillId,
        path: 'root>player>manual>cast_skill',
      }
    }

    if (dist <= MELEE_RANGE) {
      return { type: 'basic_attack', path: 'root>player>manual>basic_fallback' }
    }
    return null
  }

  /**
   * Converts a DecisionAction into a command. When a `dash` action cannot
   * actually produce any movement (wall / map edge / corner), we remap it
   * to the guardrail's "dash unavailable" fallback (best skill → basic
   * attack → noop). Without this remap a blocked dash silently kills the
   * actor's whole turn, producing the "player only dashes once then does
   * nothing" symptom.
   */
  private resolveActionToCommand(
    ctx: DecisionContext,
    actor: BattleEntity,
    target: BattleEntity,
    tick: number,
    action: DecisionAction,
  ): { command: BattleCommand | null; action: DecisionAction; rewriteReason?: string } {
    const primary = this.decisionActionToCommand(actor, target, tick, action)
    if (primary || action.type !== 'dash') {
      return { command: primary, action }
    }
    const remap = remapDashToAlternative(ctx, action, 'dash_blocked_by_walkability')
    const fallback = this.decisionActionToCommand(actor, target, tick, remap.action)
    return { command: fallback, action: remap.action, rewriteReason: remap.rewriteReason }
  }

  private decisionActionToCommand(
    actor: BattleEntity,
    target: BattleEntity,
    tick: number,
    action: DecisionAction,
  ): BattleCommand | null {
    const base = {
      commandId: newCommandId(),
      sessionId: this.session.id,
      actorId: actor.id,
      tick,
    }
    switch (action.type) {
      case 'basic_attack':
        return { ...base, action: 'basic_attack', targetId: target.id }
      case 'cast_skill':
        return { ...base, action: 'cast_skill', targetId: target.id, skillId: action.skillId }
      case 'dodge':
        return { ...base, action: 'dodge' }
      case 'dash': {
        const goal = this.clampDashGoal(action.target.x, action.target.y)
        if (!this.canDashReachGoal(actor, target, goal.x, goal.y, action)) return null
        return {
          ...base,
          action: 'dash',
          targetId: target.id,
          metadata: {
            moveTargetX: goal.x,
            moveTargetY: goal.y,
            ...(action.moveStep != null ? { moveStep: action.moveStep } : {}),
          },
        }
      }
      case 'noop':
        return null
    }
  }

  private reasonForAction(action: DecisionAction, side: 'player' | 'enemy'): string {
    const prefix = side
    switch (action.type) {
      case 'basic_attack': return `${prefix}_basic_attack`
      case 'cast_skill': return `${prefix}_cast_${action.skillId}`
      case 'dodge': return `${prefix}_dodge`
      case 'dash': return `${prefix}_dash`
      case 'noop': return `${prefix}_noop`
    }
  }

  private enqueueIntentCommand(
    command: BattleCommand,
    strategy: TacticalMode,
    reason: string,
    decisionPath: string,
  ): void {
    const nextCommand: BattleCommand = {
      ...command,
      metadata: {
        ...(command.metadata || {}),
        strategy,
        reason,
        decisionPath,
      },
    }
    this.session = enqueueBattleCommand(this.session, nextCommand)
  }
}
