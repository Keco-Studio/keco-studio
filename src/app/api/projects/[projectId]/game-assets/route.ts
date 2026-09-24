import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { aggregateProjectGameAssets } from '@/lib/services/gameAssetsService';
import { getUserProjectRole, AuthorizationError } from '@/lib/services/authorizationService';
import {
  canonicalProjectAssetMimeType,
  projectAssetMaxBytes,
  projectAssetMimeFromName,
  projectAssetExtensionMatches,
} from '@/lib/services/projectAssetUploadContract';
import { projectAssetContentMatches } from '@/lib/services/projectAssetContent';
import {
  releaseProjectStorage,
  reserveProjectStorage,
  StorageQuotaError,
} from '@/lib/server/storageQuota';

const UUID = z.string().uuid();
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const PROJECT_ASSET_BUCKET = 'project-assets';
const MAX_BATCH_SIZE = 20;
export const runtime = 'nodejs';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

function storageErrorResponse(error: unknown): Response | null {
  if (!(error instanceof StorageQuotaError)) return null;
  if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
    return json({ error: 'Storage quota exceeded' }, 409);
  }
  if (error.code === 'STORAGE_PROJECT_FORBIDDEN') {
    return json({ error: 'Forbidden' }, 403);
  }
  return json({ error: 'Storage is temporarily unavailable' }, 503);
}

async function bestEffortRelease(supabase: Parameters<typeof reserveProjectStorage>[0], reservationId: string) {
  try { await releaseProjectStorage(supabase, reservationId); } catch { /* best effort */ }
}

function storageCompletionError(error: unknown): Error {
  const detail = error && typeof error === 'object'
    ? (error as Record<string, unknown>).details ?? (error as Record<string, unknown>).message
    : null;
  if (detail === 'STORAGE_QUOTA_EXCEEDED' || detail === 'STORAGE_PROJECT_FORBIDDEN'
    || detail === 'STORAGE_RESERVATION_EXPIRED' || detail === 'STORAGE_OBJECT_MISMATCH') {
    return new StorageQuotaError(detail);
  }
  return new Error('Asset registration failed');
}

function mimeFromName(name: string): string | null {
  return projectAssetMimeFromName(name);
}

const fileMetadataSchema = z.object({
  fileName: z.string().min(1).max(255).refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value)),
  fileType: z.string().min(1).max(200),
  fileSize: z.number().int().min(1),
}).strict();
const prepareUploadSchema = z.object({
  action: z.literal('prepare'),
  files: z.array(fileMetadataSchema).min(1).max(MAX_BATCH_SIZE),
}).strict();
const completeUploadSchema = z.object({
  action: z.literal('complete'),
  items: z.array(fileMetadataSchema.extend({
    path: z.string().min(1).max(2048),
    reservationId: UUID,
  })).min(1).max(MAX_BATCH_SIZE),
}).strict();
const activateWorkspaceSchema = z.object({ action: z.literal('activate-workspace') }).strict();

function validatedMetadata(input: z.infer<typeof fileMetadataSchema>) {
  const mimeType = canonicalProjectAssetMimeType(input.fileType) ?? mimeFromName(input.fileName);
  if (!mimeType || !projectAssetExtensionMatches(input.fileName, mimeType)
    || input.fileSize > projectAssetMaxBytes(mimeType)) {
    throw new Error('Unsupported asset format or file size limit exceeded');
  }
  return { ...input, fileType: mimeType };
}

function storageMimeType(info: Record<string, unknown>): string {
  const metadata = info.metadata && typeof info.metadata === 'object'
    ? info.metadata as Record<string, unknown>
    : {};
  return String(info.contentType ?? metadata.mimetype ?? '').split(';', 1)[0].trim().toLowerCase();
}

type RouteContext = { params: Promise<{ projectId: string }> };

export const GET = withAuth<RouteContext>(async (request, context, { supabase }) => {
  const { projectId } = await context.params;
  if (!UUID.safeParse(projectId).success) return json({ error: 'Invalid project id' }, 400);
  try {
    await getUserProjectRole(supabase, projectId);
    const result = await aggregateProjectGameAssets(supabase, projectId);
    return json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) return json({ error: 'Forbidden' }, 403);
    console.error('[game-assets] list failed', error);
    return json({ error: 'Unable to load game assets' }, 500);
  }
});

export const POST = withAuth<RouteContext>(async (request, context, { supabase, user }) => {
  const { projectId } = await context.params;
  if (!UUID.safeParse(projectId).success) return json({ error: 'Invalid project id' }, 400);
  try {
    const role = (await getUserProjectRole(supabase, projectId, user.id)).role;
    if (role === 'viewer') return json({ error: 'Editor or admin access is required' }, 403);
    const body = await request.json().catch(() => null);
    const activateWorkspace = activateWorkspaceSchema.safeParse(body);
    if (activateWorkspace.success) {
      const { error } = await supabase
        .from('projects')
        .update({ assets_workspace_enabled: true })
        .eq('id', projectId);
      if (error) throw new Error('Assets workspace activation failed');
      return json({ assetsWorkspaceEnabled: true });
    }
    const prepared = prepareUploadSchema.safeParse(body);
    if (prepared.success) {
      const items = [];
      for (const [index, input] of prepared.data.files.entries()) {
        let reservationId: string | null = null;
        try {
          const file = validatedMetadata(input);
          const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `${user.id}/${projectId}/${randomUUID()}-${safeName}`;
          const reservation = await reserveProjectStorage(supabase, {
            projectId,
            bucketId: PROJECT_ASSET_BUCKET,
            objectPath: path,
            expectedBytes: file.fileSize,
            displayName: file.fileName,
            mimeType: file.fileType,
            sourceKind: 'project_asset',
          });
          reservationId = reservation.reservationId;
          const { data, error } = await supabase.storage
            .from(PROJECT_ASSET_BUCKET)
            .createSignedUploadUrl(path, { upsert: false });
          if (error || !data?.signedUrl) throw new Error('Upload target could not be prepared');
          items.push({
            index,
            ok: true as const,
            file,
            path,
            reservationId,
            upload: {
              url: data.signedUrl,
              method: 'PUT' as const,
              headers: { 'cache-control': 'max-age=3600', 'content-type': file.fileType, 'x-upsert': 'false' },
            },
          });
        } catch (error) {
          if (reservationId) await bestEffortRelease(supabase, reservationId);
          const storageError = storageErrorResponse(error);
          if (storageError) {
            await Promise.all(items.filter((item) => item.ok).map((item) => bestEffortRelease(supabase, item.reservationId)));
            return storageError;
          }
          items.push({ index, ok: false as const, file: input, error: 'Upload preparation failed' });
        }
      }
      return json({ items, preparedCount: items.filter((item) => item.ok).length, failedCount: items.filter((item) => !item.ok).length }, 201);
    }

    const completed = completeUploadSchema.safeParse(body);
    if (!completed.success) return json({ error: 'Invalid asset upload request' }, 400);
    if (new Set(completed.data.items.map((item) => item.path)).size !== completed.data.items.length) {
      return json({ error: 'Asset paths must be unique' }, 400);
    }
    const items = [];
    let completionStorageError: unknown = null;
    for (const [index, input] of completed.data.items.entries()) {
      let removeObjectOnFailure = false;
      let reservationBindingConfirmed = false;
      try {
        const prefix = `${user.id}/${projectId}/`;
        const relativePath = input.path.startsWith(prefix) ? input.path.slice(prefix.length) : '';
        if (!relativePath || relativePath.includes('/')) throw new Error('Invalid project asset path');
        const { error: bindingError } = await supabase.rpc('resolve_project_storage_upload_reservation', {
          p_project_id: projectId,
          p_bucket_id: PROJECT_ASSET_BUCKET,
          p_object_path: input.path,
          p_reservation_id: input.reservationId,
        });
        if (bindingError) throw storageCompletionError(bindingError);
        reservationBindingConfirmed = true;
        removeObjectOnFailure = true;
        const file = validatedMetadata(input);
        const bucket = supabase.storage.from(PROJECT_ASSET_BUCKET);
        const { data: rawInfo, error: infoError } = await bucket.info(input.path);
        if (infoError || !rawInfo) throw new Error('Uploaded asset was not found');
        const info = rawInfo as unknown as Record<string, unknown>;
        const actualSize = Number(info.size ?? (info.metadata as Record<string, unknown> | undefined)?.size);
        const actualMimeType = canonicalProjectAssetMimeType(storageMimeType(info));
        if (actualSize !== file.fileSize || actualMimeType !== file.fileType
          || !Number.isInteger(actualSize) || actualSize < 1
          || actualSize > projectAssetMaxBytes(file.fileType)) {
          throw new Error('Uploaded asset metadata does not match its preparation');
        }
        const { data: blob, error: downloadError } = await bucket.download(input.path);
        if (downloadError || !blob) throw new Error('Uploaded asset could not be verified');
        const bytes = Buffer.from(await blob.arrayBuffer());
        if (bytes.byteLength !== actualSize || !projectAssetContentMatches(file.fileType, bytes)) {
          throw new Error('File content does not match its declared format');
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        let width: number | null = null;
        let height: number | null = null;
        let hasTransparency: boolean | null = null;
        if (file.fileType.startsWith('image/') && file.fileType !== 'image/svg+xml'
          && file.fileType !== 'image/vnd.adobe.photoshop') {
          const metadata = await sharp(bytes).metadata();
          width = metadata.width ?? null;
          height = metadata.height ?? null;
          hasTransparency = metadata.hasAlpha ?? null;
        }
        const objectCreatedAt = typeof info.created_at === 'string'
          ? info.created_at
          : typeof info.createdAt === 'string'
            ? info.createdAt
            : null;
        // This RPC validates the reservation binding, registers the asset, and
        // finalizes physical bytes in one database transaction.
        const { data, error } = await supabase.rpc('complete_project_game_asset_storage_upload_v2', {
          p_reservation_id: input.reservationId,
          p_project_id: projectId,
          p_name: file.fileName,
          p_category: 'media',
          p_mime_type: file.fileType,
          p_storage_bucket: PROJECT_ASSET_BUCKET,
          p_storage_path: input.path,
          p_sha256: sha256,
          p_width: width,
          p_height: height,
          p_has_transparency: hasTransparency,
          p_file_size: file.fileSize,
          p_object_created_at: objectCreatedAt,
        });
        if (error) throw storageCompletionError(error);
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
        if (!row || typeof row.id !== 'string') throw new Error('Asset registration returned invalid data');
        removeObjectOnFailure = false;
        items.push({ ok: true as const, index, name: file.fileName, id: row.id, sha256, reused: row.reused === true });
      } catch (error) {
        if (removeObjectOnFailure) {
          try { await supabase.storage.from(PROJECT_ASSET_BUCKET).remove([input.path]); } catch { /* best effort */ }
        }
        if (reservationBindingConfirmed) await bestEffortRelease(supabase, input.reservationId);
        if (!completionStorageError && error instanceof StorageQuotaError) completionStorageError = error;
        items.push({ ok: false as const, index, name: input.fileName, error: 'Upload failed' });
      }
    }
    const storageError = storageErrorResponse(completionStorageError);
    if (storageError) return storageError;
    return json({ items, completedCount: items.filter((item) => item.ok).length, failedCount: items.filter((item) => !item.ok).length }, 201);
  } catch (error) {
    if (error instanceof AuthorizationError) return json({ error: 'Forbidden' }, 403);
    const storageError = storageErrorResponse(error);
    if (storageError) return storageError;
    console.error('[game-assets] upload failed', error);
    return json({ error: 'Unable to upload game assets' }, 500);
  }
});
