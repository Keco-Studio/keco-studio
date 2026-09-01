import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, mkdir, symlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishRun } from '../src/git-publisher.mjs';

const exec = promisify(execFile);

async function git(cwd, ...args) {
  return exec('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

async function remoteFixture() {
  const root = await mkdtemp(join(tmpdir(), 'gdd-edd-git-'));
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const run = join(root, 'run');
  await exec('git', ['init', '--bare', remote]);
  await exec('git', ['init', '-b', 'main', seed]);
  await git(seed, 'config', 'user.email', 'test@example.invalid');
  await git(seed, 'config', 'user.name', 'EDD Test');
  await writeFile(join(seed, 'README.md'), '# EDD\n');
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '-m', 'seed');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  await mkdir(join(run, 'result'), { recursive: true });
  await writeFile(join(run, 'result', 'result.md'), '# Result\n');
  return { root, remote, run };
}

test('publishes a run into edd-repo and pushes a commit by default', async () => {
  const { root, remote, run } = await remoteFixture();
  const published = await publishRun({
    sourceRoot: run,
    repository: remote,
    branch: 'main',
    runsPath: 'docs/gdd-edd/runs',
    evaluationId: 'sample-r1',
  });

  assert.equal(published.pushed, true);
  assert.match(published.commit, /^[0-9a-f]{40}$/);
  const clone = join(root, 'clone');
  await exec('git', ['clone', '--branch', 'main', remote, clone]);
  assert.equal(await readFile(join(clone, 'docs/gdd-edd/runs/sample-r1/result/result.md'), 'utf8'), '# Result\n');
});

test('supports a local dry run without creating a commit or push', async () => {
  const { root, remote, run } = await remoteFixture();
  const published = await publishRun({
    sourceRoot: run,
    repository: remote,
    branch: 'main',
    runsPath: 'docs/gdd-edd/runs',
    evaluationId: 'sample-dry',
    push: false,
  });

  assert.equal(published.pushed, false);
  assert.equal(published.committed, false);
  assert.equal(await readFile(join(published.checkoutPath, 'docs/gdd-edd/runs/sample-dry/result/result.md'), 'utf8'), '# Result\n');
});

test('rejects an evaluation id that would escape the runs directory', async () => {
  const { remote, run } = await remoteFixture();
  await assert.rejects(
    publishRun({ sourceRoot: run, repository: remote, evaluationId: '../escape' }),
    /evaluationId/i,
  );
});

test('rejects a runs path that resolves through a repository symlink', async () => {
  const { root, remote, run } = await remoteFixture();
  const checkout = join(root, 'checkout');
  await exec('git', ['clone', '--branch', 'main', remote, checkout]);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(checkout, 'docs'));
  await assert.rejects(
    publishRun({ sourceRoot: run, repository: remote, checkoutPath: checkout, evaluationId: 'sample-link' }),
    /outside|symlink|runsPath|uncommitted/i,
  );
});
