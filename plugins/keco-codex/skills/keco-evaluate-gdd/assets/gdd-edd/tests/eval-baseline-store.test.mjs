import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselinePath, compareConfiguration, readBaseline, writeBaseline } from '../src/eval-baseline-store.mjs';

const baseline = {
  schemaVersion: 2,
  case: { id: 'paws-patience-r97', projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97 },
  provider: 'claude',
  requestedModel: 'sonnet/latest',
  hashes: { gdd: 'g1', prompt: 'p1', rubric: 'r1', schema: 's1', resultTemplate: 't1' },
  observedModels: ['claude-opus-4-8'],
  samples: [],
  aggregates: {},
};

test('builds a safe deterministic baseline path', () => {
  assert.equal(
    baselinePath('/repo/baselines', 'paws-patience-r97', 'claude', 'sonnet/latest'),
    join('/repo/baselines', 'paws-patience-r97', 'claude-sonnet-latest.json'),
  );
  assert.equal(
    baselinePath('/repo/baselines', 'paws-patience-r97', 'codex', 'local-default'),
    join('/repo/baselines', 'paws-patience-r97', 'codex-local-default.json'),
  );
  assert.throws(() => baselinePath('/repo/baselines', '../outside', 'claude', 'sonnet'), /identifier/i);
});

test('writes atomically, reads back, and refuses overwrite without force', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-baseline-'));
  const path = baselinePath(root, baseline.case.id, baseline.provider, baseline.requestedModel);
  await writeBaseline(path, baseline);
  assert.deepEqual(await readBaseline(path), baseline);
  assert.match(await readFile(path, 'utf8'), /"schemaVersion": 2/);
  await assert.rejects(() => writeBaseline(path, baseline), /already exists/i);
  await writeBaseline(path, { ...baseline, createdAt: 'new' }, { force: true });
  assert.equal((await readBaseline(path)).createdAt, 'new');
});

test('requires identity and GDD compatibility while reporting other changes', () => {
  const current = {
    schemaVersion: 2,
    case: { id: 'paws-patience-r97', projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97 },
    provider: 'claude', requestedModel: 'sonnet/latest',
    hashes: { gdd: 'g1', prompt: 'p2', rubric: 'r1', schema: 's1', resultTemplate: 't1' },
    observedModels: ['claude-sonnet-5'],
  };
  assert.deepEqual(compareConfiguration(baseline, current), ['Prompt hash', 'Observed model']);
  assert.throws(() => compareConfiguration(baseline, { ...current, case: { ...current.case, projectId: 'other-project' } }), /Keco.*project|projectId/i);
  assert.throws(() => compareConfiguration(baseline, { ...current, case: { ...current.case, documentId: 'other-document' } }), /Keco.*document|documentId/i);
  assert.throws(() => compareConfiguration(baseline, { ...current, hashes: { ...current.hashes, gdd: 'g2' } }), /GDD/);
  assert.throws(() => compareConfiguration(baseline, { ...current, case: { ...current.case, epoch: 2 } }), /GDD.*state|epoch/i);
  assert.throws(() => compareConfiguration(baseline, { ...current, case: { ...current.case, revision: 98 } }), /GDD.*state|revision/i);
  assert.throws(() => compareConfiguration(baseline, { ...current, requestedModel: 'opus' }), /Requested model/i);
});
