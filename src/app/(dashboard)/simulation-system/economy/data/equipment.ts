/**
 * 装备数据 - Equipment Data
 * 基于《火影忍者》手游装备表
 */

import type { Equipment, EquipmentQuality, EquipmentSlot } from '../types';

/**
 * 解析CSV行为装备对象
 */
function parseEquipmentRow(row: string[]): Equipment | null {
  if (!row[0] || !row[1]) return null;
  
  const id = parseFloat(row[0]);
  if (isNaN(id)) return null;
  
  const name = row[1];
  const mainType = parseFloat(row[2]) || 0;
  const subType = parseFloat(row[3]) || 0;
  const level = parseFloat(row[4]) || 0;
  const quality = parseFloat(row[5]) || 1;
  
  // 强化费用 - 第14列是每级强化费用(递增)，第19列是1孔消耗银币
  // 第14列的值如 328,355,384...是每级强化的具体费用，这才是正确的强化费用
  const enhanceCost = parseFloat(row[14]) || 0;
  
  // 打造银币消耗
  const craftCost = parseFloat(row[23]) || 0;
  
  // 开放等级
  const openLevel = parseFloat(row[11]) || 0;
  
  // 装备品质文字
  let qualityText: EquipmentQuality = '普通';
  if (row[24]) {
    switch (row[24]) {
      case '普通': qualityText = '普通'; break;
      case '高级': qualityText = '高级'; break;
      case '神铸': qualityText = '神铸'; break;
    }
  } else if (quality === 6 || quality === 7) {
    qualityText = '神铸';
  } else if (quality >= 4) {
    qualityText = '高级';
  }
  
  return {
    id,
    name,
    mainType,
    subType,
    level,
    quality,
    qualityText,
    enhanceCost,
    craftCost,
    openLevel,
  };
}

// 装备数据 - 从CSV解析的关键装备
export const EQUIPMENTS: Equipment[] = [
  // 饰纹系列 (1级) - 强化费用随等级递增，从328到567
  { id: 14200001, name: '饰纹苦无', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 328, craftCost: 1500, openLevel: 30 },
  { id: 14200002, name: '饰纹手里剑', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 355, craftCost: 1500, openLevel: 30 },
  { id: 14200003, name: '饰纹卷轴', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 384, craftCost: 2500, openLevel: 30 },
  { id: 14200004, name: '饰纹护额', mainType: 2, subType: 2, level: 1, quality: 1, qualityText: '普通', enhanceCost: 415, craftCost: 2500, openLevel: 30 },
  { id: 14200005, name: '饰纹胸甲', mainType: 2, subType: 3, level: 1, quality: 1, qualityText: '普通', enhanceCost: 448, craftCost: 4000, openLevel: 30 },
  { id: 14200006, name: '饰纹风衣', mainType: 2, subType: 4, level: 1, quality: 1, qualityText: '普通', enhanceCost: 484, craftCost: 4000, openLevel: 30 },
  { id: 14200007, name: '饰纹靴', mainType: 2, subType: 5, level: 1, quality: 1, qualityText: '普通', enhanceCost: 524, craftCost: 4000, openLevel: 30 },
  { id: 14200008, name: '饰纹腰带', mainType: 2, subType: 6, level: 1, quality: 1, qualityText: '普通', enhanceCost: 567, craftCost: 6000, openLevel: 30 },

  // 下忍系列 (1级)
  { id: 14200011, name: '下忍苦无', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 613, craftCost: 6000, openLevel: 65 },
  { id: 14200012, name: '下忍手里剑', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 662, craftCost: 6000, openLevel: 65 },
  { id: 14200013, name: '下忍卷轴', mainType: 2, subType: 1, level: 1, quality: 1, qualityText: '普通', enhanceCost: 716, craftCost: 6000, openLevel: 65 },
  { id: 14200014, name: '下忍护额', mainType: 2, subType: 2, level: 1, quality: 1, qualityText: '普通', enhanceCost: 774, craftCost: 8000, openLevel: 65 },
  { id: 14200015, name: '下忍胸甲', mainType: 2, subType: 3, level: 1, quality: 1, qualityText: '普通', enhanceCost: 836, craftCost: 8000, openLevel: 65 },
  { id: 14200016, name: '下忍风衣', mainType: 2, subType: 4, level: 1, quality: 1, qualityText: '普通', enhanceCost: 903, craftCost: 10000, openLevel: 65 },
  { id: 14200017, name: '下忍靴', mainType: 2, subType: 5, level: 1, quality: 1, qualityText: '普通', enhanceCost: 976, craftCost: 10000, openLevel: 65 },
  { id: 14200018, name: '下忍腰带', mainType: 2, subType: 6, level: 1, quality: 1, qualityText: '普通', enhanceCost: 1056, craftCost: 10000, openLevel: 65 },

  // 精炼系列 (10级)
  { id: 14200021, name: '精炼苦无', mainType: 2, subType: 1, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1141, craftCost: 12000, openLevel: 75 },
  { id: 14200022, name: '精炼手里剑', mainType: 2, subType: 1, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1233, craftCost: 12000, openLevel: 75 },
  { id: 14200025, name: '精炼胸甲', mainType: 2, subType: 3, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1555, craftCost: 12000, openLevel: 78 },
  { id: 14200026, name: '精炼风衣', mainType: 2, subType: 4, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1680, craftCost: 14000, openLevel: 78 },
  { id: 14200027, name: '精炼靴', mainType: 2, subType: 5, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1814, craftCost: 16000, openLevel: 78 },
  { id: 14200028, name: '精炼腰带', mainType: 2, subType: 6, level: 10, quality: 2, qualityText: '高级', enhanceCost: 1959, craftCost: 14000, openLevel: 78 },

  // 雪晴系列 (30级)
  { id: 14200031, name: '雪晴苦无', mainType: 2, subType: 1, level: 30, quality: 3, qualityText: '高级', enhanceCost: 2116, craftCost: 16000, openLevel: 80 },
  { id: 14200032, name: '雪晴手里剑', mainType: 2, subType: 1, level: 30, quality: 3, qualityText: '高级', enhanceCost: 2287, craftCost: 16000, openLevel: 80 },
  { id: 14200035, name: '雪晴胸甲', mainType: 2, subType: 3, level: 30, quality: 3, qualityText: '高级', enhanceCost: 2882, craftCost: 20000, openLevel: 85 },
  { id: 14200036, name: '雪晴风衣', mainType: 2, subType: 4, level: 30, quality: 3, qualityText: '高级', enhanceCost: 3114, craftCost: 14000, openLevel: 85 },
  { id: 14200037, name: '雪晴靴', mainType: 2, subType: 5, level: 30, quality: 3, qualityText: '高级', enhanceCost: 3363, craftCost: 16000, openLevel: 85 },
  { id: 14200038, name: '雪晴腰带', mainType: 2, subType: 6, level: 30, quality: 3, qualityText: '高级', enhanceCost: 3633, craftCost: 18000, openLevel: 85 },

  // 烬灭系列 (30级)
  { id: 14200041, name: '烬灭苦无', mainType: 2, subType: 1, level: 30, quality: 4, qualityText: '高级', enhanceCost: 3925, craftCost: 0, openLevel: 90 },
  { id: 14200042, name: '烬灭手里剑', mainType: 2, subType: 1, level: 30, quality: 4, qualityText: '高级', enhanceCost: 4869, craftCost: 0, openLevel: 90 },
  { id: 14200045, name: '烬灭胸甲', mainType: 2, subType: 3, level: 30, quality: 4, qualityText: '高级', enhanceCost: 7656, craftCost: 0, openLevel: 95 },
  { id: 14200046, name: '烬灭风衣', mainType: 2, subType: 4, level: 30, quality: 4, qualityText: '高级', enhanceCost: 8577, craftCost: 0, openLevel: 95 },
  { id: 14200047, name: '烬灭靴', mainType: 2, subType: 5, level: 30, quality: 4, qualityText: '高级', enhanceCost: 9496, craftCost: 0, openLevel: 95 },
  { id: 14200048, name: '烬灭腰带', mainType: 2, subType: 6, level: 30, quality: 4, qualityText: '高级', enhanceCost: 10416, craftCost: 0, openLevel: 95 },

  // 雾朦系列 (50级)
  { id: 14200051, name: '雾朦苦无', mainType: 2, subType: 1, level: 50, quality: 3, qualityText: '高级', enhanceCost: 11335, craftCost: 0, openLevel: 98 },
  { id: 14200052, name: '雾朦手里剑', mainType: 2, subType: 1, level: 50, quality: 3, qualityText: '高级', enhanceCost: 12260, craftCost: 0, openLevel: 98 },
  { id: 14200055, name: '雾朦胸甲', mainType: 2, subType: 3, level: 50, quality: 3, qualityText: '高级', enhanceCost: 15070, craftCost: 0, openLevel: 100 },
  { id: 14200056, name: '雾朦风衣', mainType: 2, subType: 4, level: 50, quality: 3, qualityText: '高级', enhanceCost: 16024, craftCost: 0, openLevel: 100 },
  { id: 14200057, name: '雾朦靴', mainType: 2, subType: 5, level: 50, quality: 3, qualityText: '高级', enhanceCost: 16986, craftCost: 0, openLevel: 100 },
  { id: 14200058, name: '雾朦腰带', mainType: 2, subType: 6, level: 50, quality: 3, qualityText: '高级', enhanceCost: 17960, craftCost: 0, openLevel: 100 },

  // 月泉系列 (50级)
  { id: 14200061, name: '月泉苦无', mainType: 2, subType: 1, level: 50, quality: 4, qualityText: '高级', enhanceCost: 18943, craftCost: 0, openLevel: 105 },
  { id: 14200062, name: '月泉手里剑', mainType: 2, subType: 1, level: 50, quality: 4, qualityText: '高级', enhanceCost: 19940, craftCost: 0, openLevel: 105 },
  { id: 14200065, name: '月泉胸甲', mainType: 2, subType: 3, level: 50, quality: 4, qualityText: '高级', enhanceCost: 23932, craftCost: 0, openLevel: 110 },
  { id: 14200066, name: '月泉风衣', mainType: 2, subType: 4, level: 50, quality: 4, qualityText: '高级', enhanceCost: 25514, craftCost: 0, openLevel: 110 },
  { id: 14200067, name: '月泉靴', mainType: 2, subType: 5, level: 50, quality: 4, qualityText: '高级', enhanceCost: 27159, craftCost: 0, openLevel: 110 },
  { id: 14200068, name: '月泉腰带', mainType: 2, subType: 6, level: 50, quality: 4, qualityText: '高级', enhanceCost: 28860, craftCost: 0, openLevel: 110 },
  
  // 外道系列 (75级)
  { id: 14210081, name: '外道·风魔苦无', mainType: 2, subType: 1, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 4906, craftCost: 0, openLevel: 0 },
  { id: 14210082, name: '外道·风魔手里剑', mainType: 2, subType: 1, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 6087, craftCost: 0, openLevel: 0 },
  { id: 14210083, name: '外道·风魔卷轴', mainType: 2, subType: 1, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 7255, craftCost: 0, openLevel: 0 },
  { id: 14210084, name: '外道·风魔护额', mainType: 2, subType: 2, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 8415, craftCost: 0, openLevel: 0 },
  { id: 14210085, name: '外道·风魔胸甲', mainType: 2, subType: 3, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 9570, craftCost: 0, openLevel: 0 },
  { id: 14210086, name: '外道·风魔风衣', mainType: 2, subType: 4, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 10722, craftCost: 0, openLevel: 0 },
  { id: 14210087, name: '外道·风魔靴', mainType: 2, subType: 5, level: 75, quality: 7, qualityText: '神铸', enhanceCost: 11871, craftCost: 0, openLevel: 0 },

  // 封魔系列 (85级)
  { id: 14210091, name: '封魔·水月苦无', mainType: 2, subType: 1, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 14169, craftCost: 0, openLevel: 0 },
  { id: 14210092, name: '封魔·水月手里剑', mainType: 2, subType: 1, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 15325, craftCost: 0, openLevel: 0 },
  { id: 14210093, name: '封魔·水月卷轴', mainType: 2, subType: 1, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 16492, craftCost: 0, openLevel: 0 },
  { id: 14210094, name: '封魔·水月护额', mainType: 2, subType: 2, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 17659, craftCost: 0, openLevel: 0 },
  { id: 14210095, name: '封魔·水月胸甲', mainType: 2, subType: 3, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 18838, craftCost: 0, openLevel: 0 },
  { id: 14210096, name: '封魔·水月风衣', mainType: 2, subType: 4, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 20031, craftCost: 0, openLevel: 0 },
  { id: 14210097, name: '封魔·水月靴', mainType: 2, subType: 5, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 21232, craftCost: 0, openLevel: 0 },
  { id: 14210098, name: '封魔·水月腰带', mainType: 2, subType: 6, level: 85, quality: 7, qualityText: '神铸', enhanceCost: 22450, craftCost: 0, openLevel: 0 },

  // 修罗系列 (95级)
  { id: 14210101, name: '修罗·地藏苦无', mainType: 2, subType: 1, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 23679, craftCost: 0, openLevel: 0 },
  { id: 14210102, name: '修罗·地藏手里剑', mainType: 2, subType: 1, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 24925, craftCost: 0, openLevel: 0 },
  { id: 14210103, name: '修罗·地藏卷轴', mainType: 2, subType: 1, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 26185, craftCost: 0, openLevel: 0 },
  { id: 14210104, name: '修罗·地藏护额', mainType: 2, subType: 2, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 28021, craftCost: 0, openLevel: 0 },
  { id: 14210105, name: '修罗·地藏胸甲', mainType: 2, subType: 3, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 29916, craftCost: 0, openLevel: 0 },
  { id: 14210106, name: '修罗·地藏风衣', mainType: 2, subType: 4, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 31893, craftCost: 0, openLevel: 0 },
  { id: 14210107, name: '修罗·地藏靴', mainType: 2, subType: 5, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 33949, craftCost: 0, openLevel: 0 },
  { id: 14210108, name: '修罗·地藏腰带', mainType: 2, subType: 6, level: 95, quality: 7, qualityText: '神铸', enhanceCost: 36075, craftCost: 0, openLevel: 0 },

  // 魔域系列 (10级)
  { id: 14220011, name: '魔域苦无', mainType: 2, subType: 1, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 38283, craftCost: 0, openLevel: 0 },
  { id: 14220012, name: '魔域手里剑', mainType: 2, subType: 1, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 40585, craftCost: 0, openLevel: 0 },
  { id: 14220013, name: '魔域卷轴', mainType: 2, subType: 1, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 42963, craftCost: 0, openLevel: 0 },
  { id: 14220014, name: '魔域护额', mainType: 2, subType: 2, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 46015, craftCost: 0, openLevel: 0 },
  { id: 14220015, name: '魔域胸甲', mainType: 2, subType: 3, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 49200, craftCost: 0, openLevel: 0 },
  { id: 14220016, name: '魔域风衣', mainType: 2, subType: 4, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 52492, craftCost: 0, openLevel: 0 },
  { id: 14220017, name: '魔域靴', mainType: 2, subType: 5, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 55923, craftCost: 0, openLevel: 0 },
  { id: 14220018, name: '魔域腰带', mainType: 2, subType: 6, level: 10, quality: 7, qualityText: '神铸', enhanceCost: 59481, craftCost: 0, openLevel: 0 },

  // 镜月系列 (78级)
  { id: 14220081, name: '镜月·破军苦无', mainType: 2, subType: 1, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 63172, craftCost: 0, openLevel: 0 },
  { id: 14220082, name: '镜月·破军手里剑', mainType: 2, subType: 1, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 66997, craftCost: 0, openLevel: 0 },
  { id: 14220083, name: '镜月·破军卷轴', mainType: 2, subType: 1, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 70977, craftCost: 0, openLevel: 0 },
  { id: 14220084, name: '镜月·破军护额', mainType: 2, subType: 2, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 75114, craftCost: 0, openLevel: 0 },
  { id: 14220085, name: '镜月·破军胸甲', mainType: 2, subType: 3, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 79398, craftCost: 0, openLevel: 0 },
  { id: 14220086, name: '镜月·破军风衣', mainType: 2, subType: 4, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 84939, craftCost: 0, openLevel: 0 },
  { id: 14220087, name: '镜月·破军靴', mainType: 2, subType: 5, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 90702, craftCost: 0, openLevel: 0 },
  { id: 14220088, name: '镜月·破军腰带', mainType: 2, subType: 6, level: 78, quality: 7, qualityText: '神铸', enhanceCost: 96693, craftCost: 0, openLevel: 0 },

  // 血界系列 (98级)
  { id: 14220101, name: '血界·破军苦无', mainType: 2, subType: 1, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 102921, craftCost: 0, openLevel: 0 },
  { id: 14220102, name: '血界·破军手里剑', mainType: 2, subType: 1, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 109369, craftCost: 0, openLevel: 0 },
  { id: 14220103, name: '血界·破军卷轴', mainType: 2, subType: 1, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 116067, craftCost: 0, openLevel: 0 },
  { id: 14220104, name: '血界·破军护额', mainType: 2, subType: 2, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 123018, craftCost: 0, openLevel: 0 },
  { id: 14220105, name: '血界·破军胸甲', mainType: 2, subType: 3, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 130252, craftCost: 0, openLevel: 0 },
  { id: 14220106, name: '血界·破军风衣', mainType: 2, subType: 4, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 137733, craftCost: 0, openLevel: 0 },
  { id: 14220107, name: '血界·破军靴', mainType: 2, subType: 5, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 145488, craftCost: 0, openLevel: 0 },
  { id: 14220108, name: '血界·破军腰带', mainType: 2, subType: 6, level: 98, quality: 7, qualityText: '神铸', enhanceCost: 153549, craftCost: 0, openLevel: 0 },

  // 天谴系列 (118级)
  { id: 14220121, name: '天谴·破军苦无', mainType: 2, subType: 1, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 162976, craftCost: 0, openLevel: 0 },
  { id: 14220122, name: '天谴·破军手里剑', mainType: 2, subType: 1, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 172683, craftCost: 0, openLevel: 0 },
  { id: 14220123, name: '天谴·破军卷轴', mainType: 2, subType: 1, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 182619, craftCost: 0, openLevel: 0 },
  { id: 14220124, name: '天谴·破军护额', mainType: 2, subType: 2, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 192873, craftCost: 0, openLevel: 0 },
  { id: 14220125, name: '天谴·破军胸甲', mainType: 2, subType: 3, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 203395, craftCost: 0, openLevel: 0 },
  { id: 14220126, name: '天谴·破军风衣', mainType: 2, subType: 4, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 214218, craftCost: 0, openLevel: 0 },
  { id: 14220127, name: '天谴·破军靴', mainType: 2, subType: 5, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 225315, craftCost: 0, openLevel: 0 },
  { id: 14220128, name: '天谴·破军腰带', mainType: 2, subType: 6, level: 118, quality: 7, qualityText: '神铸', enhanceCost: 236757, craftCost: 0, openLevel: 0 },
];

/** 装备槽位名称映射 */
export const EQUIPMENT_SLOT_NAMES: Record<number, EquipmentSlot> = {
  1: '苦无',
  2: '护额',
  3: '胸甲',
  4: '风衣',
  5: '靴',
  6: '腰带',
};

/** 装备系列名称 */
export const EQUIPMENT_SERIES: string[] = [
  '饰纹', '下忍', '精炼', '雪晴', '烬灭', '雾朦', '月泉',
  '封魔', '修罗', '魔域', '镜月', '血界', '天谴', '万象', '天神',
  '紫菱', '魇鬼', '鬼丸', '慑魂', '赤鬼', '三日月',
];

/**
 * 根据ID获取装备
 */
export function getEquipmentById(id: number): Equipment | undefined {
  return EQUIPMENTS.find(e => e.id === id);
}

/**
 * 根据品质获取装备
 */
export function getEquipmentsByQuality(quality: number): Equipment[] {
  return EQUIPMENTS.filter(e => e.quality === quality);
}

/**
 * 根据等级获取装备
 */
export function getEquipmentsByLevel(level: number): Equipment[] {
  return EQUIPMENTS.filter(e => e.level <= level);
}

/**
 * 根据槽位获取装备
 */
export function getEquipmentsBySlot(slot: number): Equipment[] {
  return EQUIPMENTS.filter(e => e.subType === slot);
}

/**
 * 计算装备强化费用（基于装备等级的分段曲线）
 * 方案B：降低倍率，让经济更宽裕
 * 
 * 设计原则：
 * 1. 低级装备（1-30级）：每级约 baseCost * 1-3
 * 2. 中级装备（31-70级）：每级约 baseCost * 3-5
 * 3. 高级装备（71-120级）：每级约 baseCost * 5-8
 * 4. 顶级装备（121+级）：每级约 baseCost * 8-12
 * 
 * @param baseLevel 当前等级
 * @param targetLevel 目标等级
 * @param baseCost 基础强化费用（来自CSV的每级费用）
 */
export function calculateEnhanceCost(baseLevel: number, targetLevel: number, baseCost: number = 1000): number {
  // 如果基础费用为0，使用默认公式
  if (baseCost <= 0) {
    baseCost = 1000;
  }
  
  let totalCost = 0;
  
  for (let lvl = baseLevel + 1; lvl <= targetLevel; lvl++) {
    // 使用分段曲线计算每级强化费用（降低倍率）
    let levelCost: number;
    
    if (lvl <= 20) {
      // 1-20级：对数增长曲线
      // 费用范围：约 baseCost * 1 到 baseCost * 2
      levelCost = baseCost * (1 + 0.3 * Math.log(lvl + 1) / Math.log(21));
    } else if (lvl <= 50) {
      // 21-50级：平方根增长
      // 费用范围：约 baseCost * 2 到 baseCost * 4
      levelCost = baseCost * (2 + 2 * Math.sqrt((lvl - 20) / 30));
    } else if (lvl <= 100) {
      // 51-100级：平方根+线性混合
      // 费用范围：约 baseCost * 4 到 baseCost * 7
      levelCost = baseCost * (4 + 3 * Math.sqrt((lvl - 50) / 50));
    } else {
      // 100级以上：增长放缓
      // 费用范围：约 baseCost * 7 到 baseCost * 12
      levelCost = baseCost * (7 + 5 * Math.log((lvl - 99) + 1) / Math.log(101));
    }
    
    totalCost += Math.floor(levelCost);
  }
  
  return totalCost;
}

/**
 * 计算单级强化费用
 * @param level 目标等级
 * @param baseCost 基础强化费用
 */
export function calculateSingleLevelCost(level: number, baseCost: number = 1000): number {
  if (baseCost <= 0) baseCost = 1000;
  
  if (level <= 20) {
    return Math.floor(baseCost * (1 + 0.3 * Math.log(level + 1) / Math.log(21)));
  } else if (level <= 50) {
    return Math.floor(baseCost * (2 + 2 * Math.sqrt((level - 20) / 30)));
  } else if (level <= 100) {
    return Math.floor(baseCost * (4 + 3 * Math.sqrt((level - 50) / 50)));
  } else {
    return Math.floor(baseCost * (7 + 5 * Math.log((level - 99) + 1) / Math.log(101)));
  }
}

/**
 * 估算强化费用（快速计���，不逐级累加）
 * 用于大范围估算
 */
export function estimateEnhanceCost(baseLevel: number, targetLevel: number, baseCost: number = 1000): number {
  if (baseCost <= 0) baseCost = 1000;
  const levels = targetLevel - baseLevel;
  
  // 取中间等级作为平均费用估算
  const midLevel = Math.floor((baseLevel + targetLevel) / 2);
  const avgCost = calculateSingleLevelCost(midLevel, baseCost);
  
  return Math.floor(avgCost * levels);
}

/**
 * 获取装备品质颜色
 */
export function getEquipmentQualityColor(quality: number): string {
  const colors: Record<number, string> = {
    1: '#8c8c8c', // 普通
    2: '#52c41a', // 高级
    3: '#1890ff', // 蓝色
    4: '#722ed1', // 紫色
    5: '#fa8c16', // 橙色
    6: '#f5222d', // 红色
    7: '#eb2f96', // 粉色
  };
  return colors[quality] || '#8c8c8c';
}
