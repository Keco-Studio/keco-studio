import { describe, expect, it } from '@jest/globals';
import { eventToLogLine } from '@/components/simulation/arena/BattleArena/eventToLogLine';

describe('eventToLogLine', () => {
  it('reads tick from the BattleEvent envelope for action_executed', () => {
    expect(
      eventToLogLine({
        type: 'action_executed',
        tick: 12,
        payload: {
          actorId: 'poc-player',
          skillName: 'Fireball',
        },
      })
    ).toBe('[T12] poc-player → Fireball');
  });

  it('falls back to payload.tick then ? when envelope tick is missing', () => {
    expect(
      eventToLogLine({
        type: 'action_executed',
        payload: {
          actorId: 'poc-enemy',
          skillName: 'Heal',
          tick: 3,
        },
      })
    ).toBe('[T3] poc-enemy → Heal');

    expect(
      eventToLogLine({
        type: 'action_executed',
        payload: {
          actorId: 'poc-enemy',
          action: 'basic_attack',
        },
      })
    ).toBe('[T?] poc-enemy → basic_attack');
  });
});
