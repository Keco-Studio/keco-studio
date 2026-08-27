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
    duplicateName?: boolean;
  } = {}): Promise<SliceBundle> {
    const runId = crypto.randomUUID();
    const sliceId = `slice-${runId.slice(0, 8)}`;
    const taskIds = options.taskIds ?? ['task-1'];
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
    const args = {
      p_project_id: fx.projectId,
      p_run_id: runId,
      p_folder_id: folderId,
      p_slice_id: sliceId,
      p_plan_data: { schemaVersion: 1, tasks: taskIds.map(id => ({ id })) },
      p_plan_hash: hash('1'),
      p_eval_spec: {
        schemaVersion: 1,
        evaluations: [{
          evalId: 'eval-1',
          buildHash: hash('a'),
          snapshotHash: hash('b'),
          assertions: [{
            assertionId: 'guardian',
            kind: 'equals',
            path: '/guardianRoundtrip',
            expected: true,
          }],
          manualRequired: options.manualRequired ?? false,
        }],
      },
      p_eval_spec_hash: hash('2'),
      p_delivery_policy: {
        schemaVersion: 1,
        maximumRepairs: 3,
        manualReviewBlocksRelease: true,
      },
      p_delivery_policy_hash: hash('3'),
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
      inputHash: hash('5'),
      outputHash: hash('6'),
    };
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

  async function checkpoint(
    bundle: SliceBundle,
    stateToken: string,
    events: Array<Record<string, unknown>>,
    key = `checkpoint:${crypto.randomUUID()}`,
  ) {
    return await fx.editor.client.rpc('mcp_checkpoint_slice', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
      p_expected_state_token: stateToken,
      p_events: events,
      p_artifacts: [],
      p_idempotency_key: key,
      p_input_hash: hash(key.includes('same') ? '7' : '8'),
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
      p_plan_data: { schemaVersion: 1, tasks: [{ id: 'task-1' }] },
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
    const conflict = await fx.editor.client.rpc('mcp_create_slice_bundle', {
      ...bundle.args,
      p_input_hash: hash('9'),
    });
    expect(conflict.error?.code).toBe('KS409');
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
    const initial = await checkpoint(bundle, firstToken, [
      event('task_result', { taskId: 'task-1', status: 'completed' }),
      event('task_review', { taskId: 'task-1', verdict: 'accepted' }),
      event('runtime_observation', { observation: observation(bundle.runId, sliceId, false) }),
    ]);
    expect(initial.error).toBeNull();
    const initialRow = row(initial.data);
    expect(initialRow.projection).toMatchObject({
      implementationStatus: 'completed',
      runtimeVerificationStatus: 'failed',
    });

    const stale = await checkpoint(bundle, firstToken, [event('delivery_check', { status: 'passed' })]);
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
      checkpoint(bundle, token, [event('delivery_check', { status: 'passed' })], 'checkpoint:left'),
      checkpoint(bundle, token, [event('delivery_check', { status: 'passed' })], 'checkpoint:right'),
    ]);
    const results = [left, right];
    expect(results.filter(result => result.error === null)).toHaveLength(1);
    expect(results.filter(result => result.error?.code === 'KS410')).toHaveLength(1);
  });

  it.each([
    [false, 'ready'],
    [true, 'blocked_by_manual_review'],
  ])('verifies current mirrors and finalizes without revision drift (manual=%s)', async (manualRequired, readiness) => {
    const bundle = await createBundle({ manualRequired });
    const sliceId = String(bundle.args.p_slice_id);
    const verified = await checkpoint(bundle, String(bundle.result.stateToken), [
      event('task_result', { taskId: 'task-1', status: 'completed' }),
      event('task_review', { taskId: 'task-1', verdict: 'accepted' }),
      event('runtime_observation', { observation: observation(bundle.runId, sliceId, true) }),
      event('delivery_check', { status: 'passed' }),
    ]);
    expect(verified.error).toBeNull();

    const exported = await fx.viewer.client.rpc('mcp_export_slice_mirrors', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
    });
    expect(exported.error).toBeNull();
    const manifest = row(exported.data);
    expect(manifest.files).toHaveLength(4);
    expect(manifest.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const file of manifest.files as Array<Record<string, unknown>>) {
      const content = String(file.content);
      expect(file.byteCount).toBe(Buffer.byteLength(content));
      expect(file.sha256).toBe(`sha256:${createHash('sha256').update(content).digest('hex')}`);
    }

    const staleMirror = await checkpoint(bundle, String(row(verified.data).stateToken), [
      event('mirror_verification', {
        status: 'verified',
        manifestHash: hash('0'),
      }),
    ]);
    expect(staleMirror.error?.code).toBe('22023');

    const mirror = await checkpoint(bundle, String(row(verified.data).stateToken), [
      event('mirror_verification', {
        status: 'verified',
        manifestHash: manifest.manifestHash,
      }),
    ]);
    expect(mirror.error).toBeNull();
    expect(row(mirror.data).projection).toMatchObject({
      runtimeVerificationStatus: 'passed',
      releaseReadiness: readiness,
    });

    const finalDocuments = bundle.documents.map(document => ({
      documentId: document.documentId,
      expectedEpoch: 0,
      expectedRevision: 1,
      markdown: document.markdown,
      yjsState: document.yjsState,
    }));
    const finalized = await fx.editor.client.rpc('mcp_finalize_slice', {
      p_project_id: fx.projectId,
      p_run_id: bundle.runId,
      p_expected_state_token: row(mirror.data).stateToken,
      p_documents: finalDocuments,
      p_idempotency_key: `finalize:${bundle.runId}`,
      p_input_hash: hash('f'),
    });
    expect(finalized.error).toBeNull();
    expect(row(finalized.data).projection).toMatchObject({ releaseReadiness: readiness });

    const revisions = await fx.svc.from('documents')
      .select('id,collab_epoch,collab_revision')
      .in('id', bundle.documents.map(document => document.documentId));
    expect(revisions.error).toBeNull();
    expect(revisions.data).toHaveLength(4);
    expect(revisions.data?.every(document =>
      document.collab_epoch === 0 && document.collab_revision === 1
    )).toBe(true);

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
