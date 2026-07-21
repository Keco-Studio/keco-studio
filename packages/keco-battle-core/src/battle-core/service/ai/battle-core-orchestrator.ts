import type { BattleSession } from '../../domain/entities/battle-session'
import { enqueueBattleCommand, type BattleCommandWalkContext } from '../../engine/command-processor'
import {
  AutoDecisionEngine,
  type LlmDecisionContext,
  type LlmProviderConfig,
  type RawBattleDecision
} from './auto-decision-engine'
import { createInitialBehaviorTree } from './behavior-tree/initial-behavior-tree'
import { evaluateBehaviorTree } from './behavior-tree/runtime'
import type { BehaviorTreeState } from './behavior-tree/types'
import { applyBehaviorTreePatch } from './behavior-tree/validation'
import { buildShortTermMemory } from './short-term-memory'
import { arbitrateBehaviorTreeVsLlmMacro } from './decision-arbitration'
import { expandIntentStyleDecision, normalizeDecisionToCommand } from './dynamic-strategy-validator'

type ActorState = {
  pending: boolean
  cachedDecision: RawBattleDecision | null
  lastError: string | null
  btTree: BehaviorTreeState | null
  initialTreeRequested: boolean
  lastPatchTick: number
  lastMacroPlanTick: number
  nextActionTick: number
  /** Last walk context from prefetch; used when macro LLM callback re-evaluates BT. */
  lastWalk?: BattleCommandWalkContext
  /** One-time console summary per actor (see `behaviorTreeLog`). */
  btStartLogged: boolean
}

type OrchestratorOptions = {
  llmConfig?: LlmProviderConfig
  /**
   * Optional seed from long-term BT store. If null/undefined, `createInitialBehaviorTree` is used.
   */
  resolveSeedBehaviorTree?: (input: { session: BattleSession; actorId: string }) => BehaviorTreeState | null
  augmentLlmContext?: (input: {
    session: BattleSession
    actorId: string
    actor: BattleSession['left']
    target: BattleSession['left'] //BattleEntity, to reduce imports
    memory: ReturnType<typeof buildShortTermMemory>
  }) => Partial<
    Pick<LlmDecisionContext, 'mapGrid' | 'battleId' | 'recentEventsSummary' | 'decisionRefreshReason' | 'currentIntent'>
  >
  /** New LLM round committed a single command (not a multi-step sequence) — drop any prior sequence for this actor. */
  onLlmSingleActionCommitted?: (actorId: string) => void
  /** While a multi-step LLM `sequence` is still playing, do not start another prefetch (avoids 8s stall every tick). */
  shouldDeferPrefetch?: (actorId: string) => boolean
  /**
   * When true, logs once per actor at first BT use (`bt_started`: tree source + first mapped decision),
   * and relies on `updateLongTermBtAfterBattle({ behaviorTreeLog: true })` for persist logs (see long-term module).
   */
  behaviorTreeLog?: boolean
}

export type RawSequenceData = {
  actorId: string
  raw: Record<string, unknown>
}

export type PrepareDecisionResult = {
  session: BattleSession
  failedActorIds: string[]
  sequences?: RawSequenceData[]
}

export class BattleCoreOrchestrator {
  private readonly decisionEngine: AutoDecisionEngine
  private readonly llmConfig?: LlmProviderConfig
  private readonly augmentLlmContext?: OrchestratorOptions['augmentLlmContext']
  private readonly resolveSeedBehaviorTree?: OrchestratorOptions['resolveSeedBehaviorTree']
  private readonly onLlmSingleActionCommitted?: OrchestratorOptions['onLlmSingleActionCommitted']
  private readonly shouldDeferPrefetch?: OrchestratorOptions['shouldDeferPrefetch']
  private readonly behaviorTreeLog: boolean
  private readonly useProxyMode: boolean
  private readonly actorStates = new Map<string, ActorState>()
  private readonly macroPlanIntervalTicks = 5
  private readonly behaviorTreePatchIntervalTicks = 8
  private llmAvailability: 'unknown' | 'available' | 'unavailable'
  private availabilityCheckPending = false

  constructor(options?: OrchestratorOptions) {
    this.llmConfig = options?.llmConfig
    this.augmentLlmContext = options?.augmentLlmContext
    this.resolveSeedBehaviorTree = options?.resolveSeedBehaviorTree
    this.onLlmSingleActionCommitted = options?.onLlmSingleActionCommitted
    this.shouldDeferPrefetch = options?.shouldDeferPrefetch
    this.behaviorTreeLog = Boolean(options?.behaviorTreeLog)
    this.decisionEngine = new AutoDecisionEngine(this.llmConfig)
    this.useProxyMode = Boolean(this.llmConfig?.proxyUrl)
    this.llmAvailability = this.useProxyMode ? 'unknown' : 'available'
  }

  public prepareCommands(
    session: BattleSession,
    executeAtTick: number,
    walk?: BattleCommandWalkContext
  ): PrepareDecisionResult {
    if (session.result !== 'ongoing') {
      return {
        session,
        failedActorIds: []
      }
    }
    if (!this.shouldUseLlm()) {
      return {
        session,
        failedActorIds: []
      }
    }
    let nextSession = session
    const failedActorIds: string[] = []
    const sequences: RawSequenceData[] = []
    this.prefetchDecision(nextSession, nextSession.left.id, walk)
    this.prefetchDecision(nextSession, nextSession.right.id, walk)
    const leftResult = this.maybeEnqueueDecision(nextSession, nextSession.left.id, executeAtTick)
    nextSession = leftResult.session
    if (leftResult.failed) failedActorIds.push(nextSession.left.id)
    if (leftResult.sequenceData) sequences.push(leftResult.sequenceData)
    const rightResult = this.maybeEnqueueDecision(nextSession, nextSession.right.id, executeAtTick)
    nextSession = rightResult.session
    if (rightResult.failed) failedActorIds.push(nextSession.right.id)
    if (rightResult.sequenceData) sequences.push(rightResult.sequenceData)
    return {
      session: nextSession,
      failedActorIds,
      sequences: sequences.length > 0 ? sequences : undefined,
    }
  }

  public onTickFinished(session: BattleSession, walk?: BattleCommandWalkContext): void {
    if (!this.shouldUseLlm()) return
    this.prefetchDecision(session, session.left.id, walk)
    this.prefetchDecision(session, session.right.id, walk)
  }

  public ensureLlmAvailability(): void {
    if (!this.useProxyMode) return
    if (this.llmAvailability !== 'unknown') return
    if (this.availabilityCheckPending) return
    this.availabilityCheckPending = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const proxyBaseUrl = String(this.llmConfig?.proxyUrl || 'http://localhost:8787').replace(/\/$/, '')
    void fetch(`${proxyBaseUrl}/health`, { signal: controller.signal })
      .then(async (resp) => {
        if (!resp.ok) {
          this.llmAvailability = 'unavailable'
          return
        }
        const payload = (await resp.json()) as { ok?: boolean; hasKey?: boolean }
        this.llmAvailability = payload.ok && payload.hasKey ? 'available' : 'unavailable'
      })
      .catch(() => {
        this.llmAvailability = 'unavailable'
      })
      .finally(() => {
        clearTimeout(timer)
        this.availabilityCheckPending = false
      })
  }

  public shouldUseLlm(): boolean {
    return this.llmAvailability === 'available'
  }

  /** True while an HTTP decision request is in flight for this actor (do not local-fallback the same tick). */
  public isPrefetchPending(actorId: string): boolean {
    return Boolean(this.actorStates.get(actorId)?.pending)
  }

  public getLlmRuntimeStatus(): 'available' | 'unavailable' | 'unknown' {
    return this.llmAvailability
  }

  /** Deep clone of the actor's current BT for persistence (null if never built). */
  public getBehaviorTreeSnapshot(actorId: string): BehaviorTreeState | null {
    const st = this.actorStates.get(actorId)
    if (!st?.btTree) return null
    return JSON.parse(JSON.stringify(st.btTree)) as BehaviorTreeState
  }

  private maybeEnqueueDecision(
    session: BattleSession,
    actorId: string,
    executeAtTick: number
  ): { session: BattleSession; failed: boolean; sequenceData?: RawSequenceData } {
    const actor = session.left.id === actorId ? session.left : session.right
    if (!actor.alive) return { session, failed: false }
    const state = this.getActorState(actorId)
    const hasFutureCommand = session.commandQueue.some(
      (command) => command.actorId === actorId && command.tick >= executeAtTick
    )
    if (hasFutureCommand) return { session, failed: false }
    if (executeAtTick < state.nextActionTick) {
      return { session, failed: false }
    }
    if (!state.cachedDecision) {
      if (state.lastError) {
        state.lastError = null
      }
      return { session, failed: state.pending ? false : true }
    }

    if (Array.isArray(state.cachedDecision.sequence) && state.cachedDecision.sequence.length > 0) {
      const raw = state.cachedDecision as unknown as Record<string, unknown>
      state.cachedDecision = null
      return { session, failed: true, sequenceData: { actorId, raw } }
    }

    const normalized = normalizeDecisionToCommand({
      session,
      actorId,
      executeAtTick,
      rawDecision: state.cachedDecision
    })
    if (!normalized.ok || !normalized.command) {
      state.cachedDecision = null
      return {
        session,
        failed: true
      }
    }
    const arbitrationMeta =
      state.cachedDecision?.metadata &&
        typeof state.cachedDecision.metadata === 'object'
        ? (state.cachedDecision.metadata as Record<string, unknown>).arbitrationPicked
        : undefined
    const decisionSource =
      arbitrationMeta === 'bt'
        ? 'bt'
        : arbitrationMeta === 'llm_macro'
          ? 'llm_macro'
          : 'llm'
    state.cachedDecision = null
    let command = normalized.command
    command = {
      ...command,
      metadata: {
        ...(command.metadata || {}),
        decisionSource,
        validationReason: normalized.reason || 'ok'
      }
    }
    this.onLlmSingleActionCommitted?.(actorId)
    state.nextActionTick = executeAtTick + this.computeActionIntervalTicks(actor.spd)
    return {
      session: enqueueBattleCommand(session, command),
      failed: false
    }
  }

  private prefetchDecision(
    session: BattleSession,
    actorId: string,
    walk?: BattleCommandWalkContext
  ): void {
    if (!this.shouldUseLlm()) return
    if (session.result !== 'ongoing') return
    const actor = session.left.id === actorId ? session.left : session.right
    const target = actor.id === session.left.id ? session.right : session.left
    if (!actor.alive || !target.alive) return
    const state = this.getActorState(actorId)
    if (state.cachedDecision) return
    if (this.shouldDeferPrefetch?.(actorId)) return
    state.lastWalk = walk
    const memory = buildShortTermMemory(session, actorId)
    const augment = this.augmentLlmContext?.({
      session,
      actorId,
      actor,
      target,
      memory,
    })
    const context: LlmDecisionContext = {
      session,
      actor,
      target,
      memory,
      ...augment,
    }

    let bindSource: 'long_term_seed' | 'initial_template' | null = null
    if (!state.btTree) {
      const seed = this.resolveSeedBehaviorTree?.({ session, actorId }) ?? null
      state.btTree =
        seed ??
        createInitialBehaviorTree({
          actorId,
          currentTick: session.tick,
        })
      bindSource = seed ? 'long_term_seed' : 'initial_template'
    }

    const btPrefetchDecision = evaluateBehaviorTree({
      session,
      actor,
      target,
      tree: state.btTree,
      walk,
    }) as RawBattleDecision
    state.cachedDecision = btPrefetchDecision
    if (!state.btStartLogged) {
      this.logBehaviorTree('bt_started', {
        actorId,
        sessionTick: session.tick,
        battleId: session.id,
        source: bindSource ?? 'session_existing',
        treeId: state.btTree.treeId,
        version: state.btTree.version,
        updatedAtTick: state.btTree.updatedAtTick,
        ...this.btDecisionLogSlice(btPrefetchDecision),
      })
      state.btStartLogged = true
    }

    if (state.pending) return

    if (!state.initialTreeRequested) {
      state.pending = true
      state.initialTreeRequested = true
      void this.decisionEngine
        .requestInitialBehaviorTree({
          context,
          seedTree: state.btTree,
        })
        .then((result) => {
          if (result.tree) {
            state.btTree = result.tree
          }
          state.lastError = result.error || null
        })
        .finally(() => {
          state.pending = false
        })
      return
    }

    if (session.tick - state.lastMacroPlanTick >= this.macroPlanIntervalTicks) {
      state.pending = true
      const macroBaseTick = session.tick
      void this.decisionEngine
        .requestDecision(context)
        .then((result) => {
          const expanded =
            expandIntentStyleDecision((result.decision || null) as RawBattleDecision) ?? result.decision
          const hasSequence = expanded && Array.isArray(expanded.sequence) && expanded.sequence.length > 0
          const hasSingleAction =
            expanded && typeof expanded.action === 'string' && expanded.action.length > 0
          if (!hasSequence && !hasSingleAction) {
            if (result.error) state.lastError = result.error
            return
          }
          const btEval = evaluateBehaviorTree({
            session: context.session,
            actor,
            target,
            tree: state.btTree!,
            walk: state.lastWalk,
          }) as RawBattleDecision
          state.cachedDecision = arbitrateBehaviorTreeVsLlmMacro(btEval, expanded, {
            session: context.session,
            actorId,
          })
          if (result.error) {
            state.lastError = result.error
          }
        })
        .finally(() => {
          state.lastMacroPlanTick = macroBaseTick
          state.pending = false
        })
      return
    }

    if (session.tick - state.lastPatchTick < this.behaviorTreePatchIntervalTicks) return
    state.pending = true
    const patchBaseTick = session.tick
    const currentTree = state.btTree
    if (!currentTree) {
      state.pending = false
      return
    }
    void this.decisionEngine
      .requestBehaviorTreePatch({
        context,
        tree: currentTree,
      })
      .then((result) => {
        if (result.patch && state.btTree) {
          const applied = applyBehaviorTreePatch(state.btTree, result.patch, patchBaseTick)
          if (applied.applied) {
            state.btTree = applied.tree
          } else {
            state.lastError = applied.reason
          }
        }
        if (result.error) {
          state.lastError = result.error
        }
      })
      .finally(() => {
        state.lastPatchTick = patchBaseTick
        state.pending = false
      })
  }

  private getActorState(actorId: string): ActorState {
    const existing = this.actorStates.get(actorId)
    if (existing) {
      if (!('btTree' in existing)) {
        ; (existing as ActorState).btTree = null
      }
      if (!('initialTreeRequested' in existing)) {
        ; (existing as ActorState).initialTreeRequested = false
      }
      if (!('lastPatchTick' in existing)) {
        ; (existing as ActorState).lastPatchTick = -9999
      }
      if (!('lastMacroPlanTick' in existing)) {
        ; (existing as ActorState).lastMacroPlanTick = -9999
      }
      if (!('nextActionTick' in existing)) {
        ; (existing as ActorState).nextActionTick = 0
      }
      if (!('btStartLogged' in existing)) {
        ; (existing as ActorState).btStartLogged = false
      }
      return existing
    }
    const created: ActorState = {
      pending: false,
      cachedDecision: null,
      lastError: null,
      btTree: null,
      initialTreeRequested: false,
      lastPatchTick: -9999,
      lastMacroPlanTick: -9999,
      nextActionTick: 0,
      btStartLogged: false,
    }
    this.actorStates.set(actorId, created)
    return created
  }

  private logBehaviorTree(event: string, fields: Record<string, unknown>): void {
    if (!this.behaviorTreeLog) {
      return
    }
    console.info(`[battle-core][BT] ${event}`, fields)
  }

  private btDecisionLogSlice(d: RawBattleDecision): Record<string, unknown> {
    const meta = d.metadata
    const btNode =
      meta && typeof meta === 'object' && meta !== null && 'btNode' in meta
        ? (meta as { btNode?: unknown }).btNode
        : undefined
    return {
      decisionAction: d.action,
      skillId: d.skillId,
      btNodeId: btNode,
      sequenceLen: Array.isArray(d.sequence) ? d.sequence.length : 0,
    }
  }

  private computeActionIntervalTicks(spd: number): number {
    const battleTickMs = 200
    const mappedAttackSpeed = Math.max(0.4, 0.8 + (Math.max(1, spd) - 3) * 0.05)
    const secondsPerAction = Math.max(0.8, 0.8 / mappedAttackSpeed)
    const ticks = Math.round((secondsPerAction * 1000) / battleTickMs)
    return Math.max(1, ticks)
  }
}

