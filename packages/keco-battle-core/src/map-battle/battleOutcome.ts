import type { BattleSession } from '../battle-core/domain/entities/battle-session'

/** Normalizes battle-core result / battle_ended to POC UI outcome */
export function getPocBattleUiOutcome(session: BattleSession): 'ongoing' | 'win' | 'lose' | 'fled' {
  if (session.result === 'ongoing') return 'ongoing'
  const ended = [...session.events].reverse().find((e) => e.type === 'battle_ended')
  const reason = typeof ended?.payload?.reason === 'string' ? ended.payload.reason : ''

  if (reason === 'flee_success') return 'fled'
  if (reason === 'right_defeated' && session.result === 'left_win') return 'win'
  if (reason === 'left_defeated' && session.result === 'right_win') return 'lose'

  if (session.result === 'left_win') return 'win'
  if (session.result === 'right_win') return 'lose'
  return 'ongoing'
}
