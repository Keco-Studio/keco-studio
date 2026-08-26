import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactAuditText } from './progress-audit.mjs';

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('./ai-evaluation.schema.json', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const md = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export async function loadEvaluationAssets(evalCase, options = {}) {
  const repositoryRoot = options.repositoryRoot || DEFAULT_REPOSITORY_ROOT;
  const schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;
  const paths = {
    gdd: resolve(repositoryRoot, evalCase.gddPath),
    prompt: resolve(repositoryRoot, evalCase.promptPath),
    rubric: resolve(repositoryRoot, evalCase.rubricPath),
    resultTemplate: resolve(repositoryRoot, evalCase.resultTemplatePath),
    schema: schemaPath,
  };
  const [gdd, promptTemplate, rubric, resultTemplate, schema] = await Promise.all(Object.values(paths).map((path) => readFile(path, 'utf8')));
  return {
    promptTemplate,
    resultTemplate,
    hashes: { gdd: sha256(gdd), prompt: sha256(promptTemplate), rubric: sha256(rubric), resultTemplate: sha256(resultTemplate), schema: sha256(schema) },
  };
}

function observations(items) {
  return items.map((item) => `- ${item.statement} (evidence: ${item.evidence})`).join('\n');
}

function gaps(items) { return items.length ? items.join('; ') : 'None'; }

function applyTemplate(template, values) {
  const rendered = String(template).replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`Result template contains unknown placeholder: ${key}`);
    return String(values[key]);
  });
  if (/\{\{[^}]+\}\}/.test(rendered)) throw new Error('Result template still has unreplaced placeholders');
  return rendered.trimEnd() + '\n';
}

function renderProgression({ evalCase, execution, evaluationId, documents, assets, audit = {} }) {
  const hashRows = [
    ['GDD', evalCase.gddPath, assets.hashes.gdd],
    ['Prompt', evalCase.promptPath, assets.hashes.prompt],
    ['Rubric', evalCase.rubricPath, assets.hashes.rubric],
    ['Schema', 'player-rating-web/src/ai-evaluation.schema.json', assets.hashes.schema],
    ['Result Template', evalCase.resultTemplatePath, assets.hashes.resultTemplate],
  ].map(([name, path, hash]) => `| ${name} | ${md(path)} | ${hash || 'not recorded'} |`).join('\n');
  const eventRows = audit.events?.length
    ? audit.events.map((event, index) => `| ${index + 1} | ${md(event.component)} | ${md(event.action)} | ${md(event.status)} | ${md(redactAuditText(event.detail || ''))} |`).join('\n')
    : '| - | Node | No execution facts yet | pending | Awaiting execution |';
  const evidence = audit.evidence || {};
  return `# GDD EDD Execution Log

- Evaluation ID: ${evaluationId}
- Eval Case: ${evalCase.id}
- Goal: ${audit.goal || 'Generate human-reviewable evaluation documents from a fixed GDD and rubric'}
- Provider: ${execution.provider}
- Requested model: ${execution.requestedModel}
- Observed model: ${execution.observedModel || 'Not provided by CLI events'}
- Started at: ${execution.startedAt}
- Finished at: ${execution.finishedAt}
- Duration: ${execution.durationMs} ms
- Status: ${execution.status}
- Exit code: ${execution.exitCode}
- Schema validation: passed

## Fixed Inputs

| Asset | Path | SHA-256 |
| --- | --- | --- |
${hashRows}

## Execution Facts

Recorded in observable Node and Provider order.

| # | Component | Action | Status | Result Summary |
| --- | --- | --- | --- | --- |
${eventRows}

## Applied Prompt

<details>
<summary>View full prompt</summary>

\`\`\`text
${redactAuditText(execution.prompt)}
\`\`\`

</details>

## Audit Evidence and Artifacts

- AI structured output: ${evidence.path || 'Not written yet'}
- AI output SHA-256: ${evidence.sha256 || 'Not generated yet'}
- Progression: ${documents.progress}
- Problem: ../problem/${documents.problem}
- Result: ../result/${documents.result}
- Next human action: ${audit.nextAction || 'Review Result and share the human rating link'}
`;
}

function renderProblem({ evaluation, evaluationId, documents }) {
  const labels = { experienceValue: 'Experience Value', gameplaySystems: 'Gameplay and Systems', contentPresentation: 'Content and Presentation' };
  const rows = evaluation.issues.length
    ? evaluation.issues.map((issue, index) => `| ${index + 1} | ${labels[issue.dimension]} | ${md(issue.evidence)} | ${md(issue.description)} | ${md(issue.suggestion)} |`).join('\n')
    : '| - | - | - | None | - |';
  return `# GDD EDD Problem Log

- Evaluation ID: ${evaluationId}
- Issue count: ${evaluation.issues.length}
- Evaluation result: ../result/${documents.result}
- Execution log: ../progress/${documents.progress}

| # | Dimension | GDD Evidence | Issue and Impact | Minimal Fix |
| --- | --- | --- | --- | --- |
${rows}
`;
}

export function renderEvaluationDocuments(input) {
  const { evalCase, evaluation, execution, evaluationId, documents, assets } = input;
  const result = applyTemplate(assets.resultTemplate, {
    evaluationId,
    aiExperienceValueScore: evaluation.aiExperienceValueScore,
    aiGameplaySystemsScore: evaluation.aiGameplaySystemsScore,
    aiContentPresentationScore: evaluation.aiContentPresentationScore,
    aiTotalScore: evaluation.aiTotalScore,
    title: evalCase.title,
    epoch: evalCase.epoch,
    revision: evalCase.revision,
    provider: execution.provider,
    requestedModel: execution.requestedModel,
    observedModel: execution.observedModel || 'Not provided by CLI events',
    rubricPath: evalCase.rubricPath,
    progressDocument: documents.progress,
    problemDocument: documents.problem,
    experienceValueObservations: observations(evaluation.dimensions.experienceValue.observations),
    experienceValueRationale: evaluation.dimensions.experienceValue.rationale,
    experienceValueEvidenceGaps: gaps(evaluation.dimensions.experienceValue.evidenceGaps),
    gameplaySystemsObservations: observations(evaluation.dimensions.gameplaySystems.observations),
    gameplaySystemsRationale: evaluation.dimensions.gameplaySystems.rationale,
    gameplaySystemsEvidenceGaps: gaps(evaluation.dimensions.gameplaySystems.evidenceGaps),
    contentPresentationObservations: observations(evaluation.dimensions.contentPresentation.observations),
    contentPresentationRationale: evaluation.dimensions.contentPresentation.rationale,
    contentPresentationEvidenceGaps: gaps(evaluation.dimensions.contentPresentation.evidenceGaps),
    issueCount: evaluation.issues.length,
  });
  return {
    progress: renderProgression(input),
    problem: renderProblem(input),
    result,
  };
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

export async function writeEvaluationDocuments(paths, rendered) {
  await Promise.all(Object.keys(paths).map((key) => atomicWrite(paths[key], rendered[key])));
}
