/**
 * Battle simulator — core resolution (damage, reactions, turn flow).
 */

import {
  BattleUnit,
  BattleConfig,
  BattleState,
  BattleLogEntry,
  Element,
  ElementStrength,
  ELEMENT_CONFIG,
  ELEMENT_STRENGTH_CONFIG,
  REACTION_CONFIG,
  ReactionType,
  Skill,
  MP_CONFIG,
} from '../types';

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const ceil = (num: number): number => Math.ceil(num);

/** Final hit damage rolls between min and max of the computed value (inclusive via ceil). */
export const FINAL_DAMAGE_VARIANCE = { min: 0.9, max: 1.1 } as const;

export function applyFinalDamageVariance(damage: number): number {
  if (!(damage > 0)) return 0;
  const { min, max } = FINAL_DAMAGE_VARIANCE;
  const factor = min + Math.random() * (max - min);
  return ceil(damage * factor);
}

export const calculateDamage = (
  atk: number,
  def: number,
  power: number,
  reactionMultiplier: number = 1,
  extraMultiplier: number = 1
): number => {
  const baseDamage = atk * power;
  const defenseReduction = atk / (atk + def);
  const finalDamage = baseDamage * defenseReduction * reactionMultiplier * extraMultiplier;
  return applyFinalDamageVariance(finalDamage);
};

export const getRandomElement = (): Element => {
  const elements: Element[] = ['fire', 'water', 'thunder', 'grass', 'ice'];
  return elements[Math.floor(Math.random() * elements.length)];
};

/** Attacker element × defender element → reaction (single source of truth with `checkElementReaction`). */
export const ELEMENT_REACTION_PAIR_MAP: Record<Element, Partial<Record<Element, ReactionType>>> = {
  fire: { water: 'vaporize', ice: 'melt', grass: 'burn' },
  water: { fire: 'vaporize', thunder: 'electrify', ice: 'freeze' },
  thunder: { fire: 'overload', water: 'electrify', grass: 'quicken' },
  grass: { fire: 'burn', thunder: 'quicken' },
  ice: { fire: 'melt', water: 'freeze' },
};

export const checkElementReaction = (
  attackElement: Element,
  targetElement: Element | null
): ReactionType | null => {
  if (!targetElement) return null;
  return ELEMENT_REACTION_PAIR_MAP[attackElement]?.[targetElement] || null;
};

export const getElementDuration = (strength: ElementStrength): number => {
  return ELEMENT_STRENGTH_CONFIG[strength].duration;
};

export const createBattleUnit = (
  config: BattleConfig['player'] | BattleConfig['monster'],
  initialElement?: Element
): BattleUnit => {
  const maxMp = Math.max(1, config.mp ?? MP_CONFIG.maxMp);
  const mp = Math.min(maxMp, Math.max(0, config.mp ?? MP_CONFIG.initialMp));
  return {
    id: config.id,
    name: config.name,
    hp: config.hp,
    maxHp: config.hp,
    atk: config.atk,
    def: config.def,
    spd: config.spd,
    mp,
    maxMp,
    type: config.type,
    element: initialElement ? {
      element: initialElement,
      strength: 'weak',
      remainingTurns: 2,
    } : null,
    dot: null,
    buffs: [],
    control: null,
  };
};

export const createInitialBattleState = (config: BattleConfig): BattleState => {
  return {
    phase: 'setup',
    currentTurn: 0,
    player: createBattleUnit(config.player),
    monster: createBattleUnit(config.monster, config.monsterInitialElement),
    selectedSkill: null,
    skillCooldowns: {},
    battleLogs: [],
    result: null,
  };
};

export const addLog = (
  state: BattleState,
  entry: Omit<BattleLogEntry, 'id' | 'turn'>
): BattleLogEntry => {
  const newEntry: BattleLogEntry = {
    ...entry,
    id: generateId(),
    turn: state.currentTurn,
  };
  return newEntry;
};

export const formatElementLog = (
  element: Element,
  strength: ElementStrength,
  remainingTurns: number
): string => {
  const config = ELEMENT_CONFIG[element];
  const strengthConfig = ELEMENT_STRENGTH_CONFIG[strength];
  return `${config.name} · ${strengthConfig.name} (${remainingTurns} turns)`;
};

export const canUseSkill = (
  skill: Skill,
  unit: BattleUnit,
  cooldowns: Record<string, number>
): { canUse: boolean; reason?: string } => {
  const cooldown = cooldowns[skill.id] || 0;
  if (cooldown > 0) {
    return { canUse: false, reason: `On cooldown (${cooldown} turn(s) left)` };
  }
  
  if (skill.mpCost > unit.mp) {
    return { canUse: false, reason: `Not enough MP (need ${skill.mpCost}, have ${unit.mp})` };
  }
  
  return { canUse: true };
};

export const executeSkill = (
  state: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  skill: Skill,
  logs: BattleLogEntry[]
): {
  newAttacker: BattleUnit;
  newDefender: BattleUnit;
  newLogs: BattleLogEntry[];
  triggeredReaction: ReactionType | null;
  totalDamage: number;
} => {
  let newAttacker = { ...attacker };
  let newDefender = { ...defender };
  let newLogs = [...logs];
  let triggeredReaction: ReactionType | null = null;
  let totalDamage = 0;
  
  newAttacker.mp -= skill.mpCost;
  if (skill.mpCost > 0) {
    newLogs.push(addLog(state, {
      type: 'mp_cost',
      actor: attacker.name,
      target: defender.name,
      skillName: skill.name,
      mpChange: -skill.mpCost,
      statusText: `Spent ${skill.mpCost} MP`,
      color: '#c586c0',
    }));
  }
  
  if (skill.specialEffect?.type === 'heal') {
    const healAmount = ceil(attacker.atk * skill.specialEffect.value);
    newAttacker.hp = Math.min(newAttacker.maxHp, newAttacker.hp + healAmount);
    newLogs.push(addLog(state, {
      type: 'heal',
      actor: attacker.name,
      skillName: skill.name,
      healAmount,
      statusText: `Restored ${healAmount} HP`,
      color: '#69db7c',
    }));
  }
  
  if (skill.power > 0) {
    let baseDamage = calculateDamage(attacker.atk, defender.def, skill.power);
    
    const quickenBuff = defender.buffs.find(b => b.type === 'quicken');
    let reactionMultiplier = 1;
    let extraMultiplier = 1;
    
    if (quickenBuff && (skill.attachElement?.element === 'thunder' || skill.attachElement?.element === 'grass')) {
      extraMultiplier = 1 + quickenBuff.value;
    }
    
    const skillElement = skill.attachElement?.element;
    if (skillElement && skillElement !== 'random' && defender.element) {
      const reaction = checkElementReaction(skillElement, defender.element.element);
      if (reaction) {
        triggeredReaction = reaction;
        const reactionConfig = REACTION_CONFIG[reaction];
        
        if (reactionConfig.multiplier) {
          reactionMultiplier = reactionConfig.multiplier;
        }
        
        if (reactionConfig.extraDamage) {
          const extraDamage = ceil(attacker.atk * reactionConfig.extraDamage);
          baseDamage += extraDamage;
        }
      }
    }
    
    totalDamage = calculateDamage(attacker.atk, defender.def, skill.power, reactionMultiplier, extraMultiplier);
    
    newDefender.hp = Math.max(0, defender.hp - totalDamage);
    
    newLogs.push(addLog(state, {
      type: 'damage',
      actor: attacker.name,
      target: defender.name,
      skillName: skill.name,
      damage: totalDamage,
      statusText: `Dealt ${totalDamage} damage`,
      color: '#f44747',
    }));
    
    if (triggeredReaction) {
      const reactionConfig = REACTION_CONFIG[triggeredReaction];
      const defenderElem = defender.element!;
      const skillElemConfig = ELEMENT_CONFIG[skillElement as Element];
      const defElemConfig = ELEMENT_CONFIG[defenderElem.element];
      
      let reactionText = '';
      if (reactionConfig.multiplier) {
        reactionText = `Triggered ${reactionConfig.name}! ${reactionConfig.description}`;
      } else if (reactionConfig.extraDamage) {
        reactionText = `Triggered ${reactionConfig.name}! ${reactionConfig.description}`;
      }
      
      newLogs.push(addLog(state, {
        type: 'element_reaction',
        element: defenderElem.element,
        reaction: triggeredReaction,
        statusText: reactionText,
        color: '#ffd43b',
      }));
    }
  }
  
  if (skill.attachElement) {
    const element = skill.attachElement.element === 'random' 
      ? getRandomElement() 
      : skill.attachElement.element;
    
    newDefender.element = {
      element,
      strength: skill.attachElement.strength,
      remainingTurns: skill.attachElement.duration,
    };
    
    const elemConfig = ELEMENT_CONFIG[element];
    newLogs.push(addLog(state, {
      type: 'element_attach',
      actor: defender.name,
      element,
      statusText: `${defender.name} gains ${formatElementLog(element, skill.attachElement.strength, skill.attachElement.duration)}`,
      color: elemConfig.color,
    }));
  }
  
  if (skill.dot) {
    newDefender.dot = {
      damage: skill.dot.damage,
      remainingTurns: skill.dot.duration,
    };
    newLogs.push(addLog(state, {
      type: 'buff_add',
      actor: defender.name,
      statusText: `${defender.name} suffers Burn: ${ceil(defender.atk * skill.dot.damage)} per turn for ${skill.dot.duration} turn(s)`,
      color: '#ff8787',
    }));
  }
  
  if (skill.crowdControl?.type === 'freeze') {
    newDefender.control = {
      type: 'freeze',
      remainingTurns: skill.crowdControl.duration,
    };
    newLogs.push(addLog(state, {
      type: 'control',
      actor: defender.name,
      statusText: `${defender.name} is Frozen and skips the next turn`,
      color: '#74c0fc',
    }));
  }
  
  if (skill.specialEffect?.type === 'atk_debuff') {
    newDefender.buffs.push({
      type: 'atk_debuff',
      value: skill.specialEffect.value,
      remainingTurns: skill.specialEffect.duration,
    });
    newLogs.push(addLog(state, {
      type: 'buff_add',
      actor: defender.name,
      statusText: `${defender.name} ATK down ${Math.round(skill.specialEffect.value * 100)}% for ${skill.specialEffect.duration} turn(s)`,
      color: '#ff8787',
    }));
  }
  
  if (skill.specialEffect?.type === 'def_debuff') {
    newDefender.buffs.push({
      type: 'def_debuff',
      value: skill.specialEffect.value,
      remainingTurns: skill.specialEffect.duration,
    });
    newLogs.push(addLog(state, {
      type: 'buff_add',
      actor: defender.name,
      statusText: `${defender.name} DEF down ${Math.round(skill.specialEffect.value * 100)}% for ${skill.specialEffect.duration} turn(s)`,
      color: '#ff8787',
    }));
  }
  
  return { newAttacker, newDefender, newLogs, triggeredReaction, totalDamage };
};

export const processTurnStart = (
  state: BattleState,
  unit: BattleUnit,
  logs: BattleLogEntry[]
): { newUnit: BattleUnit; newLogs: BattleLogEntry[] } => {
  let newUnit = { ...unit };
  let newLogs = [...logs];
  
  if (newUnit.control?.type === 'freeze') {
    newLogs.push(addLog(state, {
      type: 'control',
      actor: unit.name,
      statusText: `${unit.name} is frozen and skips the turn`,
      color: '#74c0fc',
    }));
    return { newUnit, newLogs };
  }
  
  return { newUnit, newLogs };
};

export const processTurnEnd = (
  state: BattleState,
  unit: BattleUnit,
  logs: BattleLogEntry[]
): { newUnit: BattleUnit; newLogs: BattleLogEntry[] } => {
  let newUnit = { ...unit, hp: unit.hp };
  let newLogs = [...logs];
  
  if (newUnit.dot) {
    const dotDamage = ceil(unit.atk * newUnit.dot.damage);
    newUnit.hp = Math.max(0, newUnit.hp - dotDamage);
    
    newLogs.push(addLog(state, {
      type: 'dot_damage',
      actor: unit.name,
      dotDamage,
      statusText: `${unit.name} takes Burn damage ${dotDamage}`,
      color: '#ff8787',
    }));
    
    newUnit.dot = {
      ...newUnit.dot,
      remainingTurns: newUnit.dot.remainingTurns - 1,
    };
    
    if (newUnit.dot.remainingTurns <= 0) {
      newLogs.push(addLog(state, {
        type: 'dot_expire',
        actor: unit.name,
        statusText: `${unit.name}'s Burn wears off`,
        color: '#8c8c8c',
      }));
      newUnit.dot = null;
    }
  }
  
  if (newUnit.element) {
    newUnit.element = {
      ...newUnit.element,
      remainingTurns: newUnit.element.remainingTurns - 1,
    };
    
    if (newUnit.element.remainingTurns <= 0) {
      const elemConfig = ELEMENT_CONFIG[newUnit.element.element];
      newLogs.push(addLog(state, {
        type: 'element_attach',
        actor: unit.name,
        statusText: `${unit.name}'s ${elemConfig.name} aura fades`,
        color: '#8c8c8c',
      }));
      newUnit.element = null;
    }
  }
  
  if (newUnit.buffs.length > 0) {
    newUnit.buffs = newUnit.buffs.map(buff => ({
      ...buff,
      remainingTurns: buff.remainingTurns - 1,
    })).filter(buff => {
      if (buff.remainingTurns <= 0) {
        newLogs.push(addLog(state, {
          type: 'buff_expire',
          actor: unit.name,
          statusText: `${unit.name}'s ${buff.type} expires`,
          color: '#8c8c8c',
        }));
        return false;
      }
      return true;
    });
  }
  
  if (newUnit.control) {
    newUnit.control = {
      ...newUnit.control,
      remainingTurns: newUnit.control.remainingTurns - 1,
    };
    
    if (newUnit.control.remainingTurns <= 0) {
      newLogs.push(addLog(state, {
        type: 'control_expire',
        actor: unit.name,
        statusText: `${unit.name}'s Freeze wears off`,
        color: '#8c8c8c',
      }));
      newUnit.control = null;
    }
  }
  
  const mpRecover = MP_CONFIG.mpPerTurn;
  newUnit.mp = Math.min(newUnit.maxMp, newUnit.mp + mpRecover);
  
  newLogs.push(addLog(state, {
    type: 'mp_recover',
    actor: unit.name,
    mpChange: mpRecover,
    statusText: `${unit.name} MP +${mpRecover}`,
    color: '#845ef7',
  }));
  
  return { newUnit, newLogs };
};

export const setSkillCooldown = (
  cooldowns: Record<string, number>,
  skill: Skill
): Record<string, number> => {
  if (skill.maxCooldown > 0) {
    return {
      ...cooldowns,
      [skill.id]: skill.maxCooldown,
    };
  }
  return cooldowns;
};

export const reduceCooldowns = (
  cooldowns: Record<string, number>
): Record<string, number> => {
  const newCooldowns: Record<string, number> = {};
  for (const [skillId, cd] of Object.entries(cooldowns)) {
    if (cd > 0) {
      newCooldowns[skillId] = cd - 1;
    }
  }
  return newCooldowns;
};

export const checkBattleResult = (
  player: BattleUnit,
  monster: BattleUnit
): 'player_win' | 'monster_win' | 'draw' | null => {
  if (player.hp <= 0 && monster.hp <= 0) {
    return 'draw';
  }
  if (player.hp <= 0) {
    return 'monster_win';
  }
  if (monster.hp <= 0) {
    return 'player_win';
  }
  return null;
};
