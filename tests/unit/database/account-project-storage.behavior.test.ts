import { randomUUID } from 'node:crypto';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const QUOTA_BYTES = 1024;

type RpcError = { code?: string; details?: string | null; message: string };

function storageError(error: RpcError | null): never {
  if (!error) throw new Error('Expected storage RPC to return an error');
  throw { code: error.details ?? error.code ?? error.message };
}

describeDb('account project storage real Postgres behavior', () => {
  let fx: ProjectFixture;
  let pendingCollaborator: RlsUser;
  let secondOwner: RlsUser;
  let sharedProjectId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    pendingCollaborator = await createConfirmedOutsider(fx, 'storage-pending');
    const { error } = await fx.svc.from('project_collaborators').insert({
      project_id: fx.projectId,
      user_id: pendingCollaborator.id,
      role: 'editor',
      invited_by: fx.owner.id,
      invited_at: new Date().toISOString(),
      accepted_at: null,
    });
    if (error) throw new Error(`create pending collaborator failed: ${error.message}`);

    secondOwner = await createConfirmedOutsider(fx, 'storage-second-owner');
    const project = await fx.svc.from('projects').insert({
      owner_id: secondOwner.id,
      name: `storage-shared-${fx.suffix}`,
      description: 'storage summary fixture',
    }).select('id').single();
    if (project.error || !project.data) {
      throw new Error(`create second-owner project failed: ${project.error?.message}`);
    }
    sharedProjectId = project.data.id as string;
    const collaboration = await fx.svc.from('project_collaborators').insert({
      project_id: sharedProjectId,
      user_id: fx.editor.id,
      role: 'editor',
      invited_by: secondOwner.id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });
    if (collaboration.error) {
      throw new Error(`create second-owner collaboration failed: ${collaboration.error.message}`);
    }
  });

  beforeEach(async () => {
    await fx.svc.from('project_storage_file_locations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('storage_upload_reservations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('project_storage_files').delete().eq('project_id', fx.projectId);
    const quota = await fx.svc.from('account_storage_quotas').upsert({
      owner_id: fx.owner.id,
      quota_bytes: QUOTA_BYTES,
      used_bytes: 0,
      reserved_bytes: 0,
    });
    if (quota.error) throw new Error(`reset storage quota failed: ${quota.error.message}`);
  });

  afterAll(async () => {
    if (fx) {
      await fx.svc.from('project_collaborators').delete().eq('project_id', sharedProjectId);
      await fx.svc.from('projects').delete().eq('id', sharedProjectId);
      await teardownProjectFixture(fx);
    }
  });

  function pathFor(actor: RlsUser, suffix = randomUUID(), projectId = fx.projectId): string {
    return `${actor.id}/${projectId}/${suffix}.bin`;
  }

  async function reserve(
    actor: RlsUser,
    expectedBytes: number | string,
    objectPath = pathFor(actor),
    projectId = fx.projectId,
  ) {
    const result = await actor.client.rpc('reserve_project_storage_upload', {
      p_project_id: projectId,
      p_bucket_id: 'project-assets',
      p_object_path: objectPath,
      p_expected_bytes: expectedBytes,
      p_display_name: `storage-${fx.suffix}.bin`,
      p_mime_type: 'application/octet-stream',
      p_source_kind: 'project_asset',
      p_source_entity_id: null,
    });
    if (result.error) storageError(result.error);
    return result.data as Record<string, unknown>;
  }

  async function finalize(
    actor: RlsUser,
    reservationId: string,
    actualBytes: number | string,
    objectCreatedAt: string | null = null,
  ) {
    const result = await actor.client.rpc('finalize_project_storage_upload', {
      p_reservation_id: reservationId,
      p_actual_bytes: actualBytes,
      p_source_entity_id: null,
      p_object_created_at: objectCreatedAt,
    });
    if (result.error) storageError(result.error);
    return result.data as Record<string, unknown>;
  }

  async function release(actor: RlsUser, reservationId: string) {
    const result = await actor.client.rpc('release_project_storage_upload', {
      p_reservation_id: reservationId,
    });
    if (result.error) storageError(result.error);
    return result.data as Record<string, unknown>;
  }

  async function upload(actor: RlsUser, objectPath: string, size: number) {
    const result = await actor.client.storage.from('project-assets').upload(
      objectPath,
      new Uint8Array(size),
      { contentType: 'image/png', upsert: false },
    );
    return result.error;
  }

  it('enforces a quota boundary and serializes concurrent reservations', async () => {
    await expect(reserve(fx.owner, QUOTA_BYTES)).resolves.toMatchObject({ expectedBytes: QUOTA_BYTES });
    await expect(reserve(fx.owner, 1)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });

    await fx.svc.from('storage_upload_reservations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('account_storage_quotas').update({ used_bytes: 0, reserved_bytes: 0 })
      .eq('owner_id', fx.owner.id);

    const results = await Promise.allSettled([
      reserve(fx.owner, QUOTA_BYTES),
      reserve(fx.owner, QUOTA_BYTES),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('allows editor reservations but rejects viewers and pending collaborators', async () => {
    await expect(reserve(fx.editor, 16)).resolves.toMatchObject({ ownerId: fx.owner.id });
    await expect(reserve(fx.viewer, 16)).rejects.toMatchObject({ code: 'STORAGE_PROJECT_FORBIDDEN' });
    await expect(reserve(pendingCollaborator, 16)).rejects.toMatchObject({ code: 'STORAGE_PROJECT_FORBIDDEN' });
  });

  it('makes finalize and release replays idempotent', async () => {
    const finalizedPath = pathFor(fx.owner);
    const finalizedReservation = await reserve(fx.owner, 16, finalizedPath);
    expect(await upload(fx.owner, finalizedPath, 16)).toBeNull();
    const objectCreatedAt = '2030-01-01T00:00:00.000Z';
    const firstFinalize = await finalize(
      fx.owner, finalizedReservation.reservationId as string, 16, objectCreatedAt,
    );
    const replayFinalize = await finalize(
      fx.owner, finalizedReservation.reservationId as string, 16, objectCreatedAt,
    );
    expect(replayFinalize).toMatchObject({ fileId: firstFinalize.fileId, reused: true });
    await expect(finalize(
      fx.owner, finalizedReservation.reservationId as string, 16, '2030-01-01T00:00:01.000Z',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });

    const releasedReservation = await reserve(fx.owner, 16);
    const firstRelease = await release(fx.owner, releasedReservation.reservationId as string);
    const replayRelease = await release(fx.owner, releasedReservation.reservationId as string);
    expect(firstRelease).toMatchObject({ reused: false });
    expect(replayRelease).toMatchObject({ reused: true });
  });

  it('rejects finalization of expired reservations and actual-size quota overflow', async () => {
    const expired = await reserve(fx.owner, 16);
    const expiration = await fx.svc.from('storage_upload_reservations').update({
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq('id', expired.reservationId as string);
    if (expiration.error) throw new Error(`expire reservation failed: ${expiration.error.message}`);
    await expect(finalize(fx.owner, expired.reservationId as string, 16))
      .rejects.toMatchObject({ code: 'STORAGE_RESERVATION_EXPIRED' });

    await fx.svc.from('storage_upload_reservations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('account_storage_quotas').update({ used_bytes: 0, reserved_bytes: 0 })
      .eq('owner_id', fx.owner.id);
    const fullPath = pathFor(fx.owner);
    const full = await reserve(fx.owner, QUOTA_BYTES, fullPath);
    expect(await upload(fx.owner, fullPath, QUOTA_BYTES + 1)).toBeNull();
    await expect(finalize(fx.owner, full.reservationId as string, QUOTA_BYTES + 1))
      .rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });

    await expect(reserve(fx.owner, '9223372036854775807'))
      .rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
  });

  it('requires a pending reservation for direct bucket writes and settles verified object bytes only', async () => {
    const objectPath = pathFor(fx.owner);
    expect(await upload(fx.owner, objectPath, 3)).not.toBeNull();

    const reservation = await reserve(fx.owner, 3, objectPath);
    const gate = await fx.owner.client.rpc('storage_has_pending_upload_reservation', {
      p_bucket_id: 'project-assets', p_object_path: objectPath,
    });
    expect(gate.error).toBeNull();
    expect(gate.data).toBe(true);
    expect(await upload(fx.owner, objectPath, 3)).toBeNull();
    await expect(finalize(fx.owner, reservation.reservationId as string, 4))
      .rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(finalize(fx.owner, reservation.reservationId as string, 3))
      .resolves.toMatchObject({ sizeBytes: 3 });
  });

  it('releases expired reservations before retrying the same object path', async () => {
    const objectPath = pathFor(fx.owner);
    const expired = await reserve(fx.owner, 16, objectPath);
    const expiration = await fx.svc.from('storage_upload_reservations').update({
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }).eq('id', expired.reservationId as string);
    if (expiration.error) throw new Error(`expire retry reservation failed: ${expiration.error.message}`);

    await expect(reserve(fx.owner, 16, objectPath))
      .resolves.toMatchObject({ reused: false, expectedBytes: 16 });
  });

  it('keeps shared project usage out of the collaborator account counters', async () => {
    const quota = await fx.svc.from('account_storage_quotas').upsert({
      owner_id: secondOwner.id,
      quota_bytes: QUOTA_BYTES,
      used_bytes: 0,
      reserved_bytes: 0,
    });
    if (quota.error) throw new Error(`reset second-owner quota failed: ${quota.error.message}`);
    const sharedPath = pathFor(secondOwner, randomUUID(), sharedProjectId);
    const sharedReservation = await reserve(secondOwner, 16, sharedPath, sharedProjectId);
    expect(await upload(secondOwner, sharedPath, 16)).toBeNull();
    await finalize(secondOwner, sharedReservation.reservationId as string, 16);

    const result = await fx.editor.client.rpc('account_storage_summary');
    if (result.error) throw new Error(result.error.message);
    expect(result.data).toMatchObject({ usedBytes: 0, reservedBytes: 0 });
    expect((result.data as { sharedProjects: Array<{ id: string }> }).sharedProjects)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: sharedProjectId })]));
  });

  it('rejects unrelated users from project file listings', async () => {
    const objectPath = pathFor(fx.owner);
    const reservation = await reserve(fx.owner, 16, objectPath);
    expect(await upload(fx.owner, objectPath, 16)).toBeNull();
    await finalize(fx.owner, reservation.reservationId as string, 16);

    const result = await fx.outsider.client.rpc('account_storage_project_files', {
      p_project_id: fx.projectId,
      p_query: null,
      p_sort: 'size_desc',
      p_limit: 50,
      p_offset: 0,
    });
    expect(result.error?.details ?? result.error?.code).toBe('STORAGE_PROJECT_FORBIDDEN');
  });
});
