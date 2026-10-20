import { createHash } from 'node:crypto';
import { uploadGameMediaTool } from '@/lib/agent/tools/upload-game-media';
import { validateGameMediaAttachment } from '@/lib/agent/game-media-attachment';
import type { ToolContext } from '@/lib/agent/types';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONVERSATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MESSAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RESERVATION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASSET = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SUBMISSION = '99999999-9999-4999-8999-999999999999';
const bytes = Buffer.from('%PDF-1.7\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');

const reserve = jest.fn();
const release = jest.fn();
const role = jest.fn();

jest.mock('@/lib/server/storageQuota', () => ({
  reserveProjectStorage: (...args: unknown[]) => reserve(...args),
  releaseProjectStorage: (...args: unknown[]) => release(...args),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: (...args: unknown[]) => role(...args),
}));

function query(row: unknown) {
  const result = { data: row, error: null };
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => result);
  return chain;
}

function setup(options?: { bound?: boolean; storedBytes?: Uint8Array; existing?: unknown }) {
  const source = {
    fileName: 'guide.pdf', mimeType: 'application/pdf', fileSize: bytes.length,
    sha256, bytes: new Uint8Array(bytes), messageId: MESSAGE, submissionId: SUBMISSION,
  };
  const path = `${USER}/${PROJECT}/${MESSAGE}-guide.pdf`;
  const bucket = {
    upload: jest.fn(async () => ({ data: { path }, error: null })),
    info: jest.fn(async () => ({ data: { size: bytes.length, contentType: 'application/pdf' }, error: null })),
    download: jest.fn(async () => ({ data: new Blob([Buffer.from(options?.storedBytes ?? bytes)]), error: null })),
    remove: jest.fn(async () => ({ error: null })),
  };
  const rpc = jest.fn(async (name: string) => name === 'resolve_project_storage_upload_reservation'
    ? { data: null, error: null }
    : name === 'verify_agent_game_media_submission'
      ? { data: true, error: null }
      : { data: [{ id: ASSET, reused: false }], error: null });
  const from = jest.fn((table: string) => {
    if (table === 'agent_conversations') return query({ id: CONVERSATION, user_id: USER, project_id: PROJECT });
    if (table === 'agent_messages') return query(options?.bound === false ? null : {
      id: MESSAGE, role: 'user', content: { game_media_submission_id: SUBMISSION, game_media_attachment: {
        fileName: source.fileName, mimeType: source.mimeType, fileSize: source.fileSize, sha256,
      } },
    });
    if (table === 'project_game_assets') return query(options?.existing ?? null);
    throw new Error(`Unexpected table ${table}`);
  });
  const ctx = {
    userId: USER, projectId: PROJECT, conversationId: CONVERSATION,
    workspace: 'studio', userRole: 'editor', supabase: {
      from, rpc, storage: { from: jest.fn(() => bucket) },
    }, authoritativeUserSource: { messageId: MESSAGE, content: 'Upload my guide' },
    authoritativeGameMedia: source,
  } as unknown as ToolContext;
  return { ctx, bucket, rpc, path };
}

describe('upload_game_media', () => {
  beforeEach(() => {
    reserve.mockReset().mockResolvedValue({ reservationId: RESERVATION });
    release.mockReset().mockResolvedValue({ reservationId: RESERVATION });
    role.mockReset().mockResolvedValue({ role: 'editor' });
  });

  it('rejects missing source or model-provided arguments', async () => {
    const { ctx, bucket } = setup();
    expect((await uploadGameMediaTool.execute({ url: 'https://example.test/file' }, ctx)).success).toBe(false);
    ctx.authoritativeGameMedia = undefined;
    expect((await uploadGameMediaTool.execute({}, ctx)).success).toBe(false);
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('requires the current saved user message and writer role', async () => {
    const { ctx, bucket } = setup({ bound: false });
    expect((await uploadGameMediaTool.execute({}, ctx)).success).toBe(false);
    expect(bucket.upload).not.toHaveBeenCalled();
    role.mockResolvedValue({ role: 'viewer' });
    const second = setup();
    expect((await uploadGameMediaTool.execute({}, second.ctx)).success).toBe(false);
    expect(second.bucket.upload).not.toHaveBeenCalled();
  });

  it('verifies stored bytes and completes an accounted asset', async () => {
    const { ctx, bucket, rpc, path } = setup();
    const result = await uploadGameMediaTool.execute({}, ctx);
    expect(result).toMatchObject({ success: true, data: { assetId: ASSET, sha256 },
      invalidations: [{ type: 'game-media', projectId: PROJECT }] });
    expect(reserve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      objectPath: path, expectedBytes: bytes.length, sourceKind: 'project_asset',
    }));
    expect(bucket.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), {
      contentType: 'application/pdf', upsert: false,
    });
    expect(rpc).toHaveBeenCalledWith('complete_project_game_asset_storage_upload_v2', expect.objectContaining({
      p_reservation_id: RESERVATION, p_project_id: PROJECT, p_sha256: sha256,
    }));
    expect(release).not.toHaveBeenCalled();
  });

  it('removes mismatched storage bytes and releases the reservation', async () => {
    const { ctx, bucket, rpc } = setup({ storedBytes: Buffer.from('not-pdf') });
    expect((await uploadGameMediaTool.execute({}, ctx)).success).toBe(false);
    expect(bucket.remove).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(expect.anything(), RESERVATION);
    expect(rpc).not.toHaveBeenCalledWith('complete_project_game_asset_storage_upload_v2', expect.anything());
  });

  it('reuses the asset registered for the same immutable message', async () => {
    const { ctx, bucket } = setup({ existing: {
      id: ASSET, sha256, file_size: bytes.length, mime_type: 'application/pdf', name: 'guide.pdf',
    } });
    expect(await uploadGameMediaTool.execute({}, ctx)).toMatchObject({
      success: true, data: { assetId: ASSET, reused: true },
      invalidations: [{ type: 'game-media', projectId: PROJECT }],
    });
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('does not expose unexpected internal error messages', async () => {
    const { ctx } = setup();
    role.mockRejectedValue(new Error('internal database detail'));
    expect(await uploadGameMediaTool.execute({}, ctx)).toMatchObject({
      success: false, error: 'Game-media upload failed.',
    });
  });
});

describe('game-media attachment validation', () => {
  it('requires bytes matching the declared format', async () => {
    await expect(validateGameMediaAttachment(new File(['wrong'], 'guide.pdf', {
      type: 'application/pdf',
    }))).rejects.toThrow('bytes');
    await expect(validateGameMediaAttachment(new File([bytes], 'guide.pdf', {
      type: 'application/pdf',
    }))).resolves.toMatchObject({ fileName: 'guide.pdf', sha256 });
  });
});
