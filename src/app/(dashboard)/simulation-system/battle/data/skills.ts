/**
 * Battle Simulator - Skills Data
 * 战斗系统技能数据（30个确定性技能）
 */

import { Skill, SkillId, ELEMENT_CONFIG } from '../types';

// 技能数据
export const SKILLS: Record<SkillId, Skill> = {
  // ==================== 普攻（3个）====================
  [SkillId.PUGONG_MENGJI]: {
    id: SkillId.PUGONG_MENGJI,
    name: '猛击',
    type: 'attack',
    power: 1.0,
    mpCost: 0,
    cooldown: 0,
    maxCooldown: 0,
    description: '普通攻击，无附加效果',
  },
  [SkillId.PUGONG_YUANSU_CHUOCI]: {
    id: SkillId.PUGONG_YUANSU_CHUOCI,
    name: '元素戳刺',
    type: 'attack',
    power: 1.0,
    mpCost: 0,
    cooldown: 0,
    maxCooldown: 0,
    attachElement: {
      element: 'random',
      strength: 'weak',
      duration: 2,
    },
    description: '普通攻击，随机附加弱元素（2回合）',
  },
  [SkillId.PUGONG_XUHOU_ZAN]: {
    id: SkillId.PUGONG_XUHOU_ZAN,
    name: '蓄力斩',
    type: 'attack',
    power: 1.0,
    mpCost: 0,
    cooldown: 0,
    maxCooldown: 0,
    attachElement: {
      element: 'fire',
      strength: 'weak',
      duration: 2,
    },
    description: '火属性普通攻击，附加弱火元素（2回合）',
  },

  // ==================== 火系（6个）====================
  [SkillId.HUO_XIAOHUODAN]: {
    id: SkillId.HUO_XIAOHUODAN,
    name: '小火弹',
    type: 'attack',
    power: 1.2,
    mpCost: 13,
    cooldown: 0,
    maxCooldown: 2,
    attachElement: {
      element: 'fire',
      strength: 'weak',
      duration: 2,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'vaporize' },
    ],
    description: '附加弱火（2回合）；目标有水→蒸发',
  },
  [SkillId.HUO_HUOYAN_ZHAN]: {
    id: SkillId.HUO_HUOYAN_ZHAN,
    name: '火焰斩',
    type: 'attack',
    power: 1.4,
    mpCost: 16,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'fire',
      strength: 'medium',
      duration: 3,
    },
    reactionTrigger: [
      { element: 'ice', reaction: 'melt' },
    ],
    description: '附加中火（3回合）；目标有冰→融化',
  },
  [SkillId.HUO_RANHUO_CHONGJI]: {
    id: SkillId.HUO_RANHUO_CHONGJI,
    name: '燃火冲击',
    type: 'attack',
    power: 1.5,
    mpCost: 22,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'fire',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'thunder', reaction: 'overload' },
    ],
    description: '附加强火（4回合）；目标有雷→超载',
  },
  [SkillId.HUO_LIAOYUAN_HUO]: {
    id: SkillId.HUO_LIAOYUAN_HUO,
    name: '燎原火',
    type: 'attack',
    power: 1.3,
    mpCost: 16,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'fire',
      strength: 'medium',
      duration: 3,
    },
    dot: {
      damage: 0.3,
      duration: 2,
    },
    reactionTrigger: [
      { element: 'grass', reaction: 'burn' },
    ],
    description: '附加中火（3回合）；目标有草→燃烧',
  },
  [SkillId.HUO_YANBAO]: {
    id: SkillId.HUO_YANBAO,
    name: '炎爆',
    type: 'attack',
    power: 2.0,
    mpCost: 30,
    cooldown: 0,
    maxCooldown: 5,
    attachElement: {
      element: 'fire',
      strength: 'strong',
      duration: 4,
    },
    dot: {
      damage: 0.3,
      duration: 2,
    },
    description: '附加强火（4回合）；附带灼烧 DOT',
  },
  [SkillId.HUO_JINMIE_JI]: {
    id: SkillId.HUO_JINMIE_JI,
    name: '烬灭击',
    type: 'attack',
    power: 2.2,
    mpCost: 35,
    cooldown: 0,
    maxCooldown: 6,
    attachElement: {
      element: 'fire',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'vaporize' },
      { element: 'ice', reaction: 'melt' },
    ],
    description: '附加强火（4回合）；目标有水/冰→蒸发/融化',
  },

  // ==================== 水系（6个）====================
  [SkillId.SHUI_SHUIDAN]: {
    id: SkillId.SHUI_SHUIDAN,
    name: '水弹',
    type: 'attack',
    power: 1.1,
    mpCost: 12,
    cooldown: 0,
    maxCooldown: 2,
    attachElement: {
      element: 'water',
      strength: 'weak',
      duration: 2,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'vaporize' },
    ],
    description: '附加弱水（2回合）；目标有火→蒸发',
  },
  [SkillId.SHUI_LANGYONG]: {
    id: SkillId.SHUI_LANGYONG,
    name: '浪涌',
    type: 'attack',
    power: 1.3,
    mpCost: 18,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'water',
      strength: 'medium',
      duration: 3,
    },
    reactionTrigger: [
      { element: 'thunder', reaction: 'electrify' },
    ],
    description: '附加中水（3回合）；目标有雷→感电',
  },
  [SkillId.SHUI_BINGDONG_SHUIJIAN]: {
    id: SkillId.SHUI_BINGDONG_SHUIJIAN,
    name: '冰冻水箭',
    type: 'attack',
    power: 1.2,  // 伤害降低作为冻结代价
    mpCost: 19,
    cooldown: 0,
    maxCooldown: 4,
    attachElement: {
      element: 'water',
      strength: 'medium',
      duration: 3,
    },
    crowdControl: {
      type: 'freeze',
      duration: 1,
    },
    reactionTrigger: [
      { element: 'ice', reaction: 'freeze' },
    ],
    description: '附加中水（3回合）；附带冻结（目标跳过下回合）',
  },
  [SkillId.SHUI_HONGLIU]: {
    id: SkillId.SHUI_HONGLIU,
    name: '洪流',
    type: 'attack',
    power: 1.6,
    mpCost: 22,
    cooldown: 0,
    maxCooldown: 4,
    attachElement: {
      element: 'water',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'vaporize' },
    ],
    description: '附加强水（4回合）；目标有火→蒸发',
  },
  [SkillId.SHUI_SHUISHI_BO]: {
    id: SkillId.SHUI_SHUISHI_BO,
    name: '水蚀波',
    type: 'attack',
    power: 1.5,
    mpCost: 24,
    cooldown: 0,
    maxCooldown: 5,
    attachElement: {
      element: 'water',
      strength: 'strong',
      duration: 4,
    },
    specialEffect: {
      type: 'def_debuff',
      value: 0.1,  // 降低 10% 防御
      duration: 2,
    },
    description: '附加强水（4回合）；降低目标防御 10%（2回合）',
  },
  [SkillId.SHUI_CANGLAN_PO]: {
    id: SkillId.SHUI_CANGLAN_PO,
    name: '沧澜破',
    type: 'attack',
    power: 2.0,
    mpCost: 35,
    cooldown: 0,
    maxCooldown: 6,
    attachElement: {
      element: 'water',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'thunder', reaction: 'electrify' },
      { element: 'ice', reaction: 'freeze' },
    ],
    description: '附加强水（4回合）；目标有雷/冰→感电/冻结',
  },

  // ==================== 雷系（6个）====================
  [SkillId.LEI_LEIHU]: {
    id: SkillId.LEI_LEIHU,
    name: '雷弧',
    type: 'attack',
    power: 1.2,
    mpCost: 13,
    cooldown: 0,
    maxCooldown: 2,
    attachElement: {
      element: 'thunder',
      strength: 'weak',
      duration: 2,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'electrify' },
    ],
    description: '附加弱雷（2回合）；目标有水→感电',
  },
  [SkillId.LEI_JINGLEI_SHAN]: {
    id: SkillId.LEI_JINGLEI_SHAN,
    name: '惊雷闪',
    type: 'attack',
    power: 1.4,
    mpCost: 18,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'thunder',
      strength: 'medium',
      duration: 3,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'overload' },
    ],
    description: '附加中雷（3回合）；目标有火→超载',
  },
  [SkillId.LEI_LEITENG_JI]: {
    id: SkillId.LEI_LEITENG_JI,
    name: '雷藤击',
    type: 'attack',
    power: 1.5,
    mpCost: 20,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'thunder',
      strength: 'medium',
      duration: 3,
    },
    reactionTrigger: [
      { element: 'grass', reaction: 'quicken' },
    ],
    description: '附加中雷（3回合）；目标有草→激化',
  },
  [SkillId.LEI_KUANGLEI]: {
    id: SkillId.LEI_KUANGLEI,
    name: '狂雷',
    type: 'attack',
    power: 1.7,
    mpCost: 26,
    cooldown: 0,
    maxCooldown: 4,
    attachElement: {
      element: 'thunder',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'electrify' },
    ],
    description: '附加强雷（4回合）；目标有水→感电',
  },
  [SkillId.LEI_LEIJI]: {
    id: SkillId.LEI_LEIJI,
    name: '雷殛',
    type: 'attack',
    power: 1.8,
    mpCost: 28,
    cooldown: 0,
    maxCooldown: 5,
    attachElement: {
      element: 'thunder',
      strength: 'strong',
      duration: 4,
    },
    specialEffect: {
      type: 'atk_debuff',
      value: 0.15,  // 降低 15% 攻击
      duration: 2,
    },
    description: '附加强雷（4回合）；降低目标攻击 15%（2回合）',
  },
  [SkillId.LEI_TIANFA_LEI]: {
    id: SkillId.LEI_TIANFA_LEI,
    name: '天罚雷',
    type: 'attack',
    power: 2.2,
    mpCost: 38,
    cooldown: 0,
    maxCooldown: 6,
    attachElement: {
      element: 'thunder',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'overload' },
      { element: 'grass', reaction: 'quicken' },
    ],
    description: '附加强雷（4回合）；目标有火/草→超载/激化',
  },

  // ==================== 草系（6个）====================
  [SkillId.CAO_TENGBIAN]: {
    id: SkillId.CAO_TENGBIAN,
    name: '藤鞭',
    type: 'attack',
    power: 1.1,
    mpCost: 10,
    cooldown: 0,
    maxCooldown: 2,
    attachElement: {
      element: 'grass',
      strength: 'weak',
      duration: 2,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'burn' },
    ],
    description: '附加弱草（2回合）；目标有火→燃烧',
  },
  [SkillId.CAO_JINGJI_TU]: {
    id: SkillId.CAO_JINGJI_TU,
    name: '荆棘突',
    type: 'attack',
    power: 1.3,
    mpCost: 17,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'grass',
      strength: 'medium',
      duration: 3,
    },
    reactionTrigger: [
      { element: 'thunder', reaction: 'quicken' },
    ],
    description: '附加中草（3回合）；目标有雷→激化',
  },
  [SkillId.CAO_MANSHENG]: {
    id: SkillId.CAO_MANSHENG,
    name: '蔓生',
    type: 'attack',
    power: 0.8,  // 治疗为主，伤害降低
    mpCost: 12,
    cooldown: 0,
    maxCooldown: 3,
    attachElement: {
      element: 'grass',
      strength: 'medium',
      duration: 3,
    },
    specialEffect: {
      type: 'heal',
      value: 0.3,  // 恢复 0.3×ATK 生命
      duration: 0,
    },
    description: '附加中草（3回合）；恢复自身 0.3×ATK 生命',
  },
  [SkillId.CAO_RONGKU_SHU]: {
    id: SkillId.CAO_RONGKU_SHU,
    name: '荣枯术',
    type: 'attack',
    power: 1.5,
    mpCost: 23,
    cooldown: 0,
    maxCooldown: 4,
    attachElement: {
      element: 'grass',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'burn' },
    ],
    description: '附加强草（4回合）；目标有火→燃烧',
  },
  [SkillId.CAO_LINGCAO_YU]: {
    id: SkillId.CAO_LINGCAO_YU,
    name: '灵草愈',
    type: 'attack',
    power: 0.6,  // 强力治疗，伤害大幅降低
    mpCost: 18,
    cooldown: 0,
    maxCooldown: 5,
    attachElement: {
      element: 'grass',
      strength: 'strong',
      duration: 4,
    },
    specialEffect: {
      type: 'heal',
      value: 0.5,  // 恢复 0.5×ATK 生命
      duration: 0,
    },
    description: '附加强草（4回合）；恢复自身 0.5×ATK 生命',
  },
  [SkillId.CAO_WANTENG_JIAO]: {
    id: SkillId.CAO_WANTENG_JIAO,
    name: '万藤绞',
    type: 'attack',
    power: 2.0,
    mpCost: 36,
    cooldown: 0,
    maxCooldown: 6,
    attachElement: {
      element: 'grass',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'thunder', reaction: 'quicken' },
      { element: 'fire', reaction: 'burn' },
    ],
    description: '附加强草（4回合）；目标有雷/火→激化/燃烧',
  },

  // ==================== 冰系（3个）====================
  [SkillId.BING_BINGCI]: {
    id: SkillId.BING_BINGCI,
    name: '冰刺',
    type: 'attack',
    power: 1.2,
    mpCost: 14,
    cooldown: 0,
    maxCooldown: 2,
    attachElement: {
      element: 'ice',
      strength: 'weak',
      duration: 2,
    },
    reactionTrigger: [
      { element: 'fire', reaction: 'melt' },
    ],
    description: '附加弱冰（2回合）；目标有火→融化',
  },
  [SkillId.BING_BINGLENG_ZAN]: {
    id: SkillId.BING_BINGLENG_ZAN,
    name: '冰棱斩',
    type: 'attack',
    power: 1.2,  // 冻结代价，伤害降低
    mpCost: 20,
    cooldown: 0,
    maxCooldown: 4,
    attachElement: {
      element: 'ice',
      strength: 'medium',
      duration: 3,
    },
    crowdControl: {
      type: 'freeze',
      duration: 1,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'freeze' },
    ],
    description: '附加中冰（3回合）；目标有水→冻结',
  },
  [SkillId.BING_YONGHAN_YU]: {
    id: SkillId.BING_YONGHAN_YU,
    name: '永寒狱',
    type: 'attack',
    power: 1.8,
    mpCost: 33,
    cooldown: 0,
    maxCooldown: 5,
    attachElement: {
      element: 'ice',
      strength: 'strong',
      duration: 4,
    },
    reactionTrigger: [
      { element: 'water', reaction: 'freeze' },
      { element: 'fire', reaction: 'melt' },
    ],
    description: '附加强冰（4回合）；目标有水/火→冻结/融化',
  },
};

// 获取所有技能列表
export const getAllSkills = (): Skill[] => Object.values(SKILLS);

// 按元素分类获取技能
export const getSkillsByElement = (element?: string): Skill[] => {
  if (!element || element === 'all') {
    return getAllSkills();
  }
  
  if (element === 'none') {
    // 普攻
    return getAllSkills().filter(s => 
      [SkillId.PUGONG_MENGJI, SkillId.PUGONG_YUANSU_CHUOCI, SkillId.PUGONG_XUHOU_ZAN].includes(s.id as SkillId)
    );
  }
  
  const prefix = element === 'fire' ? 'huo_' :
                 element === 'water' ? 'shui_' :
                 element === 'thunder' ? 'lei_' :
                 element === 'grass' ? 'cao_' :
                 element === 'ice' ? 'bing_' : '';
  
  return getAllSkills().filter(s => s.id.startsWith(prefix));
};

// 获取普攻列表
export const getNormalAttacks = (): Skill[] => {
  return [
    SKILLS[SkillId.PUGONG_MENGJI],
    SKILLS[SkillId.PUGONG_YUANSU_CHUOCI],
    SKILLS[SkillId.PUGONG_XUHOU_ZAN],
  ];
};

// 元素对应的技能
export const ELEMENT_SKILLS: Record<string, Skill[]> = {
  fire: getSkillsByElement('fire'),
  water: getSkillsByElement('water'),
  thunder: getSkillsByElement('thunder'),
  grass: getSkillsByElement('grass'),
  ice: getSkillsByElement('ice'),
};
