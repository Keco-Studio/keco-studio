export type ProjectileKind =
  | 'arrow'
  | 'fireball'
  | 'arcane_bolt'
  | 'frost'
  | 'slash'
  | 'support'
  | 'generic';

/** Map keco / poc skill ids to projectile visuals (no emoji). */
export function resolveSkillFxProfile(input: {
  action: string;
  actorRole: 'player' | 'enemy';
  skillId?: string;
}): { projectileKind: ProjectileKind | null; durationMs: number } {
  const action = String(input.action || '');
  const skillId = String(input.skillId || '').toLowerCase();

  if (action === 'basic_attack') {
    return {
      projectileKind: input.actorRole === 'player' ? 'arrow' : 'slash',
      durationMs: 280,
    };
  }
  if (action !== 'cast_skill') {
    return { projectileKind: null, durationMs: 320 };
  }

  if (skillId.includes('huo') || skillId.includes('fire') || skillId.includes('ranhuo')) {
    return { projectileKind: 'fireball', durationMs: 360 };
  }
  if (skillId.includes('bing') || skillId.includes('ice') || skillId.includes('frost')) {
    return { projectileKind: 'frost', durationMs: 350 };
  }
  if (skillId.includes('shui') || skillId.includes('water')) {
    return { projectileKind: 'arcane_bolt', durationMs: 340 };
  }
  if (skillId.includes('lei') || skillId.includes('thunder')) {
    return { projectileKind: 'arcane_bolt', durationMs: 320 };
  }
  if (
    skillId.includes('zhi') ||
    skillId.includes('heal') ||
    skillId.includes('huichun') ||
    skillId.includes('barrier') ||
    skillId.includes('aura')
  ) {
    return { projectileKind: 'support', durationMs: 300 };
  }
  if (skillId.includes('cao') || skillId.includes('grass')) {
    return { projectileKind: 'support', durationMs: 310 };
  }
  if (
    skillId.includes('shadow') ||
    skillId.includes('backstab') ||
    skillId.includes('mengji') ||
    skillId.includes('zhan') ||
    skillId.includes('ci')
  ) {
    return { projectileKind: 'slash', durationMs: 250 };
  }
  return { projectileKind: 'generic', durationMs: 320 };
}
