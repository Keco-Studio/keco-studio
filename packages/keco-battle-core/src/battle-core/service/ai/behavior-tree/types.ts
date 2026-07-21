/**
 * Battle AI behavior tree: node union (selector / sequence / condition / action), serialized state,
 * and patch ops for LLM or tooling. Evaluation: `runtime.ts`; ingest rules: `validation.ts`.
 */

/** Discriminator values for any tree node (`BehaviorTreeNode` narrows on `type`). */
export type BehaviorTreeNodeType = 'selector' | 'sequence' | 'condition' | 'action'

/**
 * Condition metrics resolved at runtime by `readMetric` in `runtime.ts`.
 * Keep `validation.ts` ALLOWED_METRICS in sync when adding or removing entries.
 */
export type BehaviorMetric =
  | 'hp_ratio'
  | 'target_hp_ratio'
  | 'distance'
  | 'hp_disadvantage'
  | 'hp_advantage'
  | 'battle_phase_numeric'
  | 'consecutive_losing_trade'
  | 'near_edge'
  | 'has_any_ready_skill'
  | 'ready_skill_out_of_range'
  | 'no_ready_skill_in_range'
  | 'basic_in_range'
  | 'recent_dash_rejects'
  | 'recent_blocked_rejects'
  | 'dash_cooldown_active'
  | 'dash_streak_locked'

/** Comparison between the runtime metric sample and `BehaviorConditionNode.value`. */
export type BehaviorConditionOperator = '<' | '<=' | '>' | '>=' | '==' | '!='

/** Leaf action kinds mapped to battle commands by the behavior-tree runtime. */
export type BehaviorActionType = 'basic_attack' | 'cast_skill' | 'dash' | 'dodge' | 'flee'

/** Spatial intent for movement-related actions (resolved to goals in `runtime.ts`). */
export type BehaviorActionTarget = 'approach' | 'retreat' | 'hold' | 'center'

/** Stable node id (patches and UI target nodes by id); optional human-readable label. */
type BehaviorTreeNodeBase = {
  id: string
  name?: string
}

/** Composite node: selector picks first succeeding child; sequence requires all children in order. */
export type BehaviorControlNode = BehaviorTreeNodeBase & {
  type: 'selector' | 'sequence'
  children: BehaviorTreeNode[]
}

/** Leaf guard: compares a `BehaviorMetric` to `value` using `operator` (defaults applied in runtime). */
export type BehaviorConditionNode = BehaviorTreeNodeBase & {
  type: 'condition'
  metric: BehaviorMetric
  operator?: BehaviorConditionOperator
  value?: number
}

/** Leaf command: emits one decision branch when selected by the tree walk. */
export type BehaviorActionNode = BehaviorTreeNodeBase & {
  type: 'action'
  action: BehaviorActionType
  target?: BehaviorActionTarget
  skillId?: string
  moveStep?: number
}

export type BehaviorTreeNode = BehaviorControlNode | BehaviorConditionNode | BehaviorActionNode

/** Serialized tree snapshot: identity, monotonic version, last update tick, and recursive root. */
export type BehaviorTreeState = {
  treeId: string
  version: number
  updatedAtTick: number
  root: BehaviorTreeNode
}

/** Patch op: update only the numeric threshold on a condition node identified by `nodeId`. */
export type SetConditionValueOperation = {
  op: 'set_condition_value'
  nodeId: string
  value: number
}

/** Patch op: replace action fields on an action node; extra fields cleared in `validation.ts` by action kind. */
export type ReplaceActionOperation = {
  op: 'replace_action'
  nodeId: string
  action: BehaviorActionType
  target?: BehaviorActionTarget
  moveStep?: number
  skillId?: string
}

/** Patch op: reorder children of a selector/sequence; unknown ids are ignored, tail preserves remaining order. */
export type ReorderChildrenOperation = {
  op: 'reorder_children'
  nodeId: string
  orderedChildIds: string[]
}

export type BehaviorTreePatchOperation =
  | SetConditionValueOperation
  | ReplaceActionOperation
  | ReorderChildrenOperation

/**
 * Batch of patch operations. Optional `baseVersion` enables optimistic concurrency against `BehaviorTreeState.version`.
 */
export type BehaviorTreePatch = {
  baseVersion?: number
  reason?: string
  ops: BehaviorTreePatchOperation[]
}
