/**
 * Battle Worker - Web Worker for batch battle simulation
 * Uses shared battle logic from battleLogic.ts
 */

import {
  simulateBattle,
  calculateStats,
  type Combatant,
  type BattleResult,
} from './battleLogic';

// Re-implement message handler for Worker context
self.onmessage = function(e: MessageEvent) {
  const { type, playerConfig, monsters, runsPerMonster, batchSize } = e.data;
  
  if (type === 'start') {
    try {
      const result = runWorkerBatch(
        playerConfig,
        monsters,
        runsPerMonster,
        batchSize
      );
      self.postMessage({ type: 'complete', result });
    } catch (error) {
      self.postMessage({ type: 'error', error: (error as Error).message });
    }
  }
};

function runWorkerBatch(
  playerConfig: Omit<Combatant, 'id' | 'type'>,
  monsters: Array<Omit<Combatant, 'id' | 'type'>>,
  runsPerMonster: number,
  batchSize: number
) {
  const totalBattles = monsters.length * runsPerMonster;
  const results: BattleResult[] = [];
  
  for (let monsterIdx = 0; monsterIdx < monsters.length; monsterIdx++) {
    const monster = monsters[monsterIdx];
    
    for (let run = 0; run < runsPerMonster; run++) {
      const result = simulateBattle({
        player: { ...playerConfig, id: `player-${run}`, type: 'player' },
        monster: { ...monster, id: `monster-${run}`, type: 'monster' },
        maxTurns: 100,
      });
      
      results.push(result);
      
      // Send progress update every batch
      if (results.length % batchSize === 0 || results.length === totalBattles) {
        const progress = Math.round((results.length / totalBattles) * 100);
        const stats = calculateStats(results, playerConfig.hp);
        
        self.postMessage({
          type: 'progress',
          progress,
          stats,
          completed: results.length,
          total: totalBattles,
        });
      }
    }
  }
  
  return calculateStats(results, playerConfig.hp);
}
