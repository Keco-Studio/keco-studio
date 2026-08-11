import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION = 2048;
const REFERENCE_LIST_LIMIT = 100;

export type MapReferenceRecord = {
  id: string;
  projectId: string;
  name: string;
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
  contentType: 'image/png';
  byteSize: number;
  previewUrl: string | null;
};

export type NormalizedMapReferenceImage = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

type MapReferenceImageRow = {
  id: string;
  project_id: string;
  name: string;
  storage_path: string;
  sha256: string;
  width: number;
  height: number;
  content_type: 'image/png';
  byte_size: number;
};

export class CreateMapReferenceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'CreateMapReferenceError';
  }
}

function referenceRecord(row: MapReferenceImageRow, previewUrl: string | null): MapReferenceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    storagePath: row.storage_path,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    contentType: row.content_type,
    byteSize: row.byte_size,
    previewUrl,
  };
}

function referenceName(file: File): string {
  const name = file.name.trim();
  if (!name || name.length > 160 || /[\u0000-\u001f\\/]/.test(name)) {
    throw new CreateMapReferenceError('invalid_reference_name', 400);
  }
  return name;
}

export async function normalizeReferenceImage(file: File): Promise<NormalizedMapReferenceImage> {
  if (!file.type.startsWith('image/') || file.size === 0 || file.size > MAX_REFERENCE_BYTES) {
    throw new CreateMapReferenceError('invalid_reference_file', 400);
  }

  try {
    const source = Buffer.from(await file.arrayBuffer());
    const bytes = await sharp(source, { limitInputPixels: MAX_REFERENCE_DIMENSION * MAX_REFERENCE_DIMENSION })
      .rotate()
      .png()
      .toBuffer();
    const metadata = await sharp(bytes).metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_REFERENCE_DIMENSION ||
      metadata.height > MAX_REFERENCE_DIMENSION ||
      bytes.byteLength > MAX_REFERENCE_BYTES
    ) {
      throw new CreateMapReferenceError('invalid_reference_dimensions', 400);
    }
    return {
      bytes,
      width: metadata.width,
      height: metadata.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (error instanceof CreateMapReferenceError) throw error;
    throw new CreateMapReferenceError('invalid_reference_file', 400);
  }
}

export async function uploadCreateMapReference(
  projectId: string,
  file: File,
  createdBy: string,
  normalized?: NormalizedMapReferenceImage
): Promise<MapReferenceRecord> {
  const image = normalized ?? await normalizeReferenceImage(file);
  const id = randomUUID();
  const name = referenceName(file);
  const storagePath = `references/${projectId}/${id}/${image.sha256}.png`;
  const row: MapReferenceImageRow & { created_by: string } = {
    id,
    project_id: projectId,
    name,
    storage_path: storagePath,
    sha256: image.sha256,
    width: image.width,
    height: image.height,
    content_type: 'image/png',
    byte_size: image.bytes.byteLength,
    created_by: createdBy,
  };
  const admin = getSupabaseServiceRoleClient();
  const { error: uploadError } = await admin.storage.from('map-assets').upload(storagePath, image.bytes, {
    contentType: 'image/png',
    upsert: false,
  });
  if (uploadError) {
    throw new CreateMapReferenceError('reference_upload_failed', 502);
  }

  const { error: insertError } = await admin.from('map_reference_images').insert(row);
  if (insertError) {
    await admin.storage.from('map-assets').remove([storagePath]).catch(() => undefined);
    throw new CreateMapReferenceError('reference_registry_failed', 502);
  }

  return referenceRecord(row, null);
}

export async function listCreateMapReferences(projectId: string): Promise<MapReferenceRecord[]> {
  const admin = getSupabaseServiceRoleClient();
  const { data, error } = await admin
    .from('map_reference_images')
    .select('id, project_id, name, storage_path, sha256, width, height, content_type, byte_size')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(REFERENCE_LIST_LIMIT);
  if (error) throw new CreateMapReferenceError('reference_list_failed', 502);

  return Promise.all((data as MapReferenceImageRow[] ?? []).map(async (row) => {
    const { data: signed, error: signedError } = await admin.storage
      .from('map-assets')
      .createSignedUrl(row.storage_path, 300);
    if (signedError || !signed?.signedUrl) {
      throw new CreateMapReferenceError('reference_preview_failed', 502);
    }
    return referenceRecord(row, signed.signedUrl);
  }));
}
