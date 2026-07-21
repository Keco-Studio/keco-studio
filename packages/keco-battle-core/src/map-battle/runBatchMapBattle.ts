import type { Element, Skill } from '@keco/battle-engine'
import { MapBattleController } from './MapBattleController'
import { createKecoArenaSession } from '../keco/createKecoBattleSession'
import type { BattleResult } from '../battle-core/domain/types/battle-types'
import type { MapBattleStartConfig } from './createMapBattleSession'

const DEFAULT_MAX_TICKS_PER_BATTLE = 4000

export type BatchMapBattleInput = {
  mapWidth: number
  mapHeight: number
  playerName: string
  playerStats: { maxHp: number; atk: number; def: number; spd: number }
  playerHp: number
  playerMp: number
  playerMaxMp: number
  playerSkillIds: string[]
  enemyName: string
  enemyStats: { maxHp: number; atk: number; def: number; spd: number }
  enemyHp: number
  enemyMp: number
  enemyMaxMp: number
  enemySkillIds: string[]
  skills: Skill[]
  monsterInitialElement?: Element | null
  preparationTicks?: number
  maxTicksPerBattle?: number
}

export type BatchMapBattleSummary = {
  runs: number
  leftWins: number
  rightWins: number
  draws: number
  fled: number
  incomplete: number
}

function defaultSpawn(mapW: number, mapH: number) {
  const midY = Math.floor(mapH / 2)
  return {
    player: { x: Math.max(2, Math.floor(mapW * 0.3)), y: midY },
    enemy: { x: Math.min(mapW - 3, Math.floor(mapW * 0.65)), y: midY },
  }
}

function buildControllerConfig(input: BatchMapBattleInput): MapBattleStartConfig {
  const spawn = defaultSpawn(input.mapWidth, input.mapHeight)
  const session = createKecoArenaSession({
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
    playerName: input.playerName,
    playerGrid: spawn.player,
    playerStats: { ...input.playerStats, maxHp: input.playerStats.maxHp },
    playerHp: input.playerHp,
    playerMp: input.playerMp,
    playerMaxMp: input.playerMaxMp,
    playerSkillIds: input.playerSkillIds,
    enemyName: input.enemyName,
    enemyGrid: spawn.enemy,
    enemyStats: { ...input.enemyStats, maxHp: input.enemyStats.maxHp },
    enemyHp: input.enemyHp,
    enemyMp: input.enemyMp,
    enemyMaxMp: input.enemyMaxMp,
    enemySkillIds: input.enemySkillIds,
    skills: input.skills,
    monsterInitialElement: input.monsterInitialElement ?? undefined,
    preparationTicks: input.preparationTicks ?? 3,
  })

  return {
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
    playerName: input.playerName,
    playerGrid: spawn.player,
    playerStats: { ...input.playerStats, maxHp: input.playerStats.maxHp },
    playerHp: input.playerHp,
    playerMp: input.playerMp,
    playerMaxMp: input.playerMaxMp,
    playerSkillIds: input.playerSkillIds,
    enemyName: input.enemyName,
    enemyId: 'poc-enemy',
    enemyGrid: spawn.enemy,
    enemyStats: { ...input.enemyStats, maxHp: input.enemyStats.maxHp },
    enemySkillIds: input.enemySkillIds,
    battleDecisionMode: 'manual',
    initialSession: session,
  }
}

/** Run one headless map battle (same AI path as BattleArena manual mode). */
export function runSingleMapBattle(input: BatchMapBattleInput): BattleResult {
  const maxTicks = Math.max(1, input.maxTicksPerBattle ?? DEFAULT_MAX_TICKS_PER_BATTLE)
  const ctrl = new MapBattleController(buildControllerConfig(input))

  while (ctrl.session.result === 'ongoing' && ctrl.session.tick < maxTicks) {
    const executeAtTick = ctrl.session.tick + 1
    ctrl.step({
      executeAtTick,
      nextAttackSkillId: null,
      pendingFlee: false,
    })
  }

  return ctrl.session.result
}

function emptySummary(): BatchMapBattleSummary {
  return {
    runs: 0,
    leftWins: 0,
    rightWins: 0,
    draws: 0,
    fled: 0,
    incomplete: 0,
  }
}

function recordOutcome(summary: BatchMapBattleSummary, result: ReturnType<typeof runSingleMapBattle>): void {
  summary.runs += 1
  switch (result) {
    case 'left_win':
      summary.leftWins += 1
      break
    case 'right_win':
      summary.rightWins += 1
      break
    case 'fled':
      summary.fled += 1
      break
    case 'draw':
      summary.draws += 1
      break
    default:
      summary.incomplete += 1
      break
  }
}

/** Synchronous batch run (use from a worker or chunked UI loop for large N). */
export function runBatchMapBattle(input: BatchMapBattleInput, runs: number): BatchMapBattleSummary {
  const count = Math.max(0, Math.floor(runs))
  const summary = emptySummary()
  for (let i = 0; i < count; i += 1) {
    recordOutcome(summary, runSingleMapBattle(input))
  }
  return summary
}

export const BATCH_MAP_BATTLE_LIMITS = {
  maxRuns: 500,
  defaultRuns: 50,
  maxTicksPerBattle: DEFAULT_MAX_TICKS_PER_BATTLE,
} as const
