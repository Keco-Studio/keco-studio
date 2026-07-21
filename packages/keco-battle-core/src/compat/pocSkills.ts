/** Minimal skill stubs for MapBattleController manual-queue fallback (auto BT ignores these). */

export type PocUiSkill = {
  id: string;
  name: string;
  action: 'basic_attack' | 'cast_skill';
  coreSkillId?: string;
};

export const BASIC_ATTACK: PocUiSkill = {
  id: 'keco_basic_attack',
  name: 'Basic attack',
  action: 'basic_attack',
};

export function getSkillById(id: string): PocUiSkill | undefined {
  if (id === BASIC_ATTACK.id) return BASIC_ATTACK;
  return undefined;
}

export function cooldownMsFromTicks(ticks: number, battleTickMs = 200): number {
  return Math.max(0, ticks) * battleTickMs;
}
