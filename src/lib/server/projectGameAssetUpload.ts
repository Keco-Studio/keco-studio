import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { z } from 'zod';
import type { GameAssetCategory } from '@/lib/services/gameAssetsService';
import { projectAssetContentMatches } from '@/lib/services/projectAssetContent';
import {
  canonicalProjectAssetMimeType,
  projectAssetExtensionMatches,
  projectAssetMaxBytes,
} from '@/lib/services/projectAssetUploadContract';
import { releaseProjectStorage, reserveProjectStorage } from '@/lib/server/storageQuota';

const PROJECT_ASSET_BUCKET = 'project-assets';
const uuidSchema = z.string().uuid();
const categorySchema = z.enum([
  'character',
  'icon',
  'ui',
  'map',
  'prop',
  'vfx',
  'spritesheet',
  'media',
]);
const fileNameSchema = z.string().min(1).max(255)
  .refine((value) => !/[\u0000-\u001f\u007f/\\]/.test(value))
  .refine((value) => value !== '.' && value !== '..' && !value.includes('..'));
const completionSchema = z.object({
  id: uuidSchema,
  project_id: uuidSchema,
  category: categorySchema,
  storage_path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
}).passthrough();

export type RegisterProjectGameAssetBufferInput = {
  client: SupabaseClient;
  userId: string;
  projectId: string;
  category: GameAssetCategory;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

export type RegisteredProjectGameAsset = {
  assetId: string;
  storagePath: string;
  category: GameAssetCategory;
  sha256: string;
  width: number | null;
  height: number | null;
};

export type ValidatedProjectGameAssetMetadata = {
  fileName: string;
  fileType: string;
  fileSize: number;
};

export type InspectedProjectGameAssetBytes = {
  sha256: string;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
};

function invalidAsset(): Error {
  return new Error('Invalid project game asset');
}

export function validateProjectGameAssetMetadata(input: {
  fileName: string;
  fileType: string;
  fileSize: number;
}): ValidatedProjectGameAssetMetadata {
  const mimeType = canonicalProjectAssetMimeType(input.fileType);
  if (!fileNameSchema.safeParse(input.fileName).success
    || !mimeType
    || !Number.isSafeInteger(input.fileSize)
    || input.fileSize < 1
    || input.fileSize > projectAssetMaxBytes(mimeType)
    || !projectAssetExtensionMatches(input.fileName, mimeType)) {
    throw invalidAsset();
  }
  return { fileName: input.fileName, fileType: mimeType, fileSize: input.fileSize };
}

export async function inspectProjectGameAssetBytes(
  mimeType: string,
  bytes: Buffer,
): Promise<InspectedProjectGameAssetBytes> {
  if (!Buffer.isBuffer(bytes) || !projectAssetContentMatches(mimeType, bytes)) {
    throw invalidAsset();
  }
  let width: number | null = null;
  let height: number | null = null;
  let hasTransparency: boolean | null = null;
  if (mimeType.startsWith('image/')
    && mimeType !== 'image/svg+xml'
    && mimeType !== 'image/vnd.adobe.photoshop') {
    try {
      const metadata = await sharp(bytes).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      hasTransparency = metadata.hasAlpha ?? null;
      if (width === null || height === null) throw invalidAsset();
    } catch {
      throw invalidAsset();
    }
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width,
    height,
    hasTransparency,
  };
}

async function bestEffortRelease(client: SupabaseClient, reservationId: string): Promise<void> {
  try {
    await releaseProjectStorage(client, reservationId);
  } catch {
    // The reservation expiry path remains a second cleanup boundary.
  }
}

async function bestEffortRemove(client: SupabaseClient, storagePath: string): Promise<void> {
  try {
    await client.storage.from(PROJECT_ASSET_BUCKET).remove([storagePath]);
  } catch {
    // Project deletion and storage cleanup jobs remain a durable fallback.
  }
}

export async function registerProjectGameAssetBuffer(
  input: RegisterProjectGameAssetBufferInput,
): Promise<RegisteredProjectGameAsset> {
  if (!uuidSchema.safeParse(input.userId).success
    || !uuidSchema.safeParse(input.projectId).success
    || !categorySchema.safeParse(input.category).success
    || !fileNameSchema.safeParse(input.fileName).success
    || !Buffer.isBuffer(input.bytes)) {
    throw invalidAsset();
  }
  let file: ValidatedProjectGameAssetMetadata;
  try {
    file = validateProjectGameAssetMetadata({
      fileName: input.fileName,
      fileType: input.mimeType,
      fileSize: input.bytes.byteLength,
    });
  } catch {
    throw invalidAsset();
  }
  const mimeType = file.fileType;
  const { sha256, width, height, hasTransparency } = await inspectProjectGameAssetBytes(
    mimeType,
    input.bytes,
  );

  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${input.userId}/${input.projectId}/${randomUUID()}-${safeName}`;
  const expectedPrefix = `${input.userId}/${input.projectId}/`;
  if (!storagePath.startsWith(expectedPrefix)
    || storagePath.slice(expectedPrefix.length).includes('/')) {
    throw invalidAsset();
  }
  const reservation = await reserveProjectStorage(input.client, {
    projectId: input.projectId,
    bucketId: PROJECT_ASSET_BUCKET,
    objectPath: storagePath,
    expectedBytes: input.bytes.byteLength,
    displayName: input.fileName,
    mimeType,
    sourceKind: 'project_asset',
  });

  let uploaded = false;
  try {
    const bucket = input.client.storage.from(PROJECT_ASSET_BUCKET);
    const upload = await bucket.upload(storagePath, input.bytes, {
      contentType: mimeType,
      upsert: false,
    });
    if (upload.error) throw new Error('Project game asset upload failed');
    uploaded = true;

    const completion = await input.client.rpc('complete_project_game_asset_storage_upload_v2', {
      p_reservation_id: reservation.reservationId,
      p_project_id: input.projectId,
      p_name: input.fileName,
      p_category: input.category,
      p_mime_type: mimeType,
      p_storage_bucket: PROJECT_ASSET_BUCKET,
      p_storage_path: storagePath,
      p_sha256: sha256,
      p_width: width,
      p_height: height,
      p_has_transparency: hasTransparency,
      p_file_size: input.bytes.byteLength,
      p_object_created_at: null,
    });
    if (completion.error) throw new Error('Project game asset registration failed');
    const rawRow = Array.isArray(completion.data) ? completion.data[0] : completion.data;
    const parsed = completionSchema.safeParse(rawRow);
    if (!parsed.success
      || parsed.data.project_id !== input.projectId
      || parsed.data.category !== input.category
      || parsed.data.storage_path !== storagePath
      || parsed.data.sha256 !== sha256
      || parsed.data.width !== width
      || parsed.data.height !== height) {
      throw new Error('Invalid project game asset registration response');
    }

    return {
      assetId: parsed.data.id,
      storagePath,
      category: parsed.data.category,
      sha256,
      width,
      height,
    };
  } catch (error) {
    if (uploaded) await bestEffortRemove(input.client, storagePath);
    await bestEffortRelease(input.client, reservation.reservationId);
    throw error;
  }
}
