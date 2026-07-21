import type { Skill } from '@keco/battle-engine';
import { upsertBattleSkillDefinition } from '../battle-core/content/skills/basic-skill-catalog';
import type { BattleSkillDefinition } from '../battle-core/domain/types/skill-types';

/** Keco skill tables omit range: map-battle BT uses one cast range to gate post-move skill picks. */
const KECO_BT_CAST_RANGE = 12;

/** Map-battle CD: maxCooldown × this (built-in POC skills still use catalog ×10). */
export const KECO_SKILL_COOLDOWN_TICK_MULTIPLIER = 3;

function skillCategory(skill: Skill, freezeTicks?: number): BattleSkillDefinition['category'] {
  if (freezeTicks) return 'control';
  if (skill.type === 'heal') return 'sustain';
  return 'burst';
}

/** BT pick weight: power plus a small element-reaction bias (see pickReactionSkillInRange). */
function skillBtRatio(skill: Skill): number {
  const base = Math.max(0.5, skill.power);
  const elem = skill.attachElement?.element;
  if (elem && elem !== 'random') return base + 0.8;
  if (skill.type === 'heal') return base + 0.5;
  return base;
}

export function kecoSkillToBattleCoreDefinition(skill: Skill): BattleSkillDefinition {
  const freezeTicks =
    skill.crowdControl?.type === 'freeze' ? skill.crowdControl.duration : undefined;

  return upsertBattleSkillDefinition(
    {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skillCategory(skill, freezeTicks),
      ratio: skillBtRatio(skill),
      mpCost: skill.mpCost,
      range: KECO_BT_CAST_RANGE,
      cooldownTicks: Math.max(0, skill.maxCooldown),
      applyFreezeTicks: freezeTicks,
    },
    { cooldownTickMultiplier: KECO_SKILL_COOLDOWN_TICK_MULTIPLIER },
  );
}

export function registerKecoSkills(skills: Skill[]): Record<string, Skill> {
  const skillById: Record<string, Skill> = {};
  for (const skill of skills) {
    kecoSkillToBattleCoreDefinition(skill);
    skillById[skill.id] = skill;
  }
  return skillById;
}

export function defaultBasicKecoSkill(): Skill {
  return {
    id: 'keco_basic_strike',
    name: 'Strike',
    type: 'attack',
    power: 1,
    mpCost: 0,
    cooldown: 0,
    maxCooldown: 0,
    description: 'Basic melee strike',
  };
}
