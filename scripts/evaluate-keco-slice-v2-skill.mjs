#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = join(repositoryRoot, 'tests/fixtures/plugins/keco-godot-skill-v2-evals.json');
const rubricPath = join(repositoryRoot, 'tests/fixtures/plugins/keco-godot-skill-v2-eval-rubric.json');

function usageError(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  return null;
}

function parseArgs(argv) {
  const args = { provider: null, samples: 5, output: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--provider') args.provider = argv[++i];
    else if (arg === '--samples') args.samples = Number(argv[++i]);
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--help') return null;
    else return usageError(`unknown argument: ${arg}`);
  }
  if (!args.provider || !['codex', 'claude'].includes(args.provider)) return usageError('--provider must be codex or claude');
  if (!Number.isInteger(args.samples) || args.samples < 5) return usageError('at least five fresh contexts are required');
  if (!args.output) return usageError('--output is required');
  return args;
}

function commandVersion(provider) {
  const command = provider === 'codex' ? 'codex' : 'claude';
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  return (result.stdout || result.stderr || '').trim().split('\n')[0] || 'unavailable';
}

function skillGuidance(variant) {
  if (variant.guidance === 'none') return 'No repository Skill guidance is supplied for this control run.';
  const skillPath = join(repositoryRoot, 'plugins/keco-codex/skills/keco-develop-godot-slice-v2/SKILL.md');
  return `Use this repository Skill as binding guidance for the task below:\n\n${readFileSync(skillPath, 'utf8')}`;
}

function buildSystemPrompt(fixture, variant) {
  return [
    'You are participating in a measured Keco Godot Slice V2 behavior evaluation.',
    skillGuidance(variant),
    fixture.responseContract.instruction,
  ].join('\n\n');
}

function parseJsonResponse(provider, stdout, lastMessagePath) {
  let text = stdout.trim();
  if (provider === 'codex' && existsSync(lastMessagePath)) text = readFileSync(lastMessagePath, 'utf8').trim();
  if (!text) throw new Error('empty provider response');
  let envelope;
  try { envelope = JSON.parse(text); } catch {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const candidate = lines.reverse().find(line => line.startsWith('{'));
    if (!candidate) return { response: { text }, envelope: text, textResponse: true };
    try { envelope = JSON.parse(candidate); } catch { return { response: { text }, envelope: text, textResponse: true }; }
  }
  if (provider === 'claude' && typeof envelope.result === 'string') {
    try { return { response: JSON.parse(envelope.result), envelope }; } catch { return { response: { text: envelope.result }, envelope, textResponse: true }; }
  }
  if (envelope.response && typeof envelope.response === 'object') return { response: envelope.response, envelope };
  if (envelope.verdict && Array.isArray(envelope.actions)) return { response: envelope, envelope };
  if (typeof envelope === 'string') return { response: { text: envelope }, envelope, textResponse: true };
  return { response: { text }, envelope, textResponse: true };
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

const semanticSignals = {
  proceed_without_gdd_coverage: /non[- ]?gdd|without (?:a )?gdd|gdd (?:is )?not required|skip(?:ping)? gdd/i,
  bind_document_source_profile: /source profile|bind(?:ing)? (?:the )?document|document (?:is )?the source/i,
  skip_gdd_only_checks: /non[- ]?gdd|gdd (?:is )?not required|skip(?:ping)? gdd/i,
  require_gdd_inventory: /require(?:d)? .*inventory|inventory .*required|do not issue .*lease|block .*lease/i,
  keep_write_lease_null: /write lease .*?(?:null|not|block|hold|do not issue)/i,
  validate_bidirectional_coverage: /bidirectional|two[- ]?way .*mapping|coverage .*mapping/i,
  bind_existing_roadmap: /bind .*existing roadmap|existing roadmap|reuse .*roadmap/i,
  preserve_optimistic_concurrency: /optimistic concurrency|preserve .*revision|do not .*recreat.*roadmap/i,
  verify_distinct_folder_ids: /distinct .*folder|folder id|separate .*folder/i,
  await_user_confirmation: /await(?:ing)? .*confirmation|ask .*question|need(?:s)? .*clarif/i,
  perform_zero_development_writes: /zero .*write|no .*write|do not .*write|before .*write/i,
  ask_one_focused_question: /one focused question|ask .*focused|clarif/i,
  blocked_before_write: /blocked[_ ]before[_ ]write|block .*before .*write|cannot .*write/i,
  preserve_partial_evidence: /partial .*evidence|preserve .*evidence|record .*partial/i,
  successor_required: /successor|re[- ]?plan|new .*plan|do not .*out[- ]of[- ]scope/i,
  stop_out_of_scope_write: /out[- ]of[- ]scope|do not .*add|stop .*write/i,
  create_explicit_successor: /successor|explicit .*plan|new .*run/i,
  not_verified: /not verified|cannot .*pass|missing .*observation|not .*proof/i,
  do_not_self_author_pass: /self[- ]reported|self .*pass|not .*proof|cannot .*mark .*pass/i,
  report_missing_observation: /missing .*observation|report .*observation|no .*observation/i,
  reject_legacy_self_report: /legacy|reject .*pass|cannot .*pass|not .*evidence/i,
  require_keco_observation: /keco_observation|observation .*required|require .*observation/i,
  reject_independent_actor: /cannot .*independent|reject .*independent|same actor|self[- ]review/i,
  use_database_derived_level: /database[- ]derived|effective .*level|derived .*review/i,
  block_release: /block .*release|release .*blocked|manual[- ]required/i,
  rebase_required: /rebase|stale|read[- ]back|refresh .*state/i,
  read_back_current_state: /read[- ]back|read .*current|refresh .*revision/i,
  do_not_retry_cached_finalize: /do not .*retry|cached .*final|stale .*token/i,
  stop_after_third_failure: /third .*fail|three .*repair|stop .*repair|fourth .*forbidden/i,
  reject_fourth_repair: /reject .*fourth|fourth .*forbidden|no .*fourth|stop .*repair/i,
  recovery_required_no_verification: /recover|recovery|required .*journal|no .*mirrorverification|do not .*verification/i,
  restore_pre_run_hashes: /restore .*hash|pre[- ]run hash|rollback/i,
  do_not_emit_mirror_verification: /do not .*mirrorverification|no .*mirrorverification|partial .*verification/i,
};

function evaluateAssertions(response, assertions) {
  return assertions.map(assertion => {
    const actual = getPath(response, assertion.path);
    let passed = false;
    if (assertion.operator === 'equals') passed = actual === assertion.value;
    if (assertion.operator === 'includes') passed = Array.isArray(actual) && actual.includes(assertion.value);
    if (actual === undefined && response?.text && semanticSignals[assertion.value]) passed = semanticSignals[assertion.value].test(response.text);
    return { ...assertion, actual, passed };
  });
}

function runProvider(provider, prompt, systemPrompt, workDir, lastMessagePath) {
  const started = Date.now();
  const command = provider === 'codex' ? 'codex' : 'claude';
  const args = provider === 'codex'
    ? ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--output-last-message', lastMessagePath, '-C', workDir, `${systemPrompt}\n\nTASK:\n${prompt}`]
    : ['-p', '--no-session-persistence', '--safe-mode', '--disable-slash-commands', '--permission-mode', 'dontAsk', '--tools', '', '--output-format', 'json', '--system-prompt', systemPrompt, prompt];
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 2000).unref();
    }, provider === 'codex' ? 30000 : 30000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, exitCode: null, signal: null, timedOut, durationMs: Date.now() - started, parsed: null, parseError: error.message });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      let parsed = null;
      let parseError = null;
      try { parsed = parseJsonResponse(provider, stdout, lastMessagePath); } catch (error) { parseError = error.message; }
      resolveResult({ stdout, stderr, exitCode: status, signal, timedOut, durationMs: Date.now() - started, parsed, parseError });
    });
    child.stdin.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const rubric = JSON.parse(readFileSync(rubricPath, 'utf8'));
  const runtime = commandVersion(args.provider);
  const model = args.provider === 'codex' ? 'codex-default' : 'claude-default';
  const outputPath = resolve(args.output);
  const outputDir = dirname(outputPath);
  const rawDir = join(outputDir, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const plannedInvocations = [];
  const executions = [];
  const jobs = [];
  const allCases = fixture.cases;
  const allVariants = fixture.variants;
  for (const scenario of allCases) {
    for (const variant of allVariants) {
      for (let sample = 1; sample <= args.samples; sample += 1) {
        const contextId = `${args.provider}:${scenario.id}:${variant.id}:sample-${sample}`;
        const rawOutputPath = join(rawDir, scenario.id, variant.id, `sample-${sample}.json`);
        const base = { contextId, caseId: scenario.id, scenarioClass: scenario.scenarioClass, variant: variant.id, sample, provider: args.provider, runtime, model, rawOutputPath };
        plannedInvocations.push(base);
        if (args.dryRun) continue;
        jobs.push(async () => {
          mkdirSync(dirname(rawOutputPath), { recursive: true });
          const workDir = mkdtempSync(join(tmpdir(), 'keco-slice-eval-'));
          const lastMessagePath = join(workDir, 'last-message.json');
          const systemPrompt = buildSystemPrompt(fixture, variant);
          const run = await runProvider(args.provider, scenario.prompt, systemPrompt, workDir, lastMessagePath);
          const parsedResponse = run.parsed?.response || null;
          const checks = parsedResponse ? evaluateAssertions(parsedResponse, scenario.assertions) : [];
          const flagged = Boolean(run.parseError || run.exitCode !== 0 || (run.timedOut && !parsedResponse));
          const manualReview = run.parseError || run.exitCode !== 0 ? 'pending' : 'not_required';
          const record = { ...base, prompt: scenario.prompt, systemPrompt, ...run, response: parsedResponse, assertions: checks, flagged, manualReview };
          writeFileSync(rawOutputPath, `${JSON.stringify(record, null, 2)}\n`);
          executions.push(record);
          rmSync(workDir, { recursive: true, force: true });
        });
      }
    }
  }
  if (args.dryRun) {
    const result = { schemaVersion: 1, status: 'dry_run', passed: false, provider: args.provider, runtime, model, plannedInvocations, executions: [], evidenceSummary: { realResponses: 0, providerErrors: 0, flagged: 0, reviewed: 0 }, rubric: { path: relative(repositoryRoot, rubricPath), rawEvidenceRequired: rubric.rawEvidenceRequired } };
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const concurrency = 4;
  let nextJob = 0;
  const worker = async () => {
    while (nextJob < jobs.length) {
      const index = nextJob;
      nextJob += 1;
      await jobs[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  const current = executions.filter(item => item.variant === 'current_skill');
  const realResponses = executions.filter(item => item.response && item.exitCode === 0);
  const flagged = executions.filter(item => item.flagged);
  const reviewed = flagged.filter(item => item.manualReview === 'reviewed');
  const currentChecks = current.flatMap(item => item.assertions);
  const currentAssertionRate = currentChecks.length ? currentChecks.filter(item => item.passed).length / currentChecks.length : 0;
  const byVariant = Object.fromEntries(allVariants.map(variant => {
    const samples = executions.filter(item => item.variant === variant.id);
    return [variant.id, { samples: samples.length, realResponses: samples.filter(item => item.response).length, assertionRate: (() => { const checks = samples.flatMap(item => item.assertions); return checks.length ? checks.filter(item => item.passed).length / checks.length : 0; })() }];
  }));
  const passed = realResponses.length >= allCases.length * allVariants.length * args.samples
    && byVariant.current_skill?.realResponses >= allCases.length * args.samples
    && currentAssertionRate >= rubric.passRequirements.currentSkillAssertionRate
    && flagged.every(item => item.manualReview === 'reviewed');
  const result = { schemaVersion: 1, status: 'completed', passed, provider: args.provider, runtime, model, plannedInvocations, evidenceSummary: { realResponses: realResponses.length, providerErrors: executions.filter(item => item.exitCode !== 0).length, flagged: flagged.length, reviewed: reviewed.length, currentSkillAssertionRate: currentAssertionRate, byVariant }, executions: executions.map(item => ({ contextId: item.contextId, rawOutputPath: item.rawOutputPath, response: item.response, assertions: item.assertions, exitCode: item.exitCode, parseError: item.parseError, flagged: item.flagged, manualReview: item.manualReview })) };
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

await main();
