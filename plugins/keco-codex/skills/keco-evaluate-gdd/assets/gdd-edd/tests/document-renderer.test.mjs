import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvaluationAssets, renderEvaluationDocuments, writeEvaluationDocuments } from '../src/document-renderer.mjs';

const evalCase = {
  id: 'game-r1', type: 'gold', title: 'Game', gddPath: 'docs/gdd.md', projectId: 'p', documentId: 'd', epoch: 2, revision: 1,
  promptPath: 'docs/prompt.md', rubricPath: 'docs/rubric.md', resultTemplatePath: 'docs/result.md', outputStem: 'game-r1',
};

const evaluation = {
  source: { projectId: 'p', documentId: 'd', epoch: 2, revision: 1, title: 'Game' },
  dimensions: {
    experienceValue: { score: 22, observations: [{ statement: 'Target player is clear', evidence: 'Chapter 2' }], rationale: 'Meets baseline', evidenceGaps: ['Missing playtest data'] },
    gameplaySystems: { score: 31, observations: [{ statement: 'Loop closes', evidence: 'Chapter 3' }], rationale: 'Mostly holds up', evidenceGaps: [] },
    contentPresentation: { score: 20, observations: [{ statement: 'Feedback defined', evidence: 'Chapter 4' }], rationale: 'Needs more detail', evidenceGaps: [] },
  },
  issues: [{ dimension: 'gameplaySystems', evidence: 'Chapter 3', description: 'Rule conflict', suggestion: 'Unify rules' }],
  aiExperienceValueScore: 22, aiGameplaySystemsScore: 31, aiContentPresentationScore: 20, aiTotalScore: 73,
};

const execution = {
  provider: 'codex', requestedModel: 'gpt-test', observedModel: null,
  startedAt: '2026-08-26T00:00:00.000Z', finishedAt: '2026-08-26T00:00:02.000Z', durationMs: 2000,
  status: 'completed', exitCode: 0, prompt: 'Full applied prompt', rawOutput: { source: evaluation.source, dimensions: evaluation.dimensions, issues: evaluation.issues },
  events: [{ type: 'tool', name: 'command_execution', detail: 'sed -n 1,20p docs/gdd.md' }],
};

const audit = {
  goal: 'Generate human-reviewable evaluation documents from a fixed GDD and rubric',
  evidence: { path: 'evidence/game-r1-ai-output.json', sha256: 'f'.repeat(64) },
  events: [
    { component: 'Node', action: 'Load fixed inputs', status: 'completed', detail: 'Eval Case and 5 assets validated' },
    { component: 'AI', action: 'Run evaluation', status: 'completed', detail: 'Schema validation passed' },
    { component: 'Provider', action: 'Request', status: 'observed', detail: 'Authorization: Bearer visible-secret' },
  ],
  nextAction: 'Review Result and share the human rating link',
};

const template = `# GDD EDD Evaluation Result
- Evaluation ID: {{evaluationId}}
- Template version: v7
- AI Experience Value: {{aiExperienceValueScore}}/30
- AI Gameplay and Systems: {{aiGameplaySystemsScore}}/40
- AI Content and Presentation: {{aiContentPresentationScore}}/30
- AI total: {{aiTotalScore}}/100
- Valid human samples: 0
- Final experience value: No human rating
- Final gameplay and systems: No human rating
- Final content and presentation: No human rating
- Final score: No human rating
{{experienceValueObservations}}
{{experienceValueRationale}}
{{experienceValueEvidenceGaps}}
{{gameplaySystemsObservations}}
{{gameplaySystemsRationale}}
{{gameplaySystemsEvidenceGaps}}
{{contentPresentationObservations}}
{{contentPresentationRationale}}
{{contentPresentationEvidenceGaps}}
{{title}} {{epoch}}/{{revision}} {{provider}} {{requestedModel}} {{observedModel}} {{rubricPath}}
{{progressDocument}} {{problemDocument}} {{issueCount}}`;

test('loads fixed assets and computes SHA-256 hashes', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'edd-assets-'));
  await mkdir(join(repositoryRoot, 'docs'), { recursive: true });
  await Promise.all([
    writeFile(join(repositoryRoot, 'docs/gdd.md'), 'gdd'), writeFile(join(repositoryRoot, 'docs/prompt.md'), 'prompt'),
    writeFile(join(repositoryRoot, 'docs/rubric.md'), 'rubric'), writeFile(join(repositoryRoot, 'docs/result.md'), template),
  ]);
  const schemaPath = join(repositoryRoot, 'schema.json');
  await writeFile(schemaPath, '{}');
  const assets = await loadEvaluationAssets(evalCase, { repositoryRoot, schemaPath });
  assert.equal(assets.promptTemplate, 'prompt');
  assert.match(assets.hashes.gdd, /^[a-f0-9]{64}$/);
  assert.notEqual(assets.hashes.gdd, assets.hashes.prompt);
});

test('renders concise non-overlapping Progression, Problem, and Result', () => {
  const documents = { progress: 'game-r1-Progression.md', problem: 'game-r1-problem-log.md', result: 'game-r1-evaluation-result.md' };
  const assets = { resultTemplate: template, hashes: { gdd: 'a', prompt: 'b', rubric: 'c', schema: 'd', resultTemplate: 'e' } };
  const rendered = renderEvaluationDocuments({ evalCase, evaluation, execution, evaluationId: 'game-r1', documents, assets, audit });

  assert.match(rendered.progress, /Full applied prompt|View full prompt/i);
  assert.match(rendered.progress, /Load fixed inputs/i);
  assert.match(rendered.progress, /Run evaluation|AI evaluation/i);
  assert.match(rendered.progress, /evidence\/game-r1-ai-output\.json/);
  assert.match(rendered.progress, new RegExp('f{64}'));
  assert.match(rendered.progress, /Review Result and share the human rating link/);
  assert.match(rendered.progress, /SHA-256/);
  assert.doesNotMatch(rendered.progress, /"score"|AI Experience Value|AI Gameplay and Systems|AI Content and Presentation|AI total|Final score/);
  assert.doesNotMatch(rendered.progress, /visible-secret/);
  assert.doesNotMatch(rendered.progress, /sed -n 1,20p/);

  assert.match(rendered.problem, /Rule conflict/);
  assert.match(rendered.problem, /Unify rules/);
  assert.match(rendered.result, /Loop closes/);
  assert.match(rendered.result, /Game 2\/1/);
  assert.match(rendered.result, /1/);
  assert.doesNotMatch(rendered.result, /Rule conflict/);
  assert.doesNotMatch(rendered.result, /\{\{/);
});

test('writes the three rendered documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-render-'));
  const paths = { progress: join(root, 'progress/p.md'), problem: join(root, 'problem/q.md'), result: join(root, 'result/r.md') };
  await writeEvaluationDocuments(paths, { progress: 'P', problem: 'Q', result: 'R' });
  assert.equal(await readFile(paths.progress, 'utf8'), 'P');
  assert.equal(await readFile(paths.problem, 'utf8'), 'Q');
  assert.equal(await readFile(paths.result, 'utf8'), 'R');
});
