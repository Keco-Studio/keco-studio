# @keco/battle-engine

Keco battle simulator core: elemental reactions, turn resolution, and auto-battle AI.

## Contents

- `types` — `Skill`, `BattleState`, element/reaction config
- `core/battleLogic` — damage, `executeSkill`, turn end, cooldowns
- `ai/pickSkill` — heuristic skill selection (reactions first)
- `ai/resolveTurn` — pure player/enemy/round-end steps
- `auto/autoBattle` — `advanceAutoBattleStep`, `runAutoBattleToCompletion`

## Usage (keco-simulation)

```ts
import {
  createInitialBattleState,
  advanceAutoBattleStep,
  runAutoBattleToCompletion,
} from '@keco/battle-engine';
```

## Auto battle loop

```ts
let state = createInitialBattleState(config);
while (state.phase !== 'finished' && !state.result) {
  const step = advanceAutoBattleStep(state, {
    skillList,
    playerSkillIds,
    enemySkillIds: playerSkillIds,
    maxTurns: 100,
  });
  state = step.state;
  if (step.finished) break;
}
```
