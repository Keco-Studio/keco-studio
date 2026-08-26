import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAggregates, summarizeSamples, summarizeScores } from '../src/eval-statistics.mjs';

test('summarizes values with one-decimal mean and sample standard deviation', () => {
  assert.deepEqual(summarizeScores([52, 54, 57]), {
    values: [52, 54, 57], mean: 54.3, stddev: 2.5, min: 52, max: 57,
  });
  assert.deepEqual(summarizeScores([30, 30]), {
    values: [30, 30], mean: 30, stddev: 0, min: 30, max: 30,
  });
  assert.throws(() => summarizeScores([54]), /at least 2/i);
});

test('summarizes all dimensions and compares current minus baseline means', () => {
  const baseline = summarizeSamples([
    { experienceValueScore: 22, gameplaySystemsScore: 30, contentPresentationScore: 20, totalScore: 72 },
    { experienceValueScore: 24, gameplaySystemsScore: 32, contentPresentationScore: 22, totalScore: 78 },
    { experienceValueScore: 23, gameplaySystemsScore: 29, contentPresentationScore: 19, totalScore: 71 },
  ]);
  const current = summarizeSamples([
    { experienceValueScore: 21, gameplaySystemsScore: 29, contentPresentationScore: 19, totalScore: 69 },
    { experienceValueScore: 22, gameplaySystemsScore: 30, contentPresentationScore: 20, totalScore: 72 },
    { experienceValueScore: 22, gameplaySystemsScore: 30, contentPresentationScore: 19, totalScore: 71 },
  ]);
  assert.equal(baseline.experienceValue.mean, 23);
  assert.equal(baseline.total.stddev, 3.8);
  assert.deepEqual(compareAggregates(baseline, current), { experienceValue: -1.3, gameplaySystems: -0.6, contentPresentation: -1, total: -3 });
});
