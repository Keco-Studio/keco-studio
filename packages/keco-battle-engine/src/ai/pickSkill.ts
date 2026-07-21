import type { BattleUnit, Element, Skill } from '../types';
import { canUseSkill } from '../core/battleLogic';

/** Whether casting `skillElem` onto an existing `targetElem` aura triggers a keco reaction. */
export function canTriggerElementReaction(
  skillElem: Element,
  targetElem: Element,
): boolean {
  return (
    (skillElem === 'fire' && (targetElem === 'water' || targetElem === 'ice')) ||
    (skillElem === 'water' && targetElem === 'fire') ||
    (skillElem === 'thunder' && targetElem === 'water') ||
    (skillElem === 'grass' && targetElem === 'fire')
  );
}

/**
 * Heuristic skill picker (element reactions first, then random among affordable skills).
 */
export function pickSkillForUnit(
  actor: BattleUnit,
  target: BattleUnit,
  skillList: Skill[],
  cooldowns: Record<string, number>,
  allowedSkillIds?: string[],
): Skill | null {
  const pool = skillList.filter((s) => {
    if (allowedSkillIds && !allowedSkillIds.includes(s.id)) return false;
    return canUseSkill(s, actor, cooldowns).canUse;
  });
  if (pool.length === 0) return null;

  for (const skill of pool) {
    if (skill.attachElement && target.element) {
      const skillElem = skill.attachElement.element;
      if (skillElem !== 'random' && canTriggerElementReaction(skillElem, target.element.element)) {
        return skill;
      }
    }
  }

  const index = Math.floor(Math.random() * Math.min(3, pool.length));
  return pool[index] ?? pool[0];
}
