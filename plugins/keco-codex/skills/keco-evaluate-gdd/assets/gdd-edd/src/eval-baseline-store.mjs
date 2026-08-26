import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const safePart = (value, label) => {
  const input = String(value || '');
  if (label === 'Model' && input === 'local-default') return 'local-default';
  if (!input || input.includes('..') || input.includes('/') && label === 'Case') throw new Error(`${label} identifier invalid`);
  const normalized = input.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error(`${label} identifier invalid`);
  return normalized;
};

export function baselinePath(root, caseId, provider, requestedModel) {
  const safeCase = safePart(caseId, 'Case');
  const file = `${safePart(provider, 'Provider')}-${safePart(requestedModel, 'Model')}.json`;
  return join(root, safeCase, file);
}

export async function readBaseline(path) {
  let content;
  try { content = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Baseline not found: ${path}`);
    throw error;
  }
  try { return JSON.parse(content); }
  catch { throw new Error(`Baseline JSON invalid: ${path}`); }
}

export async function writeBaseline(path, baseline, options = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (!options.force) {
    try { await access(path); throw new Error(`Baseline already exists: ${path}; use --force to overwrite`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const content = `${JSON.stringify(baseline, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
  const readback = await readBaseline(path);
  if (JSON.stringify(readback) !== JSON.stringify(baseline)) throw new Error('Baseline readback mismatch');
  return readback;
}

export function compareConfiguration(baseline, current) {
  if (baseline.schemaVersion !== current.schemaVersion) throw new Error('Baseline schema version incompatible');
  if (baseline.case?.id !== current.case?.id) throw new Error('Eval Case incompatible');
  if (baseline.case?.projectId !== current.case?.projectId) throw new Error('Keco projectId incompatible');
  if (baseline.case?.documentId !== current.case?.documentId) throw new Error('Keco documentId incompatible');
  if (baseline.case?.epoch !== current.case?.epoch || baseline.case?.revision !== current.case?.revision) throw new Error('GDD state (epoch/revision) changed; create a separate baseline');
  if (baseline.provider !== current.provider) throw new Error('Provider incompatible');
  if (baseline.requestedModel !== current.requestedModel) throw new Error('Requested model incompatible');
  if (baseline.hashes?.gdd !== current.hashes?.gdd) throw new Error('GDD changed; create a separate baseline');
  const labels = { prompt: 'Prompt hash', rubric: 'Rubric hash', schema: 'Schema hash', resultTemplate: 'Result Template hash' };
  const changes = Object.entries(labels)
    .filter(([key]) => baseline.hashes?.[key] !== current.hashes?.[key])
    .map(([, label]) => label);
  if (JSON.stringify(baseline.observedModels || []) !== JSON.stringify(current.observedModels || [])) changes.push('Observed model');
  return changes;
}
