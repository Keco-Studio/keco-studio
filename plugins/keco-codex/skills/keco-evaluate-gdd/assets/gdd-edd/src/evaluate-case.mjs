import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAiEvaluation } from './ai-evaluator.mjs';
import { buildEvaluationPrompt } from './ai-evaluator.mjs';
import { loadEvaluationAssets, renderEvaluationDocuments, writeEvaluationDocuments } from './document-renderer.mjs';
import { listEvalCaseIds, loadEvalCase } from './eval-case.mjs';
import { createRatingServer } from './server.mjs';
import { preserveProgressSyncBlocks, verifyEvaluationDocument, writeAiEvidence, writeFailureProgression, writeTextAtomic } from './progress-audit.mjs';

const DEFAULT_RESULT_ROOT = fileURLToPath(new URL('../../result/', import.meta.url));
const DEFAULT_PROGRESS_ROOT = fileURLToPath(new URL('../../progress/', import.meta.url));
const DEFAULT_PROBLEM_ROOT = fileURLToPath(new URL('../../problem/', import.meta.url));
const decimal = (value) => Number(value).toFixed(1);

export async function nextEvaluationId(resultRoot, outputStem) {
  const files = new Set(await readdir(resultRoot).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  }));
  let highestRun = files.has(`${outputStem}-evaluation-result.md`) ? 1 : 0;
  const prefix = `${outputStem}-run`;
  const suffix = '-evaluation-result.md';
  for (const file of files) {
    if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
    const run = Number(file.slice(prefix.length, -suffix.length));
    if (Number.isInteger(run) && run >= 2) highestRun = Math.max(highestRun, run);
  }
  return highestRun ? `${outputStem}-run${highestRun + 1}` : outputStem;
}

export async function evaluateCase(options = {}) {
  const evalCase = options.evalCase || await (options.caseLoader || loadEvalCase)(options.caseId, options.caseOptions);
  const provider = options.provider || 'claude';
  const evaluator = options.evaluator || runAiEvaluation;
  const assets = options.assets || await (options.assetLoader || loadEvaluationAssets)(evalCase, options.assetOptions);
  const serverOptions = { port: process.env.EDD_PORT ? Number(process.env.EDD_PORT) : 0, ...(options.serverOptions || {}) };
  const resultRoot = serverOptions.resultRoot || DEFAULT_RESULT_ROOT;
  const progressRoot = serverOptions.progressRoot || DEFAULT_PROGRESS_ROOT;
  const problemRoot = serverOptions.problemRoot || DEFAULT_PROBLEM_ROOT;
  const evaluationId = await nextEvaluationId(resultRoot, evalCase.outputStem);
  const documentNames = {
    progress: `${evaluationId}-Progression.md`,
    problem: `${evaluationId}-problem-log.md`,
    result: `${evaluationId}-evaluation-result.md`,
  };
  const documents = {
    progress: join(progressRoot, documentNames.progress),
    problem: join(problemRoot, documentNames.problem),
    result: join(resultRoot, documentNames.result),
  };
  const prompt = buildEvaluationPrompt({ evalCase, promptTemplate: assets.promptTemplate });
  const requestedModel = options.model || (provider === 'claude' ? 'sonnet' : 'local-default');
  const startedAt = new Date().toISOString();
  const audit = {
    goal: 'Generate human-reviewable evaluation documents from the selected GDD and rubric',
    evidence: null,
    events: [{ component: 'Node', action: 'Load selected GDD and evaluation inputs', status: 'completed', detail: `${evalCase.id}; selected assets read and hashed` }],
    nextAction: 'Review Result and share the human rating link',
  };
  let app;
  let created;
  let execution;
  let failedStep = 'AI evaluation';
  const renderer = options.renderer || renderEvaluationDocuments;
  try {
    const run = await evaluator({ evalCase, provider, model: options.model, cwd: options.cwd, evaluationId, prompt });
    const evaluation = run.evaluation;
    execution = run.execution;
    audit.events.push({ component: 'AI', action: 'AI evaluation', status: 'completed', detail: `${execution.provider} returned structured result` });
    for (const event of execution.events || []) {
      audit.events.push({ component: 'Provider', action: event.name || event.type, status: 'observed', detail: event.detail || event.type });
    }
    audit.events.push({ component: 'Node', action: 'Schema validation', status: 'completed', detail: 'Source, three dimensions, evidence, and issue structure validated' });

    failedStep = 'AI evidence write';
    audit.evidence = await (options.evidenceWriter || writeAiEvidence)(progressRoot, evaluationId, execution.rawOutput);
    audit.events.push({ component: 'Node', action: 'Write AI evidence', status: 'completed', detail: `${audit.evidence.path}; readback and JSON parse passed` });

    failedStep = 'Evaluation document write';
    let rendered = renderer({ evalCase, evaluation, execution, evaluationId, documents: documentNames, assets, audit });
    await (options.documentWriter || writeEvaluationDocuments)(documents, rendered);
    audit.events.push({ component: 'Node', action: 'Write three evaluation documents', status: 'completed', detail: 'Progression, Problem, and Result atomically written' });

    failedStep = 'Evaluation document readback';
    await Promise.all([
      verifyEvaluationDocument(documents.problem, evaluationId),
      verifyEvaluationDocument(documents.result, evaluationId),
    ]);
    audit.events.push({ component: 'Node', action: 'Document readback', status: 'completed', detail: 'Evaluation ID verified in Problem and Result' });
    rendered = renderer({ evalCase, evaluation, execution, evaluationId, documents: documentNames, assets, audit });
    await writeTextAtomic(documents.progress, rendered.progress);

    failedStep = 'Human rating session creation';
    app = await (options.serverFactory || createRatingServer)(serverOptions);
    created = await app.createSessionForDocuments({
      evaluationId,
      gameTitle: evaluation.source.title,
      aiExperienceValueScore: evaluation.aiExperienceValueScore,
      aiGameplaySystemsScore: evaluation.aiGameplaySystemsScore,
      aiContentPresentationScore: evaluation.aiContentPresentationScore,
      expiryDays: options.expiryDays || 7,
    });
    await app.listen();
    audit.events.push({ component: 'Node', action: 'Create human rating session', status: 'completed', detail: `Session ${created.session.id} created; rating service started` });

    failedStep = 'Progression finalization';
    const existingProgress = await readFile(documents.progress, 'utf8');
    rendered = renderer({ evalCase, evaluation, execution, evaluationId, documents: documentNames, assets, audit });
    await writeTextAtomic(documents.progress, preserveProgressSyncBlocks(rendered.progress, existingProgress));
    return {
      app,
      case: evalCase,
      evaluation,
      execution,
      evaluationId,
      session: created.session,
      documents: created.documents,
      playerUrl: `${app.baseUrl}/?session=${encodeURIComponent(created.session.publicToken)}`,
    };
  } catch (error) {
    audit.events.push({ component: failedStep.startsWith('AI') ? 'AI' : 'Node', action: failedStep, status: 'failed', detail: error.message });
    if (created?.session?.id && app?.store?.deleteSession) await app.store.deleteSession(created.session.id).catch(() => {});
    if (app?.baseUrl) await app.close().catch(() => {});
    const retry = `npm run eval -- --case ${evalCase.id} --provider ${provider}${options.model ? ` --model ${options.model}` : ''}`;
    try {
      await (options.failureWriter || writeFailureProgression)(documents.progress, {
        evalCase, evaluationId, provider, requestedModel, observedModel: execution?.observedModel,
        startedAt: execution?.startedAt || startedAt, finishedAt: new Date().toISOString(), exitCode: execution?.exitCode,
        prompt, assets, events: audit.events, error, failedStep, retryCommand: retry,
        completedOutputs: audit.evidence ? [audit.evidence.path] : [],
        incompleteOutputs: ['Problem, Result, or human rating session need review'],
      });
    } catch (auditError) {
      throw new Error(`${error.message}; failed to write failure Progression: ${auditError.message}`);
    }
    throw error;
  }
}

export function formatEvaluationScore(result) {
  const { evaluation } = result;
  return `Experience Value: ${decimal(evaluation.aiExperienceValueScore)}/30
Gameplay and Systems: ${decimal(evaluation.aiGameplaySystemsScore)}/40
Content and Presentation: ${decimal(evaluation.aiContentPresentationScore)}/30
Total: ${decimal(evaluation.aiTotalScore)}/100
Human rating: ${result.playerUrl}`;
}

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} is missing a value`);
  return value;
}

export function parseCliOptions(argv = []) {
  const parsed = { caseId: undefined, provider: 'claude', model: undefined, listCases: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--list-cases') parsed.listCases = true;
    else if (argument === '--case') { parsed.caseId = takeValue(argv, index, '--case'); index += 1; }
    else if (argument.startsWith('--case=')) parsed.caseId = argument.slice('--case='.length) || (() => { throw new Error('--case is missing a value'); })();
    else if (argument === '--provider') { parsed.provider = takeValue(argv, index, '--provider'); index += 1; }
    else if (argument.startsWith('--provider=')) parsed.provider = argument.slice('--provider='.length) || (() => { throw new Error('--provider is missing a value'); })();
    else if (argument === '--model') { parsed.model = takeValue(argv, index, '--model'); index += 1; }
    else if (argument.startsWith('--model=')) parsed.model = argument.slice('--model='.length) || (() => { throw new Error('--model is missing a value'); })();
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

export async function runCli(options = {}) {
  const parsed = parseCliOptions(options.argv || []);
  const write = options.write || console.log;
  if (parsed.listCases) {
    const caseIds = await (options.listCases || listEvalCaseIds)();
    for (const id of caseIds) write(id);
    return { listed: true, caseIds };
  }
  const result = await (options.evaluate || evaluateCase)({ caseId: parsed.caseId, provider: parsed.provider, model: parsed.model });
  write(formatEvaluationScore(result));
  return result;
}

async function startCli() {
  try { await runCli({ argv: process.argv.slice(2) }); }
  catch (error) {
    console.error(`Evaluation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startCli();
