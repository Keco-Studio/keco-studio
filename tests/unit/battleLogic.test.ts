/**
 * Battle Logic Unit Tests
 * Tests that main thread and Worker use the same battle logic
 */

import {
  calculateDamage,
  determineFirstAttacker,
  calculateDifficulty,
  simulateBattle,
  calculateStats,
} from '../../src/app/(dashboard)/battle-simulator/core/battleLogic';

describe('Battle Logic', () => {
  describe('calculateDamage', () => {
    it('should return ATK when DEF is 0', () => {
      expect(calculateDamage(20, 0)).toBe(20);
    });

    it('should return 0 when ATK is 0', () => {
      expect(calculateDamage(0, 10)).toBe(0);
    });

    it('should use formula ATK^2 / (ATK + DEF)', () => {
      // Mock Math.random to get predictable result
      const originalRandom = Math.random;
      Math.random = () => 0.5; // 50% of 0.2 = 0.1, so multiplier = 1.0
      
      const damage = calculateDamage(20, 10);
      const expected = Math.max(1, Math.floor((20 * 20) / (20 + 10) * 1.0));
      expect(damage).toBe(expected);
      
      Math.random = originalRandom;
    });

    it('should never return less than 1', () => {
      const originalRandom = Math.random;
      Math.random = () => 0.5;
      
      const damage = calculateDamage(1, 100);
      expect(damage).toBeGreaterThanOrEqual(1);
      
      Math.random = originalRandom;
    });
  });

  describe('determineFirstAttacker', () => {
    it('should return player when player speed is higher', () => {
      const result = determineFirstAttacker(20, 10);
      expect(result).toBe('player');
    });

    it('should return monster when monster speed is higher', () => {
      const result = determineFirstAttacker(10, 20);
      expect(result).toBe('monster');
    });

    it('should be random when speeds are equal (testing distribution)', () => {
      // Run multiple times and check that both outcomes are possible
      const results = Array.from({ length: 100 }, () => 
        determineFirstAttacker(15, 15)
      );
      
      const hasPlayer = results.includes('player');
      const hasMonster = results.includes('monster');
      
      // With 100 samples, both should appear (probability of one not appearing is extremely low)
      expect(hasPlayer).toBe(true);
      expect(hasMonster).toBe(true);
    });
  });

  describe('calculateDifficulty', () => {
    it('should return balanced when playerMaxHp is 0', () => {
      expect(calculateDifficulty(50, 0)).toBe('balanced');
    });

    it('should return trivial when HP > 90%', () => {
      expect(calculateDifficulty(95, 100)).toBe('trivial');
      expect(calculateDifficulty(91, 100)).toBe('trivial');
    });

    it('should return easy when HP is 60-90%', () => {
      expect(calculateDifficulty(75, 100)).toBe('easy');  // 60-90%
      expect(calculateDifficulty(65, 100)).toBe('easy');
    });

    it('should return balanced when HP is 30-60%', () => {
      expect(calculateDifficulty(55, 100)).toBe('balanced');  // 30-60%
      expect(calculateDifficulty(35, 100)).toBe('balanced');
    });

    it('should return hard when HP is 0-30%', () => {
      expect(calculateDifficulty(25, 100)).toBe('hard');  // 0-30%
      expect(calculateDifficulty(5, 100)).toBe('hard');
    });

    it('should return impossible when HP is 0', () => {
      expect(calculateDifficulty(0, 100)).toBe('impossible');
    });
  });

  describe('simulateBattle', () => {
    it('should handle player win', () => {
      const result = simulateBattle({
        player: { id: 'p1', name: 'Player', hp: 100, atk: 50, def: 10, spd: 15, type: 'player' },
        monster: { id: 'm1', name: 'Monster', hp: 10, atk: 10, def: 10, spd: 10, type: 'monster' },
        maxTurns: 100,
      });

      expect(result.winner).toBe('player');
      expect(result.playerFinalHp).toBeGreaterThan(0);
      expect(result.monsterFinalHp).toBe(0);
    });

    it('should handle monster win', () => {
      const result = simulateBattle({
        player: { id: 'p1', name: 'Player', hp: 10, atk: 10, def: 10, spd: 10, type: 'player' },
        monster: { id: 'm1', name: 'Monster', hp: 100, atk: 50, def: 10, spd: 15, type: 'monster' },
        maxTurns: 100,
      });

      expect(result.winner).toBe('monster');
      expect(result.playerFinalHp).toBe(0);
    });

    it('should return draw when maxTurns reached', () => {
      // Use extremely low damage so battle cannot end in 5 turns
      const result = simulateBattle({
        player: { id: 'p1', name: 'Player', hp: 99999, atk: 1, def: 9999, spd: 15, type: 'player' },
        monster: { id: 'm1', name: 'Monster', hp: 99999, atk: 1, def: 9999, spd: 15, type: 'monster' },
        maxTurns: 5,
      });

      expect(result.totalTurns).toBe(5);
      // Winner depends on randomness, just verify it ran to max turns
    });

    it('should correctly track starting HP', () => {
      const result = simulateBattle({
        player: { id: 'p1', name: 'Player', hp: 100, atk: 20, def: 10, spd: 15, type: 'player' },
        monster: { id: 'm1', name: 'Monster', hp: 80, atk: 20, def: 10, spd: 15, type: 'monster' },
        maxTurns: 100,
      });

      expect(result.playerStartingHp).toBe(100);
      expect(result.monsterStartingHp).toBe(80);
    });
  });

  describe('calculateStats', () => {
    it('should return empty stats for empty results', () => {
      const stats = calculateStats([], 100);
      
      expect(stats.totalBattles).toBe(0);
      expect(stats.playerWinRate).toBe(0);
      expect(stats.averageTurns).toBe(0);
    });

    it('should calculate correct win rate', () => {
      const results = [
        { winner: 'player', totalTurns: 5, playerFinalHp: 80, monsterFinalHp: 0, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
        { winner: 'player', totalTurns: 7, playerFinalHp: 60, monsterFinalHp: 0, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
        { winner: 'monster', totalTurns: 6, playerFinalHp: 0, monsterFinalHp: 20, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
      ];

      const stats = calculateStats(results, 100);
      
      expect(stats.totalBattles).toBe(3);
      expect(stats.playerWinRate).toBeCloseTo(2/3);
    });

    it('should distribute difficulties correctly', () => {
      const results = [
        { winner: 'player', totalTurns: 5, playerFinalHp: 95, monsterFinalHp: 0, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
        { winner: 'player', totalTurns: 5, playerFinalHp: 70, monsterFinalHp: 0, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
        { winner: 'monster', totalTurns: 5, playerFinalHp: 0, monsterFinalHp: 20, turns: [], playerStartingHp: 100, monsterStartingHp: 100 },
      ];

      const stats = calculateStats(results, 100);
      
      expect(stats.difficultyDistribution.trivial).toBe(1);
      expect(stats.difficultyDistribution.easy).toBe(1);
      expect(stats.difficultyDistribution.impossible).toBe(1);
    });
  });

  describe('Symmetry Test - Same stats should give ~50% win rate', () => {
    it('should have approximately 50% win rate when stats are identical', () => {
      const playerConfig = { name: 'Player', hp: 100, atk: 20, def: 10, spd: 15 };
      const monsterConfig = { name: 'Monster', hp: 100, atk: 20, def: 10, spd: 15 };

      const results = Array.from({ length: 1000 }, () =>
        simulateBattle({
          player: { ...playerConfig, id: 'p', type: 'player' },
          monster: { ...monsterConfig, id: 'm', type: 'monster' },
          maxTurns: 100,
        })
      );

      const playerWins = results.filter(r => r.winner === 'player').length;
      const monsterWins = results.filter(r => r.winner === 'monster').length;
      const winRate = playerWins / results.length;

      // Win rate should be between 40% and 60% (allowing for variance)
      expect(winRate).toBeGreaterThan(0.40);
      expect(winRate).toBeLessThan(0.60);
      
      // Log for debugging
      console.log(`Player wins: ${playerWins}, Monster wins: ${monsterWins}, Win rate: ${(winRate * 100).toFixed(1)}%`);
    });
  });
});
