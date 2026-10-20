import { createHash } from 'node:crypto';
import { projectAssetContentMatches } from '@/lib/services/projectAssetContent';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { gameMediaAttachmentRecord } from '../game-media-attachment';
import type { GameMediaAttachment } from '../game-media-attachment';
import { requireProjectContext } from '../workspace';

const BUCKET = 'project-assets';
const PUBLIC_UPLOAD_ERRORS = new Set([
  'Editor or admin access is required.',
  'Conversation project binding is invalid.',
  'Game-media attachment is not bound to this user message.',
  'Game-media submission is not bound to this user message.',
  'Game-media attachment bytes failed verification.',
  'Game-media message already has a different asset.',
  'Uploaded game media was not found.',
  'Uploaded game-media metadata differs from the attachment.',
  'Uploaded game media could not be verified.',
  'Uploaded game-media bytes differ from the attachment.',
  'Game-media storage upload failed.',
  'Game-media storage reservation is invalid.',
  'Game-media registration failed.',
  'Game-media registration returned invalid data.',
]);

function storageMime(info: Record<string, unknown>): string {
  const metadata = info.metadata && typeof info.metadata === 'object'
    ? info.metadata as Record<string, unknown> : {};
  return String(info.contentType ?? metadata.mimetype ?? '').split(';', 1)[0].trim().toLowerCase();
}

async function verifyStoredBytes(ctx: ToolContext, path: string, source: GameMediaAttachment) {
  const bucket = ctx.supabase.storage.from(BUCKET);
  const { data: rawInfo, error: infoError } = await bucket.info(path);
  if (infoError || !rawInfo) throw new Error('Uploaded game media was not found.');
  const info = rawInfo as unknown as Record<string, unknown>;
  const metadata = info.metadata && typeof info.metadata === 'object'
    ? info.metadata as Record<string, unknown> : {};
  const storageSize = Number(info.size ?? metadata.size);
  if (!Number.isSafeInteger(storageSize) || storageSize !== source.fileSize
    || storageMime(info) !== source.mimeType) {
    throw new Error('Uploaded game-media metadata differs from the attachment.');
  }
  const { data: blob, error: downloadError } = await bucket.download(path);
  if (downloadError || !blob) throw new Error('Uploaded game media could not be verified.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.byteLength !== source.fileSize || !projectAssetContentMatches(source.mimeType, bytes)
    || createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    throw new Error('Uploaded game-media bytes differ from the attachment.');
  }
  return { bytes, info };
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!params || typeof params !== 'object' || Array.isArray(params)
    || Object.keys(params).length !== 0) {
    return { success: false, error: 'Upload accepts no source arguments.' };
  }
  const source = ctx.authoritativeGameMedia;
  if (!source || source.messageId !== ctx.authoritativeUserSource?.messageId) {
    return { success: false, error: 'Attach a game-media file to the current message first.' };
  }
  let reservationId: string | null = null;
  let uploaded = false;
  let path = '';
  try {
    const projectId = requireProjectContext(ctx);
    const role = (await getUserProjectRole(ctx.supabase, projectId, ctx.userId)).role;
    if (role !== 'admin' && role !== 'editor') throw new Error('Editor or admin access is required.');

    const { data: conversation, error: conversationError } = await ctx.supabase
      .from('agent_conversations').select('id,user_id,project_id')
      .eq('id', ctx.conversationId).maybeSingle();
    if (conversationError || !conversation || conversation.user_id !== ctx.userId
      || conversation.project_id !== projectId) throw new Error('Conversation project binding is invalid.');
    const { data: message, error: messageError } = await ctx.supabase
      .from('agent_messages').select('id,role,content')
      .eq('id', source.messageId).eq('conversation_id', ctx.conversationId).maybeSingle();
    const messageContent = message?.content as Record<string, unknown> | null;
    const persisted = messageContent?.game_media_attachment;
    const expected = gameMediaAttachmentRecord(source);
    if (messageError || !message || message.role !== 'user'
      || messageContent?.game_media_submission_id !== source.submissionId
      || !persisted || typeof persisted !== 'object' || Array.isArray(persisted)
      || Object.keys(persisted).length !== Object.keys(expected).length
      || Object.keys(expected).some((key) =>
        (persisted as Record<string, unknown>)[key] !== expected[key as keyof typeof expected])) {
      throw new Error('Game-media attachment is not bound to this user message.');
    }
    const { data: submissionBound, error: submissionError } = await ctx.supabase.rpc(
      'verify_agent_game_media_submission', {
        p_submission_id: source.submissionId,
        p_message_id: source.messageId,
        p_project_id: projectId,
        p_conversation_id: ctx.conversationId,
      }
    );
    if (submissionError || submissionBound !== true) {
      throw new Error('Game-media submission is not bound to this user message.');
    }
    const actualSourceHash = createHash('sha256').update(source.bytes).digest('hex');
    if (source.bytes.byteLength !== source.fileSize || actualSourceHash !== source.sha256
      || !projectAssetContentMatches(source.mimeType, source.bytes)) {
      throw new Error('Game-media attachment bytes failed verification.');
    }

    const safeName = source.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\.+/g, '_');
    path = `${ctx.userId}/${projectId}/${source.messageId}-${safeName}`;
    const existing = await ctx.supabase.from('project_game_assets')
      .select('id,sha256,file_size,mime_type,name')
      .eq('project_id', projectId).eq('storage_bucket', BUCKET).eq('storage_path', path).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      if (existing.data.sha256 !== source.sha256 || existing.data.file_size !== source.fileSize
        || existing.data.mime_type !== source.mimeType || existing.data.name !== source.fileName) {
        throw new Error('Game-media message already has a different asset.');
      }
      await verifyStoredBytes(ctx, path, source);
      return { success: true, displayHint: 'text', data: {
        assetId: existing.data.id, name: source.fileName, sha256: source.sha256, reused: true,
      }, invalidations: [{ type: 'game-media', projectId }] };
    }

    const { reserveProjectStorage } = await import('@/lib/server/storageQuota');
    const reservation = await reserveProjectStorage(ctx.supabase, {
      projectId, bucketId: BUCKET, objectPath: path,
      expectedBytes: source.fileSize, displayName: source.fileName,
      mimeType: source.mimeType, sourceKind: 'project_asset',
    });
    reservationId = reservation.reservationId;
    const bucket = ctx.supabase.storage.from(BUCKET);
    const { error: uploadError } = await bucket.upload(path, source.bytes, {
      contentType: source.mimeType, upsert: false,
    });
    if (uploadError) throw new Error('Game-media storage upload failed.');
    uploaded = true;

    const { bytes, info } = await verifyStoredBytes(ctx, path, source);

    let width: number | null = null;
    let height: number | null = null;
    let hasTransparency: boolean | null = null;
    if (source.mimeType.startsWith('image/') && source.mimeType !== 'image/svg+xml'
      && source.mimeType !== 'image/vnd.adobe.photoshop') {
      const { default: sharp } = await import('sharp');
      const image = await sharp(bytes).metadata();
      width = image.width ?? null;
      height = image.height ?? null;
      hasTransparency = image.hasAlpha ?? null;
    }
    const objectCreatedAt = typeof info.created_at === 'string' ? info.created_at
      : typeof info.createdAt === 'string' ? info.createdAt : null;
    const { error: bindingError } = await ctx.supabase.rpc('resolve_project_storage_upload_reservation', {
      p_project_id: projectId, p_bucket_id: BUCKET,
      p_object_path: path, p_reservation_id: reservationId,
    });
    if (bindingError) throw new Error('Game-media storage reservation is invalid.');
    const { data, error } = await ctx.supabase.rpc('complete_project_game_asset_storage_upload_v2', {
      p_reservation_id: reservationId, p_project_id: projectId,
      p_name: source.fileName, p_category: 'media', p_mime_type: source.mimeType,
      p_storage_bucket: BUCKET, p_storage_path: path, p_sha256: source.sha256,
      p_width: width, p_height: height, p_has_transparency: hasTransparency,
      p_file_size: source.fileSize, p_object_created_at: objectCreatedAt,
    });
    if (error) throw new Error('Game-media registration failed.');
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row || typeof row.id !== 'string') throw new Error('Game-media registration returned invalid data.');
    reservationId = null;
    uploaded = false;
    return { success: true, displayHint: 'text', data: {
      assetId: row.id, name: source.fileName, sha256: source.sha256, reused: row.reused === true,
    }, invalidations: [{ type: 'game-media', projectId }] };
  } catch (error) {
    if (uploaded) {
      try { await ctx.supabase.storage.from(BUCKET).remove([path]); } catch { /* best effort */ }
    }
    if (reservationId) {
      try {
        const { releaseProjectStorage } = await import('@/lib/server/storageQuota');
        await releaseProjectStorage(ctx.supabase, reservationId);
      } catch { /* best effort */ }
    }
    return { success: false, error: error instanceof Error && PUBLIC_UPLOAD_ERRORS.has(error.message)
      ? error.message : 'Game-media upload failed.' };
  }
}

export const uploadGameMediaTool: AgentTool = {
  name: 'upload_game_media',
  description: 'Upload the actual game-media file attached to the current user message into this project. No URL, path, or model-provided file source is accepted.',
  category: 'write', confirmationMode: 'pre_execute', confirmationRequired: false,
  requiredPermission: 'editor',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute,
};
