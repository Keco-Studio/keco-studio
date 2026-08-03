/**
 * Format battle-session events for the arena Battle Log HUD.
 * Tick lives on the BattleEvent envelope (from appendEvent/createEvent), not payload.
 */
export function eventToLogLine(ev: {
  type: string;
  tick?: number;
  payload: Record<string, unknown>;
}): string | null {
  if (ev.type === 'action_executed') {
    const skill = ev.payload.skillName ?? ev.payload.skillId ?? ev.payload.action;
    const tick = ev.tick ?? ev.payload.tick;
    return `[T${tick ?? '?'}] ${ev.payload.actorId} → ${skill}`;
  }
  if (ev.type === 'damage_applied') {
    return `  dmg ${ev.payload.damage}${ev.payload.resolver === 'keco_element' ? ' (keco)' : ''}`;
  }
  if (ev.type === 'command_rejected') {
    return `  reject: ${ev.payload.reason}`;
  }
  if (ev.type === 'battle_ended') {
    return `Ended: ${ev.payload.result}`;
  }
  return null;
}
