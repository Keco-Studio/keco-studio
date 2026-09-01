import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadKecoManifest, parseKecoOptions, runKecoCli } from '../src/keco-cli.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'keco-edd-case-'));
  await mkdir(join(root, 'inputs'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'inputs', 'gdd.md'), '# GDD\n'),
    writeFile(join(root, 'inputs', 'prompt.md'), 'Evaluate {{title}} {{gddPath}} {{rubricPath}}'),
    writeFile(join(root, 'inputs', 'rubric.md'), '# Rubric\n'),
    writeFile(join(root, 'inputs', 'result.md'), '# Result {{evaluationId}}\n'),
  ]);
  const manifest = {
    schemaVersion: 1,
    id: 'sample-r0-e2',
    title: 'Sample',
    source: { projectId: 'project-id', documentId: 'document-id', epoch: 2, revision: 0 },
    paths: {
      gdd: 'inputs/gdd.md', prompt: 'inputs/prompt.md', rubric: 'inputs/rubric.md', resultTemplate: 'inputs/result.md',
    },
    outputStem: 'sample-r0-e2',
  };
  const manifestPath = join(root, 'case.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath, manifest };
}

test('loads one generic Keco case with epoch/revision identity and bounded files', async () => {
  const { root, manifestPath } = await fixture();
  const loaded = await loadKecoManifest(manifestPath, { workspaceRoot: root });
  assert.deepEqual(loaded.evalCase, {
    id: 'sample-r0-e2', type: 'keco', title: 'Sample',
    projectId: 'project-id', documentId: 'document-id', epoch: 2, revision: 0,
    gddPath: 'inputs/gdd.md', promptPath: 'inputs/prompt.md', rubricPath: 'inputs/rubric.md',
    resultTemplatePath: 'inputs/result.md', outputStem: 'sample-r0-e2',
  });
  assert.equal(loaded.workspaceRoot, root);
});

test('rejects escaped inputs and invalid state tokens', async () => {
  const { root, manifestPath, manifest } = await fixture();
  await writeFile(manifestPath, JSON.stringify({ ...manifest, paths: { ...manifest.paths, gdd: '../outside.md' } }));
  await assert.rejects(loadKecoManifest(manifestPath, { workspaceRoot: root }), /workspace/i);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, source: { ...manifest.source, revision: -1 } }));
  await assert.rejects(loadKecoManifest(manifestPath, { workspaceRoot: root }), /revision/i);
});

test('rejects input symlinks that resolve outside the workspace', async () => {
  const { root, manifestPath, manifest } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'keco-edd-outside-'));
  await writeFile(join(outside, 'gdd.md'), '# Outside\n');
  await symlink(join(outside, 'gdd.md'), join(root, 'inputs', 'linked-gdd.md'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, paths: { ...manifest.paths, gdd: 'inputs/linked-gdd.md' } }));
  await assert.rejects(loadKecoManifest(manifestPath, { workspaceRoot: root }), /workspace/i);
});

test('rejects run roots that escape the workspace directly or through a symlink', async () => {
  const { root, manifestPath } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'keco-edd-run-outside-'));
  await assert.rejects(runKecoCli({ argv: ['baseline', '--manifest', manifestPath, '--workspace-root', root, '--run-root', outside, '--runs=2'], createBaseline: async () => {}, write: () => {} }), /run-root.*workspace|workspace.*run-root/i);
  await symlink(outside, join(root, 'linked-runs'));
  await assert.rejects(runKecoCli({ argv: ['baseline', '--manifest', manifestPath, '--workspace-root', root, '--run-root', 'linked-runs', '--runs=2'], createBaseline: async () => {}, write: () => {} }), /run-root.*workspace|workspace.*run-root/i);
  await assert.rejects(runKecoCli({ argv: ['baseline', '--manifest', manifestPath, '--workspace-root', root, '--run-root', 'linked-runs/new/deep', '--runs=2'], createBaseline: async () => {}, write: () => {} }), /run-root.*workspace|workspace.*run-root/i);
  await assert.rejects(access(join(outside, 'new')), /ENOENT/);
});

test('parses evaluate, baseline, and compare without implicit pass/fail gates', () => {
  assert.deepEqual(parseKecoOptions(['evaluate', '--manifest', 'case.json']), {
    mode: 'evaluate', manifestPath: 'case.json', workspaceRoot: undefined, runRoot: undefined,
    provider: 'codex', model: undefined, runs: 3, force: false, port: 0,
    outputRepository: 'git@github.com:Keco-Studio/edd-repo.git', outputBranch: 'main',
    outputRunsPath: 'docs/gdd-edd/runs', outputCheckout: undefined, autoPush: true,
  });
  assert.deepEqual(parseKecoOptions(['baseline', '--manifest=case.json', '--provider', 'claude', '--model=sonnet', '--runs=5', '--force']), {
    mode: 'baseline', manifestPath: 'case.json', workspaceRoot: undefined, runRoot: undefined,
    provider: 'claude', model: 'sonnet', runs: 5, force: true, port: 0,
    outputRepository: 'git@github.com:Keco-Studio/edd-repo.git', outputBranch: 'main',
    outputRunsPath: 'docs/gdd-edd/runs', outputCheckout: undefined, autoPush: true,
  });
  assert.deepEqual(parseKecoOptions(['evaluate', '--manifest=case.json', '--no-push', '--output-repo', 'repo', '--output-branch=develop', '--output-runs-path', 'runs', '--output-checkout', '/tmp/checkout']).autoPush, false);
  assert.equal(parseKecoOptions(['compare', '--manifest=case.json']).mode, 'compare');
  assert.throws(() => parseKecoOptions(['baseline', '--manifest=case.json', '--runs=1']), /2 to 20/);
  assert.throws(() => parseKecoOptions(['gate', '--manifest=case.json']), /evaluate.*baseline.*compare/i);
});

test('routes Keco evaluate, baseline, and compare through the generic manifest', async () => {
  const { root, manifestPath } = await fixture();
  const runRoot = join(root, 'runs');
  const calls = [];
  const dependencies = {
    evaluate: async (options) => { calls.push(['evaluate', options]); return { evaluation: { aiExperienceValueScore: 20, aiGameplaySystemsScore: 30, aiContentPresentationScore: 20, aiTotalScore: 70 }, playerUrl: 'http://127.0.0.1:1234/?session=x' }; },
    createBaseline: async (options) => { calls.push(['baseline', options]); return { path: join(runRoot, 'baselines', 'base.json'), baseline: { case: { id: 'sample-r0-e2', projectId: 'project-id', documentId: 'document-id', epoch: 2, revision: 0 }, provider: 'codex', requestedModel: 'local', observedModels: [], hashes: { gdd: 'g', prompt: 'p', rubric: 'r', schema: 's', resultTemplate: 't' }, samples: [{}, {}], aggregates: { experienceValue: { mean: 20, stddev: 0, min: 20, max: 20 }, gameplaySystems: { mean: 30, stddev: 0, min: 30, max: 30 }, contentPresentation: { mean: 20, stddev: 0, min: 20, max: 20 }, total: { mean: 70, stddev: 0, min: 70, max: 70 } } } }; },
    compareBaseline: async (options) => { calls.push(['compare', options]); return { baseline: { aggregates: { experienceValue: { mean: 20, stddev: 0 }, gameplaySystems: { mean: 30, stddev: 0 }, contentPresentation: { mean: 20, stddev: 0 }, total: { mean: 70, stddev: 0 } } }, current: { case: { id: 'sample-r0-e2', projectId: 'project-id', documentId: 'document-id', epoch: 2, revision: 0 }, provider: 'codex', requestedModel: 'local', observedModels: [], samples: [{}, {}], aggregates: { experienceValue: { mean: 21, stddev: 0 }, gameplaySystems: { mean: 30, stddev: 0 }, contentPresentation: { mean: 20, stddev: 0 }, total: { mean: 71, stddev: 0 } } }, differences: { experienceValue: 1, gameplaySystems: 0, contentPresentation: 0, total: 1 }, changes: [] }; },
    write: () => {},
    publish: false,
  };

  await runKecoCli({ argv: ['evaluate', '--manifest', manifestPath, '--workspace-root', root, '--run-root', runRoot], ...dependencies });
  await runKecoCli({ argv: ['baseline', '--manifest', manifestPath, '--workspace-root', root, '--run-root', runRoot, '--runs=2'], ...dependencies });
  await runKecoCli({ argv: ['compare', '--manifest', manifestPath, '--workspace-root', root, '--run-root', runRoot, '--runs=2'], ...dependencies });

  assert.deepEqual(calls.map(([mode]) => mode), ['evaluate', 'baseline', 'compare']);
  for (const [, options] of calls) {
    assert.equal(options.evalCase.epoch, 2);
    assert.equal(options.evalCase.revision, 0);
    assert.equal(options.cwd, root);
  }
  assert.equal(calls[0][1].serverOptions.resultRoot, join(runRoot, 'result'));
  assert.equal(calls[1][1].baselineRoot, join(runRoot, 'baselines'));
});

test('publishes the run to the configured independent repository by default', async () => {
  const { root, manifestPath } = await fixture();
  const calls = [];
  await runKecoCli({
    argv: ['baseline', '--manifest', manifestPath, '--workspace-root', root, '--run-root', join(root, 'runs'), '--runs=2', '--output-repo', 'git@example.invalid:edd-repo.git'],
    createBaseline: async () => ({ path: join(root, 'runs', 'baselines', 'baseline.json'), baseline: {
      case: { id: 'sample-r0-e2', projectId: 'project-id', documentId: 'document-id', epoch: 2, revision: 0 },
      provider: 'codex', requestedModel: 'local-default', observedModels: [],
      hashes: { gdd: 'g', prompt: 'p', rubric: 'r', schema: 's', resultTemplate: 't' },
      samples: [{}, {}], aggregates: {
        experienceValue: { mean: 20, stddev: 0, min: 20, max: 20 },
        gameplaySystems: { mean: 30, stddev: 0, min: 30, max: 30 },
        contentPresentation: { mean: 20, stddev: 0, min: 20, max: 20 },
        total: { mean: 70, stddev: 0, min: 70, max: 70 },
      },
    } }),
    publisher: async (input) => { calls.push(input); return { committed: true, pushed: true, commit: 'abc' }; },
    write: () => {},
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repository, 'git@example.invalid:edd-repo.git');
  assert.equal(calls[0].push, true);
  assert.match(calls[0].evaluationId, /^sample-r0-e2-baseline-/);
  const savedManifest = await readFile(join(root, 'runs', 'manifest.json'), 'utf8');
  assert.match(savedManifest, /"mode": "baseline"/);
  assert.match(savedManifest, /"repository": "git@example.invalid:edd-repo\.git"/);
});
