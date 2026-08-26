import { access, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatEvaluationScore, evaluateCase } from './evaluate-case.mjs';
import { createScoreBaseline, formatBaseline, formatComparison, runScoreComparison } from './eval-sampling.mjs';

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const fail = (message) => { throw new Error(message); };

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  return value.trim();
}

function isOutside(root, candidate) {
  const value = relative(root, candidate);
  return value.startsWith('..') || isAbsolute(value);
}

async function resolveWorkspaceFile(workspaceRoot, value, label) {
  const path = requiredText(value, label);
  if (isAbsolute(path)) fail(`${label} must stay within the workspace; absolute paths are not allowed`);
  const candidate = resolve(workspaceRoot, path);
  if (isOutside(workspaceRoot, candidate)) fail(`${label} must stay within the workspace`);
  try { await access(candidate); }
  catch { fail(`${label} points to a file that does not exist: ${path}`); }
  const actual = await realpath(candidate);
  if (isOutside(workspaceRoot, actual)) fail(`${label} must stay within the workspace`);
  return relative(workspaceRoot, actual).split('\\').join('/');
}

export async function loadKecoManifest(manifestPath, options = {}) {
  const requestedManifest = resolve(requiredText(manifestPath, '--manifest'));
  let actualManifest;
  try { actualManifest = await realpath(requestedManifest); }
  catch { fail(`Keco manifest not found: ${manifestPath}`); }
  const workspaceRoot = await realpath(resolve(options.workspaceRoot || dirname(actualManifest)));
  if (isOutside(workspaceRoot, actualManifest)) fail('Keco manifest must stay within the workspace');

  let manifest;
  try { manifest = JSON.parse(await readFile(actualManifest, 'utf8')); }
  catch (error) { fail(`Keco manifest is not valid JSON: ${error.message}`); }
  if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
  const id = requiredText(manifest.id, 'id');
  if (!SAFE_ID.test(id)) fail('id may contain only lowercase letters, digits, dots, underscores, and hyphens');
  const outputStem = requiredText(manifest.outputStem, 'outputStem');
  if (!SAFE_ID.test(outputStem)) fail('outputStem may contain only lowercase letters, digits, dots, underscores, and hyphens');
  const source = manifest.source || {};
  if (!Number.isInteger(source.epoch) || source.epoch < 0) fail('epoch must be an integer greater than or equal to 0');
  if (!Number.isInteger(source.revision) || source.revision < 0) fail('revision must be an integer greater than or equal to 0');
  const paths = manifest.paths || {};
  const evalCase = Object.freeze({
    id,
    type: 'keco',
    title: requiredText(manifest.title, 'title'),
    projectId: requiredText(source.projectId, 'source.projectId'),
    documentId: requiredText(source.documentId, 'source.documentId'),
    epoch: source.epoch,
    revision: source.revision,
    gddPath: await resolveWorkspaceFile(workspaceRoot, paths.gdd, 'paths.gdd'),
    promptPath: await resolveWorkspaceFile(workspaceRoot, paths.prompt, 'paths.prompt'),
    rubricPath: await resolveWorkspaceFile(workspaceRoot, paths.rubric, 'paths.rubric'),
    resultTemplatePath: await resolveWorkspaceFile(workspaceRoot, paths.resultTemplate, 'paths.resultTemplate'),
    outputStem,
  });
  return { manifest, manifestPath: actualManifest, workspaceRoot, evalCase };
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} is missing a value`);
  return value;
}

export function parseKecoOptions(argv = []) {
  const mode = argv[0];
  if (!['evaluate', 'baseline', 'compare'].includes(mode)) fail('Mode must be evaluate, baseline, or compare');
  const parsed = {
    mode,
    manifestPath: undefined,
    workspaceRoot: undefined,
    runRoot: undefined,
    provider: 'codex',
    model: undefined,
    runs: 3,
    force: false,
    port: 0,
  };
  const values = {
    '--manifest': 'manifestPath',
    '--workspace-root': 'workspaceRoot',
    '--run-root': 'runRoot',
    '--provider': 'provider',
    '--model': 'model',
    '--runs': 'runs',
    '--port': 'port',
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') parsed.force = true;
    else {
      const equals = argument.indexOf('=');
      const name = equals === -1 ? argument : argument.slice(0, equals);
      const field = values[name];
      if (!field) fail(`Unknown argument: ${argument}`);
      const value = equals === -1 ? takeValue(argv, index, name) : argument.slice(equals + 1);
      if (!value) fail(`${name} is missing a value`);
      parsed[field] = ['runs', 'port'].includes(field) ? Number(value) : value;
      if (equals === -1) index += 1;
    }
  }
  if (!parsed.manifestPath) fail('--manifest is missing a value');
  if (!['codex', 'claude'].includes(parsed.provider)) fail('--provider must be codex or claude');
  if (!Number.isInteger(parsed.runs) || parsed.runs < 2 || parsed.runs > 20) fail('--runs must be an integer from 2 to 20');
  if (!Number.isInteger(parsed.port) || parsed.port < 0 || parsed.port > 65535) fail('--port must be an integer from 0 to 65535');
  return parsed;
}

async function resolveRunRoot(workspaceRoot, value, caseId) {
  const candidate = resolve(workspaceRoot, value || join('.gdd-edd', caseId));
  if (candidate === workspaceRoot || isOutside(workspaceRoot, candidate)) fail('--run-root must be a dedicated directory inside the workspace');
  let existing = candidate;
  while (true) {
    try {
      const actualExisting = await realpath(existing);
      if (isOutside(workspaceRoot, actualExisting)) fail('--run-root must stay inside the workspace and cannot escape via symlink');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) fail('--run-root cannot find a verifiable workspace parent directory');
      existing = parent;
    }
  }
  await mkdir(candidate, { recursive: true });
  const actual = await realpath(candidate);
  if (actual === workspaceRoot || isOutside(workspaceRoot, actual)) fail('--run-root must stay inside the workspace and cannot escape via symlink');
  return actual;
}

export async function runKecoCli(options = {}) {
  const parsed = parseKecoOptions(options.argv || []);
  const loaded = await (options.manifestLoader || loadKecoManifest)(parsed.manifestPath, { workspaceRoot: parsed.workspaceRoot });
  const runRoot = await resolveRunRoot(loaded.workspaceRoot, parsed.runRoot, loaded.evalCase.id);
  const common = {
    evalCase: loaded.evalCase,
    provider: parsed.provider,
    model: parsed.model,
    runs: parsed.runs,
    force: parsed.force,
    cwd: loaded.workspaceRoot,
    assetOptions: { repositoryRoot: loaded.workspaceRoot },
  };
  let result;
  let output;
  if (parsed.mode === 'evaluate') {
    result = await (options.evaluate || evaluateCase)({
      ...common,
      serverOptions: {
        resultRoot: join(runRoot, 'result'),
        progressRoot: join(runRoot, 'progress'),
        problemRoot: join(runRoot, 'problem'),
        dataFile: join(runRoot, 'data', 'store.json'),
        port: parsed.port,
      },
    });
    output = formatEvaluationScore(result);
  } else {
    const sampling = { ...common, baselineRoot: join(runRoot, 'baselines') };
    result = parsed.mode === 'baseline'
      ? await (options.createBaseline || createScoreBaseline)(sampling)
      : await (options.compareBaseline || runScoreComparison)(sampling);
    output = parsed.mode === 'baseline' ? formatBaseline(result) : formatComparison(result);
  }
  (options.write || console.log)(output);
  return result;
}

async function startCli() {
  try { await runKecoCli({ argv: process.argv.slice(2) }); }
  catch (error) {
    console.error(`Keco GDD EDD evaluation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startCli();
