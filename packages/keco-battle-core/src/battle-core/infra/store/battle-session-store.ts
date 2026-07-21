import { BattleSession } from '../../domain/entities/battle-session'

export interface BattleSessionStore {
  get(sessionId: string): BattleSession | undefined
  set(session: BattleSession): void
  delete(sessionId: string): boolean
  list(): BattleSession[]
}

export class InMemoryBattleSessionStore implements BattleSessionStore {
  private readonly sessions = new Map<string, BattleSession>()

  public get(sessionId: string): BattleSession | undefined {
    return this.sessions.get(sessionId)
  }

  public set(session: BattleSession): void {
    this.sessions.set(session.id, session)
  }

  public delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  public list(): BattleSession[] {
    return Array.from(this.sessions.values())
  }
}

