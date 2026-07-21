import { describe, expect, it } from '@jest/globals';
import { buildArenaConfigFromSession, toKecoSkill } from '@/lib/simulation/kecoArenaAdapter';
import type { SimulationCatalog } from '@/lib/simulation/types';

const catalog: SimulationCatalog = {
  characters: [
    { id: 'hero', name: '宋江', el: 'Fire', hp: 1000, atk: 120, def: 40, spd: 100, mp: 100 },
    { id: 'slime', name: 'Slime', el: 'Earth', hp: 800, atk: 80, def: 20, spd: 80, mp: 80 },
  ],
  skills: [
    { id: 'flame', name: 'Flame Slash', el: 'Fire', mp: 13, power: 145, cd: 1, kind: 'dmg', status: 'burn' },
    { id: 'bolt', name: 'Firebolt', el: 'Fire', mp: 8, power: 110, cd: 0, kind: 'dmg' },
  ],
  basic: { id: 'basic', name: 'Strike', el: 'Physical', mp: 0, power: 70, cd: 0, kind: 'dmg' },
};

describe('kecoArenaAdapter', () => {
  it('maps studio skill power into keco ATK multipliers', () => {
    const skill = toKecoSkill(catalog.skills[0], 1);
    expect(skill.id).toBe('flame');
    expect(skill.type).toBe('attack');
    expect(skill.power).toBeCloseTo(1.45);
    expect(skill.mpCost).toBe(13);
    expect(skill.attachElement?.element).toBe('fire');
    expect(skill.dot?.duration).toBe(2);
  });

  it('builds a 1v1 arena config from the first fighters on each team', () => {
    const config = buildArenaConfigFromSession({
      catalog,
      roster: [
        { uid: 'a1', tmplId: 'hero', team: 'A' },
        { uid: 'b1', tmplId: 'slime', team: 'B' },
      ],
      loadout: {
        a1: ['flame', 'bolt'],
        b1: ['bolt'],
      },
      skillLevels: {
        a1: { flame: 2 },
      },
    });

    expect(config).not.toBeNull();
    expect(config?.playerName).toBe('宋江');
    expect(config?.enemyName).toBe('Slime');
    expect(config?.playerSkillIds).toEqual(['flame', 'bolt']);
    expect(config?.enemySkillIds).toEqual(['bolt']);
    expect(config?.skills.some((skill) => skill.id === 'flame' && skill.power > 1.45)).toBe(true);
    expect(config?.monsterInitialElement).toBe('grass');
  });
});
