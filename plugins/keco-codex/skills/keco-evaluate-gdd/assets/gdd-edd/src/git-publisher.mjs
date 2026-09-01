import { execFile } from 'node:child_process';
import { access, cp, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DEFAULT_REPOSITORY = 'git@github.com:Keco-Studio/edd-repo.git';
const DEFAULT_BRANCH = 'main';
const DEFAULT_RUNS_PATH = 'docs/gdd-edd/runs';
const EXCLUDED_NAMES = new Set(['.git', 'node_modules', 'data']);

function fail(message) {
  throw new Error(message);
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  return value.trim();
}

function safeRelativePath(value, label) {
  const path = text(value, label).replaceAll('\\', '/');
  if (isAbsolute(path) || path === '.' || path.split('/').includes('..')) fail(`${label} must be a relative path inside the repository`);
  return path;
}

async function runGit(cwd, args) {
  try {
    return await exec('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function copyRun(sourceRoot, destinationRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name) || entry.name.endsWith('.tmp')) continue;
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  }
}

async function ensureCleanCheckout(checkoutPath, branch) {
  const status = await runGit(checkoutPath, ['status', '--porcelain']);
  if (status.stdout.trim()) fail('output repository checkout has uncommitted changes; refusing to overwrite them');
  await runGit(checkoutPath, ['fetch', 'origin', branch]);
  const head = (await runGit(checkoutPath, ['rev-parse', 'HEAD'])).stdout.trim();
  const remoteHead = (await runGit(checkoutPath, ['rev-parse', `origin/${branch}`])).stdout.trim();
  if (head !== remoteHead) {
    const counts = (await runGit(checkoutPath, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`])).stdout.trim().split(/\s+/).map(Number);
    if (counts[0] > 0) fail('output repository checkout is ahead of the remote; refusing to overwrite local commits');
    await runGit(checkoutPath, ['merge', '--ff-only', `origin/${branch}`]);
  }
}

async function prepareCheckout(repository, branch, checkoutPath) {
  if (checkoutPath) {
    const path = resolve(text(checkoutPath, 'checkoutPath'));
    if (!(await exists(join(path, '.git')))) fail('checkoutPath must point to a Git checkout');
    await ensureCleanCheckout(path, branch);
    return path;
  }
  const path = await (async () => {
    const prefix = join(tmpdir(), 'keco-gdd-edd-repo-');
    const { stdout } = await exec('mktemp', ['-d', `${prefix}XXXXXX`], { encoding: 'utf8' });
    return stdout.trim();
  })();
  await runGit(dirname(path), ['clone', '--branch', branch, '--single-branch', repository, path]);
  return path;
}

async function verifyDestinationParent(checkout, destination) {
  const root = await realpath(checkout);
  let current = dirname(destination);
  while (true) {
    try {
      const actual = await realpath(current);
      if (actual !== root && !actual.startsWith(`${root}${sep}`)) fail('runsPath resolves outside the output repository');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) fail('runsPath parent cannot be verified');
      current = parent;
    }
  }
}

/** Publish one completed evaluation run to the independent EDD repository. */
export async function publishRun({
  sourceRoot,
  repository = DEFAULT_REPOSITORY,
  branch = DEFAULT_BRANCH,
  runsPath = DEFAULT_RUNS_PATH,
  evaluationId,
  push = true,
  checkoutPath,
} = {}) {
  const source = resolve(text(sourceRoot, 'sourceRoot'));
  if (!(await exists(source)) || !(await lstat(source)).isDirectory()) fail('sourceRoot must be an existing directory');
  const id = text(evaluationId, 'evaluationId');
  if (!SAFE_ID.test(id)) fail('evaluationId may contain only lowercase letters, digits, dots, underscores, and hyphens');
  const targetPath = safeRelativePath(runsPath, 'runsPath');
  const targetBranch = text(branch, 'branch');
  const remote = text(repository, 'repository');
  const checkout = await prepareCheckout(remote, targetBranch, checkoutPath);
  const destination = resolve(checkout, targetPath, id);
  if (!destination.startsWith(`${resolve(checkout)}${sep}`)) fail('evaluationId escaped the runs directory');
  await verifyDestinationParent(checkout, destination);
  if (await exists(destination)) fail(`evaluation run already exists: ${id}`);
  await mkdir(destination, { recursive: true });
  await copyRun(source, destination);
  await runGit(checkout, ['add', '--', relative(checkout, destination)]);
  const staged = await runGit(checkout, ['diff', '--cached', '--quiet']).then(() => false).catch(() => true);
  if (!staged) fail('evaluation run produced no files to publish');
  await runGit(checkout, ['config', 'user.email', 'edd-bot@users.noreply.github.com']);
  await runGit(checkout, ['config', 'user.name', 'Keco EDD Bot']);
  if (!push) return { checkoutPath: checkout, destination, committed: false, pushed: false, commit: null };
  await runGit(checkout, ['commit', '-m', `edd: record ${id}`]);
  const commit = (await runGit(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(checkout, ['push', 'origin', targetBranch]);
  return { checkoutPath: checkout, destination, committed: true, pushed: true, commit };
}

export const DEFAULT_OUTPUT_REPOSITORY = DEFAULT_REPOSITORY;
export const DEFAULT_OUTPUT_BRANCH = DEFAULT_BRANCH;
export const DEFAULT_OUTPUT_RUNS_PATH = DEFAULT_RUNS_PATH;
