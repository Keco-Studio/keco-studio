import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRatings, combineScores, distribution } from '../src/scoring.mjs';

test('distribution always contains all five labels', () => {
  assert.deepEqual(distribution([1, 1, 3, 5]), { 1: 2, 2: 0, 3: 1, 4: 0, 5: 1 });
});

test('aggregates averages, distributions, and reasons', () => {
  const result = aggregateRatings([
    { experienceValueScore: 4, gameplaySystemsScore: 3, contentPresentationScore: 5, experienceValueReasons: ['unclear_goal'], gameplaySystemsReasons: ['weak_loop'], contentPresentationReasons: ['ui_clarity'] },
    { experienceValueScore: 5, gameplaySystemsScore: 4, contentPresentationScore: 4, experienceValueReasons: ['unclear_goal'], gameplaySystemsReasons: [], contentPresentationReasons: [] },
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.experienceValueAverage, 4.5);
  assert.equal(result.gameplaySystemsAverage, 3.5);
  assert.equal(result.contentPresentationAverage, 4.5);
  assert.deepEqual(result.experienceValueReasons, [{ reason: 'unclear_goal', count: 2 }]);
});

test('combines AI 70%, players 30%, then weights dimensions 30/40/30', () => {
  const aggregate = { count: 1, experienceValueAverage: 4, gameplaySystemsAverage: 3, contentPresentationAverage: 5 };
  const result = combineScores({ aiExperienceValueScore: 24, aiGameplaySystemsScore: 32, aiContentPresentationScore: 27, aggregate });
  assert.deepEqual(result, {
    provisional: false,
    aiExperienceValuePercent: 80,
    aiGameplaySystemsPercent: 80,
    aiContentPresentationPercent: 90,
    playerExperienceValuePercent: 80,
    playerGameplaySystemsPercent: 60,
    playerContentPresentationPercent: 100,
    experienceValue: 80,
    gameplaySystems: 74,
    contentPresentation: 93,
    final: 81.5,
  });
});

test('clamps AI scores and withholds final only when there are no player ratings', () => {
  const result = combineScores({
    aiExperienceValueScore: 50,
    aiGameplaySystemsScore: -3,
    aiContentPresentationScore: 31,
    aggregate: { count: 0, experienceValueAverage: null, gameplaySystemsAverage: null, contentPresentationAverage: null },
  });
  assert.equal(result.aiExperienceValuePercent, 100);
  assert.equal(result.aiGameplaySystemsPercent, 0);
  assert.equal(result.aiContentPresentationPercent, 100);
  assert.equal(result.provisional, true);
  assert.equal(result.final, null);
});
