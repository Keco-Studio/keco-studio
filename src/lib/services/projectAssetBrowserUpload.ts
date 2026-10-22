import { projectAssetMimeFromName } from '../../../shared/project-asset-upload-contract';
import type { GameAssetCategory } from './gameAssetsService';

type AssetMetadata = {
  fileName: string;
  fileType: string;
  fileSize: number;
};

type PreparedAsset = {
  index: number;
  ok: boolean;
  file?: AssetMetadata;
  path?: string;
  reservationId?: string;
  upload?: { url: string; method: 'PUT'; headers: Record<string, string> };
};

type UploadResponse = {
  error?: string;
  failedCount?: number;
  completedCount?: number;
  items?: PreparedAsset[];
};

export async function uploadProjectAssets({
  projectId,
  category = 'media',
  files,
  fetcher = fetch,
}: {
  projectId: string;
  category?: GameAssetCategory;
  files: File[];
  fetcher?: typeof fetch;
}): Promise<{ completedCount: number; failedCount: number }> {
  const metadata: AssetMetadata[] = files.map((file) => ({
    fileName: file.name,
    fileType: file.type || projectAssetMimeFromName(file.name) || 'application/octet-stream',
    fileSize: file.size,
  }));
  const endpoint = `/api/projects/${projectId}/game-assets`;
  const prepareResponse = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'prepare', category, files: metadata }),
  });
  const prepared = await prepareResponse.json() as UploadResponse;
  if (!prepareResponse.ok || !prepared.items) {
    throw new Error(prepared.error ?? 'Upload preparation failed');
  }

  let failedCount = prepared.failedCount ?? 0;
  const completionItems: Array<AssetMetadata & { path: string; reservationId: string }> = [];
  for (const item of prepared.items) {
    if (!item.ok || !item.path || !item.reservationId || !item.file || !item.upload) continue;
    try {
      await fetcher(item.upload.url, {
        method: item.upload.method,
        headers: item.upload.headers,
        body: files[item.index],
      });
    } catch {
      // Completion verifies failed PUTs and releases their reservations.
    }
    completionItems.push({ ...item.file, path: item.path, reservationId: item.reservationId });
  }

  if (completionItems.length === 0) return { completedCount: 0, failedCount };

  const completeResponse = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'complete', category, items: completionItems }),
  });
  const completed = await completeResponse.json() as UploadResponse;
  if (!completeResponse.ok) {
    throw new Error(completed.error ?? 'Upload completion failed');
  }
  failedCount += completed.failedCount ?? 0;
  return { completedCount: completed.completedCount ?? 0, failedCount };
}
