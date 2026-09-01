import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [template, prompt, rubric, schema, evaluator, renderer, progressAudit, sampling, kecoCli, gitPublisher] = await Promise.all([
  'templates/result-template.md',
  'templates/gdd-evaluation.md',
  'templates/rubric.md',
  'src/ai-evaluation.schema.json',
  'src/ai-evaluator.mjs',
  'src/document-renderer.mjs',
  'src/progress-audit.mjs',
  'src/eval-sampling.mjs',
  'src/keco-cli.mjs',
  'src/git-publisher.mjs',
].map(read));
const packageJson = JSON.parse(await read('package.json'));
const sourceFiles = [
  'src/scoring.mjs', 'src/server.mjs', 'src/eval-case.mjs', 'src/ai-evaluator.mjs',
  'src/document-renderer.mjs', 'src/progress-audit.mjs', 'src/eval-statistics.mjs',
  'src/eval-baseline-store.mjs', 'src/eval-sampling.mjs', 'src/evaluate-case.mjs',
  'src/keco-cli.mjs', 'src/git-publisher.mjs', 'public/index.html',
];
const sources = await Promise.all(sourceFiles.map(read));

assert.match(template, /\{\{experienceValueObservations\}\}/);
assert.match(template, /\{\{gameplaySystemsObservations\}\}/);
assert.match(template, /\{\{contentPresentationObservations\}\}/);
assert.match(template, /\{\{epoch\}\}\/\{\{revision\}\}/);
assert.match(template, /Valid human samples/);
assert.doesNotMatch(template, /regression|threshold|conclusion|PASS|FAIL/i);
assert.match(prompt, /JSON Schema/);
assert.match(prompt, /explicit GDD evidence/);
assert.match(prompt, /one primary dimension/);
assert.match(prompt, /runtime quality/);
assert.ok(prompt.length < 500, 'Prompt must remain concise');
assert.doesNotMatch(prompt, /Progression|Problem|Result|create.*document/i);
assert.match(rubric, /experience goal -> design response -> GDD evidence/i);
assert.match(rubric, /0-9/);
assert.match(rubric, /37-40/);
assert.match(rubric, /one aggregate score/i);
assert.match(schema, /"epoch"/);
assert.match(schema, /"revision"/);
assert.match(schema, /"dimensions"/);
assert.doesNotMatch(schema, /"metrics"|"model"/);
assert.match(evaluator, /--json/);
assert.match(evaluator, /stream-json/);
assert.match(evaluator, /read-only/);
assert.match(evaluator, /'--tools', 'Read'/);
assert.doesNotMatch(renderer, /JSON\.stringify\(execution\.rawOutput/);
assert.match(progressAudit, /writeAiEvidence/);
assert.match(progressAudit, /writeFailureProgression/);
assert.match(sampling, /runs: 3/);
assert.doesNotMatch(sampling, /REGRESSION|PASS|FAIL/);
assert.match(kecoCli, /workspaceRoot/);
assert.match(kecoCli, /epoch/);
assert.match(kecoCli, /evaluate.*baseline.*compare/s);
assert.match(kecoCli, /no-push/);
assert.match(kecoCli, /outputRepository/);
assert.match(gitPublisher, /edd-repo\.git/);
assert.equal(packageJson.scripts.eval, 'node src/keco-cli.mjs evaluate');
assert.equal(packageJson.scripts['eval:baseline'], 'node src/keco-cli.mjs baseline');
assert.equal(packageJson.scripts['eval:compare'], 'node src/keco-cli.mjs compare');
assert.doesNotMatch(evaluator, /PAWS_SOURCE/);
assert.doesNotMatch(sources.join('\n'), /evaluate-paws/);
assert.doesNotMatch(sources.join('\n'), /fixed GDD/i);
assert.doesNotMatch(sources.join('\n'), /aiCoreScore|aiExperienceScore|coreAverage|experienceAverage/);
assert.doesNotMatch(sources.join('\n'), /admin-test-token|ngrok_[A-Za-z0-9]+/);

console.log('Static check passed: Keco identity, three dimensions, human scoring, and baseline modes are wired.');
