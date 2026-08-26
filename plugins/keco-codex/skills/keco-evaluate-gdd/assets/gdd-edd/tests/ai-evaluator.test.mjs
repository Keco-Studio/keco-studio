import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {
  DEFAULT_EVALUATION_CWD,
  buildEvaluationPrompt,
  buildProviderInvocation,
  runAiEvaluation,
  validateAiEvaluation,
} from '../src/ai-evaluator.mjs';

const evalCase = Object.freeze({
  id: 'paws-patience-r97', type: 'gold', title: 'Paws & Patience',
  gddPath: 'docs/gdd-edd/gdd/paws-patience-gdd-r97.md',
  projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97,
  promptPath: 'docs/gdd-edd/prompts/gdd-evaluation-v2.md',
  rubricPath: 'docs/gdd-edd/rubrics/three-dimension-v2.md',
  resultTemplatePath: 'docs/gdd-edd/result/result-template-v7.md', outputStem: 'paws-patience-gdd-r97',
});

const dimension = (score, label) => ({
  score,
  observations: [{ statement: `${label} objective observation`, evidence: 'Section 3, core loop items 1-4' }],
  rationale: `${label} scoring rationale`,
  evidenceGaps: ['Missing runtime evidence'],
});

const valid = {
  source: { projectId: 'project-id', documentId: 'document-id', epoch: 1, revision: 97, title: 'Paws & Patience' },
  dimensions: {
    experienceValue: dimension(24, 'Experience Value'),
    gameplaySystems: dimension(31, 'Gameplay and Systems'),
    contentPresentation: dimension(22, 'Content and Presentation'),
  },
  issues: [{ dimension: 'gameplaySystems', evidence: 'Section 3, core loop', description: 'Rule conflict', suggestion: 'Unify rules' }],
};

test('validates three evidence-backed dimensions with 30/40/30 limits', () => {
  const result = validateAiEvaluation(valid, evalCase);
  assert.equal(result.aiExperienceValueScore, 24);
  assert.equal(result.aiGameplaySystemsScore, 31);
  assert.equal(result.aiContentPresentationScore, 22);
  assert.equal(result.aiTotalScore, 77);
  assert.equal(result.dimensions.experienceValue.observations[0].statement, 'Experience Value objective observation');
  assert.throws(() => validateAiEvaluation({ ...valid, dimensions: { ...valid.dimensions, experienceValue: { ...valid.dimensions.experienceValue, score: 31 } } }, evalCase), /between 0 and 30/);
  assert.throws(() => validateAiEvaluation({ ...valid, dimensions: { ...valid.dimensions, gameplaySystems: { ...valid.dimensions.gameplaySystems, observations: [] } } }, evalCase), /objective observations/i);
  assert.throws(() => validateAiEvaluation({ ...valid, source: { ...valid.source, revision: 98 } }, evalCase), /GDD revision/i);
  assert.throws(() => validateAiEvaluation({ ...valid, source: { ...valid.source, epoch: 2 } }, evalCase), /GDD epoch/i);
});

test('renders the short versioned prompt without document-writing instructions', () => {
  const prompt = buildEvaluationPrompt({
    evalCase,
    promptTemplate: 'Evaluate {{title}}\nGDD={{gddPath}}\nRUBRIC={{rubricPath}}\nReturn JSON only.',
  });
  assert.match(prompt, /Paws & Patience/);
  assert.match(prompt, /paws-patience-gdd-r97\.md/);
  assert.match(prompt, /three-dimension-v2\.md/);
  assert.doesNotMatch(prompt, /Progression|Problem|Result|create.*document/i);
  assert.throws(() => buildEvaluationPrompt({ evalCase, promptTemplate: '{{unknown}}' }), /Unknown prompt placeholder/);
});

test('uses machine-readable observable event modes for Codex and Claude', () => {
  assert.equal(typeof DEFAULT_EVALUATION_CWD, 'string');
  const codex = buildProviderInvocation('codex', { cwd: '/repo', schemaPath: '/repo/schema.json', outputPath: '/tmp/result.json', schema: {}, prompt: 'x', model: 'gpt-test' });
  assert.ok(codex.args.includes('--json'));
  assert.ok(codex.args.includes('gpt-test'));
  const claude = buildProviderInvocation('claude', { cwd: '/repo', schemaPath: '/repo/schema.json', outputPath: '/tmp/result.json', schema: { type: 'object' }, prompt: 'x', model: 'sonnet' });
  assert.ok(claude.args.includes('stream-json'));
  assert.ok(claude.args.includes('--verbose'));
});

test('captures Codex JSONL events and final structured output without reasoning text', async () => {
  const runner = async (_command, args) => {
    const outputPath = args[args.indexOf('--output-last-message') + 1];
    await writeFile(outputPath, JSON.stringify(valid));
    return { stdout: [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'hidden chain of thought' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'sed -n 1,20p docs/gdd.md' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }),
    ].join('\n'), stderr: '' };
  };
  const result = await runAiEvaluation({ provider: 'codex', model: 'gpt-test', evalCase, prompt: 'fixed prompt', runner });
  assert.equal(result.evaluation.aiTotalScore, 77);
  assert.equal(result.execution.provider, 'codex');
  assert.equal(result.execution.requestedModel, 'gpt-test');
  assert.equal(result.execution.status, 'completed');
  assert.match(JSON.stringify(result.execution.events), /sed -n/);
  assert.doesNotMatch(JSON.stringify(result.execution), /hidden chain of thought/);
  assert.deepEqual(result.execution.rawOutput, valid);
});

test('captures Claude stream-json and observed model', async () => {
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-test' }),
    JSON.stringify({ type: 'system', subtype: 'thinking_tokens', token_count: 100 }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'docs/gdd.md' } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: valid }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', structured_output: valid }),
  ].join('\n');
  const result = await runAiEvaluation({ provider: 'claude', evalCase, prompt: 'fixed prompt', runner: async () => ({ stdout, stderr: '' }) });
  assert.equal(result.evaluation.aiExperienceValueScore, 24);
  assert.equal(result.execution.requestedModel, 'sonnet');
  assert.equal(result.execution.observedModel, 'claude-sonnet-test');
  assert.match(JSON.stringify(result.execution.events), /Read/);
  assert.doesNotMatch(JSON.stringify(result.execution.events), /thinking_tokens/);
  assert.doesNotMatch(JSON.stringify(result.execution.events), /StructuredOutput/);
});
