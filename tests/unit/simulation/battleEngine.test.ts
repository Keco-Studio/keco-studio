import { describe, expect, it } from '@jest/globals';

import { DEMO_CATALOG } from '@/lib/simulation/data';
import {
  buildFighters,
  displayUnits,
  eleMult,
  simulate,
} from '@/lib/simulation/battleEngine';
import type {
  Loadout,
  RosterEntry,
  SimulationCatalog,
  SkillLevels,
} from '@/lib/simulation/types';

describe('simulation battle engine', () => {
  it('applies strong, resisted, and neutral elemental multipliers', () => {
    expect(eleMult('Fire', 'Earth')).toBe(1.5);
    expect(eleMult('Earth', 'Fire')).toBe(0.7);
    expect(eleMult('Fire', 'Light')).toBe(1);
  });

  it('builds fighters exclusively from the supplied catalog and falls back to its basic skill', () => {
    const catalog: SimulationCatalog = {
      characters: [
        {
          id: 'custom-mage',
          name: 'Catalog Mage',
          cls: 'Tester',
          el: 'Ice',
          hp: 321,
          atk: 77,
          def: 23,
          spd: 45,
          mp: 89,
        },
      ],
      skills: [
        {
          id: 'custom-bolt',
          name: 'Catalog Bolt',
          el: 'Lightning',
          mp: 7,
          power: 100,
          cd: 1,
          kind: 'dmg',
        },
      ],
      basic: {
        id: 'custom-basic',
        name: 'Catalog Strike',
        el: 'Physical',
        mp: 0,
        power: 13,
        cd: 0,
        kind: 'dmg',
      },
    };
    const roster = [
      { uid: 'custom', tmplId: 'custom-mage', team: 'A' },
    ] as const satisfies readonly RosterEntry[];

    const leveled = buildFighters(
      catalog,
      roster,
      { custom: ['custom-bolt'] },
      { custom: { 'custom-bolt': 2 } },
    );
    const fallback = buildFighters(catalog, roster, {}, {});

    expect(leveled[0]).toMatchObject({
      uid: 'custom',
      name: 'Catalog Mage',
      maxHp: 321,
      hp: 321,
      maxMp: 89,
      mp: 89,
    });
    expect(leveled[0].skills).toEqual([
      expect.objectContaining({ id: 'custom-bolt', power: 112, lv: 2 }),
    ]);
    expect(fallback[0].skills).toEqual([
      expect.objectContaining({ id: 'custom-basic', power: 13, lv: 1 }),
    ]);
    expect(displayUnits(fallback)).toEqual([
      expect.objectContaining({
        uid: 'custom',
        name: 'Catalog Mage',
        hp: 321,
        maxHp: 321,
        mp: 89,
        maxMp: 89,
        alive: true,
      }),
    ]);
  });

  it('reproduces the deterministic Ignara versus Bramwell battle', () => {
    const roster = [
      { uid: 'ignara-a', tmplId: 'ignara', team: 'A' },
      { uid: 'bramwell-b', tmplId: 'bramwell', team: 'B' },
    ] as const satisfies readonly RosterEntry[];
    const loadout: Loadout = {
      'ignara-a': ['fireball'],
      'bramwell-b': ['stoneskin'],
    };
    const skillLv: SkillLevels = {
      'ignara-a': { fireball: 1 },
      'bramwell-b': { stoneskin: 1 },
    };

    const recorded = simulate(DEMO_CATALOG, roster, loadout, skillLv, true, () => 0.5);

    expect(recorded.winner).toBe('A');
    expect(recorded.events).toHaveLength(32);
    expect(
      recorded.events.reduce<Record<string, number>>((counts, event) => {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ dmg: 21, dot: 10, ko: 1 });
    expect(recorded.events[0]).toMatchObject({
      actor: 'ignara-a',
      target: 'bramwell-b',
      type: 'dmg',
      amount: 104,
    });
    expect(recorded.events[0].snap).toEqual([
      { uid: 'ignara-a', hp: 520, mp: 100, alive: true },
      { uid: 'bramwell-b', hp: 836, mp: 60, alive: true },
    ]);
    expect(recorded.events.at(-1)).toMatchObject({
      actor: 'ignara-a',
      target: 'bramwell-b',
      type: 'ko',
      tag: 'KO',
    });
    expect(recorded.fs).toEqual([
      expect.objectContaining({ uid: 'ignara-a', hp: 190, mp: 80, alive: true }),
      expect.objectContaining({ uid: 'bramwell-b', hp: 0, mp: 60, alive: false }),
    ]);

    const unrecorded = simulate(DEMO_CATALOG, roster, loadout, skillLv, false, () => 0.5);

    expect(unrecorded.events).toEqual([]);
    expect(unrecorded.winner).toBe(recorded.winner);
    expect(unrecorded.fs).toEqual(recorded.fs);
  });
});
