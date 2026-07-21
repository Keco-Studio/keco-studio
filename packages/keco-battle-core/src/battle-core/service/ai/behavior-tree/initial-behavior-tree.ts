import type { BehaviorTreeState } from './types'

/**
 * Factory for the default combat behavior tree (v2).
 * Root is a selector: children are tried top-to-bottom; first fully matching branch wins.
 * Phase metric `battle_phase_numeric`: 0 = both >70% HP, 1 = mid, 2 = late (either ≤30%).
 */
export function createInitialBehaviorTree(input: {
  actorId: string
  currentTick: number
}): BehaviorTreeState {
  const prefix = sanitizeActorId(input.actorId)
  return {
    treeId: `bt_${prefix}`,
    version: 2,
    updatedAtTick: Math.max(0, Math.floor(input.currentTick)),
    root: {
      id: `${prefix}_root_selector`,
      type: 'selector',
      name: 'root',
      children: [
        // Burst skill when target is low and self is healthy enough.
        {
          id: `${prefix}_seq_finish_kill`,
          type: 'sequence',
          name: 'finish_kill',
          children: [
            {
              id: `${prefix}_cond_finish_target_hp`,
              type: 'condition',
              name: 'target_finish_window',
              metric: 'target_hp_ratio',
              operator: '<=',
              value: 0.3,
            },
            {
              id: `${prefix}_cond_finish_self_safe`,
              type: 'condition',
              name: 'self_hp_safe_for_burst',
              metric: 'hp_ratio',
              operator: '>',
              value: 0.4,
            },
            {
              id: `${prefix}_act_finish_skill`,
              type: 'action',
              name: 'finish_burst_skill',
              action: 'cast_skill',
            },
          ],
        },
        // Same low-target window but self is also low: trade with skill if one is ready in range.
        {
          id: `${prefix}_seq_finish_desperate_skill`,
          type: 'sequence',
          name: 'finish_desperate_skill',
          children: [
            {
              id: `${prefix}_cond_fd_target_low`,
              type: 'condition',
              name: 'target_finish_window_desperate',
              metric: 'target_hp_ratio',
              operator: '<=',
              value: 0.3,
            },
            {
              id: `${prefix}_cond_fd_self_low`,
              type: 'condition',
              name: 'self_low_with_target_finish',
              metric: 'hp_ratio',
              operator: '<=',
              value: 0.4,
            },
            {
              id: `${prefix}_cond_fd_skill_ready`,
              type: 'condition',
              name: 'has_ready_skill_in_range',
              metric: 'no_ready_skill_in_range',
              operator: '==',
              value: 0,
            },
            {
              id: `${prefix}_act_fd_cast`,
              type: 'action',
              name: 'desperate_trade_skill',
              action: 'cast_skill',
            },
          ],
        },
        // Low self + low target: disengage dash if skill path above did not fire.
        {
          id: `${prefix}_seq_finish_desperate_run`,
          type: 'sequence',
          name: 'finish_desperate_run',
          children: [
            {
              id: `${prefix}_cond_fr_target_low`,
              type: 'condition',
              name: 'target_finish_window_run',
              metric: 'target_hp_ratio',
              operator: '<=',
              value: 0.3,
            },
            {
              id: `${prefix}_cond_fr_self_low`,
              type: 'condition',
              name: 'self_low_escape',
              metric: 'hp_ratio',
              operator: '<=',
              value: 0.4,
            },
            {
              id: `${prefix}_act_fr_retreat`,
              type: 'action',
              name: 'disengage_after_finish_attempt',
              action: 'dash',
              target: 'retreat',
              moveStep: 2.6,
            },
          ],
        },
        // Critical self HP while hugging map edge: dash toward center.
        {
          id: `${prefix}_seq_low_hp_corner_escape`,
          type: 'sequence',
          name: 'low_hp_corner_escape',
          children: [
            {
              id: `${prefix}_cond_self_low_hp_corner`,
              type: 'condition',
              name: 'self_low_hp',
              metric: 'hp_ratio',
              operator: '<=',
              value: 0.3,
            },
            {
              id: `${prefix}_cond_near_edge`,
              type: 'condition',
              name: 'near_edge',
              metric: 'near_edge',
              operator: '==',
              value: 1,
            },
            {
              id: `${prefix}_act_escape_center`,
              type: 'action',
              name: 'escape_center',
              action: 'dash',
              target: 'center',
              moveStep: 2.8,
            },
          ],
        },
        // Behind on HP and enemy close: retreat dash.
        {
          id: `${prefix}_seq_retreat_low_hp`,
          type: 'sequence',
          name: 'retreat_low_hp',
          children: [
            {
              id: `${prefix}_cond_rlh_hp`,
              type: 'condition',
              name: 'self_critical_hp',
              metric: 'hp_ratio',
              operator: '<=',
              value: 0.3,
            },
            {
              id: `${prefix}_cond_rlh_losing_hp`,
              type: 'condition',
              name: 'hp_disadvantage_vs_target',
              metric: 'hp_advantage',
              operator: '<',
              value: 0,
            },
            {
              id: `${prefix}_cond_rlh_threat_close`,
              type: 'condition',
              name: 'opponent_within_retreat_window',
              metric: 'distance',
              operator: '<',
              value: 4,
            },
            {
              id: `${prefix}_act_rlh_retreat`,
              type: 'action',
              name: 'retreat_dash',
              action: 'dash',
              target: 'retreat',
              moveStep: 2.6,
            },
          ],
        },
        // Too many dash rejects: dodge instead of spamming movement.
        {
          id: `${prefix}_seq_dash_guard`,
          type: 'sequence',
          name: 'dash_guard',
          children: [
            {
              id: `${prefix}_cond_recent_dash_rejects`,
              type: 'condition',
              name: 'recent_dash_rejects',
              metric: 'recent_dash_rejects',
              operator: '>=',
              value: 2,
            },
            {
              id: `${prefix}_act_guard_dodge`,
              type: 'action',
              name: 'guard_dodge',
              action: 'dodge',
            },
          ],
        },
        // Mid-game pressure: cast when a skill is ready, HP ok, and not late phase.
        {
          id: `${prefix}_seq_skill_pressure`,
          type: 'sequence',
          name: 'skill_pressure',
          children: [
            {
              id: `${prefix}_cond_sp_skill_ready`,
              type: 'condition',
              name: 'has_ready_skill_in_range',
              metric: 'no_ready_skill_in_range',
              operator: '==',
              value: 0,
            },
            {
              id: `${prefix}_cond_sp_hp_ok`,
              type: 'condition',
              name: 'hp_above_pressure_floor',
              metric: 'hp_ratio',
              operator: '>',
              value: 0.35,
            },
            {
              id: `${prefix}_cond_sp_not_late_phase`,
              type: 'condition',
              name: 'not_late_phase',
              metric: 'battle_phase_numeric',
              operator: '<',
              value: 2,
            },
            {
              id: `${prefix}_act_sp_cast`,
              type: 'action',
              name: 'cast_pressure_skill',
              action: 'cast_skill',
            },
          ],
        },
        // Safe melee basic attack when in range and not on a losing streak.
        {
          id: `${prefix}_seq_melee_trade`,
          type: 'sequence',
          name: 'melee_trade',
          children: [
            {
              id: `${prefix}_cond_mt_basic`,
              type: 'condition',
              name: 'basic_in_range',
              metric: 'basic_in_range',
              operator: '==',
              value: 1,
            },
            {
              id: `${prefix}_cond_mt_hp_ok`,
              type: 'condition',
              name: 'no_hp_disadvantage',
              metric: 'hp_advantage',
              operator: '>=',
              value: 0,
            },
            {
              id: `${prefix}_cond_mt_not_losing_streak`,
              type: 'condition',
              name: 'not_consecutive_losing_trades',
              metric: 'consecutive_losing_trade',
              operator: '<',
              value: 2,
            },
            {
              id: `${prefix}_act_mt_basic`,
              type: 'action',
              name: 'basic_attack',
              action: 'basic_attack',
            },
          ],
        },
        // Mid phase poke with skill from outside basic range.
        {
          id: `${prefix}_seq_poke_mid`,
          type: 'sequence',
          name: 'poke_from_range',
          children: [
            {
              id: `${prefix}_cond_pk_skill`,
              type: 'condition',
              name: 'skill_reaches_target',
              metric: 'no_ready_skill_in_range',
              operator: '==',
              value: 0,
            },
            {
              id: `${prefix}_cond_pk_outside_basic`,
              type: 'condition',
              name: 'outside_basic_range',
              metric: 'distance',
              operator: '>',
              value: 1.6,
            },
            {
              id: `${prefix}_cond_pk_mid_phase`,
              type: 'condition',
              name: 'mid_phase_only',
              metric: 'battle_phase_numeric',
              operator: '==',
              value: 1,
            },
            {
              id: `${prefix}_act_pk_cast`,
              type: 'action',
              name: 'poke_skill',
              action: 'cast_skill',
            },
          ],
        },
        // Default: close distance with approach dash.
        {
          id: `${prefix}_act_approach`,
          type: 'action',
          name: 'approach_dash',
          action: 'dash',
          target: 'approach',
          moveStep: 2.2,
        },
      ],
    },
  }
}

/** Stable token for ids: non-alphanumeric characters become underscores. */
export function sanitizeActorId(raw: string): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return 'actor'
  return trimmed.replace(/[^a-zA-Z0-9_]/g, '_')
}
