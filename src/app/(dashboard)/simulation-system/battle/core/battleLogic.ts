/**
 * Battle Simulator - Core Battle Logic
 * 战斗系统核心逻辑
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
  SkillId,
} from '../types';
import { SKILLS } from '../data/skills';

// ==================== 工具函数 ====================

/** 生成唯一 ID */
export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

/** 向上取整 */
export const ceil = (num: number): number => Math.ceil(num);

/** 计算伤害 */
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
  return ceil(finalDamage);
};

/** 随机获取元素 */
export const getRandomElement = (): Element => {
  const elements: Element[] = ['fire', 'water', 'thunder', 'grass', 'ice'];
  return elements[Math.floor(Math.random() * elements.length)];
};

/** 检查元素反应 */
export const checkElementReaction = (
  attackElement: Element,
  targetElement: Element | null
): ReactionType | null => {
  if (!targetElement) return null;
  
  const reactionMap: Record<string, Record<string, ReactionType>> = {
    fire: { water: 'vaporize', ice: 'melt', grass: 'burn' },
    water: { fire: 'vaporize', thunder: 'electrify', ice: 'freeze' },
    thunder: { fire: 'overload', water: 'electrify', grass: 'quicken' },
    grass: { fire: 'burn', thunder: 'quicken' },
    ice: { fire: 'melt', water: 'freeze' },
  };
  
  return reactionMap[attackElement]?.[targetElement] || null;
};

/** 获取元素强度持续回合 */
export const getElementDuration = (strength: ElementStrength): number => {
  return ELEMENT_STRENGTH_CONFIG[strength].duration;
};

// ==================== 战斗单位管理 ====================

/** 创建战斗单位 */
export const createBattleUnit = (
  config: BattleConfig['player'] | BattleConfig['monster'],
  initialElement?: Element
): BattleUnit => {
  return {
    id: config.id,
    name: config.name,
    hp: config.hp,
    maxHp: config.hp,
    atk: config.atk,
    def: config.def,
    spd: config.spd,
    mp: MP_CONFIG.initialMp,
    maxMp: MP_CONFIG.maxMp,
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

/** 创建初始战斗状态 */
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

// ==================== 战斗日志 ====================

/** 添加战斗日志 */
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

/** 格式化元素日志 */
export const formatElementLog = (
  element: Element,
  strength: ElementStrength,
  remainingTurns: number
): string => {
  const config = ELEMENT_CONFIG[element];
  const strengthConfig = ELEMENT_STRENGTH_CONFIG[strength];
  return `${config.emoji}${config.name}·${strengthConfig.name}(${remainingTurns})`;
};

// ==================== 技能执行 ====================

/** 检查技能是否可用 */
export const canUseSkill = (
  skill: Skill,
  unit: BattleUnit,
  cooldowns: Record<string, number>
): { canUse: boolean; reason?: string } => {
  // 检查冷却
  const cooldown = cooldowns[skill.id] || 0;
  if (cooldown > 0) {
    return { canUse: false, reason: `冷却中，剩余 ${cooldown} 回合` };
  }
  
  // 检查 MP
  if (skill.mpCost > unit.mp) {
    return { canUse: false, reason: `MP 不足（需要 ${skill.mpCost}，当前 ${unit.mp}）` };
  }
  
  return { canUse: true };
};

/** 执行技能 */
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
  
  // 1. 扣除 MP
  newAttacker.mp -= skill.mpCost;
  if (skill.mpCost > 0) {
    newLogs.push(addLog(state, {
      type: 'mp_cost',
      actor: attacker.name,
      target: defender.name,
      skillName: skill.name,
      mpChange: -skill.mpCost,
      statusText: `消耗 ${skill.mpCost} MP`,
      color: '#c586c0',
    }));
  }
  
  // 2. 处理治疗技能
  if (skill.specialEffect?.type === 'heal') {
    const healAmount = ceil(attacker.atk * skill.specialEffect.value);
    newAttacker.hp = Math.min(newAttacker.maxHp, newAttacker.hp + healAmount);
    newLogs.push(addLog(state, {
      type: 'heal',
      actor: attacker.name,
      skillName: skill.name,
      healAmount,
      statusText: `恢复 ${healAmount} HP`,
      color: '#69db7c',
    }));
  }
  
  // 3. 计算伤害
  if (skill.power > 0) {
    let baseDamage = calculateDamage(attacker.atk, defender.def, skill.power);
    
    // 检查激化 Buff
    const quickenBuff = defender.buffs.find(b => b.type === 'quicken');
    let reactionMultiplier = 1;
    let extraMultiplier = 1;
    
    if (quickenBuff && (skill.attachElement?.element === 'thunder' || skill.attachElement?.element === 'grass')) {
      extraMultiplier = 1 + quickenBuff.value;
    }
    
    // 计算元素反应
    const skillElement = skill.attachElement?.element;
    if (skillElement && skillElement !== 'random' && defender.element) {
      const reaction = checkElementReaction(skillElement, defender.element.element);
      if (reaction) {
        triggeredReaction = reaction;
        const reactionConfig = REACTION_CONFIG[reaction];
        
        if (reactionConfig.multiplier) {
          reactionMultiplier = reactionConfig.multiplier;
        }
        
        // 额外伤害（剧变反应）
        if (reactionConfig.extraDamage) {
          const extraDamage = ceil(attacker.atk * reactionConfig.extraDamage);
          baseDamage += extraDamage;
        }
      }
    }
    
    totalDamage = calculateDamage(attacker.atk, defender.def, skill.power, reactionMultiplier, extraMultiplier);
    
    // 应用伤害
    newDefender.hp = Math.max(0, defender.hp - totalDamage);
    
    // 记录伤害日志
    newLogs.push(addLog(state, {
      type: 'damage',
      actor: attacker.name,
      target: defender.name,
      skillName: skill.name,
      damage: totalDamage,
      statusText: `造成 ${totalDamage} 伤害`,
      color: '#f44747',
    }));
    
    // 元素反应日志
    if (triggeredReaction) {
      const reactionConfig = REACTION_CONFIG[triggeredReaction];
      const defenderElem = defender.element!;
      const skillElemConfig = ELEMENT_CONFIG[skillElement as Element];
      const defElemConfig = ELEMENT_CONFIG[defenderElem.element];
      
      let reactionText = '';
      if (reactionConfig.multiplier) {
        reactionText = `触发「${reactionConfig.emoji}${reactionConfig.name}」！ ${reactionConfig.description}`;
      } else if (reactionConfig.extraDamage) {
        reactionText = `触发「${reactionConfig.emoji}${reactionConfig.name}」！ ${reactionConfig.description}`;
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
  
  // 4. 附加元素
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
      statusText: `${defender.name} 获得「${formatElementLog(element, skill.attachElement.strength, skill.attachElement.duration)}」`,
      color: elemConfig.color,
    }));
  }
  
  // 5. 附加 DOT
  if (skill.dot) {
    newDefender.dot = {
      damage: skill.dot.damage,
      remainingTurns: skill.dot.duration,
    };
    newLogs.push(addLog(state, {
      type: 'buff_add',
      actor: defender.name,
      statusText: `${defender.name} 获得「灼烧」每回合 ${ceil(defender.atk * skill.dot.damage)} 伤害（${skill.dot.duration}回合）`,
      color: '#ff8787',
    }));
  }
  
  // 6. 附加控制效果
  if (skill.crowdControl?.type === 'freeze') {
    newDefender.control = {
      type: 'freeze',
      remainingTurns: skill.crowdControl.duration,
    };
    newLogs.push(addLog(state, {
      type: 'control',
      actor: defender.name,
      statusText: `${defender.name} 被「❄️冻结」，跳过下回合`,
      color: '#74c0fc',
    }));
  }
  
  // 7. 附加 Debuff
  if (skill.specialEffect?.type === 'atk_debuff') {
    newDefender.buffs.push({
      type: 'atk_debuff',
      value: skill.specialEffect.value,
      remainingTurns: skill.specialEffect.duration,
    });
    newLogs.push(addLog(state, {
      type: 'buff_add',
      actor: defender.name,
      statusText: `${defender.name} ATK 降低 ${Math.round(skill.specialEffect.value * 100)}%（${skill.specialEffect.duration}回合）`,
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
      statusText: `${defender.name} DEF 降低 ${Math.round(skill.specialEffect.value * 100)}%（${skill.specialEffect.duration}回合）`,
      color: '#ff8787',
    }));
  }
  
  return { newAttacker, newDefender, newLogs, triggeredReaction, totalDamage };
};

// ==================== 回合结算 ====================

/** 回合开始处理 */
export const processTurnStart = (
  state: BattleState,
  unit: BattleUnit,
  logs: BattleLogEntry[]
): { newUnit: BattleUnit; newLogs: BattleLogEntry[] } => {
  let newUnit = { ...unit };
  let newLogs = [...logs];
  
  // 检查冻结控制
  if (newUnit.control?.type === 'freeze') {
    newLogs.push(addLog(state, {
      type: 'control',
      actor: unit.name,
      statusText: `${unit.name} 被冻结，跳过回合`,
      color: '#74c0fc',
    }));
    return { newUnit, newLogs };
  }
  
  return { newUnit, newLogs };
};

/** 回合结束处理 */
export const processTurnEnd = (
  state: BattleState,
  unit: BattleUnit,
  logs: BattleLogEntry[]
): { newUnit: BattleUnit; newLogs: BattleLogEntry[] } => {
  let newUnit = { ...unit, hp: unit.hp };
  let newLogs = [...logs];
  
  // 1. 结算 DOT 伤害
  if (newUnit.dot) {
    const dotDamage = ceil(unit.atk * newUnit.dot.damage);
    newUnit.hp = Math.max(0, newUnit.hp - dotDamage);
    
    newLogs.push(addLog(state, {
      type: 'dot_damage',
      actor: unit.name,
      dotDamage,
      statusText: `${unit.name} 受到灼烧伤害 ${dotDamage}`,
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
        statusText: `${unit.name} 的灼烧效果消失`,
        color: '#8c8c8c',
      }));
      newUnit.dot = null;
    }
  }
  
  // 2. 元素衰减
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
        statusText: `${unit.name} 的「${elemConfig.emoji}${elemConfig.name}」元素消失`,
        color: '#8c8c8c',
      }));
      newUnit.element = null;
    }
  }
  
  // 3. Buff 衰减
  if (newUnit.buffs.length > 0) {
    newUnit.buffs = newUnit.buffs.map(buff => ({
      ...buff,
      remainingTurns: buff.remainingTurns - 1,
    })).filter(buff => {
      if (buff.remainingTurns <= 0) {
        newLogs.push(addLog(state, {
          type: 'buff_expire',
          actor: unit.name,
          statusText: `${unit.name} 的 ${buff.type} 效果消失`,
          color: '#8c8c8c',
        }));
        return false;
      }
      return true;
    });
  }
  
  // 4. 控制状态衰减
  if (newUnit.control) {
    newUnit.control = {
      ...newUnit.control,
      remainingTurns: newUnit.control.remainingTurns - 1,
    };
    
    if (newUnit.control.remainingTurns <= 0) {
      newLogs.push(addLog(state, {
        type: 'control_expire',
        actor: unit.name,
        statusText: `${unit.name} 的冻结效果消失`,
        color: '#8c8c8c',
      }));
      newUnit.control = null;
    }
  }
  
  // 5. MP 恢复
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

// ==================== 技能冷却管理 ====================

/** 使用技能后设置冷却 */
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

/** 回合结束减少冷却 */
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

// ==================== 战斗胜负判断 ====================

/** 判断战斗结果 */
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
