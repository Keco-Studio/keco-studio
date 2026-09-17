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
    bucketId = 'project-assets',
  ) {
    const result = await actor.client.rpc('reserve_project_storage_upload', {
      p_project_id: projectId,
      p_bucket_id: bucketId,
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

  async function upload(actor: RlsUser, objectPath: string, size: number, bucketId = 'project-assets', upsert = false) {
    const result = await actor.client.storage.from(bucketId).upload(
      objectPath,
      new Uint8Array(size),
      { contentType: 'image/png', upsert },
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

  it('rolls back project asset registration when actual bytes exceed the reservation quota', async () => {
    const quotaLimit = await fx.svc.from('account_storage_quotas')
      .update({ quota_bytes: 3 }).eq('owner_id', fx.owner.id);
    if (quotaLimit.error) throw new Error(`set quota limit failed: ${quotaLimit.error.message}`);

    const objectPath = pathFor(fx.owner);
    const reservation = await reserve(fx.owner, 3, objectPath);
    expect(await upload(fx.owner, objectPath, 4)).toBeNull();

    const completion = await fx.owner.client.rpc('complete_project_game_asset_storage_upload', {
      p_reservation_id: reservation.reservationId,
      p_project_id: fx.projectId,
      p_name: 'overflow.png',
      p_category: 'media',
      p_mime_type: 'image/png',
      p_storage_bucket: 'project-assets',
      p_storage_path: objectPath,
      p_sha256: '0'.repeat(64),
      p_width: 1,
      p_height: 1,
      p_has_transparency: false,
      p_file_size: 4,
      p_object_created_at: null,
    });
    expect(completion.error?.details ?? completion.error?.code).toBe('STORAGE_QUOTA_EXCEEDED');

    const assets = await fx.svc.from('project_game_assets').select('id').eq('storage_path', objectPath);
    expect(assets.error).toBeNull();
    expect(assets.data).toEqual([]);
    const files = await fx.svc.from('project_storage_files').select('id').eq('object_path', objectPath);
    expect(files.error).toBeNull();
    expect(files.data).toEqual([]);
    const quota = await fx.svc.from('account_storage_quotas')
      .select('used_bytes,reserved_bytes').eq('owner_id', fx.owner.id).single();
    expect(quota.error).toBeNull();
    expect(quota.data).toMatchObject({ used_bytes: 0, reserved_bytes: 3 });

    await fx.svc.storage.from('project-assets').remove([objectPath]);
    await release(fx.owner, reservation.reservationId as string);
  });

  it('requires a pending reservation for direct bucket writes and settles verified object bytes only', async () => {
    const objectPath = pathFor(fx.owner);
    expect(await upload(fx.owner, objectPath, 3)).not.toBeNull();

    const reservation = await reserve(fx.owner, 3, objectPath);
    expect(await upload(fx.owner, objectPath, 3)).toBeNull();
    await expect(finalize(fx.owner, reservation.reservationId as string, 4))
      .rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(finalize(fx.owner, reservation.reservationId as string, 3))
      .resolves.toMatchObject({ sizeBytes: 3 });
  });

  it('settles collaborator-owned paths against the project owner only after physical deletion', async () => {
    const objectPath = pathFor(fx.editor);
    const reservation = await reserve(
      fx.editor,
      16,
      objectPath,
      fx.projectId,
      'library-media-files',
    );
    expect(await upload(fx.editor, objectPath, 16, 'library-media-files')).toBeNull();
    await finalize(fx.editor, reservation.reservationId as string, 16);

    const premature = await fx.editor.client.rpc('settle_project_storage_file_deletion', {
      p_bucket_id: 'library-media-files',
      p_object_path: objectPath,
    });
    expect(premature.error?.details ?? premature.error?.code).toBe('STORAGE_OBJECT_MISMATCH');

    const removed = await fx.owner.client.storage.from('library-media-files').remove([objectPath]);
    expect(removed.error).toBeNull();
    const settled = await fx.owner.client.rpc('settle_project_storage_file_deletion', {
      p_bucket_id: 'library-media-files',
      p_object_path: objectPath,
    });
    expect(settled.error).toBeNull();
    expect(settled.data).toMatchObject({ releasedBytes: 16, reused: false });

    const quota = await fx.svc.from('account_storage_quotas')
      .select('used_bytes').eq('owner_id', fx.owner.id).single();
    expect(quota.error).toBeNull();
    expect(Number(quota.data?.used_bytes)).toBe(0);

    const replay = await fx.owner.client.rpc('settle_project_storage_file_deletion', {
      p_bucket_id: 'library-media-files',
      p_object_path: objectPath,
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ releasedBytes: 0, reused: true });
  });

  it('prevents a removed collaborator from deleting a project-scoped media object', async () => {
    const objectPath = pathFor(fx.editor);
    await reserve(fx.editor, 3, objectPath, fx.projectId, 'library-media-files');
    expect(await upload(fx.editor, objectPath, 3, 'library-media-files')).toBeNull();

    const removed = await fx.svc.from('project_collaborators').delete()
      .eq('project_id', fx.projectId).eq('user_id', fx.editor.id);
    if (removed.error) throw new Error(`remove editor failed: ${removed.error.message}`);

    const deletion = await fx.editor.client.storage.from('library-media-files').remove([objectPath]);
    expect(deletion.error).toBeNull();
    const remaining = await fx.svc.storage.from('library-media-files').info(objectPath);
    expect(remaining.error).toBeNull();
    expect(remaining.data).not.toBeNull();

    await fx.svc.from('project_collaborators').insert({
      project_id: fx.projectId,
      user_id: fx.editor.id,
      role: 'editor',
      invited_by: fx.owner.id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });
    await fx.svc.storage.from('library-media-files').remove([objectPath]);
  });

  it('rechecks current membership on update policies after an editor reservation', async () => {
    const objectPath = pathFor(fx.editor);
    const reservation = await reserve(fx.editor, 3, objectPath, fx.projectId, 'tiptap-images');
    expect(await upload(fx.editor, objectPath, 3, 'tiptap-images')).toBeNull();

    const removed = await fx.svc.from('project_collaborators').delete()
      .eq('project_id', fx.projectId).eq('user_id', fx.editor.id);
    if (removed.error) throw new Error(`remove editor failed: ${removed.error.message}`);

    await expect(upload(fx.editor, objectPath, 3, 'tiptap-images', true)).resolves.not.toBeNull();

    await fx.svc.from('project_collaborators').insert({
      project_id: fx.projectId,
      user_id: fx.editor.id,
      role: 'editor',
      invited_by: fx.owner.id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });
    await fx.svc.from('storage_upload_reservations').delete().eq('id', reservation.reservationId as string);
    await fx.svc.storage.from('tiptap-images').remove([objectPath]);
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
