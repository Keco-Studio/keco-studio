import { createHash } from 'node:crypto';
import type { ToolContext } from '@/lib/agent/types';
import { uploadMapReferenceTool } from '@/lib/agent/tools/upload-map-reference';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { uploadCreateMapReference } from '@/lib/server/createMapReferenceService';

jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/server/createMapReferenceService', () => ({ uploadCreateMapReference: jest.fn() }));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONVERSATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MESSAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBMISSION = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ASSET = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const bytes = new Uint8Array([137, 80, 78, 71, 1, 2]);
const normalizedBytes = new Uint8Array([137, 80, 78, 71, 3, 4]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const normalizedSha256 = createHash('sha256').update(normalizedBytes).digest('hex');

function query(row: unknown) {
  const result = { data: row, error: null };
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => result);
  return chain;
}

function setup(options?: { bound?: boolean; consumed?: boolean; forgedHash?: boolean }) {
  const source = { fileName: 'layout.png', mimeType: 'image/png', fileSize: bytes.length,
    sha256, normalizedSha256, width: 16, height: 16,
    bytes: new Uint8Array(bytes), normalizedBytes: new Uint8Array(normalizedBytes),
    messageId: MESSAGE, submissionId: SUBMISSION };
  const rpc = jest.fn(async () => ({ data: options?.consumed === false ? false : true, error: null }));
  const from = jest.fn((table: string) => {
    if (table === 'agent_conversations') return query({ id: CONVERSATION, user_id: USER, project_id: PROJECT });
    if (table === 'agent_messages') return query(options?.bound === false ? null : {
      id: MESSAGE, role: 'user', content: { map_reference_submission_id: SUBMISSION,
        map_reference_attachment: { fileName: source.fileName, mimeType: source.mimeType,
          fileSize: source.fileSize, sha256: options?.forgedHash ? '0'.repeat(64) : sha256,
          normalizedSha256, width: source.width, height: source.height } },
    });
    throw new Error(`Unexpected table ${table}`);
  });
  const ctx = { userId: USER, projectId: PROJECT, conversationId: CONVERSATION,
    workspace: 'create-map', userRole: 'editor', supabase: { from, rpc },
    authoritativeUserSource: { messageId: MESSAGE, content: 'Upload this layout' },
    authoritativeMapReference: source } as unknown as ToolContext;
  return { ctx, rpc };
}

describe('upload_map_reference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
    jest.mocked(uploadCreateMapReference).mockResolvedValue({ id: ASSET, projectId: PROJECT,
      name: 'layout.png', sha256: normalizedSha256, width: 16, height: 16 } as never);
  });

  it('rejects model-provided source arguments and missing current attachments', async () => {
    const { ctx } = setup();
    expect((await uploadMapReferenceTool.execute({ url: 'https://example.test/layout.png' }, ctx)).success).toBe(false);
    expect((await uploadMapReferenceTool.execute({ path: '/tmp/layout.png' }, ctx)).success).toBe(false);
    ctx.authoritativeMapReference = undefined;
    expect((await uploadMapReferenceTool.execute({}, ctx)).success).toBe(false);
    expect(uploadCreateMapReference).not.toHaveBeenCalled();
  });

  it('requires an editor, the exact saved user message, and matching bytes', async () => {
    jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
    expect((await uploadMapReferenceTool.execute({}, setup().ctx)).success).toBe(false);
    expect((await uploadMapReferenceTool.execute({}, setup({ bound: false }).ctx)).success).toBe(false);
    expect((await uploadMapReferenceTool.execute({}, setup({ forgedHash: true }).ctx)).success).toBe(false);
    const altered = setup();
    altered.ctx.authoritativeMapReference!.bytes[0] = 0;
    expect((await uploadMapReferenceTool.execute({}, altered.ctx)).success).toBe(false);
    expect(uploadCreateMapReference).not.toHaveBeenCalled();
  });

  it('consumes the bound submission before uploading with the normalized image', async () => {
    const { ctx, rpc } = setup();
    const result = await uploadMapReferenceTool.execute({}, ctx);
    expect(result).toMatchObject({ success: true, data: { assetId: ASSET, sha256: normalizedSha256 },
      invalidations: [{ type: 'create-map', projectId: PROJECT }] });
    expect(rpc).toHaveBeenCalledWith('consume_agent_map_reference_submission', {
      p_submission_id: SUBMISSION, p_message_id: MESSAGE, p_project_id: PROJECT,
      p_conversation_id: CONVERSATION, p_sha256: sha256,
    });
    expect(uploadCreateMapReference).toHaveBeenCalledWith(PROJECT,
      expect.objectContaining({ name: 'layout.png', type: 'image/png' }), USER,
      expect.objectContaining({ sha256: normalizedSha256, width: 16, height: 16 }));
  });

  it('blocks replay and masks unexpected uploader errors', async () => {
    expect((await uploadMapReferenceTool.execute({}, setup({ consumed: false }).ctx)).error)
      .toBe('This Map reference submission was already used.');
    expect(uploadCreateMapReference).not.toHaveBeenCalled();
    jest.mocked(uploadCreateMapReference).mockRejectedValueOnce(new Error('storage internals'));
    expect((await uploadMapReferenceTool.execute({}, setup().ctx)).error).toBe('Map reference upload failed.');
  });
});
