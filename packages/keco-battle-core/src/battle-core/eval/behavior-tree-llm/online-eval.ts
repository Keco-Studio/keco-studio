import { createBattleSession } from '../../domain/entities/battle-session'
import type { BattleEntity } from '../../domain/entities/battle-entity'
import { AutoDecisionEngine, type LlmProviderConfig, type LlmDecisionContext } from '../../service/ai/auto-decision-engine'
import { buildShortTermMemory } from '../../service/ai/short-term-memory'
import { createInitialBehaviorTree } from '../../service/ai/behavior-tree/initial-behavior-tree'
import { evaluateBehaviorTree } from '../../service/ai/behavior-tree/runtime'
import { applyBehaviorTreePatch } from '../../service/ai/behavior-tree/validation'
import type { BehaviorTreeNode, BehaviorTreeState } from '../../service/ai/behavior-tree/types'

type EvalSuite = 'patch' | 'initial_tree'
type EvalDimension = 'format' | 'schema_contract' | 'runtime_apply' | 'inventory' | 'effective'

type EvalRunResult = {
  passByDimension: Record<EvalDimension, boolean> /*dimensions passed?*/
  hardPass: boolean /*if the five dimensions are all passed*/
  note?: string
}

type EvalCaseResult = {
  id: string
  suite: EvalSuite /*which dimension*/
  runs: number   /*how many times to run*/
  hardPassRate: number /*passed / all */
  passRateByDimension: Record<EvalDimension, number>/*how many times passed in each dimension*/
  failures: string[]
}

export type OnlineEvalReport = {
  meta: {
    provider: string
    model: string
    runsDefault: number
  }
  cases: EvalCaseResult[]
  aggregate: {
    hardPassRate: number
    bySuite: Record<EvalSuite, number>
  }
}

function makeEntity(input: {
  id: string
  team: 'left' | 'right'
  hp: number
  maxHp: number
  mp: number
  x: number
  y: number
  skillIds: string[]
}): BattleEntity {
  return {
    id: input.id,
    name: input.id,
    team: input.team,
    position: { x: input.x, y: input.y },
    resources: {
      hp: input.hp,
      maxHp: input.maxHp,
      mp: input.mp,
      maxMp: 50,
      stamina: 60,
      maxStamina: 60,
      rage: 0,
      maxRage: 100,
      shield: 0,
      maxShield: 30,
    },
    atk: 20,
    def: 10,
    spd: 12,
    skillSlots: input.skillIds.map((skillId) => ({ skillId, cooldownTick: 0 })),
    defending: false,
    alive: true,
    effects: [],
  }
}

function makeContext(): { context: LlmDecisionContext; actor: BattleEntity; target: BattleEntity } {
  const actor = makeEntity({
    id: 'left_eval',
    team: 'left',
    hp: 90,
    maxHp: 100,
    mp: 40,
    x: 3,
    y: 2,
    skillIds: ['arcane_bolt', 'fireball'],
  })
  const target = makeEntity({
    id: 'right_eval',
    team: 'right',
    hp: 28,
    maxHp: 100,
    mp: 30,
    x: 4.2,
    y: 2,
    skillIds: ['arcane_bolt'],
  })
  const session = createBattleSession({ left: actor, right: target, preparationTicks: 0 })
  const memory = buildShortTermMemory(session, actor.id)
  return {
    context: {
      session,
      actor,
      target,
      memory,
      battleId: session.id,
      decisionRefreshReason: 'interval',
      currentIntent: 'trade',
    },
    actor,
    target,
  }
}

/*to test whether the llm can fix it*/
function buildBadPatchTree(): BehaviorTreeState {
  return {
    treeId: 'bt_eval_bad_patch',
    version: 1,
    updatedAtTick: 0,
    root: {
      id: 'root_selector',
      type: 'selector',
      children: [
        {
          id: 'retreat_seq',
          type: 'sequence',
          children: [
            {
              /*hp percentage of the actor > 0.2 but retreat*/
              id: 'retreat_hp_gate',
              type: 'condition',
              metric: 'hp_ratio',
              operator: '>=',
              value: 0.2,
            },
            {
              id: 'retreat_action',
              type: 'action',
              action: 'dash',
              target: 'retreat',
              moveStep: 2.8,
            },
          ],
        },
        {
          id: 'fight_seq',
          type: 'sequence',
          children: [
            {
              id: 'fight_in_range',
              type: 'condition',
              metric: 'basic_in_range',
              operator: '==',
              value: 1,
            },
            {
              id: 'fight_attack',
              type: 'action',
              action: 'basic_attack',
            },
          ],
        },
      ],
    },
  }
}

/*to test whether the llm can build a new tree*/
function buildBadInitialSeed(): BehaviorTreeState {
  return {
    treeId: 'bt_eval_bad_seed',
    version: 1,
    updatedAtTick: 0,
    root: {
      id: 'seed_root',
      type: 'selector',
      children: [
        {
          id: 'seed_flee',
          type: 'action',
          action: 'flee',
        },
      ],
    },
  }
}


function collectActionNodes(root: BehaviorTreeNode): Array<{ action: string; skillId?: string; moveStep?: number }> {
  if (root.type === 'action') {
    return [{ action: root.action, skillId: root.skillId, moveStep: root.moveStep }]
  }
  if (root.type === 'condition') return []
  return root.children.flatMap((child) => collectActionNodes(child))
}

/*to calculate the rate of the pass*/
function safeRate(hit: number, total: number): number {
  return total <= 0 ? 0 : Number((hit / total).toFixed(3))
}

function sameTree(a: BehaviorTreeState, b: BehaviorTreeState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isInventoryValid(tree: BehaviorTreeState, allowSkills: Set<string>): boolean {
  const actions = collectActionNodes(tree.root)
  for (const node of actions) {
    if (node.action === 'cast_skill') {
      if (!node.skillId || !allowSkills.has(node.skillId)) return false
    }
    if (node.action === 'dash' && node.moveStep != null) {
      if (node.moveStep < 0.4 || node.moveStep > 4.2) return false
    }
  }
  return true
}

/*to rebuild the tree*/
async function runPatchCase(engine: AutoDecisionEngine, runs: number): Promise<EvalCaseResult> {
  const dimKeys: EvalDimension[] = ['format', 'schema_contract', 'runtime_apply', 'inventory', 'effective']
  const dimHits: Record<EvalDimension, number> = {
    format: 0,
    schema_contract: 0,
    runtime_apply: 0,
    inventory: 0,
    effective: 0,
  }
  let hardPassCount = 0
  const failures: string[] = []

  for (let i = 0; i < runs; i += 1) {
    const { context } = makeContext()
    const tree = buildBadPatchTree()
    const beforeDecision = evaluateBehaviorTree({
      session: context.session,
      actor: context.actor,
      target: context.target,
      tree,
    })

    /*get answer from llm*/
    const llm = await engine.requestBehaviorTreePatch({ context, tree })
    const parsedPatch = llm.patch
    const format = llm.source === 'remote_llm' && !llm.error
    const schemaContract = Boolean(parsedPatch && parsedPatch.ops.length >= 1 && parsedPatch.ops.length <= 3)
    const applied = parsedPatch ? applyBehaviorTreePatch(tree, parsedPatch, context.session.tick + 1) : null
    const runtimeApply = Boolean(applied?.applied)
    const allowSkills = new Set(context.actor.skillSlots.map((slot) => slot.skillId))
    const inventory = parsedPatch
      ? parsedPatch.ops.every((op) => {
        if (op.op !== 'replace_action') return true
        if (op.action === 'cast_skill') return Boolean(op.skillId && allowSkills.has(op.skillId))
        if (op.action === 'dash' && op.moveStep != null) return op.moveStep >= 0.4 && op.moveStep <= 4.2
        return true
      })
      : false
    const afterTree = applied?.tree ?? tree
    const afterDecision = evaluateBehaviorTree({
      session: context.session,
      actor: context.actor,
      target: context.target,
      tree: afterTree,
    })
    const effective =
      runtimeApply
      && (afterDecision.action === 'basic_attack' || afterDecision.action === 'cast_skill')
      && afterDecision.action !== beforeDecision.action

    const run: EvalRunResult = {
      passByDimension: {
        format,
        schema_contract: schemaContract,
        runtime_apply: runtimeApply,
        inventory,
        effective,
      },
      hardPass: format && schemaContract && runtimeApply && inventory && effective,
      note: llm.error,
    }
    for (const dim of dimKeys) {
      if (run.passByDimension[dim]) dimHits[dim] += 1
    }
    if (run.hardPass) {
      hardPassCount += 1
    } else if (run.note) {
      failures.push(`[run ${i + 1}] ${run.note}`)
    }
  }

  return {
    id: 'patch_pressure_from_bad_retreat',
    suite: 'patch',
    runs,
    hardPassRate: safeRate(hardPassCount, runs),
    passRateByDimension: {
      format: safeRate(dimHits.format, runs),
      schema_contract: safeRate(dimHits.schema_contract, runs),
      runtime_apply: safeRate(dimHits.runtime_apply, runs),
      inventory: safeRate(dimHits.inventory, runs),
      effective: safeRate(dimHits.effective, runs),
    },
    failures: failures.slice(0, 3),
  }
}

/*to build a new tree*/
async function runInitialCase(engine: AutoDecisionEngine, runs: number): Promise<EvalCaseResult> {
  const dimKeys: EvalDimension[] = ['format', 'schema_contract', 'runtime_apply', 'inventory', 'effective']
  const dimHits: Record<EvalDimension, number> = {
    format: 0,
    schema_contract: 0,
    runtime_apply: 0,
    inventory: 0,
    effective: 0,
  }
  let hardPassCount = 0
  const failures: string[] = []

  for (let i = 0; i < runs; i += 1) {
    const { context } = makeContext()
    const seedTree = buildBadInitialSeed()
    const llm = await engine.requestInitialBehaviorTree({ context, seedTree })
    const tree = llm.tree
    const format = llm.source === 'remote_llm' && !llm.error
    const schemaContract = Boolean(tree)
    const runtimeApply = Boolean(tree)
    const allowSkills = new Set(context.actor.skillSlots.map((slot) => slot.skillId))
    const inventory = tree ? isInventoryValid(tree, allowSkills) : false
    const decision = tree
      ? evaluateBehaviorTree({
        session: context.session,
        actor: context.actor,
        target: context.target,
        tree,
      })
      : null
    const effective = Boolean(
      tree
      && !sameTree(tree, seedTree)
      && decision
      && (decision.action === 'basic_attack' || decision.action === 'cast_skill')
    )

    const run: EvalRunResult = {
      passByDimension: {
        format,
        schema_contract: schemaContract,
        runtime_apply: runtimeApply,
        inventory,
        effective,
      },
      hardPass: format && schemaContract && runtimeApply && inventory && effective,
      note: llm.error,
    }
    for (const dim of dimKeys) {
      if (run.passByDimension[dim]) dimHits[dim] += 1
    }
    if (run.hardPass) {
      hardPassCount += 1
    } else if (run.note) {
      failures.push(`[run ${i + 1}] ${run.note}`)
    }
  }

  return {
    id: 'initial_build_pressure_tree',
    suite: 'initial_tree',
    runs,
    hardPassRate: safeRate(hardPassCount, runs),
    passRateByDimension: {
      format: safeRate(dimHits.format, runs),
      schema_contract: safeRate(dimHits.schema_contract, runs),
      runtime_apply: safeRate(dimHits.runtime_apply, runs),
      inventory: safeRate(dimHits.inventory, runs),
      effective: safeRate(dimHits.effective, runs),
    },
    failures: failures.slice(0, 3),/*error message*/
  }
}

export function createOnlineEvalEngineConfigFromEnv(env: NodeJS.ProcessEnv): LlmProviderConfig | null {
  const providerRaw =
    env.BT_EVAL_PROVIDER
    || env.NEXT_PUBLIC_BATTLE_LLM_PROVIDER
    || env.AI_LLM_PROVIDER
    || 'deepseek'
  const provider = (
    providerRaw === 'deepseek'
      || providerRaw === 'zhipu'
      || providerRaw === 'minimax'
      || providerRaw === 'custom'
      ? providerRaw
      : 'deepseek'
  ) as LlmProviderConfig['provider']
  const model =
    env.BT_EVAL_MODEL
    || (provider === 'minimax' ? env.MINIMAX_MODEL : undefined)
    || (provider === 'deepseek' ? env.DEEPSEEK_MODEL : undefined)
  const proxyUrl = env.BT_EVAL_PROXY_URL
  const apiKey =
    env.BT_EVAL_API_KEY
    || (provider === 'minimax' ? env.MINIMAX_API_KEY : undefined)
    || (provider === 'deepseek' ? env.DEEPSEEK_API_KEY : undefined)
  const baseUrl =
    env.BT_EVAL_BASE_URL
    || (provider === 'minimax' ? (env.MINIMAX_BASE_URL || 'https://api.minimax.io') : undefined)
  const timeoutMs = Number(env.BT_EVAL_TIMEOUT_MS || 60000)

  if (proxyUrl) {
    return { provider, model, proxyUrl, timeoutMs }
  }
  if (!apiKey) return null
  return { provider, model, apiKey, baseUrl, timeoutMs }
}

export async function runBehaviorTreeOnlineEvalSuite(input: {
  llmConfig: LlmProviderConfig
  runs?: number
  logToConsole?: boolean
}): Promise<OnlineEvalReport> {
  const runs = Math.max(1, Math.floor(input.runs ?? 3))
  const engine = new AutoDecisionEngine(input.llmConfig)
  const patch = await runPatchCase(engine, runs)
  const initial = await runInitialCase(engine, runs)
  const cases = [patch, initial]
  const totalHard = cases.reduce((sum, item) => sum + item.hardPassRate, 0)
  const bySuite: Record<EvalSuite, number> = {
    patch: safeRate(cases.filter((item) => item.suite === 'patch').reduce((sum, item) => sum + item.hardPassRate, 0), 1),
    initial_tree: safeRate(cases.filter((item) => item.suite === 'initial_tree').reduce((sum, item) => sum + item.hardPassRate, 0), 1),
  }

  const report: OnlineEvalReport = {
    meta: {
      provider: input.llmConfig.provider,
      model: input.llmConfig.model || 'default',
      runsDefault: runs,
    },
    cases,
    aggregate: {
      hardPassRate: safeRate(totalHard, cases.length),
      bySuite,
    },
  }

  if (input.logToConsole !== false) {
    console.log(formatBehaviorTreeOnlineEvalReport(report))
  }

  return report
}

export function formatBehaviorTreeOnlineEvalReport(report: OnlineEvalReport): string {
  const lines: string[] = []
  lines.push('=== Behavior Tree LLM Online Eval ===')
  lines.push(`provider=${report.meta.provider} model=${report.meta.model} runs=${report.meta.runsDefault}`)
  lines.push('')
  for (const item of report.cases) {
    lines.push(`[${item.suite}] ${item.id}`)
    lines.push(`  hardPassRate=${item.hardPassRate}`)
    lines.push(
      `  format=${item.passRateByDimension.format} schema=${item.passRateByDimension.schema_contract} runtime=${item.passRateByDimension.runtime_apply} inventory=${item.passRateByDimension.inventory} effective=${item.passRateByDimension.effective}`
    )
    if (item.failures.length > 0) {
      lines.push(`  failures=${item.failures.join(' | ')}`)
    }
    lines.push('')
  }
  lines.push(`aggregate.hardPassRate=${report.aggregate.hardPassRate}`)
  lines.push(
    `aggregate.patch=${report.aggregate.bySuite.patch} aggregate.initial_tree=${report.aggregate.bySuite.initial_tree}`
  )
  return lines.join('\n')
}

/*a reserved api*/
export function buildSeedTreeForFutureCases(actorId: string): BehaviorTreeState {
  return createInitialBehaviorTree({ actorId, currentTick: 0 })
}
