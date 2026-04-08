/**
 * Battle Logic - Shared Pure Functions
 * This file contains all battle calculation logic.
 * Used by both main thread and Web Worker.
 */

/**
 * Calculate damage
 * Formula: damage = ATK * ATK / (ATK + DEF)
 * Minimum damage is 1
 * Damage variance: 90% - 110%
 */
export function calculateDamage(atk: number, def: number): number {
  if (def === 0) return atk;
  if (atk === 0) return 0;
  
  const baseDamage = (atk * atk) / (atk + def);
  const floatMultiplier = 0.9 + Math.random() * 0.2;
  const damage = baseDamage * floatMultiplier;
  
  return Math.max(1, Math.floor(damage));
}

/**
 * Determine first attacker based on speed
 */
export function determineFirstAttacker(
  playerSpd: number,
  monsterSpd: number
): 'player' | 'monster' {
  if (playerSpd > monsterSpd) return 'player';
  if (monsterSpd > playerSpd) return 'monster';
  return Math.random() < 0.5 ? 'player' : 'monster';
}

/**
 * Calculate difficulty based on player's remaining HP
 */
export function calculateDifficulty(
  playerFinalHp: number,
  playerMaxHp: number
): 'trivial' | 'easy' | 'balanced' | 'hard' | 'impossible' {
  if (playerMaxHp === 0) return 'balanced';
  
  const hpPercent = playerFinalHp / playerMaxHp;
  
  if (hpPercent > 0.9) return 'trivial';
  if (hpPercent > 0.6) return 'easy';
  if (hpPercent > 0.3) return 'balanced';
  if (hpPercent > 0) return 'hard';
  return 'impossible';
}

/**
 * Combatant data structure
 */
export interface Combatant {
  id: string;
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  type: 'player' | 'monster';
}

/**
 * Battle configuration
 */
export interface BattleConfig {
  player: Combatant;
  monster: Combatant;
  maxTurns: number;
}

/**
 * Turn log entry
 */
export interface TurnLog {
  turnNumber: number;
  attacker: string;
  defender: string;
  damage: number;
  attackerHpAfter: number;
  defenderHpAfter: number;
}

/**
 * Battle result
 */
export interface BattleResult {
  winner: 'player' | 'monster' | 'draw';
  totalTurns: number;
  playerFinalHp: number;
  monsterFinalHp: number;
  turns: TurnLog[];
  playerStartingHp: number;
  monsterStartingHp: number;
}

/**
 * Battle statistics
 */
export interface BattleStats {
  totalBattles: number;
  playerWinRate: number;
  averageTurns: number;
  averagePlayerHp: number;
  difficultyDistribution: Record<'trivial' | 'easy' | 'balanced' | 'hard' | 'impossible', number>;
}

/**
 * Simulate a single battle
 */
export function simulateBattle(config: BattleConfig): BattleResult {
  const { player, monster, maxTurns } = config;
  
  let p: Combatant = { ...player };
  let m: Combatant = { ...monster };
  const turns: TurnLog[] = [];
  
  let turnNumber = 0;
  
  while (p.hp > 0 && m.hp > 0 && turnNumber < maxTurns) {
    turnNumber++;
    
    const firstAttacker = determineFirstAttacker(p.spd, m.spd);
    
    if (firstAttacker === 'player') {
      // Player attacks first
      const playerDamage = calculateDamage(p.atk, m.def);
      const monsterHpAfter = Math.max(0, m.hp - playerDamage);
      
      turns.push({
        turnNumber,
        attacker: p.name,
        defender: m.name,
        damage: playerDamage,
        attackerHpAfter: p.hp,
        defenderHpAfter: monsterHpAfter,
      });
      
      m.hp = monsterHpAfter;
      
      // Counter-attack if monster survives
      if (m.hp > 0) {
        const monsterDamage = calculateDamage(m.atk, p.def);
        const playerHpAfter = Math.max(0, p.hp - monsterDamage);
        
        turns.push({
          turnNumber,
          attacker: m.name,
          defender: p.name,
          damage: monsterDamage,
          attackerHpAfter: monsterHpAfter,
          defenderHpAfter: playerHpAfter,
        });
        
        p.hp = playerHpAfter;
      }
    } else {
      // Monster attacks first
      const monsterDamage = calculateDamage(m.atk, p.def);
      const playerHpAfter = Math.max(0, p.hp - monsterDamage);
      
      turns.push({
        turnNumber,
        attacker: m.name,
        defender: p.name,
        damage: monsterDamage,
        attackerHpAfter: m.hp,
        defenderHpAfter: playerHpAfter,
      });
      
      p.hp = playerHpAfter;
      
      // Counter-attack if player survives
      if (p.hp > 0) {
        const playerDamage = calculateDamage(p.atk, m.def);
        const monsterHpAfter = Math.max(0, m.hp - playerDamage);
        
        turns.push({
          turnNumber,
          attacker: p.name,
          defender: m.name,
          damage: playerDamage,
          attackerHpAfter: playerHpAfter,
          defenderHpAfter: monsterHpAfter,
        });
        
        m.hp = monsterHpAfter;
      }
    }
  }
  
  return {
    winner: p.hp > 0 ? 'player' : m.hp > 0 ? 'monster' : 'draw',
    totalTurns: turnNumber,
    playerFinalHp: p.hp,
    monsterFinalHp: m.hp,
    turns,
    playerStartingHp: player.hp,
    monsterStartingHp: monster.hp,
  };
}

/**
 * Batch battle simulation (sync version)
 */
export function runBatchSimulation(
  playerConfig: Omit<Combatant, 'id' | 'type'>,
  monsterConfigs: Array<Omit<Combatant, 'id' | 'type'>>,
  runsPerMonster: number = 10,
  maxTurns: number = 100
): BattleStats {
  const results: BattleResult[] = [];
  
  for (const monster of monsterConfigs) {
    for (let i = 0; i < runsPerMonster; i++) {
      const result = simulateBattle({
        player: { ...playerConfig, id: `player-${i}`, type: 'player' },
        monster: { ...monster, id: `monster-${i}`, type: 'monster' },
        maxTurns,
      });
      results.push(result);
    }
  }
  
  return calculateStats(results, playerConfig.hp);
}

/**
 * Calculate statistics from battle results
 */
export function calculateStats(
  results: BattleResult[],
  playerMaxHp: number
): BattleStats {
  if (results.length === 0) {
    return {
      totalBattles: 0,
      playerWinRate: 0,
      averageTurns: 0,
      averagePlayerHp: 0,
      difficultyDistribution: { trivial: 0, easy: 0, balanced: 0, hard: 0, impossible: 0 },
    };
  }
  
  const playerWins = results.filter(r => r.winner === 'player').length;
  const totalTurns = results.reduce((sum, r) => sum + r.totalTurns, 0);
  const totalPlayerHp = results.reduce((sum, r) => sum + r.playerFinalHp, 0);
  
  const difficultyDistribution: Record<'trivial' | 'easy' | 'balanced' | 'hard' | 'impossible', number> = {
    trivial: 0,
    easy: 0,
    balanced: 0,
    hard: 0,
    impossible: 0,
  };
  
  results.forEach(r => {
    const diff = calculateDifficulty(r.playerFinalHp, playerMaxHp);
    difficultyDistribution[diff]++;
  });
  
  return {
    totalBattles: results.length,
    playerWinRate: playerWins / results.length,
    averageTurns: totalTurns / results.length,
    averagePlayerHp: totalPlayerHp / results.length,
    difficultyDistribution,
  };
}

/**
 * Format battle result to readable text
 */
export function formatBattleResult(result: BattleResult): string[] {
  const lines: string[] = [];
  
  lines.push(`=== Battle Result ===`);
  lines.push(`Turns: ${result.totalTurns}`);
  lines.push(`Winner: ${result.winner === 'player' ? 'Player' : result.winner === 'monster' ? 'Monster' : 'Draw'}`);
  lines.push(`Player HP: ${result.playerFinalHp}/${result.playerStartingHp}`);
  lines.push(`Monster HP: ${result.monsterFinalHp}/${result.monsterStartingHp}`);
  lines.push(``);
  lines.push(`=== Battle Log ===`);
  
  for (const turn of result.turns) {
    lines.push(
      `T${turn.turnNumber}: ${turn.attacker} attacks ${turn.defender} for ${turn.damage} damage`
    );
  }
  
  return lines;
}
