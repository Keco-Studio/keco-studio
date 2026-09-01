import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const md = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function redactAuditText(value) {
  return String(value ?? '')
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, 'authorization=redacted')
    .replace(/\b(token|password|secret|cookie|authorization|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=redacted')
    .replace(/([?&](?:token|key|signature|sig|auth)=)[^&\s]+/gi, '$1redacted');
}

export async function writeTextAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

export async function writeAiEvidence(progressRoot, evaluationId, rawOutput) {
  const relativePath = `evidence/${evaluationId}-ai-output.json`;
  const absolutePath = join(progressRoot, relativePath);
  const content = `${JSON.stringify(rawOutput, null, 2)}\n`;
  await writeTextAtomic(absolutePath, content);
  const readback = await readFile(absolutePath, 'utf8');
  JSON.parse(readback);
  if (readback !== content) throw new Error('AI structured output readback mismatch');
  return { path: relativePath, absolutePath, sha256: sha256(readback) };
}

export async function verifyEvaluationDocument(path, evaluationId) {
  const content = await readFile(path, 'utf8');
  if (!content.includes(evaluationId)) throw new Error(`Document readback missing evaluation ID: ${path}`);
  return { path, sha256: sha256(content) };
}

export function preserveProgressSyncBlocks(rendered, existing = '') {
  const blocks = existing.match(/<!-- EDD_PLAYER_PROGRESS_START:[^ ]+ -->[\s\S]*?<!-- EDD_PLAYER_PROGRESS_END:[^ ]+ -->/g) || [];
  return blocks.length ? `${rendered.trimEnd()}\n\n${blocks.join('\n\n')}\n` : rendered;
}

function inputRows(evalCase, assets) {
  return [
    ['GDD', evalCase.gddPath, assets.hashes?.gdd],
    ['Prompt', evalCase.promptPath, assets.hashes?.prompt],
    ['Rubric', evalCase.rubricPath, assets.hashes?.rubric],
    ['Schema', 'player-rating-web/src/ai-evaluation.schema.json', assets.hashes?.schema],
    ['Result Template', evalCase.resultTemplatePath, assets.hashes?.resultTemplate],
  ].map(([name, path, hash]) => `| ${name} | ${md(path)} | ${hash || 'not recorded'} |`).join('\n');
}

function eventRows(events) {
  return events.length
    ? events.map((event, index) => `| ${index + 1} | ${md(event.component)} | ${md(event.action)} | ${md(event.status)} | ${md(redactAuditText(event.detail || ''))} |`).join('\n')
    : '| - | Node | No execution facts yet | failed | Not started |';
}

export function renderFailureProgression(input) {
  const finishedAt = input.finishedAt || new Date().toISOString();
  const retryCommand = input.retryCommand || `npm run eval -- --case ${input.evalCase.id} --provider ${input.provider}`;
  return `# GDD EDD Execution Log

- Evaluation ID: ${input.evaluationId}
- Eval Case: ${input.evalCase.id}
- Goal: Generate human-reviewable evaluation documents from the selected GDD and rubric
- Provider: ${input.provider}
- Requested model: ${input.requestedModel || 'local-default'}
- Observed model: ${input.observedModel || 'Execution failed; not obtained'}
- Started at: ${input.startedAt}
- Finished at: ${finishedAt}
- Status: failed
- Exit code: ${input.exitCode ?? 'not obtained'}
- Schema validation: not completed

## Fixed Inputs

| Asset | Path | SHA-256 |
| --- | --- | --- |
${inputRows(input.evalCase, input.assets)}

## Execution Facts

| # | Component | Action | Status | Result Summary |
| --- | --- | --- | --- | --- |
${eventRows(input.events || [])}

## Applied Prompt

<details>
<summary>View applied prompt</summary>

\`\`\`text
${redactAuditText(input.prompt || 'Prompt not generated yet')}
\`\`\`

</details>

## Errors and Recovery

- Failed step: ${input.failedStep || 'AI evaluation'}
- Error summary: ${redactAuditText(input.error?.message || input.error || 'Unknown error')}
- Completed outputs: ${input.completedOutputs?.length ? input.completedOutputs.join('; ') : 'None'}
- Incomplete items: ${input.incompleteOutputs?.length ? input.incompleteOutputs.join('; ') : 'Problem, Result, and human rating session'}
- Retry command: ${retryCommand}
`;
}

export async function writeFailureProgression(path, input) {
  const content = renderFailureProgression(input);
  await writeTextAtomic(path, content);
  return content;
}
