import { skillPower, STRONG } from './data';
import type {
  BattleEvent,
  BattleFighter,
  BattleResult,
  ElementName,
  FighterSnapshot,
  Loadout,
  RosterEntry,
  SimulationCatalog,
  SkillLevels,
  Team,
} from './types';

export function eleMult(attacker: ElementName, defender: ElementName): number {
  if (STRONG[attacker] === defender) return 1.5;
  if (STRONG[defender] === attacker) return 0.7;
  return 1;
}

export function buildFighters(
  catalog: SimulationCatalog,
  roster: readonly RosterEntry[],
  loadout: Loadout,
  skillLv: SkillLevels,
): BattleFighter[] {
  const fighters: BattleFighter[] = [];

  for (const entry of roster) {
    const template = catalog.characters.find((character) => character.id === entry.tmplId);
    if (!template) throw new Error(`Unknown character template: ${entry.tmplId}`);

    const skills = (loadout[entry.uid] || []).map((skillId) => {
      const definition = catalog.skills.find((skill) => skill.id === skillId) ?? catalog.basic;
      const level = (skillLv[entry.uid] || {})[skillId] || 1;
      return {
        ...definition,
        power: skillPower(definition.power, level),
        lv: level,
      };
    });

    if (skills.length === 0) skills.push({ ...catalog.basic, lv: 1 });
    fighters.push({
      uid: entry.uid,
      name: template.name,
      team: entry.team,
      el: template.el,
      cls: template.cls,
      initial: template.name[0],
      maxHp: template.hp,
      hp: template.hp,
      maxMp: template.mp,
      mp: template.mp,
      atk: template.atk,
      def: template.def,
      spd: template.spd,
      skills,
      cd: {},
      alive: true,
      burn: 0,
      dot: 0,
      freeze: 0,
      defBuff: 0,
    });
  }

  return fighters;
}

function snapshot(fighters: BattleFighter[]): FighterSnapshot[] {
  return fighters.map((fighter) => ({
    uid: fighter.uid,
    hp: Math.max(0, Math.round(fighter.hp)),
    mp: Math.round(fighter.mp),
    alive: fighter.alive,
  }));
}

export function simulate(
  catalog: SimulationCatalog,
  roster: readonly RosterEntry[],
  loadout: Loadout,
  skillLv: SkillLevels,
  record: boolean,
  random: () => number = Math.random,
): BattleResult {
  const fighters = buildFighters(catalog, roster, loadout, skillLv);
  const events: BattleEvent[] = [];
  const teamAlive = (team: Team) => fighters.some((fighter) => fighter.team === team && fighter.alive);
  const push = (event: Omit<BattleEvent, 'snap'>) => {
    if (record) events.push({ ...event, snap: snapshot(fighters) });
  };
  let round = 0;

  while (teamAlive('A') && teamAlive('B') && round < 40) {
    round++;
    const order = fighters
      .filter((fighter) => fighter.alive)
      .sort((left, right) => right.spd - left.spd);

    for (const fighter of order) {
      if (!fighter.alive) continue;

      if (fighter.burn > 0) {
        fighter.hp -= 24;
        fighter.burn--;
        if (fighter.hp <= 0) {
          fighter.hp = 0;
          fighter.alive = false;
        }
        push({
          actor: fighter.uid,
          target: fighter.uid,
          type: 'dot',
          text: `${fighter.name} takes 24 burn damage.`,
          tag: 'BURN',
        });
        if (!fighter.alive) {
          push({
            actor: fighter.uid,
            target: fighter.uid,
            type: 'ko',
            text: `${fighter.name} is defeated.`,
            tag: 'KO',
          });
          continue;
        }
      }

      if (fighter.dot > 0) {
        fighter.hp -= 22;
        fighter.dot--;
        if (fighter.hp <= 0) {
          fighter.hp = 0;
          fighter.alive = false;
        }
        push({
          actor: fighter.uid,
          target: fighter.uid,
          type: 'dot',
          text: `${fighter.name} takes 22 decay damage.`,
          tag: 'DECAY',
        });
        if (!fighter.alive) {
          push({
            actor: fighter.uid,
            target: fighter.uid,
            type: 'ko',
            text: `${fighter.name} is defeated.`,
            tag: 'KO',
          });
          continue;
        }
      }

      if (fighter.defBuff > 0) fighter.defBuff--;
      if (fighter.freeze > 0) {
        fighter.freeze--;
        push({
          actor: fighter.uid,
          target: fighter.uid,
          type: 'status',
          text: `${fighter.name} is frozen and skips the turn.`,
          tag: 'FROZEN',
        });
        continue;
      }

      for (const skillId in fighter.cd) {
        if (fighter.cd[skillId] > 0) fighter.cd[skillId]--;
      }
      fighter.mp = Math.min(fighter.maxMp, fighter.mp + 8);

      const enemies = fighters.filter((candidate) => candidate.alive && candidate.team !== fighter.team);
      const allies = fighters.filter((candidate) => candidate.alive && candidate.team === fighter.team);
      if (enemies.length === 0) break;

      const usable = fighter.skills.filter(
        (skill) => (fighter.cd[skill.id] || 0) <= 0 && fighter.mp >= skill.mp,
      );
      const heal = usable.find((skill) => skill.kind === 'heal');
      const low = allies
        .filter((ally) => ally.hp / ally.maxHp < 0.5)
        .sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0];
      let skill;
      let target;

      if (heal && low) {
        skill = heal;
        target = low;
      } else {
        const damageSkills = usable
          .filter((candidate) => candidate.kind === 'dmg')
          .sort((left, right) => right.power - left.power);
        const buff = usable.find((candidate) => candidate.kind === 'buff');
        if (buff && fighter.defBuff <= 0 && random() < 0.25) {
          skill = buff;
          target = fighter;
        } else {
          skill = damageSkills[0];
        }
        if (!skill) skill = { ...catalog.basic, lv: 1 };

        if (skill.kind !== 'buff' && skill.kind !== 'heal') {
          target = enemies.slice().sort((left, right) => left.hp - right.hp)[0];
        } else if (skill.kind === 'heal') {
          target = low || fighter;
        } else {
          target = fighter;
        }
      }

      fighter.mp -= skill.mp;
      if (skill.cd > 0) fighter.cd[skill.id] = skill.cd;

      if (skill.kind === 'heal') {
        const amount = 170;
        target.hp = Math.min(target.maxHp, target.hp + amount);
        push({
          actor: fighter.uid,
          target: target.uid,
          type: 'heal',
          amount,
          text: `${fighter.name} casts ${skill.name} — heals ${target.name} +${amount} HP.`,
          tag: 'HEAL',
        });
      } else if (skill.kind === 'buff') {
        fighter.defBuff = 2;
        push({
          actor: fighter.uid,
          target: fighter.uid,
          type: 'buff',
          text: `${fighter.name} casts ${skill.name} — DEF up.`,
          tag: 'BUFF',
        });
      } else {
        const elementMultiplier = eleMult(skill.el, target.el);
        const variance = 0.9 + random() * 0.2;
        let defense = target.def * (target.defBuff > 0 ? 1.4 : 1);
        if (skill.id === 'piercing') defense *= 0.7;
        let damage = Math.round(
          skill.power
            * (fighter.atk / 100)
            * elementMultiplier
            * (100 / (100 + defense))
            * variance,
        );
        if (skill.id === 'smite' && target.el === 'Shadow') damage = Math.round(damage * 1.35);
        if (skill.id === 'shadowstrike' && random() < 0.3) damage = Math.round(damage * 1.5);

        target.hp -= damage;
        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
        }
        const reaction = elementMultiplier > 1
          ? ' ·  effective!'
          : (elementMultiplier < 1 ? ' ·  resisted' : '');
        push({
          actor: fighter.uid,
          target: target.uid,
          type: 'dmg',
          amount: damage,
          text: `${fighter.name} uses ${skill.name} on ${target.name} — ${damage} dmg${reaction}.`,
          tag: skill.el.toUpperCase(),
        });

        if (target.alive && skill.status) {
          if (skill.status === 'burn') {
            target.burn = 2;
          } else if (skill.status === 'dot') {
            target.dot = 3;
          } else if (skill.status === 'freeze') {
            target.freeze = 1;
            push({
              actor: fighter.uid,
              target: target.uid,
              type: 'status',
              text: `${target.name} is frozen!`,
              tag: 'FREEZE',
            });
          } else if (skill.status === 'stun' && random() < 0.35) {
            target.freeze = 1;
            push({
              actor: fighter.uid,
              target: target.uid,
              type: 'status',
              text: `${target.name} is stunned!`,
              tag: 'STUN',
            });
          }
        }
        if (!target.alive) {
          push({
            actor: fighter.uid,
            target: target.uid,
            type: 'ko',
            text: `${target.name} is defeated.`,
            tag: 'KO',
          });
        }
      }

      if (!teamAlive('A') || !teamAlive('B')) break;
    }
  }

  let winner: Team;
  if (teamAlive('A') && !teamAlive('B')) {
    winner = 'A';
  } else if (teamAlive('B') && !teamAlive('A')) {
    winner = 'B';
  } else {
    const hpFraction = (team: Team) => fighters
      .filter((fighter) => fighter.team === team)
      .reduce((sum, fighter) => sum + fighter.hp / fighter.maxHp, 0);
    winner = hpFraction('A') >= hpFraction('B') ? 'A' : 'B';
  }

  return { winner, events, fs: fighters };
}

export function displayUnits(fighters: BattleFighter[]) {
  return fighters.map((fighter) => ({
    uid: fighter.uid,
    name: fighter.name,
    team: fighter.team,
    el: fighter.el,
    initial: fighter.initial,
    cls: fighter.cls,
    hp: fighter.maxHp,
    maxHp: fighter.maxHp,
    mp: fighter.maxMp,
    maxMp: fighter.maxMp,
    alive: true,
  }));
}
