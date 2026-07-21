/**
 * Behavior tree validation and mutation: whitelist metrics/actions, cap depth, clone/patch safely,
 * and reject malformed payloads so runtime always sees a consistent tree shape.
 */
import type {
  BehaviorActionNode,
  BehaviorActionTarget,
  BehaviorActionType,
  BehaviorConditionNode,
  BehaviorConditionOperator,
  BehaviorMetric,
  BehaviorTreeNode,
  BehaviorTreePatch,
  BehaviorTreeState,
} from './types'

/** Maximum nesting depth when ingesting external tree JSON (defense in depth). */
const MAX_TREE_DEPTH = 6
const MIN_MOVE_STEP = 0.4
const MAX_MOVE_STEP = 4.2

const ALLOWED_METRICS = new Set<BehaviorMetric>([
  'hp_ratio',
  'target_hp_ratio',
  'distance',
  'hp_disadvantage',
  'hp_advantage',
  'battle_phase_numeric',
  'consecutive_losing_trade',
  'near_edge',
  'has_any_ready_skill',
  'ready_skill_out_of_range',
  'no_ready_skill_in_range',
  'basic_in_range',
  'recent_dash_rejects',
  'recent_blocked_rejects',
  'dash_cooldown_active',
  'dash_streak_locked',
])

const ALLOWED_OPERATORS = new Set<BehaviorConditionOperator>(['<', '<=', '>', '>=', '==', '!='])
const ALLOWED_ACTIONS = new Set<BehaviorActionType>([
  'basic_attack',
  'cast_skill',
  'dash',
  'dodge',
  'flee',
])
const ALLOWED_TARGETS = new Set<BehaviorActionTarget>(['approach', 'retreat', 'hold', 'center'])

/** Result of applying a patch: possibly unchanged tree plus human-readable reason code. */
export type ApplyBehaviorTreePatchResult = {
  tree: BehaviorTreeState
  applied: boolean
  reason: string
}

/** Parse untrusted tree JSON; on failure return a deep clone of `seedTree`. */
export function sanitizeBehaviorTreeState(raw: unknown, seedTree: BehaviorTreeState): BehaviorTreeState {
  const seedClone = cloneTreeState(seedTree)
  const payload = unwrapTreePayload(raw)
  if (!payload) return seedClone

  const treeId = typeof payload.treeId === 'string' && payload.treeId.trim().length > 0
    ? payload.treeId.trim()
    : seedClone.treeId
  const version = sanitizeVersion(payload.version, seedClone.version)
  const updatedAtTick = sanitizeTick(payload.updatedAtTick, seedClone.updatedAtTick)
  const seenNodeIds = new Set<string>()
  const root = sanitizeNode(payload.root, 1, seenNodeIds)
  if (!root || (root.type !== 'selector' && root.type !== 'sequence')) {
    return seedClone
  }

  return {
    treeId,
    version,
    updatedAtTick,
    root,
  }
}

/**
 * Apply patch ops in order on a clone, bump version, then re-sanitize.
 * Any invalid op aborts and returns the original tree unchanged.
 */
export function applyBehaviorTreePatch(
  currentTree: BehaviorTreeState,
  patch: BehaviorTreePatch | null | undefined,
  updatedAtTick: number,
): ApplyBehaviorTreePatchResult {
  const original = cloneTreeState(currentTree)
  if (!patch || !Array.isArray(patch.ops) || patch.ops.length === 0) {
    return { tree: original, applied: false, reason: 'empty_patch' }
  }
  if (patch.baseVersion != null && patch.baseVersion !== currentTree.version) {
    return { tree: original, applied: false, reason: 'base_version_mismatch' }
  }

  const draft = cloneTreeState(currentTree)
  const nodeIndex = buildNodeIndex(draft.root)

  for (const op of patch.ops) {
    if (op.op === 'set_condition_value') {
      const node = nodeIndex.get(op.nodeId)
      if (!node || node.type !== 'condition' || !Number.isFinite(op.value)) {
        return { tree: original, applied: false, reason: 'invalid_set_condition_value' }
      }
      node.value = Number(op.value)
      continue
    }

    if (op.op === 'replace_action') {
      const node = nodeIndex.get(op.nodeId)
      if (!node || node.type !== 'action' || !ALLOWED_ACTIONS.has(op.action)) {
        return { tree: original, applied: false, reason: 'invalid_replace_action' }
      }
      applyActionReplacement(node, op.action, op.target, op.skillId, op.moveStep)
      continue
    }

    if (op.op === 'reorder_children') {
      const node = nodeIndex.get(op.nodeId)
      if (!node || (node.type !== 'selector' && node.type !== 'sequence')) {
        return { tree: original, applied: false, reason: 'invalid_reorder_children' }
      }
      reorderNodeChildren(node, op.orderedChildIds)
      continue
    }

    return { tree: original, applied: false, reason: 'unknown_patch_operation' }
  }

  draft.version = Math.max(1, Math.floor(currentTree.version + 1))
  draft.updatedAtTick = sanitizeTick(updatedAtTick, currentTree.updatedAtTick)
  const sanitized = sanitizeBehaviorTreeState(draft, currentTree)
  return { tree: sanitized, applied: true, reason: 'ok' }
}

/** Accept either `{ tree: ... }` or a bare tree object from external payloads. */
function unwrapTreePayload(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  if (isRecord(raw.tree)) return raw.tree
  return raw
}

/** Recursively coerce one node; enforces unique ids and allowed enum values per node type. */
function sanitizeNode(
  raw: unknown,
  depth: number,
  seenNodeIds: Set<string>,
): BehaviorTreeNode | null {
  if (!isRecord(raw) || depth > MAX_TREE_DEPTH) return null
  const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : ''
  if (!id || seenNodeIds.has(id)) return null
  seenNodeIds.add(id)

  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : undefined
  const type = typeof raw.type === 'string' ? raw.type : ''

  if (type === 'selector' || type === 'sequence') {
    const rawChildren = Array.isArray(raw.children) ? raw.children : []
    const children = rawChildren
      .map((entry) => sanitizeNode(entry, depth + 1, seenNodeIds))
      .filter((entry): entry is BehaviorTreeNode => Boolean(entry))
    if (children.length === 0) return null
    return { id, name, type, children }
  }

  if (type === 'condition') {
    const metric = typeof raw.metric === 'string' ? (raw.metric as BehaviorMetric) : null
    if (!metric || !ALLOWED_METRICS.has(metric)) return null
    const operatorRaw = typeof raw.operator === 'string' ? (raw.operator as BehaviorConditionOperator) : undefined
    const operator = operatorRaw && ALLOWED_OPERATORS.has(operatorRaw) ? operatorRaw : undefined
    const value = typeof raw.value === 'number' && Number.isFinite(raw.value) ? Number(raw.value) : undefined
    const out: BehaviorConditionNode = { id, name, type: 'condition', metric }
    if (operator) out.operator = operator
    if (value != null) out.value = value
    return out
  }

  if (type === 'action') {
    const action = typeof raw.action === 'string' ? (raw.action as BehaviorActionType) : null
    if (!action || !ALLOWED_ACTIONS.has(action)) return null

    const out: BehaviorActionNode = { id, name, type: 'action', action }
    const target = typeof raw.target === 'string' ? (raw.target as BehaviorActionTarget) : undefined
    if (target && ALLOWED_TARGETS.has(target)) out.target = target
    if (typeof raw.skillId === 'string' && raw.skillId.trim().length > 0) {
      out.skillId = raw.skillId.trim()
    }
    if (typeof raw.moveStep === 'number' && Number.isFinite(raw.moveStep)) {
      out.moveStep = clamp(Number(raw.moveStep), MIN_MOVE_STEP, MAX_MOVE_STEP)
    }
    if (action !== 'dash') {
      delete out.moveStep
    }
    return out
  }

  return null
}

/** Replace action fields and strip fields that do not apply to the new action kind. */
function applyActionReplacement(
  node: BehaviorActionNode,
  action: BehaviorActionType,
  target?: string,
  skillId?: string,
  moveStep?: number,
): void {
  node.action = action
  node.target = target && ALLOWED_TARGETS.has(target as BehaviorActionTarget)
    ? (target as BehaviorActionTarget)
    : undefined
  node.skillId = typeof skillId === 'string' && skillId.trim().length > 0 ? skillId.trim() : undefined
  node.moveStep = typeof moveStep === 'number' && Number.isFinite(moveStep)
    ? clamp(Number(moveStep), MIN_MOVE_STEP, MAX_MOVE_STEP)
    : undefined

  if (action !== 'dash') {
    delete node.moveStep
  }
  if (action !== 'cast_skill') {
    delete node.skillId
  }
}

/** Reorder composite children: listed ids first, then any remaining children in original order. */
function reorderNodeChildren(
  node: Extract<BehaviorTreeNode, { type: 'selector' | 'sequence' }>,
  orderedChildIds: string[],
): void {
  if (!Array.isArray(orderedChildIds) || orderedChildIds.length === 0) return

  const childById = new Map(node.children.map((child) => [child.id, child]))
  const seen = new Set<string>()
  const reordered: BehaviorTreeNode[] = []

  for (const id of orderedChildIds) {
    if (typeof id !== 'string' || seen.has(id)) continue
    const child = childById.get(id)
    if (!child) continue
    reordered.push(child)
    seen.add(id)
  }

  for (const child of node.children) {
    if (seen.has(child.id)) continue
    reordered.push(child)
  }

  if (reordered.length === node.children.length) {
    node.children = reordered
  }
}

/** Flat id → node map for O(1) patch target lookup (DFS stack order is irrelevant for lookups). */
function buildNodeIndex(root: BehaviorTreeNode): Map<string, BehaviorTreeNode> {
  const out = new Map<string, BehaviorTreeNode>()
  const stack: BehaviorTreeNode[] = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    out.set(current.id, current)
    if (current.type === 'selector' || current.type === 'sequence') {
      for (let i = current.children.length - 1; i >= 0; i -= 1) {
        stack.push(current.children[i])
      }
    }
  }
  return out
}

/** Deep copy of tree state for immutable patch application. */
function cloneTreeState(input: BehaviorTreeState): BehaviorTreeState {
  return {
    treeId: input.treeId,
    version: input.version,
    updatedAtTick: input.updatedAtTick,
    root: cloneNode(input.root),
  }
}

/** Deep copy of a single subtree (used by cloneTreeState and sanitize paths). */
function cloneNode(node: BehaviorTreeNode): BehaviorTreeNode {
  if (node.type === 'selector' || node.type === 'sequence') {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      children: node.children.map((child) => cloneNode(child)),
    }
  }
  if (node.type === 'condition') {
    return {
      id: node.id,
      name: node.name,
      type: 'condition',
      metric: node.metric,
      operator: node.operator,
      value: node.value,
    }
  }
  const action = node as BehaviorActionNode
  return {
    id: action.id,
    name: action.name,
    type: 'action',
    action: action.action,
    target: action.target,
    skillId: action.skillId,
    moveStep: action.moveStep,
  }
}

function sanitizeVersion(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function sanitizeTick(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, Math.floor(fallback))
  return Math.max(0, Math.floor(value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}
