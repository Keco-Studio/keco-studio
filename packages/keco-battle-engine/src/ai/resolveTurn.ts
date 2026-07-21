import type { BattleState, BattleUnit, Skill } from '../types';
import {
  addLog,
  checkBattleResult,
  executeSkill,
  processTurnEnd,
  reduceCooldowns,
  setSkillCooldown,
} from '../core/battleLogic';
import { pickSkillForUnit } from './pickSkill';

function appendBattleEndLog(
  state: BattleState,
  logs: ReturnType<typeof addLog>[],
  result: NonNullable<BattleState['result']>,
) {
  logs.push(
    addLog(state, {
      type: 'battle_end',
      statusText:
        result === 'player_win'
          ? 'Victory — player wins!'
          : result === 'monster_win'
            ? 'Defeat — enemy wins!'
            : 'Draw!',
      color:
        result === 'player_win' ? '#51cf66' : result === 'monster_win' ? '#ff6b6b' : '#ffd43b',
    }),
  );
}

export type TurnResolveResult = {
  state: BattleState;
  finished: boolean;
};

export function beginCombatFromSetup(state: BattleState): BattleState {
  if (state.phase !== 'setup') return state;
  let logs = [...state.battleLogs];
  const base = { ...state, currentTurn: 1, phase: 'player_turn' as const };
  logs.push(
    addLog(base, {
      type: 'battle_start',
      statusText: 'Auto combat started!',
      color: '#dcdcaa',
    }),
  );
  logs.push(
    addLog(base, {
      type: 'battle_start',
      statusText: `Speed — ${base.player.name} ${base.player.spd} vs ${base.monster.name} ${base.monster.spd}`,
      color: '#8b949e',
    }),
  );
  return { ...base, battleLogs: logs };
}

export function resolvePlayerTurn(
  state: BattleState,
  skill: Skill,
  playerSkillIds: string[],
): TurnResolveResult {
  if (state.phase !== 'player_turn' || state.result) {
    return { state, finished: Boolean(state.result) };
  }

  let newState = { ...state };
  let logs = [...state.battleLogs];
  let player = { ...state.player };
  let monster = { ...state.monster };

  if (player.control?.type === 'freeze') {
    logs.push(
      addLog(newState, {
        type: 'control',
        actor: player.name,
        statusText: `${player.name} is frozen and skips the turn!`,
        color: '#74c0fc',
      }),
    );
    return {
      state: { ...newState, battleLogs: logs, phase: 'enemy_turn' },
      finished: false,
    };
  }

  if (!playerSkillIds.includes(skill.id)) {
    return { state, finished: false };
  }

  const result = executeSkill(newState, player, monster, skill, logs);
  player = result.newAttacker;
  monster = result.newDefender;
  logs = result.newLogs;

  const newCooldowns = setSkillCooldown(state.skillCooldowns, skill);
  newState = {
    ...newState,
    player,
    monster,
    skillCooldowns: newCooldowns,
    battleLogs: logs,
  };

  const battleResult = checkBattleResult(player, monster);
  if (battleResult) {
    appendBattleEndLog(newState, logs, battleResult);
    return {
      state: { ...newState, battleLogs: logs, phase: 'finished', result: battleResult },
      finished: true,
    };
  }

  return {
    state: { ...newState, phase: 'enemy_turn' },
    finished: false,
  };
}

export function resolveEnemyTurn(
  state: BattleState,
  skillList: Skill[],
  enemySkillIds?: string[],
): TurnResolveResult {
  if (state.phase !== 'enemy_turn' || state.result) {
    return { state, finished: Boolean(state.result) };
  }

  let newState = { ...state };
  let logs = [...newState.battleLogs];
  let player = { ...newState.player };
  let monster = { ...newState.monster };

  if (monster.control?.type === 'freeze') {
    logs.push(
      addLog(newState, {
        type: 'control',
        actor: monster.name,
        statusText: `${monster.name} is frozen and skips the turn!`,
        color: '#74c0fc',
      }),
    );
    return {
      state: { ...newState, battleLogs: logs, phase: 'round_end' },
      finished: false,
    };
  }

  const enemySkill = pickSkillForUnit(
    monster,
    player,
    skillList,
    newState.skillCooldowns,
    enemySkillIds,
  );

  if (enemySkill) {
    const result = executeSkill(newState, monster, player, enemySkill, logs);
    player = result.newDefender;
    monster = result.newAttacker;
    logs = result.newLogs;
    newState.skillCooldowns = setSkillCooldown(newState.skillCooldowns, enemySkill);
  }

  newState = { ...newState, player, monster, battleLogs: logs };

  const battleResult = checkBattleResult(player, monster);
  if (battleResult) {
    appendBattleEndLog(newState, logs, battleResult);
    return {
      state: { ...newState, battleLogs: logs, phase: 'finished', result: battleResult },
      finished: true,
    };
  }

  return {
    state: { ...newState, phase: 'round_end' },
    finished: false,
  };
}

export function resolveRoundEnd(state: BattleState, maxTurns = 100): TurnResolveResult {
  if (state.phase !== 'round_end' || state.result) {
    return { state, finished: Boolean(state.result) };
  }

  let newState = { ...state };
  let logs = [...newState.battleLogs];
  let player = { ...newState.player };
  let monster = { ...newState.monster };

  logs.push(
    addLog(newState, {
      type: 'turn_end',
      statusText: '─'.repeat(30),
      color: '#6e7681',
    }),
  );

  const playerResult = processTurnEnd(newState, player, logs);
  player = playerResult.newUnit;
  logs = playerResult.newLogs;

  const monsterResult = processTurnEnd(newState, monster, logs);
  monster = monsterResult.newUnit;
  logs = monsterResult.newLogs;

  const newCooldowns = reduceCooldowns(newState.skillCooldowns);

  const battleResult = checkBattleResult(player, monster);
  if (battleResult) {
    appendBattleEndLog(newState, logs, battleResult);
    return {
      state: {
        ...newState,
        player,
        monster,
        battleLogs: logs,
        skillCooldowns: newCooldowns,
        phase: 'finished',
        result: battleResult,
      },
      finished: true,
    };
  }

  if (newState.currentTurn >= maxTurns) {
    const drawResult = 'draw' as const;
    appendBattleEndLog(newState, logs, drawResult);
    return {
      state: {
        ...newState,
        player,
        monster,
        battleLogs: logs,
        skillCooldowns: newCooldowns,
        phase: 'finished',
        result: drawResult,
      },
      finished: true,
    };
  }

  const newTurn = newState.currentTurn + 1;
  logs.push(
    addLog(newState, {
      type: 'turn_start',
      statusText: `Round ${newTurn} begins`,
      color: '#569cd6',
    }),
  );

  return {
    state: {
      ...newState,
      player,
      monster,
      battleLogs: logs,
      skillCooldowns: newCooldowns,
      currentTurn: newTurn,
      phase: 'player_turn',
    },
    finished: false,
  };
}

export function resolveAutoPlayerTurn(
  state: BattleState,
  skillList: Skill[],
  playerSkillIds: string[],
): TurnResolveResult {
  const skill = pickSkillForUnit(
    state.player,
    state.monster,
    skillList,
    state.skillCooldowns,
    playerSkillIds,
  );
  if (!skill) {
    let logs = [...state.battleLogs];
    logs.push(
      addLog(state, {
        type: 'skill_use',
        actor: state.player.name,
        statusText: `${state.player.name} has no usable skill and skips`,
        color: '#8b949e',
      }),
    );
    return {
      state: { ...state, battleLogs: logs, phase: 'enemy_turn' },
      finished: false,
    };
  }
  return resolvePlayerTurn(state, skill, playerSkillIds);
}
