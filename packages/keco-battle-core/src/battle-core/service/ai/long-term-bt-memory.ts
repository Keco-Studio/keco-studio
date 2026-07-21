/**
 * Long-term behavior-tree memory (browser localStorage).
 * Cross-battle: winner snapshots, global battle ordinal, human per-opponent entries, single enemy tree.
 * For single-battle event-window memory see `short-term-memory.ts`.
 */

import type { BattleResult } from '../../domain/types/battle-types'
import type { BehaviorTreeNode, BehaviorTreeState } from './behavior-tree/types'
import { sanitizeActorId } from './behavior-tree/initial-behavior-tree'

/** Single localStorage key for the whole persisted JSON blob; bump `v2` if on-disk shape changes. */
const STORAGE_KEY = 'battle-poc:long-term-bt:v1'
/** Written into that JSON; `readStore` rejects other values so old/corrupt blobs reset cleanly. */
const SCHEMA_VERSION = 1 as const

/**
 * When picking among several past human wins (new opponent): weight ≈ 1 / (1 + WEIGHT_LOG_COEFF * log(1 + battleGap)).
 * Larger coeff → old entries lose probability faster. WEIGHT_FLOOR caps how low any entry can go (avoids ~100:1 vs most-recent).
 */
const WEIGHT_LOG_COEFF = 0.35
const WEIGHT_FLOOR = 0.15

export type LongTermBtHumanEntry = {
  tree: BehaviorTreeState
  /** `globalOrdinal` after this battle ended (same as stored snapshot version). */
  ordinalAtSave: number
  /** Prefix used in node ids when this tree was saved (see `sanitizeActorId`). */
  actorIdPrefix: string
}

export type LongTermBtEnemySlot = {
  tree: BehaviorTreeState
  ordinalAtSave: number
  actorIdPrefix: string
}

export type LongTermBtPersistedV1 = {
  schemaVersion: typeof SCHEMA_VERSION
  globalOrdinal: number
  humanByOpponent: Record<string, LongTermBtHumanEntry>
  enemy: LongTermBtEnemySlot | null
}

function defaultStore(): LongTermBtPersistedV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    globalOrdinal: 0,
    humanByOpponent: {},
    enemy: null,
  }
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage
    return ls ?? null
  } catch {
    return null
  }
}

function deepCloneTree(tree: BehaviorTreeState): BehaviorTreeState {
  return JSON.parse(JSON.stringify(tree)) as BehaviorTreeState
}

function readStore(): LongTermBtPersistedV1 {
  const ls = getLocalStorage()
  if (!ls) return defaultStore()
  try {
    const raw = ls.getItem(STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as Partial<LongTermBtPersistedV1>
    if (parsed.schemaVersion !== SCHEMA_VERSION || typeof parsed.globalOrdinal !== 'number') {
      return defaultStore()
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      globalOrdinal: Math.max(0, Math.floor(parsed.globalOrdinal)),
      humanByOpponent:
        parsed.humanByOpponent && typeof parsed.humanByOpponent === 'object'
          ? (parsed.humanByOpponent as Record<string, LongTermBtHumanEntry>)
          : {},
      enemy: parsed.enemy && typeof parsed.enemy === 'object' ? (parsed.enemy as LongTermBtEnemySlot) : null,
    }
  } catch {
    return defaultStore()
  }
}

/**
 * Persist current snapshot to `localStorage`. Called automatically by `updateLongTermBtAfterBattle`;
 * exposed for tests or explicit flush.
 */
export function saveLongTermBtToLocalStorage(
  store: LongTermBtPersistedV1,
  options?: {
    behaviorTreeLog?: boolean
    battleResult?: BattleResult
    opponentKey?: string
  }
): void {
  const ls = getLocalStorage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(store))
    if (options?.behaviorTreeLog) {
      console.info('[battle-core][BT] long_term_persisted', {
        storageKey: STORAGE_KEY,
        globalOrdinal: store.globalOrdinal,
        battleResult: options.battleResult,
        opponentKey: options.opponentKey,
        resultHumanTrees: Object.keys(store.humanByOpponent),
        enemyTreeId: store.enemy?.tree.treeId ?? null,
        enemyVersion: store.enemy?.tree.version ?? null,
      })
    }
  } catch {
    // Quota or privacy mode: ignore.
  }
}

/** Remove persisted long-term BT (e.g. on account sign-out so the next user does not inherit AI memory). */
export function clearLongTermBtPersisted(): void {
  const ls = getLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}

export type PickLongTermBtRole = 'human' | 'enemy'

export type PickLongTermBtSeedInput = {
  role: PickLongTermBtRole
  /** Opponent key for the human side (e.g. enemy entity id). Unused when `role === 'enemy'`. */
  opponentKey: string
  /** Current battle actor id for id-prefix remap (`session.left.id` / `session.right.id`). */
  currentActorId: string
}

function remapNodeIds(node: BehaviorTreeNode, oldPrefix: string, newPrefix: string): BehaviorTreeNode {
  const mapId = (id: string) => {
    if (id.startsWith(`${oldPrefix}_`)) return `${newPrefix}_${id.slice(oldPrefix.length + 1)}`
    return id
  }
  const base = { ...node, id: mapId(node.id) }
  if (base.type === 'selector' || base.type === 'sequence') {
    return {
      ...base,
      children: base.children.map((c) => remapNodeIds(c, oldPrefix, newPrefix)),
    }
  }
  return base
}

function remapBehaviorTreeByPrefix(tree: BehaviorTreeState, oldPrefix: string, newPrefix: string): BehaviorTreeState {
  const oldP = String(oldPrefix || '').trim() || 'actor'
  const newP = String(newPrefix || '').trim() || 'actor'
  if (oldP === newP) return deepCloneTree(tree)
  const treeId =
    tree.treeId === `bt_${oldP}`
      ? `bt_${newP}`
      : tree.treeId.replace(new RegExp(`^${escapeRe(`bt_${oldP}`)}$`), `bt_${newP}`)
  return {
    ...tree,
    treeId,
    root: remapNodeIds(tree.root, oldP, newP),
  }
}

/*avoid to be confused with the escapeRegex function*/
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/*calculate the weight of the ordinal*/
function ordinalWeight(globalOrdinal: number, ordinalAtSave: number): number {
  const d = Math.max(0, globalOrdinal - ordinalAtSave)
  const w = 1 / (1 + WEIGHT_LOG_COEFF * Math.log(1 + d))
  return Math.max(WEIGHT_FLOOR, w)
}

function weightedPickIndex(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * sum
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

/**
 * Select a behavior tree seed from long-term storage for the current actor.
 * Human: exact opponent entry if present; otherwise weighted among other opponents' trees by ordinal closeness.
 * Enemy: single global tree if present.
 */
export function pickLongTermBtSeed(input: PickLongTermBtSeedInput): BehaviorTreeState | null {
  const store = readStore()
  const ord = store.globalOrdinal

  const newPrefix = sanitizeActorId(input.currentActorId)

  if (input.role === 'enemy') {
    const slot = store.enemy
    if (!slot?.tree) return null
    try {
      return remapBehaviorTreeByPrefix(slot.tree, slot.actorIdPrefix, newPrefix)
    } catch {
      return null
    }
  }

  const opp = String(input.opponentKey || '').trim()
  if (!opp) return null

  const direct = store.humanByOpponent[opp]
  if (direct?.tree) {
    try {
      return remapBehaviorTreeByPrefix(direct.tree, direct.actorIdPrefix, newPrefix)
    } catch {
      return null
    }
  }

  const candidates = Object.entries(store.humanByOpponent).filter(([k]) => k !== opp)
  if (candidates.length === 0) return null
  if (candidates.length === 1) {
    const [, e] = candidates[0]
    try {
      return remapBehaviorTreeByPrefix(e.tree, e.actorIdPrefix, newPrefix)
    } catch {
      return null
    }
  }

  const weights = candidates.map(([, e]) => ordinalWeight(ord, e.ordinalAtSave))
  const idx = weightedPickIndex(weights)
  const chosen = candidates[idx][1]
  try {
    return remapBehaviorTreeByPrefix(chosen.tree, chosen.actorIdPrefix, newPrefix)
  } catch {
    return null
  }
}

export type UpdateLongTermBtAfterBattleInput = {
  result: BattleResult
  /** Right-side opponent key for indexing human wins (e.g. `session.right.id`). */
  opponentKey: string //human use, enemy jump
  leftActorId: string
  rightActorId: string
  leftTree: BehaviorTreeState | null
  rightTree: BehaviorTreeState | null
  /** When true, logs one line to `console.info` after a successful `localStorage` write. */
  behaviorTreeLog?: boolean
}

/**
 * Every finished battle: increment `globalOrdinal`.
 * Only clear wins update trees: `left_win` stores human tree; `right_win` stores the single global enemy tree.
 * Draw / fled / ongoing: ordinal only, no tree changes.
 */
export function updateLongTermBtAfterBattle(input: UpdateLongTermBtAfterBattleInput): void {
  const store = readStore()
  store.globalOrdinal = Math.max(0, store.globalOrdinal) + 1
  const o = store.globalOrdinal
  const opp = String(input.opponentKey || '').trim()

  if (input.result === 'left_win' && input.leftTree && opp) {
    store.humanByOpponent[opp] = {
      tree: deepCloneTree(input.leftTree),
      ordinalAtSave: o,
      actorIdPrefix: sanitizeActorId(input.leftActorId),
    }
  } else if (input.result === 'right_win' && input.rightTree) {
    store.enemy = {
      tree: deepCloneTree(input.rightTree),
      ordinalAtSave: o,
      actorIdPrefix: sanitizeActorId(input.rightActorId),
    }
  }

  saveLongTermBtToLocalStorage(store, {
    behaviorTreeLog: input.behaviorTreeLog,
    battleResult: input.result,
    opponentKey: opp,
  })
}

/** Read-only snapshot (e.g. tests, debug UI). */
export function readLongTermBtStore(): LongTermBtPersistedV1 {
  return readStore()
}
