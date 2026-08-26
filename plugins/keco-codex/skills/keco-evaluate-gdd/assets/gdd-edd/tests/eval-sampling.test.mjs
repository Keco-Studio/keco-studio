import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScoreBaseline,
  formatBaseline,
  formatComparison,
  parseSamplingOptions,
  runScoreComparison,
  sampleEvaluations,
} from '../src/eval-sampling.mjs';

const evalCase = Object.freeze({
  id: 'paws-patience-r97', title: 'Paws & Patience', projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97,
  gddPath: 'docs/gdd.md', promptPath: 'docs/prompt.md', rubricPath: 'docs/rubric.md',
  resultTemplatePath: 'docs/result.md', outputStem: 'paws-r97',
});
const assets = {
  promptTemplate: 'Evaluate {{title}} {{gddPath}} {{rubricPath}}',
  hashes: { gdd: 'g1', prompt: 'p1', rubric: 'r1', schema: 's1', resultTemplate: 't1' },
};

function evaluatorFor(scores, calls, activity) {
  return async (input) => {
    activity.active += 1;
    activity.max = Math.max(activity.max, activity.active);
    calls.push(input);
    const index = calls.length - 1;
    await new Promise((resolve) => setImmediate(resolve));
    activity.active -= 1;
    const [experienceValue, gameplaySystems, contentPresentation] = scores[index];
    return {
      evaluation: { aiExperienceValueScore: experienceValue, aiGameplaySystemsScore: gameplaySystems, aiContentPresentationScore: contentPresentation, aiTotalScore: experienceValue + gameplaySystems + contentPresentation },
      execution: {
        requestedModel: 'sonnet', observedModel: index === 2 ? 'claude-opus-4-8' : 'claude-sonnet-4-6',
        startedAt: `start-${index + 1}`, finishedAt: `end-${index + 1}`, durationMs: index + 1,
        rawOutput: { run: index + 1, experienceValue, gameplaySystems, contentPresentation },
      },
    };
  };
}

test('defaults to three sequential AI-only samples with identical inputs', async () => {
  const calls = [];
  const activity = { active: 0, max: 0 };
  const result = await sampleEvaluations({
    evalCase, assets, provider: 'claude', runs: 3,
    evaluator: evaluatorFor([[22, 30, 20], [24, 32, 22], [23, 29, 19]], calls, activity),
    now: () => '2026-08-26T00:00:00.000Z',
  });
  assert.equal(calls.length, 3);
  assert.equal(activity.max, 1);
  assert.ok(calls.every((call) => call.prompt === calls[0].prompt && call.evalCase === evalCase));
  assert.equal(result.samples.length, 3);
  assert.equal(result.schemaVersion, 2);
  assert.deepEqual(result.case, { id: 'paws-patience-r97', title: 'Paws & Patience', projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97 });
  assert.equal(result.aggregates.total.mean, 73.7);
  assert.deepEqual(result.observedModels, ['claude-sonnet-4-6', 'claude-opus-4-8']);
  assert.match(result.samples[0].rawOutputSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), /"rawOutput":/);
});

test('creates and compares baselines without writing on sample failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-sampling-'));
  const makeEvaluator = (scores) => {
    const calls = [];
    return evaluatorFor(scores, calls, { active: 0, max: 0 });
  };
  const created = await createScoreBaseline({
    evalCase, assets, provider: 'claude', runs: 3, baselineRoot: root,
    evaluator: makeEvaluator([[22, 30, 20], [24, 32, 22], [23, 29, 19]]),
    now: () => '2026-08-26T00:00:00.000Z',
  });
  assert.match(created.path, /claude-sonnet\.json$/);
  const compared = await runScoreComparison({
    evalCase, assets: { ...assets, hashes: { ...assets.hashes, prompt: 'p2' } }, provider: 'claude', runs: 3, baselineRoot: root,
    evaluator: makeEvaluator([[21, 29, 19], [22, 30, 20], [22, 30, 19]]),
    now: () => '2026-08-27T00:00:00.000Z',
  });
  assert.deepEqual(compared.differences, { experienceValue: -1.3, gameplaySystems: -0.6, contentPresentation: -1, total: -3 });
  assert.deepEqual(compared.changes, ['Prompt hash']);
  assert.doesNotMatch(formatComparison(compared), /PASS|FAIL|Regression/i);

  let writes = 0;
  let calls = 0;
  await assert.rejects(() => createScoreBaseline({
    evalCase, assets, provider: 'claude', runs: 3, baselineRoot: root, force: true,
    evaluator: async () => { calls += 1; if (calls === 2) throw new Error('sample failed'); return makeEvaluator([[22, 30, 20]])({}); },
    baselineWriter: async () => { writes += 1; },
  }), /sample failed/);
  assert.equal(writes, 0);
});

test('parses bounded sampling CLI options and formats baseline output', () => {
  assert.deepEqual(parseSamplingOptions(['baseline']), { mode: 'baseline', caseId: undefined, provider: 'claude', model: undefined, runs: 3, force: false });
  assert.deepEqual(parseSamplingOptions(['compare', '--case=x', '--provider', 'codex', '--model=m', '--runs', '5', '--force']), { mode: 'compare', caseId: 'x', provider: 'codex', model: 'm', runs: 5, force: true });
  assert.throws(() => parseSamplingOptions(['baseline', '--runs', '1']), /2 to 20/);
  assert.throws(() => parseSamplingOptions(['unknown']), /Mode must be/i);
  const output = formatBaseline({ path: '/tmp/base.json', baseline: { case: { id: 'x', projectId: 'p', documentId: 'd', epoch: 2, revision: 0 }, provider: 'codex', requestedModel: 'gpt-test', observedModels: ['gpt-observed'], hashes: { gdd: 'g1', prompt: 'p1', rubric: 'r1', schema: 's1', resultTemplate: 't1' }, samples: [{}, {}, {}], aggregates: { experienceValue: { mean: 23, stddev: 1, min: 22, max: 24 }, gameplaySystems: { mean: 30.3, stddev: 1.5, min: 29, max: 32 }, contentPresentation: { mean: 20.3, stddev: 1.5, min: 19, max: 22 }, total: { mean: 73.7, stddev: 3.8, min: 70, max: 77 } } } });
  assert.match(output, /AI BASELINE[\s\S]*Project: p[\s\S]*Document: d[\s\S]*State: 2\/0[\s\S]*Provider: codex[\s\S]*Requested model: gpt-test[\s\S]*Observed models: gpt-observed[\s\S]*Runs: 3/);
  assert.match(output, /Total[\s\S]*73\.7 \+\/- 3\.8[\s\S]*70\.0[\s\S]*77\.0/);
  assert.match(output, /GDD=g1[\s\S]*Prompt=p1[\s\S]*Rubric=r1[\s\S]*Schema=s1/);
});

test('rejects an incompatible baseline before starting paid comparison samples', async () => {
  let calls = 0;
  await assert.rejects(() => runScoreComparison({
    evalCase,
    assets,
    provider: 'claude',
    runs: 3,
    baselineReader: async () => ({
      schemaVersion: 2,
      case: { id: evalCase.id, title: evalCase.title, projectId: evalCase.projectId, documentId: evalCase.documentId, epoch: 2, revision: evalCase.revision },
      provider: 'claude', requestedModel: 'sonnet', observedModels: [], hashes: assets.hashes,
    }),
    evaluator: async () => { calls += 1; throw new Error('must not run'); },
  }), /GDD.*state|epoch|revision/i);
  assert.equal(calls, 0);
});
