import { describe, expect, it } from '@jest/globals';

import {
  autoMapFields,
  createCharSnapshot,
  DEMO_CATALOG,
  needExp,
  skillCost,
  skillPower,
  sortRosterByTeam,
} from '@/lib/simulation/data';

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

  it('maps canonical fields without reusing a Studio column', () => {
    const mapping = autoMapFields('characters', {});

    expect(mapping.id).toBe('char_id');
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
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
