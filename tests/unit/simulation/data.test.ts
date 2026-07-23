import { describe, expect, it } from '@jest/globals';

import {
  autoMapFields,
  createCharSnapshot,
  createDemoImportedSnapshot,
  DEMO_CATALOG,
  needExp,
  skillCost,
  skillPower,
  sortRosterByTeam,
} from '@/lib/simulation/data';
import { SIM_FIELDS } from '@/lib/simulation/data';

describe('simulation data helpers', () => {
  it('keeps the demo progression formulas', () => {
    expect(needExp(1)).toBe(100);
    expect(needExp(3)).toBe(420);
    expect(skillCost(1)).toBe(1);
    expect(skillCost(5)).toBeNull();
    expect(skillPower(140, 3)).toBe(174);
  });

  it('uses imported progression rules when provided', () => {
    expect(needExp(3, [{ level: 3, exp: 900, sp: 4 }])).toBe(900);
    expect(skillCost(1, [{ lv: 1, cost: 7 }])).toBe(7);
  });

  it('creates a project-scoped snapshot from the built-in demo data', () => {
    const importedAt = '2026-07-21T00:00:00.000Z';
    const snapshot = createDemoImportedSnapshot('project-1', importedAt);

    expect(snapshot.sourceProjectId).toBe('project-1');
    expect(snapshot.catalog).toEqual(DEMO_CATALOG);
    expect(snapshot.sourceLibraryIds).toEqual({
      characters: 'demo:characters',
      skills: 'demo:skills',
      level: 'demo:level',
      skillc: 'demo:skillc',
    });
    expect(snapshot.fieldMappings).toEqual({
      characters: {}, skills: {}, level: {}, skillc: {},
    });
    expect(snapshot.importedAt).toBe(importedAt);
    expect(snapshot.catalog).not.toBe(DEMO_CATALOG);
  });

  it('maps canonical fields without reusing a Studio column', () => {
    const mapping = autoMapFields('characters', {});

    expect(mapping.id).toBe('char_id');
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
  });

  it('maps aliases immediately while respecting Studio value types', () => {
    const mapping = autoMapFields('skillc', {}, [
      { id: 'skill', label: 'Skill ID', valueType: 'string' },
      { id: 'skill_level', label: 'Skill Level', valueType: 'number' },
      { id: 'upgrade_cost', label: 'Upgrade Cost', valueType: 'number' },
      { id: 'wrong_cost', label: 'Cost', valueType: 'boolean' },
    ]);

    expect(mapping).toEqual({ skillId: 'skill', lv: 'skill_level', cost: 'upgrade_cost' });
  });

  it('declares the complete required import contract', () => {
    const required = (role: keyof typeof SIM_FIELDS) => SIM_FIELDS[role]
      .filter((field) => field.required)
      .map((field) => field.id);

    expect(required('characters')).toEqual(['id', 'name', 'el', 'hp', 'atk', 'def', 'spd', 'mp']);
    expect(required('skills')).toEqual(['id', 'name', 'el', 'mp', 'power', 'cd', 'kind']);
    expect(required('level')).toEqual(['level', 'exp', 'sp']);
    expect(required('skillc')).toEqual(['skillId', 'lv', 'cost']);
  });

  it('uses entity-specific progression rules before shared fallbacks', () => {
    expect(needExp(3, [
      { level: 3, exp: 300, sp: 1 },
      { characterId: 'hero', level: 3, exp: 900, sp: 4 },
    ], 'hero')).toBe(900);
    expect(needExp(3, [
      { level: 3, exp: 300, sp: 1 },
      { characterId: 'hero', level: 3, exp: 900, sp: 4 },
    ], 'other')).toBe(300);
    expect(skillCost(2, [
      { lv: 2, cost: 2 },
      { skillId: 'quake', lv: 2, cost: 7 },
    ], 'quake')).toBe(7);
    expect(skillCost(2, [{ skillId: 'quake', lv: 2, cost: 7 }], 'other')).toBeNull();
  });

  it('creates catalog snapshots and orders Team A before Team B', () => {
    expect(createCharSnapshot('ignara')).toMatchObject({ name: 'Ignara', lv: 1 });
    expect(
      sortRosterByTeam([
        { uid: 'b', tmplId: 'ignara', team: 'B' },
        { uid: 'a', tmplId: 'bramwell', team: 'A' },
      ])[0].team,
    ).toBe('A');

    const importedCatalog = {
      ...DEMO_CATALOG,
      characters: [
        { ...DEMO_CATALOG.characters[0], id: 'custom', name: 'Custom Hero' },
      ],
    };

    expect(createCharSnapshot('custom', importedCatalog)).toMatchObject({
      name: 'Custom Hero',
      lv: 1,
    });
  });
});
