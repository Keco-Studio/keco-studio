import type { Element, Skill } from '@keco/battle-engine';
import type { BattleArenaConfig } from '@/components/simulation/arena/BattleArena/BattleArena';
import { skillPower } from './data';
import type {
  CharacterTemplate,
  ElementName,
  RosterEntry,
  SimulationCatalog,
  SkillDefinition,
  SkillLevels,
  Loadout,
} from './types';

const ELEMENT_MAP: Partial<Record<ElementName, Element>> = {
  Fire: 'fire',
  Ice: 'ice',
  Lightning: 'thunder',
  Earth: 'grass',
};

export function toKecoElement(el: ElementName | undefined | null): Element | null {
  if (!el) return null;
  return ELEMENT_MAP[el] ?? null;
}

export function toKecoSkill(def: SkillDefinition, level = 1): Skill {
  const scaled = skillPower(def.power, level);
  const power = Math.max(0.1, scaled / 100);
  const attachElement = toKecoElement(def.el);

  const skill: Skill = {
    id: def.id,
    name: def.name,
    type: def.kind === 'heal' ? 'heal' : 'attack',
    power: def.kind === 'heal' || def.kind === 'buff' ? 0 : power,
    mpCost: def.mp,
    cooldown: 0,
    maxCooldown: def.cd,
    description: def.fx ?? def.name,
  };

  if (attachElement) {
    skill.attachElement = { element: attachElement, strength: 'weak', duration: 2 };
  }

  if (def.status === 'burn' || def.status === 'dot') {
    skill.dot = {
      damage: def.status === 'burn' ? 0.25 : 0.2,
      duration: def.status === 'burn' ? 2 : 3,
    };
  }
  if (def.status === 'freeze' || def.status === 'stun') {
    skill.crowdControl = { type: 'freeze', duration: 1 };
  }

  if (def.kind === 'heal') {
    skill.specialEffect = { type: 'heal', value: Math.max(0.5, power || 1.7), duration: 0 };
  }

  return skill;
}

function resolveCharacter(
  entry: RosterEntry,
  catalog: SimulationCatalog,
): CharacterTemplate {
  if (entry.snapshot) {
    return {
      id: entry.tmplId,
      name: entry.snapshot.name,
      cls: entry.snapshot.cls,
      el: entry.snapshot.el,
      hp: entry.snapshot.hp,
      atk: entry.snapshot.atk,
      def: entry.snapshot.def,
      spd: entry.snapshot.spd,
      mp: entry.snapshot.mp,
    };
  }
  const tmpl = catalog.characters.find((item) => item.id === entry.tmplId);
  if (tmpl) return tmpl;
  return {
    id: entry.tmplId,
    name: entry.tmplId,
    el: 'Physical',
    hp: 800,
    atk: 100,
    def: 40,
    spd: 100,
    mp: 80,
  };
}

function collectMappedSkills(
  skillIds: string[],
  catalog: SimulationCatalog,
  levels: Record<string, number> | undefined,
): Skill[] {
  const byId = new Map(catalog.skills.map((skill) => [skill.id, skill]));
  byId.set(catalog.basic.id, catalog.basic);
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const id of skillIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = byId.get(id);
    if (!def) continue;
    out.push(toKecoSkill(def, levels?.[id] ?? 1));
  }
  if (out.length === 0) {
    out.push(toKecoSkill(catalog.basic, 1));
  }
  return out;
}

/**
 * Build a 1v1 BattleArena config from the first Team A and Team B roster entries.
 * Multi-fighter rosters still use batch simulation on the local engine.
 */
export function buildArenaConfigFromSession(input: {
  catalog: SimulationCatalog;
  roster: RosterEntry[];
  loadout: Loadout;
  skillLevels: SkillLevels;
}): BattleArenaConfig | null {
  const player = input.roster.find((entry) => entry.team === 'A');
  const enemy = input.roster.find((entry) => entry.team === 'B');
  if (!player || !enemy) return null;

  const playerChar = resolveCharacter(player, input.catalog);
  const enemyChar = resolveCharacter(enemy, input.catalog);
  const playerSkillIds = input.loadout[player.uid] ?? [];
  const enemySkillIds = input.loadout[enemy.uid] ?? [];
  if (playerSkillIds.length === 0 || enemySkillIds.length === 0) return null;

  const playerSkills = collectMappedSkills(
    playerSkillIds,
    input.catalog,
    input.skillLevels[player.uid],
  );
  const enemySkills = collectMappedSkills(
    enemySkillIds,
    input.catalog,
    input.skillLevels[enemy.uid],
  );
  const skillMap = new Map<string, Skill>();
  for (const skill of [...playerSkills, ...enemySkills]) {
    skillMap.set(skill.id, skill);
  }

  return {
    mapWidth: 16,
    mapHeight: 16,
    playerName: playerChar.name,
    playerStats: {
      maxHp: playerChar.hp,
      atk: playerChar.atk,
      def: playerChar.def,
      spd: playerChar.spd,
    },
    playerHp: playerChar.hp,
    playerMp: playerChar.mp,
    playerMaxMp: playerChar.mp,
    playerSkillIds: playerSkills.map((skill) => skill.id),
    enemyName: enemyChar.name,
    enemyStats: {
      maxHp: enemyChar.hp,
      atk: enemyChar.atk,
      def: enemyChar.def,
      spd: enemyChar.spd,
    },
    enemyHp: enemyChar.hp,
    enemyMp: enemyChar.mp,
    enemyMaxMp: enemyChar.mp,
    enemySkillIds: enemySkills.map((skill) => skill.id),
    skills: [...skillMap.values()],
    monsterInitialElement: toKecoElement(enemyChar.el),
  };
}
