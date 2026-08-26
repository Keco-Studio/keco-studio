import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CASE_ID = 'paws-patience-r97';
export const DEFAULT_CASES_ROOT = fileURLToPath(new URL('../../eval-cases/', import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fail = (message) => { throw new Error(message); };

function roots(options = {}) {
  return {
    casesRoot: options.casesRoot || DEFAULT_CASES_ROOT,
    repositoryRoot: options.repositoryRoot || DEFAULT_REPOSITORY_ROOT,
  };
}

export async function listEvalCaseIds(options = {}) {
  const { casesRoot } = roots(options);
  const entries = await readdir(casesRoot).catch((error) => {
    if (error.code === 'ENOENT') fail(`Eval Case directory not found: ${casesRoot}`);
    throw error;
  });
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .sort();
}

function requiredText(manifest, field) {
  const value = manifest[field];
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

async function validateRepositoryFile(repositoryRoot, manifest, field) {
  const path = requiredText(manifest, field);
  if (isAbsolute(path)) fail(`${field} must stay inside the repository; absolute paths are not allowed`);
  const repositoryPath = await realpath(repositoryRoot);
  const candidate = resolve(repositoryPath, path);
  const lexicalRelative = relative(repositoryPath, candidate);
  if (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) fail(`${field} must stay inside the repository`);
  try { await access(candidate); }
  catch { fail(`${field} points to a file that does not exist: ${path}`); }
  const actual = await realpath(candidate);
  const actualRelative = relative(repositoryPath, actual);
  if (actualRelative.startsWith('..') || isAbsolute(actualRelative)) fail(`${field} must stay inside the repository`);
  return path;
}

export async function loadEvalCase(id = DEFAULT_CASE_ID, options = {}) {
  const selectedId = id || DEFAULT_CASE_ID;
  if (!SAFE_ID.test(selectedId)) fail(`Eval Case ID invalid: ${selectedId}`);
  const resolvedRoots = roots(options);
  const ids = await listEvalCaseIds(resolvedRoots);
  if (!ids.includes(selectedId)) fail(`Unknown Eval Case: ${selectedId}; available cases: ${ids.join(', ') || 'none'}`);
  const manifestPath = resolve(resolvedRoots.casesRoot, `${selectedId}.json`);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { fail(`${selectedId}.json is not valid JSON: ${error.message}`); }

  const manifestId = requiredText(manifest, 'id');
  if (manifestId !== selectedId) fail(`id must match filename: ${selectedId}`);
  if (!SAFE_ID.test(manifestId)) fail('id may contain only lowercase letters, digits, and hyphens');
  if (manifest.type !== 'gold') fail('type must currently be gold');
  const outputStem = requiredText(manifest, 'outputStem');
  if (!SAFE_ID.test(outputStem)) fail('outputStem may contain only lowercase letters, digits, and hyphens');
  if (!Number.isInteger(manifest.revision) || manifest.revision <= 0) fail('revision must be a positive integer');

  const evalCase = {
    id: manifestId,
    type: manifest.type,
    title: requiredText(manifest, 'title'),
    gddPath: await validateRepositoryFile(resolvedRoots.repositoryRoot, manifest, 'gddPath'),
    projectId: requiredText(manifest, 'projectId'),
    documentId: requiredText(manifest, 'documentId'),
    revision: manifest.revision,
    promptPath: await validateRepositoryFile(resolvedRoots.repositoryRoot, manifest, 'promptPath'),
    rubricPath: await validateRepositoryFile(resolvedRoots.repositoryRoot, manifest, 'rubricPath'),
    resultTemplatePath: await validateRepositoryFile(resolvedRoots.repositoryRoot, manifest, 'resultTemplatePath'),
    outputStem,
  };
  return Object.freeze(evalCase);
}
