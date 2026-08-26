import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
export const DEFAULT_EVALUATION_CWD = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('./ai-evaluation.schema.json', import.meta.url));
const fail = (message) => { throw new Error(message); };
const round = (value) => Math.round(Number(value) * 10) / 10;

function requiredText(value, label, max = 1000) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max) fail(`${label} must be 1-${max} characters`);
  return result;
}

function validateDimension(raw = {}, label, maximum) {
  const score = Number(raw.score);
  if (!Number.isFinite(score) || score < 0 || score > maximum) fail(`${label} score must be between 0 and ${maximum}`);
  if (!Array.isArray(raw.observations) || raw.observations.length < 1 || raw.observations.length > 20) fail(`${label} must include 1-20 objective observations`);
  const observations = raw.observations.map((item, index) => ({
    statement: requiredText(item?.statement, `${label} objective observation ${index + 1}`, 500),
    evidence: requiredText(item?.evidence, `${label} evidence ${index + 1}`, 300),
  }));
  if (!Array.isArray(raw.evidenceGaps) || raw.evidenceGaps.length > 20) fail(`${label} evidence gaps must be an array`);
  return {
    score: round(score),
    observations,
    rationale: requiredText(raw.rationale, `${label} scoring rationale`, 1000),
    evidenceGaps: raw.evidenceGaps.map((item, index) => requiredText(item, `${label} evidence gap ${index + 1}`, 500)),
  };
}

export function validateAiEvaluation(raw = {}, evalCase) {
  if (!evalCase) fail('Eval Case is required');
  const source = raw.source || {};
  if (source.projectId !== evalCase.projectId) fail('AI returned a mismatched Keco project');
  if (source.documentId !== evalCase.documentId) fail('AI returned a mismatched GDD document');
  if (!Number.isInteger(source.epoch) || source.epoch !== evalCase.epoch) fail('AI returned an invalid GDD epoch');
  if (!Number.isInteger(source.revision) || source.revision !== evalCase.revision) fail('AI returned an invalid GDD revision');
  if (source.title !== evalCase.title) fail('AI returned a mismatched GDD title');
  const experienceValue = validateDimension(raw.dimensions?.experienceValue, 'Experience Value', 30);
  const gameplaySystems = validateDimension(raw.dimensions?.gameplaySystems, 'Gameplay and Systems', 40);
  const contentPresentation = validateDimension(raw.dimensions?.contentPresentation, 'Content and Presentation', 30);
  if (!Array.isArray(raw.issues) || raw.issues.length > 100) fail('Issue list invalid');
  const issues = raw.issues.map((issue, index) => {
    if (!['experienceValue', 'gameplaySystems', 'contentPresentation'].includes(issue?.dimension)) fail(`Issue ${index + 1} has an invalid dimension`);
    return {
      dimension: issue.dimension,
      evidence: requiredText(issue.evidence, `Issue ${index + 1} evidence`, 300),
      description: requiredText(issue.description, `Issue ${index + 1} description`, 500),
      suggestion: requiredText(issue.suggestion, `Issue ${index + 1} suggestion`, 500),
    };
  });
  return {
    source: { projectId: source.projectId, documentId: source.documentId, epoch: source.epoch, revision: source.revision, title: requiredText(source.title, 'GDD title', 100) },
    dimensions: { experienceValue, gameplaySystems, contentPresentation },
    issues,
    aiExperienceValueScore: experienceValue.score,
    aiGameplaySystemsScore: gameplaySystems.score,
    aiContentPresentationScore: contentPresentation.score,
    aiTotalScore: round(experienceValue.score + gameplaySystems.score + contentPresentation.score),
  };
}

export function buildEvaluationPrompt({ evalCase, promptTemplate }) {
  if (!evalCase) fail('Eval Case is required');
  const values = { title: evalCase.title, gddPath: evalCase.gddPath, rubricPath: evalCase.rubricPath, caseId: evalCase.id };
  return String(promptTemplate || '').replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_match, key) => {
    if (!(key in values)) fail(`Unknown prompt placeholder: ${key}`);
    return values[key];
  }).trim();
}

export function buildProviderInvocation(provider, { cwd, schemaPath, outputPath, schema, prompt, model }) {
  if (provider === 'codex') {
    const modelArgs = model ? ['--model', model] : [];
    return {
      command: 'codex',
      args: ['exec', '--ephemeral', '--sandbox', 'read-only', '-c', 'model_reasoning_effort="medium"', ...modelArgs, '--json', '--output-schema', schemaPath, '--output-last-message', outputPath, '--color', 'never', '-C', cwd, prompt],
    };
  }
  if (provider === 'claude') {
    const { $schema: _draft, ...claudeSchema } = schema;
    return {
      command: 'claude',
      args: ['-p', '--safe-mode', '--tools', 'Read', '--model', model || 'sonnet', '--effort', 'medium', '--permission-mode', 'dontAsk', '--no-session-persistence', '--verbose', '--output-format', 'stream-json', '--json-schema', JSON.stringify(claudeSchema), prompt],
    };
  }
  fail(`Unsupported provider: ${provider}`);
}

function jsonLines(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); }
    catch { return { type: 'unparsed', value: line.slice(0, 500) }; }
  });
}

function findObservedModel(events) {
  for (const event of events) {
    if (typeof event?.model === 'string') return event.model;
    if (typeof event?.message?.model === 'string') return event.message.model;
  }
  return null;
}

function eventDetail(value) {
  if (typeof value === 'string') return value.slice(0, 500);
  return JSON.stringify(value || {}).slice(0, 500);
}

export function normalizeObservableEvents(events = []) {
  const normalized = [];
  for (const event of events) {
    const item = event?.item;
    if (item?.type === 'reasoning' || event?.type === 'thinking' || (event?.type === 'system' && event?.subtype === 'thinking_tokens')) continue;
    if (item?.type === 'command_execution') normalized.push({ type: 'tool', name: 'command_execution', detail: eventDetail(item.command) });
    else if (item?.type === 'file_change') normalized.push({ type: 'tool', name: 'file_change', detail: eventDetail(item.changes) });
    else if (event?.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type === 'tool_use' && block.name !== 'StructuredOutput') {
          normalized.push({ type: 'tool', name: block.name || 'tool', detail: eventDetail(block.input) });
        }
      }
    } else if (['thread.started', 'turn.started', 'turn.completed', 'system', 'result'].includes(event?.type)) {
      normalized.push({ type: 'status', name: event.type, detail: event.subtype || event.thread_id || '' });
    }
  }
  return normalized;
}

function parseClaudeOutput(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.structured_output) return event.structured_output;
    if (event?.type === 'result' && typeof event.result === 'string') {
      try { return JSON.parse(event.result); } catch { /* continue */ }
    }
  }
  fail('AI did not return structured JSON');
}

async function defaultRunner(command, args, options) { return execFileAsync(command, args, options); }

export async function runAiEvaluation(options = {}) {
  const provider = options.provider || 'codex';
  const cwd = options.cwd || DEFAULT_EVALUATION_CWD;
  const schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;
  const schema = options.schema || JSON.parse(await readFile(schemaPath, 'utf8'));
  const prompt = options.prompt;
  if (!prompt) fail('Rendered prompt is required');
  const requestedModel = options.model || (provider === 'claude' ? 'sonnet' : 'local-default');
  const tempDir = await mkdtemp(join(tmpdir(), 'edd-ai-'));
  const outputPath = join(tempDir, 'result.json');
  const invocation = buildProviderInvocation(provider, { cwd, schemaPath, outputPath, schema, prompt, model: options.model });
  const runner = options.runner || defaultRunner;
  const started = new Date();
  try {
    const result = await runner(invocation.command, invocation.args, { cwd, timeout: options.timeoutMs || 600_000, maxBuffer: 8 * 1024 * 1024, env: process.env });
    const events = jsonLines(result.stdout);
    let rawOutput;
    if (provider === 'codex') {
      try { rawOutput = JSON.parse(await readFile(outputPath, 'utf8')); }
      catch { fail('Codex did not write valid structured JSON'); }
    } else rawOutput = parseClaudeOutput(events);
    const evaluation = validateAiEvaluation(rawOutput, options.evalCase);
    const finished = new Date();
    return {
      evaluation,
      execution: {
        provider,
        requestedModel,
        observedModel: findObservedModel(events),
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - started.getTime(),
        status: 'completed',
        exitCode: 0,
        prompt,
        rawOutput,
        events: normalizeObservableEvents(events),
      },
    };
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`${provider} evaluation failed${detail ? `: ${detail}` : ''}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
