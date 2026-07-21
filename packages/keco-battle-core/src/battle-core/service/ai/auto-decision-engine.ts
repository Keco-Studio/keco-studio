import type { BattleEntity } from '../../domain/entities/battle-entity'
import type { BattleSession } from '../../domain/entities/battle-session'
import { getBattleSkillDefinition } from '../../content/skills/basic-skill-catalog'
import { memoryDerivedRecentEventsSummary, type ShortTermMemory } from './short-term-memory'
import {
  buildStructuredPayload,
  buildSystemPrompt,
  type LlmMapGridSnapshot,
} from './decision-tree/llm-prompt-builder'
import { sanitizeBehaviorTreeState } from './behavior-tree/validation'
import type { BehaviorTreePatch, BehaviorTreeState } from './behavior-tree/types'

export type RawBattleDecision = {
  action?: string
  targetId?: string
  skillId?: string
  sequence?: unknown[]
  name?: string
  ttlTicks?: number
  metadata?: Record<string, unknown>
}

export type LlmProviderConfig = {
  provider: 'deepseek' | 'zhipu' | 'minimax' | 'custom'
  apiKey?: string
  model?: string
  proxyUrl?: string
  baseUrl?: string
  timeoutMs?: number
}

/**
 * Context passed to LLM providers. Renamed from the ambiguous
 * `DecisionContext` (which collided with decision-tree/decision-context.ts).
 */
export type LlmDecisionContext = {
  session: BattleSession
  actor: BattleEntity
  target: BattleEntity
  memory: ShortTermMemory
  /** Session id for tracing */
  battleId?: string
  decisionRefreshReason?: string
  currentIntent?: string
  recentEventsSummary?: string
  /** Row-major walkable matrix from map collision (optional when no grid available) */
  mapGrid?: LlmMapGridSnapshot
}

export type { LlmMapGridSnapshot }

function structuredPayloadArgs(context: LlmDecisionContext): Parameters<typeof buildStructuredPayload>[0] {
  return {
    session: context.session,
    actor: context.actor,
    target: context.target,
    refreshReason: context.decisionRefreshReason ?? 'interval',
    currentIntent: context.currentIntent ?? 'trade',
    memorySummary: context.memory.recentActionSummary.join(', ') || 'No recent actions.',
    battleId: context.battleId,
    recentEventsSummary:
      context.recentEventsSummary ?? memoryDerivedRecentEventsSummary(context.memory),
    mapGrid: context.mapGrid,
  }
}

export type DecisionResult = {
  decision: RawBattleDecision | null
  source: 'remote_llm' | 'heuristic_fallback'
  error?: string
}

export type BehaviorTreePatchResult = {
  patch: BehaviorTreePatch | null
  source: 'remote_llm' | 'heuristic_fallback'
  error?: string
}

export type InitialBehaviorTreeResult = {
  tree: BehaviorTreeState | null
  source: 'remote_llm' | 'heuristic_fallback'
  error?: string
}

interface DecisionProvider {
  request(context: LlmDecisionContext): Promise<RawBattleDecision>
}

const MIN_TIMEOUT_MS = 400
/** Proxy + MiniMax + 大地图 payload 常需 10–25s+；须大于浏览器/代理上游等待时间 */
const DEFAULT_TIMEOUT_MS = 60000
const ERROR_BODY_SNIPPET_LIMIT = 140

function defaultModelForProvider(provider: LlmProviderConfig['provider'] | undefined): string {
  if (provider === 'deepseek') return 'deepseek-chat'
  if (provider === 'zhipu') return 'glm-4.5'
  if (provider === 'minimax') return 'MiniMax-M2.7'
  return 'gpt-4o-mini'
}

class HeuristicDecisionProvider implements DecisionProvider {
  async request(context: LlmDecisionContext): Promise<RawBattleDecision> {
    const { actor, target } = context
    const distance = Math.hypot(actor.position.x - target.position.x, actor.position.y - target.position.y)
    const availableSkill = actor.skillSlots
      .map((slot) => ({
        slot,
        skill: getBattleSkillDefinition(slot.skillId)
      }))
      .find(
        (entry) =>
          entry.skill &&
          entry.slot.cooldownTick <= context.session.tick &&
          actor.resources.mp >= entry.skill.mpCost &&
          distance <= entry.skill.range
      )
    if (availableSkill?.skill) {
      return {
        action: 'cast_skill',
        targetId: target.id,
        skillId: availableSkill.skill.id
      }
    }
    if (distance <= 1.8) {
      return {
        action: 'basic_attack',
        targetId: target.id
      }
    }
    return {
      action: 'dash',
      targetId: target.id,
      metadata: {
        moveTargetX: actor.team === 'left' ? target.position.x - 1.4 : target.position.x + 1.4,
        moveTargetY: target.position.y
      }
    }
  }
}

/**
 * Shared skeleton for HTTP-based LLM providers. Subclasses only need to
 * describe how to *build* the request and *parse* the response — the
 * timeout/abort/fetch/error-envelope plumbing is done here.
 */
abstract class BaseHttpLlmProvider implements DecisionProvider {
  constructor(protected readonly config: LlmProviderConfig) { }

  async request(context: LlmDecisionContext): Promise<RawBattleDecision> {
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Number(this.config.timeoutMs || DEFAULT_TIMEOUT_MS))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const { endpoint, init } = this.buildRequest(context, timeoutMs)
      const resp = await fetch(endpoint, { ...init, signal: controller.signal })
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '')
        throw new Error(`${this.httpErrorPrefix}${resp.status}:${bodyText.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`)
      }
      return await this.parseResponse(resp)
    } finally {
      clearTimeout(timer)
    }
  }

  protected getDefaultModel(): string {
    if (this.config.provider === 'deepseek') return 'deepseek-chat'
    if (this.config.provider === 'zhipu') return 'glm-4.5'
    if (this.config.provider === 'minimax') return 'MiniMax-M2.7'
    return 'gpt-4o-mini'
  }

  protected abstract readonly httpErrorPrefix: string
  protected abstract buildRequest(
    context: LlmDecisionContext,
    timeoutMs: number,
  ): { endpoint: string; init: RequestInit }
  protected abstract parseResponse(resp: Response): Promise<RawBattleDecision>
}

class ProxyLlmDecisionProvider extends BaseHttpLlmProvider {
  protected readonly httpErrorPrefix = 'proxy_http_'

  protected buildRequest(context: LlmDecisionContext, timeoutMs: number) {
    const proxyBase = String(this.config.proxyUrl || 'http://localhost:8787').replace(/\/$/, '')
    const payload = buildStructuredPayload(structuredPayloadArgs(context))
    return {
      endpoint: `${proxyBase}/api/ai/battle-decision`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: this.config.provider,
          model: this.config.model || this.getDefaultModel(),
          systemPrompt: buildSystemPrompt(),
          prompt: JSON.stringify(payload),
          timeoutMs,
        }),
      },
    }
  }

  protected async parseResponse(resp: Response): Promise<RawBattleDecision> {
    const text = await resp.text()
    let payload: { decision?: RawBattleDecision; error?: string }
    try {
      payload = JSON.parse(text) as { decision?: RawBattleDecision; error?: string }
    } catch {
      throw new Error(`proxy_response_not_json:${text.slice(0, 140)}`)
    }
    if (payload.error) throw new Error(payload.error)
    const parsed = payload.decision as Record<string, unknown> | undefined
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('proxy_parse_error:no_decision_object')
    }
    return parsed as RawBattleDecision
  }
}

class DirectRemoteLlmDecisionProvider extends BaseHttpLlmProvider {
  protected readonly httpErrorPrefix = 'llm_http_'

  protected buildRequest(context: LlmDecisionContext, _timeoutMs: number) {
    const payload = buildStructuredPayload(structuredPayloadArgs(context))
    return {
      endpoint: this.getEndpoint(),
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: this.config.model || this.getDefaultModel(),
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 280,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
    }
  }

  protected async parseResponse(resp: Response): Promise<RawBattleDecision> {
    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = String(payload.choices?.[0]?.message?.content || '')
    const parsed = parseJsonObject(content)
    if (!parsed || typeof parsed !== 'object') throw new Error('llm_parse_error')
    return parsed as RawBattleDecision
  }

  private getEndpoint(): string {
    if (this.config.baseUrl) return this.config.baseUrl
    if (this.config.provider === 'deepseek') return 'https://api.deepseek.com/chat/completions'
    if (this.config.provider === 'zhipu') return 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    throw new Error('missing_llm_base_url')
  }
}

function buildPrompt(context: LlmDecisionContext): string {
  const { session, actor, target, memory } = context
  const distance = Math.hypot(actor.position.x - target.position.x, actor.position.y - target.position.y)
  const skillSummary = actor.skillSlots
    .map((slot) => {
      const skill = getBattleSkillDefinition(slot.skillId)
      if (!skill) return `${slot.skillId}:unknown`
      return `${skill.id}(cd:${slot.cooldownTick - session.tick},mp:${skill.mpCost},r:${skill.range})`
    })
    .join(', ')
  return [
    `tick=${session.tick}`,
    `phase=${session.phase}`,
    `actor=${actor.id},hp=${actor.resources.hp}/${actor.resources.maxHp},mp=${actor.resources.mp},stamina=${actor.resources.stamina}`,
    `target=${target.id},hp=${target.resources.hp}/${target.resources.maxHp}`,
    `distance=${distance.toFixed(2)}`,
    `skills=${skillSummary}`,
    `recentActions=${memory.recentActionSummary.join('|') || 'none'}`,
    `windowHpLost: actor=${memory.actorHpLostInWindow}, target=${memory.targetHpLostInWindow}`,
    `outcomeLines=${memory.recentCombatOutcomeSummary.join('|') || 'none'}`,
    `recentRejects=${JSON.stringify(memory.recentRejectReasons)}`,
    'allowedActions=basic_attack,cast_skill,dash,dodge,flee'
  ].join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let trimmed = text.trim()
  // MiniMax may wrap JSON in <think>…</think> blocks (same as ai-proxy / parseOpenAiSse).
  trimmed = trimmed
    .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const slice = trimmed.slice(start, end + 1)
    try {
      return JSON.parse(slice) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function buildBehaviorTreePatchSystemPrompt(): string {
  return [
    'You are a deterministic battle behavior-tree patch planner.',
    'Return JSON only. No markdown. No extra keys outside the schema.',
    'Task:',
    '- Given "situation" and current "behaviorTree", return a minimal patch that improves immediate decision quality.',
    '- Keep edits small and safe. Do not rewrite the tree.',
    'Output schema:',
    '{',
    '  "patch": {',
    '    "baseVersion": number,',
    '    "reason": "fix_legality|break_loop|improve_range_tempo|stabilize_trade|improve_priority",',
    '    "ops": [',
    '      {"op":"set_condition_value","nodeId":string,"value":number}',
    '      | {"op":"replace_action","nodeId":string,"action":"basic_attack|cast_skill|dash|dodge|flee","target":"approach|retreat|hold|center","skillId":string,"moveStep":number}',
    '      | {"op":"reorder_children","nodeId":string,"orderedChildIds":string[]}',
    '    ]',
    '  }',
    '}',
    'Decision policy (deterministic):',
    '- Priority order: legality issues > stuck/loop behavior > range/tempo mismatch > micro priority tuning.',
    '- If multiple candidates are similarly good, choose by op type order: set_condition_value > reorder_children > replace_action.',
    '- Always produce 1 to 3 ops (never 0 ops).',
    'Operation constraints:',
    '- Use existing nodeId values only.',
    '- Do not add/remove nodes. Do not change node types.',
    '- set_condition_value: small change only; prefer relative delta <= 20% from current value.',
    '- reorder_children: only reorder existing direct children; do not invent child ids.',
    '- replace_action:',
    '  - action must be legal and executable in context.',
    '  - if action="cast_skill", include skillId from actor available skills.',
    '  - if action="dash", include moveStep in [0.4, 4.2].',
    '  - target must be one of approach|retreat|hold|center.',
    'Behavior expectations:',
    '- Avoid mirror full-retreat and corner-lock loops.',
    '- Preserve combat pressure when safe.',
    '- Prefer threshold and ordering tweaks before action replacement.',
    '- Keep rationale consistent with selected reason enum.',
  ].join('\n')
}

function buildInitialBehaviorTreeSystemPrompt(): string {
  return [
    'You are a deterministic initial battle behavior-tree planner.',
    'Return JSON only. No markdown. No extra keys outside the schema.',
    'Task:',
    '- Build one executable initial tree from "situation" and "seedTree".',
    '- Prefer stable, focused structure with safe combat pressure.',
    'Output schema:',
    '{',
    '  "tree": {',
    '    "treeId": string,',
    '    "version": number,',
    '    "updatedAtTick": number,',
    '    "root": BehaviorCompositeNode',
    '  }',
    '}',
    'BehaviorNode:',
    '- selector/sequence: {id,type,name,children[]}',
    '- condition: {id,type:"condition",name,metric,operator?,value?}',
    '- action: {id,type:"action",name,action,target?,skillId?,moveStep?}',
    'BehaviorCompositeNode:',
    '- root must be type "selector" or "sequence" (never condition/action).',
    'Allowed metrics: hp_ratio,target_hp_ratio,distance,hp_disadvantage,hp_advantage,battle_phase_numeric,consecutive_losing_trade,near_edge,has_any_ready_skill,ready_skill_out_of_range,no_ready_skill_in_range,basic_in_range,recent_dash_rejects,recent_blocked_rejects,dash_cooldown_active,dash_streak_locked',
    'Allowed actions: basic_attack,cast_skill,dash,dodge,flee',
    'Allowed targets: approach,retreat,hold,center',
    'Hard constraints:',
    '- tree depth <= 6.',
    '- all node ids must be unique and non-empty.',
    '- each selector/sequence must have at least one child.',
    '- cast_skill action must include skillId from actor available skills.',
    '- dash action may include moveStep only, and moveStep must be in [0.4, 4.2].',
    '- non-dash actions should not rely on moveStep.',
    'Deterministic construction policy:',
    '- Priority order: legality/executability > anti-loop safety > range/tempo control > micro optimization.',
    '- If multiple structures are similarly good, prefer the one closer to seedTree ordering and naming style.',
    '- Keep branches concise and behavior-focused; avoid broad speculative branches.',
    'Behavior expectations:',
    '- Avoid mirror full-retreat behavior.',
    '- Avoid corner-lock loops and repeated same-direction no-progress movement patterns.',
    '- Keep combat pressure when safe; retreat only when truly disadvantaged.',
  ].join('\n')
}

function buildBehaviorTreePatchPayload(input: {
  context: LlmDecisionContext
  tree: BehaviorTreeState
}): Record<string, unknown> {
  return {
    situation: buildStructuredPayload(structuredPayloadArgs(input.context)),
    behaviorTree: input.tree,
    outputContract: {
      patchOnly: true,
      maxOps: 3
    }
  }
}

function buildInitialBehaviorTreePayload(input: {
  context: LlmDecisionContext
  seedTree: BehaviorTreeState
}): Record<string, unknown> {
  return {
    situation: buildStructuredPayload(structuredPayloadArgs(input.context)),
    seedTree: input.seedTree,
    outputContract: {
      fullTree: true
    }
  }
}

function parseBehaviorTreePatch(raw: unknown): BehaviorTreePatch | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const candidate = obj.patch && typeof obj.patch === 'object'
    ? (obj.patch as Record<string, unknown>)
    : obj

  const opsRaw = candidate.ops
  if (!Array.isArray(opsRaw) || opsRaw.length === 0) return null
  const ops = opsRaw
    .map((entry) => sanitizePatchOperation(entry))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  if (ops.length === 0) return null
  const baseVersion =
    typeof candidate.baseVersion === 'number' && Number.isFinite(candidate.baseVersion)
      ? Math.max(1, Math.floor(candidate.baseVersion))
      : undefined
  const reason = typeof candidate.reason === 'string' ? candidate.reason : undefined
  return {
    baseVersion,
    reason,
    ops
  }
}

function sanitizePatchOperation(
  raw: unknown
): BehaviorTreePatch['ops'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const op = typeof item.op === 'string' ? item.op : ''
  if (op === 'set_condition_value') {
    if (
      typeof item.nodeId === 'string' &&
      typeof item.value === 'number' &&
      Number.isFinite(item.value)
    ) {
      return {
        op: 'set_condition_value',
        nodeId: item.nodeId,
        value: Number(item.value)
      }
    }
    return null
  }
  if (op === 'replace_action') {
    if (typeof item.nodeId !== 'string' || typeof item.action !== 'string') return null
    const action = item.action
    if (
      action !== 'basic_attack' &&
      action !== 'cast_skill' &&
      action !== 'dash' &&
      action !== 'dodge' &&
      action !== 'flee'
    ) {
      return null
    }
    const targetRaw = typeof item.target === 'string' ? item.target : undefined
    const target =
      targetRaw === 'approach' || targetRaw === 'retreat' || targetRaw === 'hold' || targetRaw === 'center'
        ? targetRaw
        : undefined
    const moveStep =
      typeof item.moveStep === 'number' && Number.isFinite(item.moveStep)
        ? Math.max(0.4, Math.min(4.2, Number(item.moveStep)))
        : undefined
    const skillId = typeof item.skillId === 'string' ? item.skillId : undefined
    return {
      op: 'replace_action',
      nodeId: item.nodeId,
      action,
      target,
      moveStep,
      skillId
    }
  }
  if (op === 'reorder_children') {
    if (typeof item.nodeId !== 'string' || !Array.isArray(item.orderedChildIds)) return null
    const orderedChildIds = item.orderedChildIds
      .filter((entry) => typeof entry === 'string')
      .map((entry) => String(entry))
    if (orderedChildIds.length === 0) return null
    return {
      op: 'reorder_children',
      nodeId: item.nodeId,
      orderedChildIds
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class AutoDecisionEngine {
  private readonly provider: DecisionProvider
  private readonly usesRemoteProvider: boolean

  constructor(private readonly config?: LlmProviderConfig) {
    if (config?.proxyUrl) {
      this.provider = new ProxyLlmDecisionProvider(config)
      this.usesRemoteProvider = true
      return
    }
    if (config?.apiKey) {
      this.provider = new DirectRemoteLlmDecisionProvider(config)
      this.usesRemoteProvider = true
      return
    }
    this.provider = new HeuristicDecisionProvider()
    this.usesRemoteProvider = false
  }

  async requestInitialBehaviorTree(input: {
    context: LlmDecisionContext
    seedTree: BehaviorTreeState
  }): Promise<InitialBehaviorTreeResult> {
    if (!this.usesRemoteProvider || !this.config) {
      return {
        tree: null,
        source: 'heuristic_fallback'
      }
    }
    const attempts = 2
    let lastError: string | undefined
    for (let a = 0; a < attempts; a += 1) {
      try {
        const tree = await this.requestInitialBehaviorTreeOnce(input)
        return {
          tree,
          source: 'remote_llm'
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (a + 1 < attempts) {
          await sleep(240)
        }
      }
    }
    return {
      tree: null,
      source: 'remote_llm',
      error: lastError
    }
  }

  async requestBehaviorTreePatch(input: {
    context: LlmDecisionContext
    tree: BehaviorTreeState
  }): Promise<BehaviorTreePatchResult> {
    if (!this.usesRemoteProvider || !this.config) {
      return {
        patch: null,
        source: 'heuristic_fallback'
      }
    }
    const attempts = 2
    let lastError: string | undefined
    for (let a = 0; a < attempts; a += 1) {
      try {
        const patch = await this.requestBehaviorTreePatchOnce(input)
        return {
          patch,
          source: 'remote_llm'
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (a + 1 < attempts) {
          await sleep(220)
        }
      }
    }
    return {
      patch: null,
      source: 'remote_llm',
      error: lastError
    }
  }

  async requestDecision(context: LlmDecisionContext): Promise<DecisionResult> {
    const attempts = this.usesRemoteProvider ? 2 : 1
    let lastError: string | undefined
    for (let a = 0; a < attempts; a += 1) {
      try {
        const decision = await this.provider.request(context)
        return {
          decision,
          source: this.usesRemoteProvider ? 'remote_llm' : 'heuristic_fallback'
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (a + 1 < attempts) {
          await sleep(280)
        }
      }
    }
    return {
      decision: null,
      source: 'heuristic_fallback',
      error: lastError
    }
  }

  private async requestBehaviorTreePatchOnce(input: {
    context: LlmDecisionContext
    tree: BehaviorTreeState
  }): Promise<BehaviorTreePatch | null> {
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Number(this.config?.timeoutMs || DEFAULT_TIMEOUT_MS))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const payload = buildBehaviorTreePatchPayload(input)
    try {
      if (this.config?.proxyUrl) {
        const proxyBase = String(this.config.proxyUrl).replace(/\/$/, '')
        const resp = await fetch(`${proxyBase}/api/ai/battle-decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.config.provider,
            model: this.config.model || defaultModelForProvider(this.config.provider),
            systemPrompt: buildBehaviorTreePatchSystemPrompt(),
            prompt: JSON.stringify(payload),
            timeoutMs
          }),
          signal: controller.signal
        })
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => '')
          throw new Error(`proxy_http_${resp.status}:${bodyText.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`)
        }
        const text = await resp.text()
        const outer = parseJsonObject(text)
        if (!outer) throw new Error(`proxy_response_not_json:${text.slice(0, 140)}`)
        if (typeof outer.error === 'string' && outer.error.length > 0) {
          throw new Error(outer.error)
        }
        return parseBehaviorTreePatch(outer.decision ?? outer)
      }

      const endpoint = this.config?.baseUrl
        || (this.config?.provider === 'deepseek'
          ? 'https://api.deepseek.com/chat/completions'
          : this.config?.provider === 'zhipu'
            ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
            : '')
      if (!endpoint) throw new Error('missing_llm_base_url')

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config?.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: this.config?.model || 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 300,
          messages: [
            { role: 'system', content: buildBehaviorTreePatchSystemPrompt() },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
        signal: controller.signal
      })
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '')
        throw new Error(`llm_http_${resp.status}:${bodyText.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`)
      }
      const body = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = String(body.choices?.[0]?.message?.content || '')
      const parsed = parseJsonObject(content)
      if (!parsed) throw new Error('llm_patch_parse_error')
      return parseBehaviorTreePatch(parsed)
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestInitialBehaviorTreeOnce(input: {
    context: LlmDecisionContext
    seedTree: BehaviorTreeState
  }): Promise<BehaviorTreeState | null> {
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Number(this.config?.timeoutMs || DEFAULT_TIMEOUT_MS))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const payload = buildInitialBehaviorTreePayload(input)
    try {
      if (this.config?.proxyUrl) {
        const proxyBase = String(this.config.proxyUrl).replace(/\/$/, '')
        const resp = await fetch(`${proxyBase}/api/ai/battle-decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: this.config.provider,
            model: this.config.model || defaultModelForProvider(this.config.provider),
            systemPrompt: buildInitialBehaviorTreeSystemPrompt(),
            prompt: JSON.stringify(payload),
            timeoutMs
          }),
          signal: controller.signal
        })
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => '')
          throw new Error(`proxy_http_${resp.status}:${bodyText.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`)
        }
        const text = await resp.text()
        const outer = parseJsonObject(text)
        if (!outer) throw new Error(`proxy_response_not_json:${text.slice(0, 140)}`)
        if (typeof outer.error === 'string' && outer.error.length > 0) {
          throw new Error(outer.error)
        }
        return sanitizeBehaviorTreeState(outer.decision ?? outer, input.seedTree)
      }

      const endpoint = this.config?.baseUrl
        || (this.config?.provider === 'deepseek'
          ? 'https://api.deepseek.com/chat/completions'
          : this.config?.provider === 'zhipu'
            ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
            : '')
      if (!endpoint) throw new Error('missing_llm_base_url')

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config?.apiKey || ''}`,
        },
        body: JSON.stringify({
          model: this.config?.model || 'gpt-4o-mini',
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 1200,
          messages: [
            { role: 'system', content: buildInitialBehaviorTreeSystemPrompt() },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
        signal: controller.signal
      })
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => '')
        throw new Error(`llm_http_${resp.status}:${bodyText.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`)
      }
      const body = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = String(body.choices?.[0]?.message?.content || '')
      const parsed = parseJsonObject(content)
      if (!parsed) throw new Error('llm_initial_tree_parse_error')
      return sanitizeBehaviorTreeState(parsed, input.seedTree)
    } finally {
      clearTimeout(timer)
    }
  }
}
