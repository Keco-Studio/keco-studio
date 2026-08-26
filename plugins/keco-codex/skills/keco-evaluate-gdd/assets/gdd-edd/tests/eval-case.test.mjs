import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CASE_ID, listEvalCaseIds, loadEvalCase } from '../src/eval-case.mjs';

const baseManifest = {
  id: 'paws-patience-r97',
  type: 'gold',
  title: 'Paws & Patience',
  gddPath: 'docs/gdd.md',
  projectId: 'project-id',
  documentId: 'document-id',
  revision: 97,
  promptPath: 'docs/prompt.md',
  rubricPath: 'docs/rubric.md',
  resultTemplatePath: 'docs/template.md',
  outputStem: 'paws-patience-gdd-r97',
};

async function fixture(manifest = baseManifest, options = {}) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'edd-cases-'));
  const casesRoot = join(repositoryRoot, 'eval-cases');
  await mkdir(join(repositoryRoot, 'docs'), { recursive: true });
  await mkdir(casesRoot, { recursive: true });
  if (options.gdd !== false) await writeFile(join(repositoryRoot, 'docs', 'gdd.md'), '# GDD\n');
  if (options.prompt !== false) await writeFile(join(repositoryRoot, 'docs', 'prompt.md'), '# Prompt\n');
  if (options.rubric !== false) await writeFile(join(repositoryRoot, 'docs', 'rubric.md'), '# Rubric\n');
  if (options.template !== false) await writeFile(join(repositoryRoot, 'docs', 'template.md'), '# Template\n');
  const fileId = options.fileId || manifest.id || 'invalid';
  const content = options.raw ?? JSON.stringify(manifest);
  await writeFile(join(casesRoot, `${fileId}.json`), content);
  return { repositoryRoot, casesRoot };
}

test('lists case ids in stable order', async () => {
  const roots = await fixture();
  await writeFile(join(roots.casesRoot, 'another-case.json'), JSON.stringify({ ...baseManifest, id: 'another-case' }));
  await writeFile(join(roots.casesRoot, 'notes.txt'), 'ignored');
  assert.deepEqual(await listEvalCaseIds(roots), ['another-case', 'paws-patience-r97']);
});

test('loads the default and explicit case as frozen normalized data', async () => {
  const roots = await fixture();
  assert.equal(DEFAULT_CASE_ID, 'paws-patience-r97');
  const byDefault = await loadEvalCase(undefined, roots);
  const explicit = await loadEvalCase('paws-patience-r97', roots);
  assert.deepEqual(byDefault, explicit);
  assert.equal(explicit.revision, 97);
  assert.equal(explicit.gddPath, 'docs/gdd.md');
  assert.ok(Object.isFrozen(explicit));
});

test('reports unknown cases with available ids', async () => {
  const roots = await fixture();
  await assert.rejects(loadEvalCase('missing-case', roots), /Unknown Eval Case.*paws-patience-r97/);
});

test('rejects malformed manifests with the file and field context', async () => {
  const invalidJson = await fixture(baseManifest, { raw: '{' });
  await assert.rejects(loadEvalCase(baseManifest.id, invalidJson), /paws-patience-r97\.json.*JSON/);

  const mismatch = await fixture({ ...baseManifest, id: 'other-case' }, { fileId: baseManifest.id });
  await assert.rejects(loadEvalCase(baseManifest.id, mismatch), /id.*filename/i);

  const badRevision = await fixture({ ...baseManifest, revision: 0 });
  await assert.rejects(loadEvalCase(baseManifest.id, badRevision), /revision/);

  const badType = await fixture({ ...baseManifest, type: 'standard' });
  await assert.rejects(loadEvalCase(baseManifest.id, badType), /type.*gold/);
});

test('rejects paths outside the repository and missing input files', async () => {
  const traversal = await fixture({ ...baseManifest, gddPath: '../outside.md' });
  await assert.rejects(loadEvalCase(baseManifest.id, traversal), /gddPath.*repository/i);

  const absolute = await fixture({ ...baseManifest, resultTemplatePath: '/tmp/template.md' });
  await assert.rejects(loadEvalCase(baseManifest.id, absolute), /resultTemplatePath.*repository/i);

  const missingGdd = await fixture(baseManifest, { gdd: false });
  await assert.rejects(loadEvalCase(baseManifest.id, missingGdd), /gddPath.*does not exist/i);

  const missingPrompt = await fixture(baseManifest, { prompt: false });
  await assert.rejects(loadEvalCase(baseManifest.id, missingPrompt), /promptPath.*does not exist/i);

  const missingRubric = await fixture(baseManifest, { rubric: false });
  await assert.rejects(loadEvalCase(baseManifest.id, missingRubric), /rubricPath.*does not exist/i);

  const missingTemplate = await fixture(baseManifest, { template: false });
  await assert.rejects(loadEvalCase(baseManifest.id, missingTemplate), /resultTemplatePath.*does not exist/i);
});
