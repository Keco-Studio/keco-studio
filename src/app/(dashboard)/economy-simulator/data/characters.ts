/**
 * 角色数据 - Characters Data
 * 基于《少年三国志2》配置表
 */

import type { Character, Talent, Skill, CharacterBaseStats, Camp, Rarity } from '../types';

/** 武将列表 */
export const CHARACTERS: Character[] = [
  {
    id: 1001,
    name: '夏侯惇',
    rarity: 3,
    int: 14,
    camp: '魏国',
    baseStats: { atk: 178, life: 2850, def: 78, mdf: 78 },
    talentIds: [2021, 2002, 2023, 2043, 2025, 2032, 2007, 2040, 2029, 2047, 2020, 2036],
    skillIds: [4001, 4002],
  },
  {
    id: 1002,
    name: '乐进',
    rarity: 2,
    int: 10,
    camp: '魏国',
    baseStats: { atk: 96, life: 1200, def: 48, mdf: 48 },
    talentIds: [2011, 2022, 2003, 2014, 2025, 2016, 2033, 2008],
    skillIds: [4003, 4004],
  },
  {
    id: 1003,
    name: '曹丕',
    rarity: 2,
    int: 10,
    camp: '魏国',
    baseStats: { atk: 80, life: 1000, def: 40, mdf: 40 },
    talentIds: [2001, 2022, 2013, 2024, 2005, 2016, 2033, 2008],
    skillIds: [4005, 4006],
  },
  {
    id: 1004,
    name: '于禁',
    rarity: 2,
    int: 10,
    camp: '魏国',
    baseStats: { atk: 107, life: 1067, def: 47, mdf: 47 },
    talentIds: [2001, 2022, 2023, 2004, 2015, 2026, 2033, 2028],
    skillIds: [4007, 4008],
  },
  {
    id: 1005,
    name: '庞德',
    rarity: 2,
    int: 10,
    camp: '魏国',
    baseStats: { atk: 80, life: 1000, def: 40, mdf: 40 },
    talentIds: [2021, 2012, 2023, 2004, 2025, 2016, 2033, 2008],
    skillIds: [4009, 4010],
  },
  {
    id: 1006,
    name: '赵云',
    rarity: 3,
    int: 14,
    camp: '蜀国',
    baseStats: { atk: 175, life: 2983, def: 77, mdf: 77 },
    talentIds: [2021, 2002, 2023, 2043, 2015, 2032, 2027, 2040, 2029, 2047, 2010, 2042],
    skillIds: [4011, 4012],
  },
  {
    id: 1007,
    name: '魏延',
    rarity: 3,
    int: 14,
    camp: '蜀国',
    baseStats: { atk: 180, life: 2736, def: 79, mdf: 79 },
    talentIds: [2021, 2022, 2013, 2031, 2015, 2044, 2007, 2034, 2029, 2041, 2010, 2048],
    skillIds: [4013, 4014],
  },
  {
    id: 1008,
    name: '法正',
    rarity: 2,
    int: 10,
    camp: '蜀国',
    baseStats: { atk: 80, life: 1000, def: 40, mdf: 40 },
    talentIds: [2001, 2022, 2003, 2024, 2015, 2026, 2033, 2028],
    skillIds: [4015, 4016],
  },
  {
    id: 1009,
    name: '祝融',
    rarity: 1,
    int: 8,
    camp: '蜀国',
    baseStats: { atk: 50, life: 500, def: 25, mdf: 25 },
    talentIds: [2021, 2022, 2023, 2004, 2015, 2026, 2033, 2028],
    skillIds: [4017, 4018],
  },
  {
    id: 1010,
    name: '孟获',
    rarity: 1,
    int: 8,
    camp: '蜀国',
    baseStats: { atk: 43, life: 605, def: 25, mdf: 25 },
    talentIds: [2011, 2002, 2003, 2024, 2015, 2026, 2033, 2008],
    skillIds: [4019, 4020],
  },
];

/** 天赋列表 */
export const TALENTS: Talent[] = [
  { id: 2001, name: '生命1', level: 1, effect: 'energy_general+1，characters_life+3800' },
  { id: 2002, name: '生命2', level: 2, effect: 'characters_life+14000' },
  { id: 2003, name: '生命3', level: 3, effect: 'energy_general+1，characters_life+82000' },
  { id: 2004, name: '生命4', level: 4, effect: 'characters_life+大幅提升' },
  { id: 2005, name: '生命5', level: 5, effect: 'characters_life+33000' },
  { id: 2006, name: '生命6', level: 6, effect: 'characters_life+1170000' },
  { id: 2007, name: '生命7', level: 7, effect: 'characters_life+2540000' },
  { id: 2008, name: '生命8', level: 8, effect: 'characters_life+大幅提升' },
  { id: 2009, name: '生命9', level: 9, effect: 'characters_life+4980000' },
  { id: 2010, name: '生命11', level: 11, effect: 'characters_life+7920000' },
  { id: 2011, name: '防御1', level: 1, effect: 'energy_general+1，characters_def+小幅提升' },
  { id: 2012, name: '防御2', level: 2, effect: 'characters_def+小幅提升' },
  { id: 2013, name: '防御3', level: 3, effect: 'energy_general+1，characters_def+2500' },
  { id: 2014, name: '防御4', level: 4, effect: 'characters_def+小幅提升' },
  { id: 2015, name: '防御5', level: 5, effect: 'characters_def+19000' },
  { id: 2016, name: '防御6', level: 6, effect: 'characters_def+大幅提升' },
  { id: 2017, name: '防御7', level: 7, effect: 'characters_def+大幅提升' },
  { id: 2018, name: '防御8', level: 8, effect: 'characters_def+大幅提升' },
  { id: 2019, name: '防御9', level: 9, effect: 'characters_def+大幅提升' },
  { id: 2020, name: '防御11', level: 11, effect: 'characters_def+大幅提升' },
  { id: 2021, name: '攻击1', level: 1, effect: 'energy_general+1，characters_atk+240' },
  { id: 2022, name: '攻击2', level: 2, effect: 'characters_atk+640' },
  { id: 2023, name: '攻击3', level: 3, effect: 'energy_general+1，characters_atk+5100' },
  { id: 2024, name: '攻击4', level: 4, effect: 'characters_atk+18000' },
  { id: 2025, name: '攻击5', level: 5, effect: 'characters_atk+33000' },
  { id: 2026, name: '攻击6', level: 6, effect: 'characters_atk+大幅提升' },
  { id: 2027, name: '攻击7', level: 7, effect: 'characters_atk+134000' },
  { id: 2028, name: '攻击8', level: 8, effect: 'characters_atk+164000' },
  { id: 2029, name: '攻击9', level: 9, effect: 'characters_atk+262000' },
  { id: 2030, name: '攻击11', level: 11, effect: 'characters_atk+大幅提升' },
  { id: 2031, name: '阵营生命4', level: 4, effect: 'characters_camp_life+132000' },
  { id: 2032, name: '阵营生命6', level: 6, effect: 'characters_camp_life+461000' },
  { id: 2033, name: '阵营生命7', level: 7, effect: 'characters_camp_life+大幅提升' },
  { id: 2034, name: '阵营生命8', level: 8, effect: 'characters_camp_life+1220000' },
  { id: 2035, name: '阵营生命10', level: 10, effect: 'characters_camp_life+大幅提升' },
  { id: 2036, name: '阵营生命12', level: 12, effect: 'characters_camp_life+大幅提升' },
  { id: 2037, name: '阵营防御4', level: 4, effect: 'characters_camp_def+小幅提升' },
  { id: 2038, name: '阵营防御6', level: 6, effect: 'characters_camp_def+小幅提升' },
  { id: 2039, name: '阵营防御7', level: 7, effect: 'characters_camp_def+小幅提升' },
  { id: 2040, name: '阵营防御8', level: 8, effect: 'characters_camp_def+32000' },
  { id: 2041, name: '阵营防御10', level: 10, effect: 'characters_camp_def+57000' },
  { id: 2042, name: '阵营防御12', level: 12, effect: 'characters_camp_def+81000' },
  { id: 2043, name: '阵营攻击4', level: 4, effect: 'characters_camp_atk+7000' },
  { id: 2044, name: '阵营攻击6', level: 6, effect: 'characters_camp_atk+大幅提升' },
  { id: 2045, name: '阵营攻击7', level: 7, effect: 'characters_camp_atk+38000' },
  { id: 2046, name: '阵营攻击8', level: 8, effect: 'characters_camp_atk+大幅提升' },
  { id: 2047, name: '阵营攻击10', level: 10, effect: 'characters_camp_atk+114000' },
  { id: 2048, name: '阵营攻击12', level: 12, effect: 'characters_camp_atk+162000' },
];

/** 技能列表 */
export const SKILLS: Skill[] = [
  { id: 4001, name: '刚烈', type: '普攻', description: '对敌方一列造成92%的物理伤害' },
  { id: 4002, name: '拔矢怒斩', type: '怒气', description: '对敌方一列造成246%的物理伤害，25%概率使目标进入眩晕状态，持续1回合；释放时如果目标生命高于50%则额外造成140%伤害' },
  { id: 4003, name: '胆烈', type: '普攻', description: '对敌方单位造成100%物理伤害' },
  { id: 4004, name: '无坚不摧', type: '怒气', description: '对敌方一列造成192%的物理伤害，自身抗暴率增加15%，持续2回合' },
  { id: 4005, name: '颂威', type: '普攻', description: '对敌方单体造成100%的法术伤害' },
  { id: 4006, name: '雄才伟略', type: '怒气', description: '对敌方随机3个单位造成133%的法术伤害，30%概率减少目标1怒气' },
  { id: 4007, name: '夺命', type: '普攻', description: '对敌方后排单体造成100%物理伤害' },
  { id: 4008, name: '飞火流星', type: '怒气', description: '对敌方后排单体造成262%的物理伤害，60%概率使目标攻击力减少15%,持续2回合' },
  { id: 4009, name: '冲锋', type: '普攻', description: '对敌方单体造成100%物理伤害' },
  { id: 4010, name: '背水一战', type: '怒气', description: '对敌方前排造成133%物理伤害，本次攻击有10%概率额外暴击率' },
  { id: 4011, name: '龙胆枪', type: '普攻', description: '对敌方一列造成92%的物理伤害' },
  { id: 4012, name: '七探盘蛇', type: '怒气', description: '对敌方一列造成246%的物理伤害，40%概率增加自身4点怒气；同时自身伤害加成增加15%，持续2回合' },
  { id: 4013, name: '狂骨', type: '普攻', description: '对敌方前排造成64%的物理伤害' },
  { id: 4014, name: '嗜血鬼影', type: '怒气', description: '对敌方前排造成171%的物理伤害，20%概率使目标进入眩晕状态，持续1回合；同时使目标治疗增益减少15%，持续2回合；本次共计有20%额外命中率' },
  { id: 4015, name: '奇袭', type: '普攻', description: '对敌方单体造成100%的法术伤害' },
  { id: 4016, name: '因果循环', type: '怒气', description: '对敌方随机2个单位造成193%的法术伤害，40%概率回复自身2点怒气' },
  { id: 4017, name: '烈刃', type: '普攻', description: '对敌方后排单体造成80%的物理伤害' },
  { id: 4018, name: '白虎飞射', type: '怒气', description: '对敌方后排造成107%的物理伤害，并对目标中生命值百分比最少的单位造成额外50%物理伤害' },
  { id: 4019, name: '冲撞', type: '普攻', description: '对敌方单体造成80%的物理伤害' },
  { id: 4020, name: '南中霸王', type: '怒气', description: '对目标及其相邻的单位造成99%的物理伤害，自身伤害减免增加15%，持续2回合' },
];

/**
 * 根据ID获取武将
 */
export function getCharacterById(id: number): Character | undefined {
  return CHARACTERS.find(c => c.id === id);
}

/**
 * 根据阵营获取武将
 */
export function getCharactersByCamp(camp: Camp): Character[] {
  return CHARACTERS.filter(c => c.camp === camp);
}

/**
 * 根据稀有度获取武将
 */
export function getCharactersByRarity(rarity: Rarity): Character[] {
  return CHARACTERS.filter(c => c.rarity === rarity);
}

/**
 * 根据天赋ID获取天赋
 */
export function getTalentById(id: number): Talent | undefined {
  return TALENTS.find(t => t.id === id);
}

/**
 * 根据技能ID获取技能
 */
export function getSkillById(id: number): Skill | undefined {
  return SKILLS.find(s => s.id === id);
}

/**
 * 计算武将总属性（含天赋加成）
 */
export function calculateCharacterStats(character: Character, talentLevel: number): CharacterBaseStats {
  const stats = { ...character.baseStats };
  
  // 累加已开启的天赋效果
  for (const talentId of character.talentIds) {
    const talent = getTalentById(talentId);
    if (talent && talent.level <= talentLevel) {
      // 解析天赋效果并应用到属性
      // 这里简化处理，实际需要解析 effect 字符串
      if (talent.effect.includes('characters_atk')) {
        const match = talent.effect.match(/characters_atk\+(\d+)/);
        if (match) stats.atk += parseInt(match[1]);
      }
      if (talent.effect.includes('characters_life')) {
        const match = talent.effect.match(/characters_life\+(\d+)/);
        if (match) stats.life += parseInt(match[1]);
      }
      if (talent.effect.includes('characters_def')) {
        const match = talent.effect.match(/characters_def\+(\d+)/);
        if (match) stats.def += parseInt(match[1]);
      }
      if (talent.effect.includes('characters_mdf')) {
        const match = talent.effect.match(/characters_mdf\+(\d+)/);
        if (match) stats.mdf += parseInt(match[1]);
      }
    }
  }
  
  return stats;
}

/** 阵营列表 */
export const CAMPS: Camp[] = ['魏国', '蜀国', '吴国', '群雄'];

/** 稀有度列表 */
export const RARITIES: Rarity[] = [1, 2, 3];
