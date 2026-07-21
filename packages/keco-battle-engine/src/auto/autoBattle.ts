import type { BattleState, Skill } from '../types';
import {
  beginCombatFromSetup,
  resolveAutoPlayerTurn,
  resolveEnemyTurn,
  resolveRoundEnd,
  type TurnResolveResult,
} from '../ai/resolveTurn';

export type AutoBattleRuntimeConfig = {
  skillList: Skill[];
  playerSkillIds: string[];
  /** When omitted, enemy may use any affordable skill from skillList */
  enemySkillIds?: string[];
  maxTurns?: number;
};

export type AutoBattleTickKind = 'player' | 'enemy' | 'round_end' | 'begin';

export type AutoBattleStep = {
  kind: AutoBattleTickKind;
  state: BattleState;
  finished: boolean;
};

/**
 * Advances one atomic phase (player action, enemy action, or round end).
 */
export function advanceAutoBattleStep(
  state: BattleState,
  config: AutoBattleRuntimeConfig,
): AutoBattleStep {
  const maxTurns = config.maxTurns ?? 100;

  if (state.phase === 'setup') {
    const next = beginCombatFromSetup(state);
    return { kind: 'begin', state: next, finished: false };
  }

  if (state.phase === 'finished' || state.result) {
    return { kind: 'round_end', state, finished: true };
  }

  let result: TurnResolveResult;

  if (state.phase === 'player_turn') {
    result = resolveAutoPlayerTurn(state, config.skillList, config.playerSkillIds);
    return { kind: 'player', state: result.state, finished: result.finished };
  }

  if (state.phase === 'enemy_turn') {
    result = resolveEnemyTurn(state, config.skillList, config.enemySkillIds);
    return { kind: 'enemy', state: result.state, finished: result.finished };
  }

  if (state.phase === 'round_end') {
    result = resolveRoundEnd(state, maxTurns);
    return { kind: 'round_end', state: result.state, finished: result.finished };
  }

  return { kind: 'round_end', state, finished: true };
}

/**
 * Run entire battle synchronously (tests / batch sim).
 */
export function runAutoBattleToCompletion(
  initialState: BattleState,
  config: AutoBattleRuntimeConfig,
  maxSteps = 5000,
): BattleState {
  let state = initialState;
  let steps = 0;
  while (state.phase !== 'finished' && !state.result && steps < maxSteps) {
    const step = advanceAutoBattleStep(state, config);
    state = step.state;
    steps += 1;
    if (step.finished) break;
  }
  return state;
}
