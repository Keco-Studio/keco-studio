import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hashJson = (value: unknown) =>
  `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

type CanonicalDocument = {
  kind: 'roadmap' | 'spec' | 'plan' | 'status';
  documentId: string;
  name: string;
  repositoryPath: string;
  markdown: string;
  yjsState: string;
};

type SliceBundle = {
  runId: string;
  documents: CanonicalDocument[];
  result: Record<string, unknown>;
  args: Record<string, unknown>;
};

function normalizeMarkdown(markdown: string): { markdown: string; yjsStateBase64: string } {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: JSON.stringify({ mode: 'normalize', markdown }),
    env: { ...process.env, DOCUMENT_CODEC_COMMONJS: '1' },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(result.stdout) as { markdown: string; yjsStateBase64: string };
}

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object RPC result');
  }
  return value as Record<string, unknown>;
}

describeDb('deterministic Slice ledger real Postgres behavior', () => {
  let fx: ProjectFixture;
  let folderId = '';

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const folder = await fx.svc.from('folders').insert({
      project_id: fx.projectId,
      name: `slice-ledger-${fx.suffix}`,
      updated_by: fx.owner.id,
    }).select('id').single();
    if (folder.error || !folder.data) {
      throw new Error(`create Slice test folder failed: ${folder.error?.message}`);
    }
    folderId = String(folder.data.id);
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  });

  async function createBundle(options: {
    manualRequired?: boolean;
    taskIds?: string[];
    evaluationIds?: string[];
    duplicateName?: boolean;
  } = {}): Promise<SliceBundle> {
    const runId = crypto.randomUUID();
    const sliceId = `slice-${runId.slice(0, 8)}`;
    const taskIds = options.taskIds ?? ['task-1'];
    const evaluationIds = options.evaluationIds ?? ['eval-1'];
    const kinds = ['roadmap', 'spec', 'plan', 'status'] as const;
    const documents = kinds.map((kind, index) => {
      const normalized = normalizeMarkdown(`# ${kind} ${runId}\n`);
      return {
        kind,
        documentId: crypto.randomUUID(),
        name: options.duplicateName && index === 1
          ? `roadmap-${runId}`
          : `${kind}-${runId}`,
        repositoryPath: `docs/keco-godot-slices/${sliceId}/${kind}.${kind === 'status' ? 'json' : 'md'}`,
        markdown: normalized.markdown,
        yjsState: normalized.yjsStateBase64,
      };
    });
    const plan = {
      schemaVersion: 1,
      planRevision: hash('1'),
      allowedFiles: ['scripts/game.gd'],
      tasks: taskIds.map(id => ({
        id,
        files: ['scripts/game.gd'],
        dependsOn: [],
        servesEvaluations: evaluationIds,
        red: { command: 'npm run test:red', expected: 'fails' },
        green: { command: 'npm run test:green', expected: 'passes' },
        review: { spec: 'required', quality: 'required' },
      })),
    };
    const evalSpec = {
      schemaVersion: 1,
      evaluations: evaluationIds.map(evalId => ({
        evalId,
        buildHash: hash('a'),
        snapshotHash: hash('b'),
        assertions: [{
          assertionId: 'guardian',
          kind: 'equals',
          path: '/guardianRoundtrip',
          expected: true,
        }],
        manualRequired: options.manualRequired ?? false,
      })),
    };
    const deliveryPolicy = {
      schemaVersion: 1,
      requiredArtifacts: ['TaskResult', 'TaskReview', 'EvalReport', 'MirrorVerification'],
      runtimeEvidenceFreshness: 'current_build_and_snapshot',
      maximumRepairs: 3,
      releaseOrder: ['implementation', 'runtime_verification', 'acceptance', 'mirrors', 'package'],
      manualReviewBlocksRelease: true,
    };
    const args = {
      p_project_id: fx.projectId,
      p_run_id: runId,
      p_folder_id: folderId,
      p_slice_id: sliceId,
      p_plan_data: plan,
      p_plan_hash: hashJson(plan),
      p_eval_spec: evalSpec,
      p_eval_spec_hash: hashJson(evalSpec),
      p_delivery_policy: deliveryPolicy,
      p_delivery_policy_hash: hashJson(deliveryPolicy),
      p_documents: documents,
      p_idempotency_key: `create:${runId}`,
      p_input_hash: hash('4'),
    };
    const created = await fx.editor.client.rpc('mcp_create_slice_bundle', args);
    if (created.error) {
      throw new Error(`create bundle failed: ${created.error.code} ${created.error.message} ${created.error.details ?? ''} ${created.error.hint ?? ''}`);
    }
    return { runId, documents, result: row(created.data), args };
  }

  function event(eventType: string, payload: Record<string, unknown>) {
    return {
      eventId: crypto.randomUUID(),
      eventType,
      payload,
      inputHash: hashJson(payload),
      outputHash: hashJson({ eventType, payload }),
    };
  }

  function executionPrerequisites() {
    return [
      event('plan_accepted', { planRevision: hash('1'), acceptedAt: '2026-08-27T00:00:00Z' }),
      event('write_lease', {
        leaseId: crypto.randomUUID(),
        allowedFiles: ['scripts/game.gd'],
        acquiredAt: '2026-08-27T00:00:00Z',
        expiresAt: '2026-08-28T00:00:00Z',
      }),
    ];
  }

  function deliveryGates(status: 'passed' | 'failed' = 'passed') {
    return ['implementation', 'runtime_verification', 'acceptance', 'mirrors', 'package']
      .map((gate, index) => event('delivery_check', { gate, status, evidenceHash: hash(String(index + 1)) }));
  }

  function observation(runId: string, sliceId: string, guardianRoundtrip: boolean) {
    return {
      schemaVersion: 1,
      runId,
      sliceId,
      evalId: 'eval-1',
      buildHash: hash('a'),
      snapshotHash: hash('b'),
      actual: { guardianRoundtrip },
      errors: [],
    };
  }

  function taskResult(bundle: SliceBundle) {
    return event('task_result', {
      schemaVersion: 1, runId: bundle.runId, sliceId: String(bundle.args.p_slice_id), taskId: 'task-1', planRevision: hash('1'), attemptId: crypto.randomUUID(),
      phase: 'green', operation: { kind: 'command', command: 'npm run test:green' }, startedAt: '2026-08-27T00:00:00Z', endedAt: '2026-08-27T00:00:01Z',
      exitCode: 0, timedOut: false, cancelled: false, stdoutSummary: '', stdoutHash: hash('a'), stderrSummary: '', stderrHash: hash('b'),
      changedFiles: [], expectedOutcome: 'passes', observedOutcome: 'passed', status: 'completed', concerns: [], artifactIds: [],
    });
  }

  function taskReview(bundle: SliceBundle, resultEventId: string) {
    return event('task_review', {
      schemaVersion: 1, runId: bundle.runId, sliceId: String(bundle.args.p_slice_id), taskId: 'task-1', planRevision: hash('1'),
      taskResultIds: [resultEventId], reviewedFiles: [], reviewerType: 'agent', reviewerId: fx.editor.id, verdict: 'accepted',
      specificationFindings: [], qualityFindings: [], requiredFollowUp: [],
    });
  }

  async function checkpoint(
    bundle: SliceBundle,
    stateToken: string,
    events: Array<Record<string, unknown>>,
    key = `checkpoint:${crypto.randomUUID()}`,
    artifacts: Array<Record<string, unknown>> = [],
  ) {
    const computedEvaluations = events.filter(item => item.eventType === 'runtime_observation').map(item => {
      const runtime = (item.payload as Record<string, unknown>).observation as Record<string, unknown>;
      const actual = runtime.actual as Record<string, unknown>;
      const passed = actual.guardianRoundtrip === true;
      const spec = ((bundle.args.p_eval_spec as Record<string, unknown>).evaluations as Array<Record<string, unknown>>)
        .find(candidate => candidate.evalId === runtime.evalId)!;
      const manualRequired = Boolean(spec.manualRequired);
      if (runtime.buildHash !== spec.buildHash || runtime.snapshotHash !== spec.snapshotHash) {
        return { evalId: runtime.evalId, status: 'failed', manualRequired, assertions: [],
          reasonCodes: [runtime.buildHash !== spec.buildHash ? 'BUILD_HASH_MISMATCH' : 'SNAPSHOT_HASH_MISMATCH'] };
      }
      return { evalId: runtime.evalId, status: passed ? 'passed' : 'failed', manualRequired,
        assertions: [{ assertionId: 'guardian', status: passed ? 'passed' : 'failed', reasonCode: passed ? 'OK' : 'VALUE_MISMATCH', actual: actual.guardianRoundtrip }], reasonCodes: passed ? [] : ['VALUE_MISMATCH'] };
    });
    return await fx.editor.client.rpc('mcp_checkpoint_slice', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
      p_expected_state_token: stateToken,
      p_events: events,
      p_artifacts: artifacts,
      p_idempotency_key: key,
      p_input_hash: hash(key.includes('same') ? '7' : '8'),
      p_computed_evaluations: computedEvaluations,
    });
  }

  it('rolls back a partial document bundle and enforces writer authorization', async () => {
    const before = await fx.svc.from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('folder_id', folderId);
    expect(before.error).toBeNull();
    const failed = await createBundle({ duplicateName: true }).catch(error => error as Error);
    expect(failed).toBeInstanceOf(Error);
    const message = (failed as Error).message;
    expect(message).toMatch(/23505|already exists/i);
    const after = await fx.svc.from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('folder_id', folderId);
    expect(after.error).toBeNull();
    expect(after.count).toBe(before.count);

    const deniedRunId = crypto.randomUUID();
    const normalized = normalizeMarkdown('# denied\n');
    const denied = await fx.viewer.client.rpc('mcp_create_slice_bundle', {
      p_project_id: fx.projectId,
      p_run_id: deniedRunId,
      p_folder_id: folderId,
      p_slice_id: `slice-${deniedRunId.slice(0, 8)}`,
      p_plan_data: { schemaVersion: 1, planRevision: hash('1'), tasks: [{ id: 'task-1' }] },
      p_plan_hash: hash('1'),
      p_eval_spec: { schemaVersion: 1, evaluations: [{
        evalId: 'eval-1', buildHash: hash('a'), snapshotHash: hash('b'),
        assertions: [{ assertionId: 'a', kind: 'equals', path: '/ok', expected: true }],
      }] },
      p_eval_spec_hash: hash('2'),
      p_delivery_policy: { schemaVersion: 1, maximumRepairs: 3, manualReviewBlocksRelease: true },
      p_delivery_policy_hash: hash('3'),
      p_documents: ['roadmap', 'spec', 'plan'].map(kind => ({
        kind, documentId: crypto.randomUUID(), name: `${kind}-${deniedRunId}`,
        repositoryPath: `docs/${kind}.md`, markdown: normalized.markdown,
        yjsState: normalized.yjsStateBase64,
      })),
      p_idempotency_key: `create:${deniedRunId}`,
      p_input_hash: hash('4'),
    });
    expect(denied.error?.code).toBe('42501');
  });

  it('replays exact requests and rejects changed input under the same key', async () => {
    const bundle = await createBundle();
    expect(bundle.result.outcome).toBe('created');
    const replay = await fx.editor.client.rpc('mcp_create_slice_bundle', bundle.args);
    expect(replay.error).toBeNull();
    expect(row(replay.data)).toMatchObject({
      outcome: 'reused',
      runId: bundle.runId,
      stateToken: bundle.result.stateToken,
    });
    const forgedHash = await fx.editor.client.rpc('mcp_create_slice_bundle', {
      ...bundle.args,
      p_input_hash: hash('9'),
    });
    expect(forgedHash.error).toBeNull();
    expect(row(forgedHash.data).outcome).toBe('reused');
    const conflict = await fx.editor.client.rpc('mcp_create_slice_bundle', {
      ...bundle.args,
      p_slice_id: `${bundle.args.p_slice_id}-changed`,
      p_input_hash: hash('9'),
    });
    expect(conflict.error?.code).toBe('KS409');

    const forgedContract = await fx.editor.client.rpc('mcp_create_slice_bundle', {
      ...bundle.args,
      p_run_id: crypto.randomUUID(),
      p_slice_id: `${bundle.args.p_slice_id}-forged`,
      p_plan_hash: hash('f'),
      p_idempotency_key: `forged:${bundle.runId}`,
    });
    expect(forgedContract.error?.code).toBe('22023');
  });

  it('keeps missing evaluations partial and preserves manual requirements on early failures', async () => {
    const bundle = await createBundle({ evaluationIds: ['eval-1', 'eval-2'] });
    const completedTask = taskResult(bundle);
    const partial = await checkpoint(bundle, String(bundle.result.stateToken), [
      ...executionPrerequisites(),
      completedTask,
      taskReview(bundle, completedTask.eventId),
      event('runtime_observation', { observation: observation(bundle.runId, String(bundle.args.p_slice_id), true) }),
    ]);
    expect(partial.error).toBeNull();
    expect(row(partial.data).projection).toMatchObject({
      runtimeVerificationStatus: 'partial',
      acceptanceStatus: 'partial',
    });

    const manual = await createBundle({ manualRequired: true });
    const staleBuild = observation(manual.runId, String(manual.args.p_slice_id), true);
    staleBuild.buildHash = hash('c');
    const failed = await checkpoint(manual, String(manual.result.stateToken), [
      event('runtime_observation', { observation: staleBuild }),
    ]);
    expect(failed.error).toBeNull();
    expect((row(failed.data).computedEvaluations as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: 'failed',
      manualRequired: true,
      reasonCodes: ['BUILD_HASH_MISMATCH'],
    });
  });

  it('rejects task evidence without the accepted lease, approved command, latest result, or reviewer actor', async () => {
    const bundle = await createBundle();
    const firstResult = taskResult(bundle);
    const noLease = await checkpoint(bundle, String(bundle.result.stateToken), [firstResult]);
    expect(noLease.error?.code).toBe('22023');

    const prerequisites = await checkpoint(bundle, String(bundle.result.stateToken), executionPrerequisites());
    expect(prerequisites.error).toBeNull();
    const wrongCommandPayload = {
      ...(firstResult.payload as Record<string, unknown>),
      operation: { kind: 'command', command: 'npm run unapproved' },
    };
    const wrongCommand = await checkpoint(bundle, String(row(prerequisites.data).stateToken), [
      event('task_result', wrongCommandPayload),
    ]);
    expect(wrongCommand.error?.code).toBe('22023');

    const acceptedFirst = await checkpoint(bundle, String(row(prerequisites.data).stateToken), [firstResult]);
    expect(acceptedFirst.error).toBeNull();
    const secondResult = taskResult(bundle);
    const acceptedSecond = await checkpoint(bundle, String(row(acceptedFirst.data).stateToken), [secondResult]);
    expect(acceptedSecond.error).toBeNull();
    const staleReview = await checkpoint(bundle, String(row(acceptedSecond.data).stateToken), [
      taskReview(bundle, firstResult.eventId),
    ]);
    expect(staleReview.error?.code).toBe('22023');
    const latestReview = taskReview(bundle, secondResult.eventId);
    const wrongReviewer = await checkpoint(bundle, String(row(acceptedSecond.data).stateToken), [
      event('task_review', { ...(latestReview.payload as Record<string, unknown>), reviewerId: fx.owner.id }),
    ]);
    expect(wrongReviewer.error?.code).toBe('22023');
    const reviewed = await checkpoint(bundle, String(row(acceptedSecond.data).stateToken), [latestReview]);
    expect(reviewed.error).toBeNull();
    expect(row(reviewed.data).projection).toMatchObject({ implementationStatus: 'completed' });
  });

  it('computes assertions, recovers from the latest repair, and enforces CAS and hash order', async () => {
    const bundle = await createBundle();
    const sliceId = String(bundle.args.p_slice_id);
    const firstToken = String(bundle.result.stateToken);
    const claimedPass = await checkpoint(bundle, firstToken, [
      event('runtime_observation', {
        observation: {
          ...observation(bundle.runId, sliceId, false),
          status: 'passed',
          expected: { guardianRoundtrip: true },
        },
      }),
    ]);
    expect(claimedPass.error?.code).toBe('22023');
    const completedTask = taskResult(bundle);
    const initial = await checkpoint(bundle, firstToken, [
      ...executionPrerequisites(),
      completedTask,
      taskReview(bundle, completedTask.eventId),
      event('runtime_observation', { observation: observation(bundle.runId, sliceId, false) }),
    ]);
    expect(initial.error).toBeNull();
    const initialRow = row(initial.data);
    expect(initialRow.projection).toMatchObject({
      implementationStatus: 'completed',
      runtimeVerificationStatus: 'failed',
    });

    const stale = await checkpoint(bundle, firstToken, [event('delivery_check', { gate: 'package', status: 'passed', evidenceHash: hash('d') })]);
    expect(stale.error?.code).toBe('KS410');

    const repaired = await checkpoint(bundle, String(initialRow.stateToken), [
      event('repair_transition', { reason: 'objective assertion failed' }),
      event('runtime_observation', { observation: observation(bundle.runId, sliceId, true) }),
    ]);
    expect(repaired.error).toBeNull();
    const repairedRow = row(repaired.data);
    expect(repairedRow).toMatchObject({
      repairCount: 1,
      projection: expect.objectContaining({ runtimeVerificationStatus: 'passed' }),
    });

    const events = await fx.svc.from('keco_slice_run_events')
      .select('sequence,event_type,previous_event_hash,event_hash,payload')
      .eq('run_id', bundle.runId)
      .order('sequence');
    expect(events.error).toBeNull();
    expect(events.data?.map(item => item.sequence)).toEqual(
      Array.from({ length: events.data?.length ?? 0 }, (_, index) => index + 1),
    );
    for (let index = 1; index < (events.data?.length ?? 0); index += 1) {
      expect(events.data?.[index].previous_event_hash).toBe(events.data?.[index - 1].event_hash);
    }
    const assertionResults = events.data?.filter(item => item.event_type === 'assertion_result') ?? [];
    expect(assertionResults.map(item => item.payload.result.status)).toEqual(['failed', 'passed']);

    let token = String(repairedRow.stateToken);
    for (let repair = 2; repair <= 3; repair += 1) {
      const next = await checkpoint(bundle, token, [event('repair_transition', { reason: `repair ${repair}` })]);
      expect(next.error).toBeNull();
      token = String(row(next.data).stateToken);
    }
    const fourth = await checkpoint(bundle, token, [event('repair_transition', { reason: 'repair 4' })]);
    expect(fourth.error?.code).toBe('KS411');
  });

  it('serializes concurrent appends with one CAS winner', async () => {
    const bundle = await createBundle();
    const token = String(bundle.result.stateToken);
    const [left, right] = await Promise.all([
      checkpoint(bundle, token, [event('delivery_check', { gate: 'package', status: 'passed', evidenceHash: hash('c') })], 'checkpoint:left'),
      checkpoint(bundle, token, [event('delivery_check', { gate: 'package', status: 'passed', evidenceHash: hash('d') })], 'checkpoint:right'),
    ]);
    const results = [left, right];
    expect(results.filter(result => result.error === null)).toHaveLength(1);
    expect(results.filter(result => result.error?.code === 'KS410')).toHaveLength(1);
  });

  it.each([
    [false, 'ready', false],
    [true, 'blocked_by_manual_review', true],
  ])('requires all delivery gates and matching mirror evidence (manual=%s)', async (manualRequired, readiness, deliveryBlocked) => {
    const bundle = await createBundle({ manualRequired });
    const sliceId = String(bundle.args.p_slice_id);
    const completedTask = taskResult(bundle);
    const verified = await checkpoint(bundle, String(bundle.result.stateToken), [
      ...executionPrerequisites(),
      completedTask,
      taskReview(bundle, completedTask.eventId),
      event('runtime_observation', { observation: observation(bundle.runId, sliceId, true) }),
      ...deliveryGates().slice(0, -1),
    ]);
    expect(verified.error).toBeNull();
    expect(row(verified.data).projection).toMatchObject({
      releaseReadiness: deliveryBlocked ? readiness : 'not_ready',
    });
    const packaged = await checkpoint(bundle, String(row(verified.data).stateToken), [deliveryGates()[4]]);
    expect(packaged.error).toBeNull();

    const projection = row(packaged.data).projection as Record<string, unknown>;
    const projectionMarkdown = (kind: 'roadmap' | 'status' | 'evalReport') => normalizeMarkdown([
      `# Keco Slice ${kind}`,
      'schemaVersion: 1',
      `runId: ${bundle.runId}`,
      `sliceId: ${sliceId}`,
      `sequence: ${row(packaged.data).currentSequence}`,
      `implementationStatus: ${projection.implementationStatus}`,
      `runtimeVerificationStatus: ${projection.runtimeVerificationStatus}`,
      `acceptanceStatus: ${projection.acceptanceStatus}`,
      `releaseReadiness: ${projection.releaseReadiness}`,
      '',
    ].join('\n'));
    const projectedDocuments = bundle.documents.map(document => {
      const generated = document.kind === 'roadmap' || document.kind === 'status'
        ? projectionMarkdown(document.kind)
        : { markdown: document.markdown, yjsStateBase64: document.yjsState };
      return {
        documentId: document.documentId,
        expectedEpoch: 0,
        expectedRevision: 1,
        markdown: generated.markdown,
        yjsState: generated.yjsStateBase64,
      };
    });
    const evalReport = projectionMarkdown('evalReport');
    const implementation = await fx.editor.client.rpc('mcp_finalize_slice', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
      p_expected_state_token: row(packaged.data).stateToken,
      p_documents: [...projectedDocuments, {
        kind: 'evalReport',
        documentId: crypto.randomUUID(),
        name: `eval-report-${bundle.runId}`,
        repositoryPath: `docs/keco-godot-slices/${sliceId}/eval-report.json`,
        markdown: evalReport.markdown,
        yjsState: evalReport.yjsStateBase64,
      }],
      p_requested_terminal_intent: 'implementation_complete',
      p_mirror_verification_event_id: null,
      p_mirror_manifest_hash: null,
      p_idempotency_key: `implementation:${bundle.runId}`,
      p_input_hash: hash('e'),
    });
    expect(implementation.error).toBeNull();

    const exported = await fx.viewer.client.rpc('mcp_export_slice_mirrors', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
    });
    expect(exported.error).toBeNull();
    const manifest = row(exported.data);
    expect(manifest.files).toHaveLength(5);
    expect(manifest.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const file of manifest.files as Array<Record<string, unknown>>) {
      const content = String(file.content);
      expect(file.byteCount).toBe(Buffer.byteLength(content));
      expect(file.sha256).toBe(`sha256:${createHash('sha256').update(content).digest('hex')}`);
    }

    const staleMirror = await checkpoint(bundle, String(row(implementation.data).stateToken), [
      event('mirror_verification', {
        status: 'verified',
        manifestHash: hash('0'),
      }),
    ]);
    expect(staleMirror.error?.code).toBe('22023');

    const mirrorEvent = event('mirror_verification', {
      status: 'verified',
      manifestHash: manifest.manifestHash,
    });
    const mirrorPayload = {
      schemaVersion: 1,
      artifactType: 'MirrorVerification',
      runId: bundle.runId,
      stateToken: manifest.stateToken,
      manifestHash: manifest.manifestHash,
      files: (manifest.files as Array<Record<string, unknown>>).map(file => ({
        repositoryPath: file.repositoryPath,
        byteCount: file.byteCount,
        sha256: file.sha256,
      })),
    };
    const missingArtifact = await checkpoint(bundle, String(row(implementation.data).stateToken), [mirrorEvent]);
    expect(missingArtifact.error?.code).toBe('22023');
    const mirror = await checkpoint(bundle, String(row(implementation.data).stateToken), [mirrorEvent], undefined, [{
      artifactId: crypto.randomUUID(),
      eventId: mirrorEvent.eventId,
      artifactType: 'mirror_verification',
      schemaVersion: 1,
      contentHash: hashJson(mirrorPayload),
      payload: mirrorPayload,
    }]);
    expect(mirror.error).toBeNull();
    expect(row(mirror.data).projection).toMatchObject({
      runtimeVerificationStatus: 'passed',
      releaseReadiness: readiness,
    });

    const finalized = await fx.editor.client.rpc('mcp_finalize_slice', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
      p_expected_state_token: row(mirror.data).stateToken,
      p_documents: [],
      p_requested_terminal_intent: 'delivery',
      p_mirror_verification_event_id: mirrorEvent.eventId,
      p_mirror_manifest_hash: manifest.manifestHash,
      p_idempotency_key: `delivery:${bundle.runId}`,
      p_input_hash: hash('f'),
    });
    if (deliveryBlocked) {
      expect(finalized.error?.code).toBe('KS412');
    } else {
      expect(finalized.error).toBeNull();
      expect(row(finalized.data).projection).toMatchObject({ releaseReadiness: readiness });
    }

    const revisions = await fx.svc.from('documents')
      .select('id,collab_epoch,collab_revision')
      .in('id', bundle.documents.map(document => document.documentId));
    expect(revisions.error).toBeNull();
    expect(revisions.data).toHaveLength(4);
    expect(revisions.data?.filter(document =>
      bundle.documents.some(source => source.documentId === document.id && (source.kind === 'roadmap' || source.kind === 'status'))
    ).every(document => document.collab_epoch === 1 && document.collab_revision === 2)).toBe(true);

    const outsiderRead = await fx.outsider.client.from('keco_slice_runs')
      .select('id').eq('id', bundle.runId);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);
    const viewerRead = await fx.viewer.client.from('keco_slice_runs')
      .select('id').eq('id', bundle.runId);
    expect(viewerRead.error).toBeNull();
    expect(viewerRead.data).toEqual([{ id: bundle.runId }]);
  });
});

describeDb('Slice contract version 2 real Postgres behavior', () => {
  let fx: ProjectFixture;
  let planningRootId = '';
  let specFolderId = '';
  let planFolderId = '';

  function eventV2(eventType: string, payload: Record<string, unknown>) {
    return {
      eventId: crypto.randomUUID(),
      eventType,
      payload,
      inputHash: hashJson(payload),
      outputHash: hashJson({ eventType, payload }),
    };
  }

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const root = await fx.svc.from('folders').insert({
      project_id: fx.projectId,
      name: `slice-v2-${fx.suffix}`,
      updated_by: fx.owner.id,
    }).select('id').single();
    if (root.error || !root.data) throw new Error(`create V2 planning root failed: ${root.error?.message}`);
    planningRootId = String(root.data.id);
    const children = await fx.svc.from('folders').insert(['spec', 'plan'].map(name => ({
      project_id: fx.projectId,
      parent_folder_id: planningRootId,
      name,
      updated_by: fx.owner.id,
    }))).select('id,name');
    if (children.error || !children.data) throw new Error(`create V2 child folders failed: ${children.error?.message}`);
    specFolderId = String(children.data.find(item => item.name === 'spec')?.id);
    planFolderId = String(children.data.find(item => item.name === 'plan')?.id);
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  });

  async function createV2Bundle(roadmap?: Record<string, unknown>) {
    const runId = crypto.randomUUID();
    const sliceId = `slice-${runId.slice(0, 8)}`;
    const sourceProfile = {
      schemaVersion: 1,
      contractVersion: 2,
      kind: 'document',
      kecoProjectId: fx.projectId,
      capturedAt: '2026-09-03T00:00:00Z',
      sourceHash: hash('a'),
      selectionEvidence: [],
      documentId: crypto.randomUUID(),
      epoch: 0,
      revision: 1,
      contentHash: hash('b'),
    };
    const plan = {
      schemaVersion: 2,
      coverageMode: 'non_gdd',
      sourceProfileHash: hashJson(sourceProfile),
      nonGddRationale: 'The selected document directly authorizes this Slice.',
      planRevision: hash('c'),
      allowedFiles: ['game/main.gd'],
      tasks: [{
        id: 'task-1', files: ['game/main.gd'], dependsOn: [], servesEvaluations: ['eval-1'],
        red: { command: 'test red', expected: 'fails' },
        green: { command: 'test green', expected: 'passes' },
        review: { minimumLevel: 'self' }, sourceMappings: ['source-1'],
      }],
    };
    const evalSpec = {
      schemaVersion: 2,
      coverageMode: 'non_gdd',
      sourceProfileHash: hashJson(sourceProfile),
      evaluations: [{
        evalId: 'eval-1', servedByTasks: ['task-1'], buildHash: hash('d'), snapshotHash: hash('e'),
        assertions: [{ assertionId: 'ready', kind: 'equals', path: '/ready', expected: true }],
      }],
    };
    const policy = {
      schemaVersion: 2,
      requiredArtifacts: ['TaskResult', 'TaskReview', 'EvalReport', 'MirrorVerification'],
      runtimeEvidenceFreshness: 'current_build_and_snapshot', maximumRepairs: 3,
      releaseOrder: ['implementation', 'runtime_verification', 'acceptance', 'manual_review', 'package', 'roadmap_completion', 'mirrors', 'seal'],
      manualReviewBlocksRelease: true,
    };
    const createBinding = (kind: 'roadmap' | 'spec' | 'plan', folderId: string, name: string, repositoryPath: string) => {
      const encoded = normalizeMarkdown(`# ${kind} ${sliceId}\n- [ ] ${sliceId}\n`);
      return { kind, disposition: 'create', folderId, name, repositoryPath, documentId: crypto.randomUUID(), markdown: encoded.markdown, yjsState: encoded.yjsStateBase64 };
    };
    let roadmapBinding = roadmap;
    if (!roadmapBinding) {
      const existing = await fx.svc.from('documents')
        .select('id,content,collab_epoch,collab_revision')
        .eq('project_id', fx.projectId).eq('folder_id', planningRootId).eq('name', 'roadmap')
        .maybeSingle();
      if (existing.error) throw new Error(`read V2 roadmap failed: ${existing.error.message}`);
      roadmapBinding = existing.data ? {
        kind: 'roadmap', disposition: 'bind', folderId: planningRootId, name: 'roadmap',
        repositoryPath: 'docs/superpowers/roadmap.md', documentId: existing.data.id,
        expectedEpoch: existing.data.collab_epoch, expectedRevision: existing.data.collab_revision,
        contentHash: `sha256:${createHash('sha256').update(existing.data.content).digest('hex')}`,
      } : createBinding('roadmap', planningRootId, 'roadmap', 'docs/superpowers/roadmap.md');
    }
    const documentBindings = [
      roadmapBinding,
      createBinding('spec', specFolderId, sliceId, `docs/superpowers/specs/${sliceId}-design.md`),
      createBinding('plan', planFolderId, sliceId, `docs/superpowers/plans/${sliceId}.md`),
    ];
    const args = {
      p_project_id: fx.projectId, p_run_id: runId, p_planning_root_id: planningRootId,
      p_slice_id: sliceId, p_source_profile: sourceProfile, p_source_profile_hash: hashJson(sourceProfile),
      p_plan_data: plan, p_plan_hash: hashJson(plan), p_eval_spec: evalSpec, p_eval_spec_hash: hashJson(evalSpec),
      p_delivery_policy: policy, p_delivery_policy_hash: hashJson(policy), p_document_bindings: documentBindings,
      p_supersedes_run_id: null, p_idempotency_key: `create-v2:${runId}`, p_input_hash: hash('f'),
    };
    const created = await fx.editor.client.rpc('mcp_create_slice_bundle_v2', args);
    if (created.error) throw new Error(`create V2 bundle failed: ${created.error.code} ${created.error.message}`);
    return { runId, sliceId, args, result: row(created.data) };
  }

  async function checkpointV2(runId: string, token: string, events: Array<Record<string, unknown>>) {
    const key = `checkpoint-v2:${crypto.randomUUID()}`;
    return fx.editor.client.rpc('mcp_checkpoint_slice_v2', {
      p_project_id: fx.projectId, p_run_id: runId, p_expected_state_token: token,
      p_events: events, p_artifacts: [], p_document_progress: null,
      p_idempotency_key: key, p_input_hash: hash('9'), p_computed_evaluations: [],
    });
  }

  it('creates same-name spec and plan in distinct folders and binds the roadmap for a second Slice', async () => {
    const first = await createV2Bundle();
    const documents = first.result.documents as Record<string, Record<string, unknown>>;
    const second = await createV2Bundle({
      kind: 'roadmap', disposition: 'bind', folderId: planningRootId, name: 'roadmap',
      repositoryPath: 'docs/superpowers/roadmap.md', documentId: documents.roadmap.documentId,
      expectedEpoch: documents.roadmap.epoch, expectedRevision: documents.roadmap.revision,
      contentHash: documents.roadmap.contentHash,
    });
    const secondDocuments = second.result.documents as Record<string, Record<string, unknown>>;
    expect(secondDocuments.roadmap.documentId).toBe(documents.roadmap.documentId);
    const pairs = await fx.svc.from('documents').select('name,folder_id').in('id', [
      secondDocuments.spec.documentId, secondDocuments.plan.documentId,
    ]);
    expect(pairs.error).toBeNull();
    expect(pairs.data).toEqual(expect.arrayContaining([
      { name: second.sliceId, folder_id: specFolderId },
      { name: second.sliceId, folder_id: planFolderId },
    ]));
  });

  it('rejects same-actor independent review and a fourth repair across fresh keys', async () => {
    const bundle = await createV2Bundle();
    const prerequisites = await checkpointV2(bundle.runId, String(bundle.result.stateToken), [
      eventV2('plan_accepted', { planRevision: hash('c'), acceptedAt: '2026-09-03T00:00:00Z' }),
      eventV2('write_lease', { leaseId: crypto.randomUUID(), allowedFiles: ['game/main.gd'], acquiredAt: '2026-09-03T00:00:00Z', expiresAt: '2026-09-04T00:00:00Z' }),
    ]);
    expect(prerequisites.error).toBeNull();
    let token = String(row(prerequisites.data).stateToken);
    const resultEvent = eventV2('task_result', {
      schemaVersion: 1, runId: bundle.runId, sliceId: bundle.sliceId, taskId: 'task-1', planRevision: hash('c'), attemptId: crypto.randomUUID(),
      phase: 'green', operation: { kind: 'command', command: 'test green' }, startedAt: '2026-09-03T00:00:00Z', endedAt: '2026-09-03T00:00:01Z',
      exitCode: 0, timedOut: false, cancelled: false, stdoutSummary: '', stdoutHash: hash('1'), stderrSummary: '', stderrHash: hash('2'),
      changedFiles: [], expectedOutcome: 'passes', observedOutcome: 'passed', status: 'completed', concerns: [], artifactIds: [],
    });
    const result = await checkpointV2(bundle.runId, token, [resultEvent]);
    expect(result.error).toBeNull();
    token = String(row(result.data).stateToken);
    const forged = await checkpointV2(bundle.runId, token, [eventV2('task_review', {
      schemaVersion: 1, runId: bundle.runId, sliceId: bundle.sliceId, taskId: 'task-1', planRevision: hash('c'),
      taskResultIds: [resultEvent.eventId], reviewedFiles: [], reviewerType: 'agent', reviewerId: fx.editor.id,
      requestedLevel: 'independent_actor', verdict: 'accepted', specificationFindings: [], qualityFindings: [], requiredFollowUp: [],
    })]);
    expect(forged.error?.message).toContain('SLICE_REVIEW_LEVEL_INVALID');
    for (let iteration = 1; iteration <= 3; iteration += 1) {
      const repaired = await checkpointV2(bundle.runId, token, [eventV2('repair_transition', { reason: `repair ${iteration}`, failedEvaluationIds: ['eval-1'] })]);
      expect(repaired.error).toBeNull();
      token = String(row(repaired.data).stateToken);
    }
    const fourth = await checkpointV2(bundle.runId, token, [eventV2('repair_transition', { reason: 'repair 4', failedEvaluationIds: ['eval-1'] })]);
    expect(fourth.error?.message).toContain('SLICE_REPAIR_LIMIT');
  });
});
