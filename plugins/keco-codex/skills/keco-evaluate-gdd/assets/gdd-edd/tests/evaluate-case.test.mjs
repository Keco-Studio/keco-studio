import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateCase, formatEvaluationScore, nextEvaluationId, parseCliOptions, runCli } from '../src/evaluate-case.mjs';
import { renderEvaluationDocuments } from '../src/document-renderer.mjs';

const evalCase = Object.freeze({
  id: 'paws-patience-r97',
  type: 'gold',
  title: 'Paws & Patience',
  gddPath: 'docs/gdd-edd/gdd/paws-patience-gdd-r97.md',
  projectId: 'project-id',
  documentId: 'document-id',
  revision: 97,
  promptPath: 'docs/gdd-edd/prompts/gdd-evaluation-v2.md',
  rubricPath: 'docs/gdd-edd/rubrics/three-dimension-v2.md',
  resultTemplatePath: 'docs/gdd-edd/result/result-template-v7.md',
  outputStem: 'paws-patience-gdd-r97',
});

const evaluation = {
  source: { projectId: 'project-id', documentId: 'document-id', revision: 97, title: 'Paws & Patience' },
  provider: 'codex',
  aiExperienceValueScore: 27,
  aiGameplaySystemsScore: 36,
  aiContentPresentationScore: 29,
  aiTotalScore: 92,
  dimensions: {
    experienceValue: { score: 27, observations: [{ statement: 'Value observation', evidence: 'Chapter 2' }], rationale: 'Value rationale', evidenceGaps: [] },
    gameplaySystems: { score: 36, observations: [{ statement: 'Gameplay observation', evidence: 'Chapter 3' }], rationale: 'Gameplay rationale', evidenceGaps: [] },
    contentPresentation: { score: 29, observations: [{ statement: 'Presentation observation', evidence: 'Chapter 4' }], rationale: 'Presentation rationale', evidenceGaps: [] },
  },
  issues: [],
};

test('creates run suffixes from the selected case output stem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-id-'));
  assert.equal(await nextEvaluationId(root, 'other-game-r3'), 'other-game-r3');
  await writeFile(join(root, 'other-game-r3-evaluation-result.md'), 'existing');
  assert.equal(await nextEvaluationId(root, 'other-game-r3'), 'other-game-r3-run2');
});

test('continues after the highest run when the base document was removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-id-gap-'));
  await writeFile(join(root, 'paws-patience-gdd-r97-run2-evaluation-result.md'), 'existing');
  assert.equal(await nextEvaluationId(root, 'paws-patience-gdd-r97'), 'paws-patience-gdd-r97-run3');
});

test('one selected case creates three documents and returns a human-rating link', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'edd-command-'));
  const roots = { progressRoot: join(root, 'progress'), problemRoot: join(root, 'problem'), resultRoot: join(root, 'result') };
  let receivedCase;
  let renderedInput;
  const result = await evaluateCase({
    evalCase,
    provider: 'codex',
    assets: {
      promptTemplate: 'Evaluate {{title}} {{gddPath}} {{rubricPath}}',
      resultTemplate: '# Result\n- Evaluation ID: {{evaluationId}}\n- AI Experience Value: {{aiExperienceValueScore}}/30\n- AI Gameplay and Systems: {{aiGameplaySystemsScore}}/40\n- AI Content and Presentation: {{aiContentPresentationScore}}/30\n- AI total: {{aiTotalScore}}/100\n- Valid human samples: 0\n- Final experience value: No human rating\n- Final gameplay and systems: No human rating\n- Final content and presentation: No human rating\n- Final score: No human rating\n',
      hashes: { gdd: 'a', prompt: 'b', rubric: 'c', schema: 'd', resultTemplate: 'e' },
    },
    evaluator: async ({ evalCase: selected, prompt }) => {
      receivedCase = selected;
      assert.match(prompt, /Paws & Patience/);
      return { evaluation, execution: { provider: 'codex', requestedModel: 'test', observedModel: null, startedAt: 'x', finishedAt: 'y', durationMs: 1, status: 'completed', exitCode: 0, prompt, rawOutput: {}, events: [] } };
    },
    renderer: (input) => { renderedInput = input; return renderEvaluationDocuments(input); },
    serverOptions: { ...roots, dataFile: join(root, 'data', 'store.json'), publicRoot: new URL('../public/', import.meta.url), host: '127.0.0.1', port: 0, rateLimit: 100 },
  });
  t.after(() => result.app.close());

  assert.equal(receivedCase, evalCase);
  assert.equal(renderedInput.evaluation, evaluation);
  assert.equal(result.case.id, evalCase.id);
  assert.match(result.playerUrl, /^http:\/\/127\.0\.0\.1:\d+\/\?session=/);
  await Promise.all([
    access(join(roots.progressRoot, result.documents.progress)),
    access(join(roots.problemRoot, result.documents.problem)),
    access(join(roots.resultRoot, result.documents.result)),
  ]);
  const progress = await readFile(join(roots.progressRoot, result.documents.progress), 'utf8');
  const evidencePath = join(roots.progressRoot, 'evidence', `${result.evaluationId}-ai-output.json`);
  assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), {});
  assert.match(progress, /AI evaluation/i);
  assert.match(progress, /Schema validation/i);
  assert.match(progress, /Document readback/i);
  assert.match(progress, /rating session/i);
  assert.match(progress, /evidence\/paws-patience-gdd-r97-ai-output\.json/);
  assert.doesNotMatch(progress, /AI Experience Value|AI Gameplay and Systems|AI Content and Presentation|AI total|Final score/);
  assert.equal(formatEvaluationScore(result), `Experience Value: 27.0/30
Gameplay and Systems: 36.0/40
Content and Presentation: 29.0/30
Total: 92.0/100
Human rating: ${result.playerUrl}`);
});

test('writes a failure Progression when AI evaluation fails after allocating the run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edd-command-failure-'));
  const roots = { progressRoot: join(root, 'progress'), problemRoot: join(root, 'problem'), resultRoot: join(root, 'result') };
  await assert.rejects(() => evaluateCase({
    evalCase,
    provider: 'claude',
    model: 'sonnet',
    assets: { promptTemplate: 'Evaluate {{title}}', resultTemplate: '# Result', hashes: { gdd: 'a', prompt: 'b', rubric: 'c', schema: 'd', resultTemplate: 'e' } },
    evaluator: async () => { throw new Error('provider authorization: Bearer secret-value failed'); },
    serverOptions: { ...roots, dataFile: join(root, 'data', 'store.json'), publicRoot: new URL('../public/', import.meta.url), host: '127.0.0.1', port: 0, rateLimit: 100 },
  }), /provider/);

  const progress = await readFile(join(roots.progressRoot, 'paws-patience-gdd-r97-Progression.md'), 'utf8');
  assert.match(progress, /Status: failed/i);
  assert.match(progress, /AI evaluation/i);
  assert.match(progress, /failed/i);
  assert.match(progress, /Retry command: npm run eval -- --case paws-patience-r97 --provider claude --model sonnet/);
  assert.doesNotMatch(progress, /secret-value/);
  assert.doesNotMatch(progress, /AI Experience Value|AI Gameplay and Systems|AI Content and Presentation|AI total|Final score/);
});

test('parses case, provider, and list options and rejects unknown arguments', () => {
  assert.deepEqual(parseCliOptions([]), { caseId: undefined, provider: 'claude', model: undefined, listCases: false });
  assert.deepEqual(parseCliOptions(['--case', 'other-r3', '--provider=codex', '--model', 'gpt-test']), { caseId: 'other-r3', provider: 'codex', model: 'gpt-test', listCases: false });
  assert.deepEqual(parseCliOptions(['--list-cases']), { caseId: undefined, provider: 'claude', model: undefined, listCases: true });
  assert.throws(() => parseCliOptions(['--case']), /--case.*value/i);
  assert.throws(() => parseCliOptions(['--unknown']), /Unknown argument/);
});

test('list mode prints cases without starting evaluation', async () => {
  const lines = [];
  let evaluated = false;
  const result = await runCli({
    argv: ['--list-cases'],
    write: (line) => lines.push(line),
    listCases: async () => ['other-r3', 'paws-patience-r97'],
    evaluate: async () => { evaluated = true; },
  });
  assert.equal(evaluated, false);
  assert.deepEqual(lines, ['other-r3', 'paws-patience-r97']);
  assert.deepEqual(result, { listed: true, caseIds: ['other-r3', 'paws-patience-r97'] });
});

test('run mode passes the selected case and provider to evaluation', async () => {
  let received;
  const lines = [];
  const fake = { evaluation, playerUrl: 'http://127.0.0.1:1234/?session=x' };
  await runCli({
    argv: ['--case=paws-patience-r97', '--provider', 'codex', '--model=gpt-test'],
    write: (line) => lines.push(line),
    evaluate: async (options) => { received = options; return fake; },
  });
  assert.deepEqual(received, { caseId: 'paws-patience-r97', provider: 'codex', model: 'gpt-test' });
  assert.match(lines[0], /Experience Value: 27\.0\/30/);
});
