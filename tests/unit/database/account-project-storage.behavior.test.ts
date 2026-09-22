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
    await fx.svc.from('libraries').update({ folder_id: null }).eq('id', fx.libraryId);
    await fx.svc.from('documents').delete().eq('project_id', fx.projectId);
    await fx.svc.from('libraries').delete().eq('project_id', fx.projectId).neq('id', fx.libraryId);
    await fx.svc.from('library_assets').delete().eq('library_id', fx.libraryId);
    await fx.svc.from('library_field_definitions').delete().eq('library_id', fx.libraryId);
    await fx.svc.from('project_storage_file_locations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('storage_upload_reservations').delete().eq('project_id', fx.projectId);
    await fx.svc.from('project_storage_files').delete().eq('project_id', fx.projectId);
    await fx.svc.from('projects').update({ assets_workspace_enabled: false }).eq('id', fx.projectId);
    const quota = await fx.svc.from('account_storage_quotas').upsert({
      owner_id: fx.owner.id,
      quota_bytes: QUOTA_BYTES,
      used_bytes: 0,
      reserved_bytes: 0,
    });
    if (quota.error) throw new Error(`reset storage quota failed: ${quota.error.message}`);
    const rebuild = await fx.svc.rpc('service_rebuild_account_storage_quota_totals');
    if (rebuild.error) throw new Error(`rebuild storage quota failed: ${rebuild.error.message}`);
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
    sourceKind = 'project_asset',
    sourceEntityId: string | null = null,
    displayName = `storage-${fx.suffix}.bin`,
  ) {
    const result = await actor.client.rpc('reserve_project_storage_upload', {
      p_project_id: projectId,
      p_bucket_id: bucketId,
      p_object_path: objectPath,
      p_expected_bytes: expectedBytes,
      p_display_name: displayName,
      p_mime_type: 'application/octet-stream',
      p_source_kind: sourceKind,
      p_source_entity_id: sourceEntityId,
    });
    if (result.error) storageError(result.error);
    return result.data as Record<string, unknown>;
  }

  async function finalize(
    actor: RlsUser,
    reservationId: string,
    actualBytes: number | string,
    objectCreatedAt: string | null = null,
    sourceEntityId: string | null = null,
  ) {
    const result = await actor.client.rpc('finalize_project_storage_upload', {
      p_reservation_id: reservationId,
      p_actual_bytes: actualBytes,
      p_source_entity_id: sourceEntityId,
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

  it('accepts each generated storage layout and rejects bucket, source, actor, and project mismatches', async () => {
    const mapId = randomUUID();
    const characterId = randomUUID();
    await expect(reserve(
      fx.owner, 3, `references/${fx.projectId}/${mapId}/reference.png`, fx.projectId, 'map-assets', 'map_reference',
    )).resolves.toMatchObject({ projectId: fx.projectId });
    await expect(reserve(
      fx.owner, 3, `${fx.projectId}/${mapId}/revision/asset.png`, fx.projectId, 'map-assets', 'map_asset',
    )).resolves.toMatchObject({ projectId: fx.projectId });
    await expect(reserve(
      fx.owner, 3, `${fx.projectId}/${characterId}/generation/asset.png`, fx.projectId, 'character-assets', 'character_asset',
    )).resolves.toMatchObject({ projectId: fx.projectId });
    await expect(reserve(
      fx.editor, 3, `${fx.editor.id}/${fx.projectId}/document.png`, fx.projectId, 'tiptap-images', 'document_image',
    )).resolves.toMatchObject({ ownerId: fx.owner.id });

    await expect(reserve(
      fx.owner, 3, `${fx.owner.id}/${fx.projectId}/wrong.png`, fx.projectId, 'map-assets', 'map_asset',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(reserve(
      fx.owner, 3, `references/${fx.projectId}/wrong.png`, fx.projectId, 'map-assets', 'map_asset',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(reserve(
      fx.owner, 3, `${fx.owner.id}/${fx.projectId}/wrong.png`, fx.projectId, 'project-assets', 'document_image',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(reserve(
      fx.owner, 3, `${fx.editor.id}/${fx.projectId}/wrong.png`, fx.projectId, 'project-assets', 'project_asset',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
    await expect(reserve(
      fx.editor, 3, `${fx.owner.id}/${sharedProjectId}/wrong-project.png`, sharedProjectId, 'project-assets', 'project_asset',
    )).rejects.toMatchObject({ code: 'STORAGE_OBJECT_MISMATCH' });
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

  it('rejects mismatched game-asset completion bindings before registering any asset', async () => {
    const objectPath = pathFor(fx.owner);
    const reservation = await reserve(fx.owner, 3, objectPath);
    expect(await upload(fx.owner, objectPath, 3)).toBeNull();

    for (const [projectId, storagePath] of [
      [sharedProjectId, objectPath],
      [fx.projectId, `${objectPath}-other`],
    ]) {
      const completion = await fx.owner.client.rpc('complete_project_game_asset_storage_upload', {
        p_reservation_id: reservation.reservationId,
        p_project_id: projectId,
        p_name: 'mismatch.png',
        p_category: 'media',
        p_mime_type: 'image/png',
        p_storage_bucket: 'project-assets',
        p_storage_path: storagePath,
        p_sha256: '0'.repeat(64),
        p_width: 1,
        p_height: 1,
        p_has_transparency: false,
        p_file_size: 3,
        p_object_created_at: null,
      });
      expect(completion.error?.details ?? completion.error?.code).toBe('STORAGE_OBJECT_MISMATCH');
    }
    const assets = await fx.svc.from('project_game_assets').select('id').eq('storage_path', objectPath);
    expect(assets.error).toBeNull();
    expect(assets.data).toEqual([]);

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
      'library_media',
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
    await reserve(fx.editor, 3, objectPath, fx.projectId, 'library-media-files', 'library_media');
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
    const reservation = await reserve(fx.editor, 3, objectPath, fx.projectId, 'tiptap-images', 'document_image');
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

  it('lists a document and its owned images as one logical file', async () => {
    const content = '# Imported document\n\n| Column |\n| --- |\n| Value |';
    const name = `aggregated-document-${fx.suffix}`;
    const document = await fx.owner.client.from('documents').insert({
      project_id: fx.projectId,
      name,
      content,
      created_by: fx.owner.id,
    }).select('id').single();
    expect(document.error).toBeNull();
    const documentId = document.data?.id as string;

    const imageBytes = 16;
    const objectPath = `${fx.owner.id}/${fx.projectId}/${randomUUID()}.png`;
    const reservation = await reserve(
      fx.owner,
      imageBytes,
      objectPath,
      fx.projectId,
      'tiptap-images',
      'document_image',
      documentId,
    );
    expect(await upload(fx.owner, objectPath, imageBytes, 'tiptap-images')).toBeNull();
    await finalize(
      fx.owner,
      reservation.reservationId as string,
      imageBytes,
      null,
      documentId,
    );

    const listed = await fx.owner.client.rpc('account_storage_project_files', {
      p_project_id: fx.projectId,
      p_query: name,
      p_sort: 'size_desc',
      p_limit: 50,
      p_offset: 0,
    });
    expect(listed.error).toBeNull();
    expect(listed.data).toMatchObject({ total: 1 });
    expect(listed.data.items).toEqual([expect.objectContaining({
      name,
      mimeType: 'application/x-keco-document',
      sizeBytes: Buffer.byteLength(content, 'utf8') + imageBytes,
      sourceKind: 'document_content',
      sourceEntityId: documentId,
    })]);

    const allFiles = await fx.owner.client.rpc('account_storage_project_files', {
      p_project_id: fx.projectId,
      p_query: null,
      p_sort: 'size_desc',
      p_limit: 100,
      p_offset: 0,
    });
    expect(allFiles.error).toBeNull();
    expect(allFiles.data.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'document_image', sourceEntityId: documentId }),
    ]));

    const entities = await fx.owner.client.rpc('account_storage_project_entities_v3', {
      p_project_id: fx.projectId,
      p_query: null,
      p_sort: 'size_desc',
      p_limit: 100,
      p_offset: 0,
      p_parent_folder_id: null,
    });
    expect(entities.error).toBeNull();

    const summary = await fx.owner.client.rpc('account_storage_summary_v3');
    expect(summary.error).toBeNull();
    const project = summary.data.ownedProjects.find(
      (item: { id: string }) => item.id === fx.projectId,
    );
    expect(project.fileCount).toBe(entities.data.total);
    expect(project.usedBytes).toBe(
      allFiles.data.items.reduce(
        (total: number, item: { sizeBytes: number }) => total + Number(item.sizeBytes),
        0,
      ),
    );
  });

  it('lists each Table once, counts referenced media once, and groups remaining files under Assets', async () => {
    const fieldId = randomUUID();
    const rowIds = [randomUUID(), randomUUID()];
    const sectionId = `${fx.libraryId}::main`;
    const field = await fx.svc.from('library_field_definitions').insert({
      id: fieldId,
      library_id: fx.libraryId,
      section: 'main',
      section_id: sectionId,
      label: 'Portrait',
      data_type: 'image',
      required: false,
      order_index: 0,
    });
    expect(field.error).toBeNull();
    const rows = await fx.svc.from('library_assets').insert([
      { id: rowIds[0], library_id: fx.libraryId, name: 'Alice', row_index: 0 },
      { id: rowIds[1], library_id: fx.libraryId, name: 'Bob', row_index: 1 },
    ]);
    expect(rows.error).toBeNull();

    const mediaBytes = 16;
    const mediaPath = `${fx.owner.id}/${fx.projectId}/${randomUUID()}.png`;
    const mediaReservation = await reserve(
      fx.owner, mediaBytes, mediaPath, fx.projectId, 'library-media-files', 'library_media', null,
      'alice.png',
    );
    expect(await upload(fx.owner, mediaPath, mediaBytes, 'library-media-files')).toBeNull();
    await finalize(fx.owner, mediaReservation.reservationId as string, mediaBytes);

    const mediaValue = {
      url: `https://example.test/storage/${mediaPath}`,
      path: mediaPath,
      fileName: 'alice.png',
      fileSize: mediaBytes,
      fileType: 'image/png',
      uploadedAt: '2026-09-22T00:00:00.000Z',
    };
    const values = await fx.svc.from('library_asset_values').insert([
      { asset_id: rowIds[0], field_id: fieldId, value_json: mediaValue },
      { asset_id: rowIds[1], field_id: fieldId, value_json: mediaValue },
    ]);
    expect(values.error).toBeNull();

    const standaloneBytes = 20;
    const standalonePath = pathFor(fx.owner);
    const standaloneReservation = await reserve(fx.owner, standaloneBytes, standalonePath);
    expect(await upload(fx.owner, standalonePath, standaloneBytes)).toBeNull();
    await finalize(fx.owner, standaloneReservation.reservationId as string, standaloneBytes);

    const listed = await fx.owner.client.rpc('account_storage_project_entities_v3', {
      p_project_id: fx.projectId,
      p_query: null,
      p_sort: 'size_desc',
      p_limit: 50,
      p_offset: 0,
    });
    expect(listed.error).toBeNull();
    const tableRows = listed.data.items.filter((item: { kind: string }) => item.kind === 'table');
    const table = tableRows.find((item: { id: string }) => item.id === fx.libraryId);
    const assets = listed.data.items.find((item: { kind: string }) => item.kind === 'assets');
    expect(tableRows).toHaveLength(1);
    expect(Number(table.physicalBytes)).toBe(mediaBytes);
    expect(Number(table.sizeBytes)).toBe(Number(table.logicalBytes) + mediaBytes);
    expect(assets).toMatchObject({ id: fx.projectId, name: 'Assets', physicalBytes: standaloneBytes });

    const detail = await fx.owner.client.rpc('account_storage_entity_details', {
      p_project_id: fx.projectId,
      p_entity_kind: 'table',
      p_entity_id: fx.libraryId,
    });
    expect(detail.error).toBeNull();
    expect(detail.data.items.filter((item: { name: string }) => item.name === 'alice.png')).toHaveLength(1);
    expect(detail.data.items.reduce(
      (total: number, item: { sizeBytes: number }) => total + Number(item.sizeBytes),
      0,
    )).toBe(Number(detail.data.sizeBytes));

    const summaryResult = await fx.owner.client.rpc('account_storage_summary_v3');
    expect(summaryResult.error).toBeNull();
    const project = summaryResult.data.ownedProjects.find((item: { id: string }) => item.id === fx.projectId);
    expect(project.fileCount).toBe(listed.data.total);
    expect(project.usedBytes).toBe(listed.data.items.reduce(
      (total: number, item: { sizeBytes: number }) => total + Number(item.sizeBytes),
      0,
    ));

    const drift = await fx.svc.rpc('service_account_storage_entity_binding_drift');
    expect(drift.error).toBeNull();
    expect(drift.data).toEqual({
      missingBindings: 0,
      staleBindings: 0,
      conflictingBindings: 0,
    });
  });

  it('browses nested folders with recursive sizes and keeps Assets at the project root', async () => {
    const parent = await fx.svc.from('folders').insert({
      project_id: fx.projectId,
      name: `storage-parent-${fx.suffix}`,
    }).select('id').single();
    expect(parent.error).toBeNull();
    const parentId = parent.data?.id as string;
    const child = await fx.svc.from('folders').insert({
      project_id: fx.projectId,
      parent_folder_id: parentId,
      name: `storage-child-${fx.suffix}`,
    }).select('id').single();
    expect(child.error).toBeNull();
    const childId = child.data?.id as string;

    try {
      expect((await fx.svc.from('libraries').update({ folder_id: childId }).eq('id', fx.libraryId)).error)
        .toBeNull();
      const document = await fx.svc.from('documents').insert({
        project_id: fx.projectId,
        folder_id: childId,
        name: `storage-child-document-${fx.suffix}`,
        content: '# Child document',
        created_by: fx.owner.id,
      }).select('id').single();
      expect(document.error).toBeNull();
      expect((await fx.svc.from('projects').update({ assets_workspace_enabled: true })
        .eq('id', fx.projectId)).error).toBeNull();

      const root = await fx.owner.client.rpc('account_storage_project_entities_v3', {
        p_project_id: fx.projectId,
        p_query: null,
        p_sort: 'size_desc',
        p_limit: 50,
        p_offset: 0,
        p_parent_folder_id: null,
      });
      expect(root.error).toBeNull();
      expect(root.data.breadcrumb).toEqual([]);
      expect(root.data.items.map((item: { kind: string }) => item.kind).sort())
        .toEqual(['assets', 'folder']);
      const rootFolder = root.data.items.find((item: { kind: string }) => item.kind === 'folder');
      expect(rootFolder).toMatchObject({ id: parentId, parentFolderId: null });
      expect(root.data.items.find((item: { kind: string }) => item.kind === 'assets'))
        .toMatchObject({ id: fx.projectId, sizeBytes: 0 });

      const parentPage = await fx.owner.client.rpc('account_storage_project_entities_v3', {
        p_project_id: fx.projectId,
        p_query: null,
        p_sort: 'size_desc',
        p_limit: 50,
        p_offset: 0,
        p_parent_folder_id: parentId,
      });
      expect(parentPage.error).toBeNull();
      expect(parentPage.data.breadcrumb).toEqual([
        expect.objectContaining({ id: parentId, name: `storage-parent-${fx.suffix}` }),
      ]);
      expect(parentPage.data.items).toEqual([
        expect.objectContaining({ id: childId, kind: 'folder', parentFolderId: parentId }),
      ]);

      const childPage = await fx.owner.client.rpc('account_storage_project_entities_v3', {
        p_project_id: fx.projectId,
        p_query: null,
        p_sort: 'size_desc',
        p_limit: 50,
        p_offset: 0,
        p_parent_folder_id: childId,
      });
      expect(childPage.error).toBeNull();
      expect(childPage.data.breadcrumb.map((part: { id: string }) => part.id))
        .toEqual([parentId, childId]);
      expect(childPage.data.items.map((item: { kind: string }) => item.kind).sort())
        .toEqual(['document', 'table']);
      expect(childPage.data.items.some((item: { kind: string }) => item.kind === 'assets')).toBe(false);
      const childBytes = childPage.data.items.reduce(
        (total: number, item: { sizeBytes: number }) => total + Number(item.sizeBytes),
        0,
      );
      expect(Number(parentPage.data.items[0].sizeBytes)).toBe(childBytes);
      expect(Number(rootFolder.sizeBytes)).toBe(childBytes);

      const summary = await fx.owner.client.rpc('account_storage_summary_v3');
      expect(summary.error).toBeNull();
      const project = summary.data.ownedProjects.find((item: { id: string }) => item.id === fx.projectId);
      expect(project.fileCount).toBe(5);
      expect(project.usedBytes).toBe(root.data.items.reduce(
        (total: number, item: { sizeBytes: number }) => total + Number(item.sizeBytes),
        0,
      ));
    } finally {
      await fx.svc.from('libraries').update({ folder_id: null }).eq('id', fx.libraryId);
      await fx.svc.from('documents').delete().eq('folder_id', childId);
      await fx.svc.from('folders').delete().eq('id', childId);
      await fx.svc.from('folders').delete().eq('id', parentId);
    }
  });

  it('imports historical Storage bytes once and activates the root Assets workspace', async () => {
    const sizeBytes = 37;
    const objectPath = pathFor(fx.owner, randomUUID());
    const legacyTableBytes = 29;
    const legacyTablePath = `${fx.owner.id}/legacy-${randomUUID()}.png`;
    const sharedMediaBytes = 31;
    const sharedMediaPath = `${fx.owner.id}/shared-${randomUUID()}.png`;
    const fieldId = randomUUID();
    const sharedFieldId = randomUUID();
    const rowId = randomUUID();
    const uploaded = await fx.svc.storage.from('project-assets').upload(
      objectPath,
      new Uint8Array(sizeBytes),
      { contentType: 'image/png' },
    );
    expect(uploaded.error).toBeNull();
    const legacyUploaded = await fx.svc.storage.from('library-media-files').upload(
      legacyTablePath,
      new Uint8Array(legacyTableBytes),
      { contentType: 'image/png' },
    );
    expect(legacyUploaded.error).toBeNull();
    const sharedUploaded = await fx.svc.storage.from('library-media-files').upload(
      sharedMediaPath,
      new Uint8Array(sharedMediaBytes),
      { contentType: 'image/png' },
    );
    expect(sharedUploaded.error).toBeNull();
    expect((await fx.svc.from('library_field_definitions').insert([{
      id: fieldId,
      library_id: fx.libraryId,
      section: 'main',
      section_id: `${fx.libraryId}::main`,
      label: 'Legacy portrait',
      data_type: 'image',
      required: false,
      order_index: 0,
    }, {
      id: sharedFieldId,
      library_id: fx.libraryId,
      section: 'main',
      section_id: `${fx.libraryId}::main`,
      label: 'Shared portrait',
      data_type: 'image',
      required: false,
      order_index: 1,
    }])).error).toBeNull();
    expect((await fx.svc.from('library_assets').insert({
      id: rowId,
      library_id: fx.libraryId,
      name: 'Legacy row',
      row_index: 0,
    })).error).toBeNull();
    expect((await fx.svc.from('library_asset_values').insert([{
      asset_id: rowId,
      field_id: fieldId,
      value_json: {
        path: legacyTablePath,
        url: `https://example.test/${legacyTablePath}`,
        fileName: 'legacy.png',
        fileSize: legacyTableBytes,
        fileType: 'image/png',
      },
    }, {
      asset_id: rowId,
      field_id: sharedFieldId,
      value_json: {
        path: sharedMediaPath,
        url: `https://example.test/${sharedMediaPath}`,
        fileName: 'shared.png',
        fileSize: sharedMediaBytes,
        fileType: 'image/png',
      },
    }])).error).toBeNull();
    const sharedDocument = await fx.svc.from('documents').insert({
      project_id: fx.projectId,
      name: `Shared historical media ${fx.suffix}`,
      content: `![shared](https://example.test/${sharedMediaPath})`,
      created_by: fx.owner.id,
    }).select('id').single();
    expect(sharedDocument.error).toBeNull();
    const sharedDocumentId = sharedDocument.data?.id as string;
    const nativeAssetId = randomUUID();
    expect((await fx.svc.from('project_game_assets').insert({
      id: nativeAssetId,
      project_id: fx.projectId,
      created_by: fx.owner.id,
      name: 'Shared native asset',
      category: 'character',
      status: 'ready',
      mime_type: 'image/png',
      storage_bucket: 'library-media-files',
      storage_path: sharedMediaPath,
      file_size: sharedMediaBytes,
    })).error).toBeNull();

    try {
      expect((await fx.svc.from('project_storage_files').select('id')
        .eq('bucket_id', 'project-assets').eq('object_path', objectPath)).data).toHaveLength(0);

      const firstRepair = await fx.svc.rpc('service_repair_historical_project_storage');
      expect(firstRepair.error).toBeNull();
      expect(Number(firstRepair.data.importedFiles)).toBeGreaterThanOrEqual(3);
      const secondRepair = await fx.svc.rpc('service_repair_historical_project_storage');
      expect(secondRepair.error).toBeNull();
      expect(secondRepair.data).toEqual({ importedFiles: 0 });

      const files = await fx.svc.from('project_storage_files')
        .select('size_bytes,source_kind,project_id')
        .eq('bucket_id', 'project-assets').eq('object_path', objectPath);
      expect(files.error).toBeNull();
      expect(files.data).toEqual([{
        size_bytes: sizeBytes,
        source_kind: 'project_asset',
        project_id: fx.projectId,
      }]);
      const sharedFile = await fx.svc.from('project_storage_files')
        .select('source_kind,source_entity_id')
        .eq('bucket_id', 'library-media-files').eq('object_path', sharedMediaPath).single();
      expect(sharedFile.error).toBeNull();
      expect(sharedFile.data).toEqual({
        source_kind: 'document_image',
        source_entity_id: sharedDocumentId,
      });

      const listed = await fx.owner.client.rpc('account_storage_project_entities_v3', {
        p_project_id: fx.projectId,
        p_query: null,
        p_sort: 'size_desc',
        p_limit: 50,
        p_offset: 0,
        p_parent_folder_id: null,
      });
      expect(listed.error).toBeNull();
      const assets = listed.data.items.find((item: { kind: string }) => item.kind === 'assets');
      expect(Number(assets.physicalBytes)).toBeGreaterThanOrEqual(sizeBytes);
      expect(Number(assets.sizeBytes)).toBe(Number(assets.physicalBytes));
      const table = listed.data.items.find((item: { id: string }) => item.id === fx.libraryId);
      expect(Number(table.physicalBytes)).toBe(legacyTableBytes);
      const document = listed.data.items.find((item: { id: string }) => item.id === sharedDocumentId);
      expect(Number(document.physicalBytes)).toBe(sharedMediaBytes);
    } finally {
      await fx.svc.storage.from('project-assets').remove([objectPath]);
      await fx.svc.storage.from('library-media-files').remove([legacyTablePath, sharedMediaPath]);
      await fx.svc.from('project_storage_files')
        .delete().eq('bucket_id', 'project-assets').eq('object_path', objectPath);
      await fx.svc.from('project_storage_files')
        .delete().eq('bucket_id', 'library-media-files').eq('object_path', legacyTablePath);
      await fx.svc.from('project_storage_files')
        .delete().eq('bucket_id', 'library-media-files').eq('object_path', sharedMediaPath);
      await fx.svc.from('documents').delete().eq('id', sharedDocumentId);
      await fx.svc.from('project_game_assets').delete().eq('id', nativeAssetId);
      await fx.svc.from('library_assets').delete().eq('id', rowId);
      await fx.svc.from('library_field_definitions').delete().in('id', [fieldId, sharedFieldId]);
    }
  });

  it('accounts UTF-8 documents and complete library tables without blocking logical writes', async () => {
    const documentContent = `# \u903b\u8f91\u6587\u4ef6\n${'x'.repeat(1100)}`;
    const document = await fx.editor.client.from('documents').insert({
      project_id: fx.projectId,
      name: '',
      content: documentContent,
      created_by: fx.editor.id,
    }).select('id').single();
    expect(document.error).toBeNull();
    const documentId = document.data?.id as string;

    const documentLogical = await fx.svc.from('project_storage_logical_files')
      .select('project_id,owner_id,source_kind,size_bytes')
      .eq('source_kind', 'document_content').eq('source_entity_id', documentId).single();
    expect(documentLogical.error).toBeNull();
    expect(documentLogical.data).toMatchObject({
      project_id: fx.projectId,
      owner_id: fx.owner.id,
      source_kind: 'document_content',
      size_bytes: Buffer.byteLength(documentContent, 'utf8'),
    });

    const longDocumentName = `storage-document-${'x'.repeat(300)}`;
    const renamedDocument = await fx.svc.from('documents')
      .update({ name: longDocumentName }).eq('id', documentId);
    expect(renamedDocument.error).toBeNull();
    const renamedDocumentLogical = await fx.svc.from('project_storage_logical_files')
      .select('display_name').eq('source_kind', 'document_content')
      .eq('source_entity_id', documentId).single();
    expect(renamedDocumentLogical.error).toBeNull();
    expect(renamedDocumentLogical.data?.display_name).toBe(longDocumentName);

    const updatedDocumentContent = `${documentContent}\n\u6570\u636e`;
    const updatedDocument = await fx.svc.from('documents')
      .update({ content: updatedDocumentContent }).eq('id', documentId);
    expect(updatedDocument.error).toBeNull();
    const updatedDocumentLogical = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('source_kind', 'document_content')
      .eq('source_entity_id', documentId).single();
    expect(updatedDocumentLogical.error).toBeNull();
    expect(Number(updatedDocumentLogical.data?.size_bytes)).toBe(
      Buffer.byteLength(updatedDocumentContent, 'utf8'),
    );

    const longLibraryName = `storage-table-${'x'.repeat(300)}`;
    const library = await fx.editor.client.from('libraries').insert({
      project_id: fx.projectId,
      name: longLibraryName,
      description: 'Complete logical table',
    }).select('id').single();
    expect(library.error).toBeNull();
    const libraryId = library.data?.id as string;
    const referenceLibrary = await fx.editor.client.from('libraries').insert({
      project_id: fx.projectId,
      name: `reference-${fx.suffix}`,
    }).select('id').single();
    expect(referenceLibrary.error).toBeNull();
    const referenceLibraryId = referenceLibrary.data?.id as string;
    const fieldIds = [randomUUID(), randomUUID()];
    const sectionId = `${libraryId}::main`;
    const fields = await fx.svc.from('library_field_definitions').insert([
      {
        id: fieldIds[0], library_id: libraryId, section: 'main', section_id: sectionId,
        label: 'Name', data_type: 'string', required: true, order_index: 0,
      },
      {
        id: fieldIds[1], library_id: libraryId, section: 'main', section_id: sectionId,
        label: 'Stats', data_type: 'reference', required: false, order_index: 1,
        reference_libraries: [referenceLibraryId],
      },
    ]);
    expect(fields.error).toBeNull();

    const rowIds = [randomUUID(), randomUUID()];
    const rows = await fx.svc.from('library_assets').insert([
      { id: rowIds[0], library_id: libraryId, name: 'Hero', row_index: 0 },
      { id: rowIds[1], library_id: libraryId, name: 'Guide', row_index: 1 },
    ]);
    expect(rows.error).toBeNull();
    const values = await fx.svc.from('library_asset_values').insert([
      { asset_id: rowIds[0], field_id: fieldIds[0], value_json: '\u963f\u6f84' },
      { asset_id: rowIds[0], field_id: fieldIds[1], value_json: { hp: 120, tags: ['lead'] } },
      { asset_id: rowIds[1], field_id: fieldIds[0], value_json: 'Guide' },
      { asset_id: rowIds[1], field_id: fieldIds[1], value_json: { hp: 80, tags: ['support'] } },
    ]);
    expect(values.error).toBeNull();

    const libraryLogical = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('source_kind', 'library_table')
      .eq('source_entity_id', libraryId).single();
    expect(libraryLogical.error).toBeNull();
    const initialLibraryBytes = Number(libraryLogical.data?.size_bytes);
    expect(initialLibraryBytes).toBeGreaterThan(0);

    const plotPlan = {
      version: 1,
      nodes: [{ id: 'opening', title: '\u5e8f\u5e55', rowIds }],
      groups: [{ id: 'act-1', title: 'Act 1', nodeIds: ['opening'] }],
    };
    const updatedPlotPlan = await fx.svc.from('libraries')
      .update({ plot_plan: plotPlan }).eq('id', libraryId);
    expect(updatedPlotPlan.error).toBeNull();
    const libraryAfterPlotPlan = await fx.svc.from('project_storage_logical_files')
      .select('display_name,size_bytes').eq('source_kind', 'library_table')
      .eq('source_entity_id', libraryId).single();
    expect(libraryAfterPlotPlan.error).toBeNull();
    expect(libraryAfterPlotPlan.data?.display_name).toBe(longLibraryName);
    expect(Number(libraryAfterPlotPlan.data?.size_bytes)).toBeGreaterThan(initialLibraryBytes);

    const renamedReference = await fx.svc.from('libraries')
      .update({ name: `reference-renamed-${fx.suffix}` }).eq('id', referenceLibraryId);
    expect(renamedReference.error).toBeNull();
    const libraryAfterReferenceRename = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('source_kind', 'library_table')
      .eq('source_entity_id', libraryId).single();
    expect(libraryAfterReferenceRename.error).toBeNull();
    expect(Number(libraryAfterReferenceRename.data?.size_bytes)).toBeGreaterThan(
      Number(libraryAfterPlotPlan.data?.size_bytes),
    );

    const updateValues = await fx.svc.from('library_asset_values').update({
      value_json: { hp: 125, tags: ['lead', 'updated'] },
    }).eq('asset_id', rowIds[0]).eq('field_id', fieldIds[1]);
    expect(updateValues.error).toBeNull();
    const updatedLibraryLogical = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('source_kind', 'library_table')
      .eq('source_entity_id', libraryId).single();
    expect(updatedLibraryLogical.error).toBeNull();
    expect(Number(updatedLibraryLogical.data?.size_bytes)).toBeGreaterThan(initialLibraryBytes);

    const secondProject = await fx.svc.from('projects').insert({
      owner_id: fx.owner.id,
      name: `storage-move-${fx.suffix}`,
    }).select('id').single();
    expect(secondProject.error).toBeNull();
    const secondProjectId = secondProject.data?.id as string;
    const moved = await fx.svc.from('documents').update({ project_id: secondProjectId })
      .eq('id', documentId);
    expect(moved.error).toBeNull();
    const movedLogical = await fx.svc.from('project_storage_logical_files')
      .select('project_id,size_bytes').eq('source_kind', 'document_content')
      .eq('source_entity_id', documentId).single();
    expect(movedLogical.error).toBeNull();
    expect(movedLogical.data).toMatchObject({
      project_id: secondProjectId,
      size_bytes: Buffer.byteLength(updatedDocumentContent, 'utf8'),
    });

    const quota = await fx.svc.from('account_storage_quotas')
      .select('used_bytes,logical_used_bytes').eq('owner_id', fx.owner.id).single();
    const logicalRows = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('owner_id', fx.owner.id);
    expect(quota.error).toBeNull();
    expect(logicalRows.error).toBeNull();
    expect(Number(quota.data?.used_bytes)).toBe(0);
    expect(Number(quota.data?.logical_used_bytes)).toBe(
      (logicalRows.data ?? []).reduce((total, row) => total + Number(row.size_bytes), 0),
    );

    const summary = await fx.owner.client.rpc('account_storage_summary_v3');
    expect(summary.error).toBeNull();
    expect(summary.data).toMatchObject({
      physicalUsedBytes: 0,
      remainingBytes: 0,
    });
    expect(Number(summary.data.logicalUsedBytes)).toBeGreaterThan(QUOTA_BYTES);
    expect(Number(summary.data.overageBytes)).toBeGreaterThan(0);

    const listed = await fx.owner.client.rpc('account_storage_project_files', {
      p_project_id: fx.projectId,
      p_query: null,
      p_sort: 'size_desc',
      p_limit: 50,
      p_offset: 0,
    });
    expect(listed.error).toBeNull();
    expect(listed.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'library_table', sourceEntityId: libraryId }),
    ]));

    const deletedReferenceLibrary = await fx.svc.from('libraries').delete().eq('id', referenceLibraryId);
    expect(deletedReferenceLibrary.error).toBeNull();
    const libraryAfterReferenceDelete = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('source_kind', 'library_table')
      .eq('source_entity_id', libraryId).single();
    expect(libraryAfterReferenceDelete.error).toBeNull();
    expect(Number(libraryAfterReferenceDelete.data?.size_bytes)).toBeLessThan(
      Number(updatedLibraryLogical.data?.size_bytes),
    );
    const deletedLibrary = await fx.svc.from('libraries').delete().eq('id', libraryId);
    expect(deletedLibrary.error).toBeNull();
    const deletedProject = await fx.svc.from('projects').delete().eq('id', secondProjectId);
    expect(deletedProject.error).toBeNull();
    const deletedLogicalRows = await fx.svc.from('project_storage_logical_files')
      .select('id').in('source_entity_id', [documentId, libraryId]);
    expect(deletedLogicalRows.error).toBeNull();
    expect(deletedLogicalRows.data).toEqual([]);
    const finalQuota = await fx.svc.from('account_storage_quotas')
      .select('logical_used_bytes').eq('owner_id', fx.owner.id).single();
    const finalLogicalRows = await fx.svc.from('project_storage_logical_files')
      .select('size_bytes').eq('owner_id', fx.owner.id);
    expect(finalQuota.error).toBeNull();
    expect(finalLogicalRows.error).toBeNull();
    expect(Number(finalQuota.data?.logical_used_bytes)).toBe(
      (finalLogicalRows.data ?? []).reduce((total, row) => total + Number(row.size_bytes), 0),
    );
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

    const result = await fx.editor.client.rpc('account_storage_summary_v3');
    if (result.error) throw new Error(result.error.message);
    expect(result.data).toMatchObject({ physicalUsedBytes: 0, reservedBytes: 0 });
    expect(Number(result.data.usedBytes)).toBe(Number(result.data.logicalUsedBytes));
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
