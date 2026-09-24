import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { mcpRpc, type McpRpcSession } from './mcp-jsonrpc';
import {
  persistValidatedAsset,
  type AssetStorageContext,
} from '../../../supabase/functions/pixellab-map/storage';
import type { ValidatedPng as MapValidatedPng } from '../../../supabase/functions/pixellab-map/png';
import { PixelLabMapError } from '../../../supabase/functions/pixellab-map/types';
import {
  finalizePersistedCharacterAsset,
  persistValidatedCharacterAsset,
} from '../../../supabase/functions/pixellab-character/storage';
import type { AuthorizedCharacterAttempt } from '../../../supabase/functions/pixellab-character/types';
import { StorageQuotaError } from '../../../supabase/functions/_shared/storage-quota';

export const STORAGE_REQUEST_BYTES = {
  browser: 20 * 1024 * 1024,
  mcp: 20 * 1024 * 1024,
  map: 10 * 1024 * 1024,
  character: 20 * 1024 * 1024,
} as const;
export const STORAGE_TEST_QUOTA_BYTES = 50 * 1024 * 1024;

export type StorageEntryPoint = keyof typeof STORAGE_REQUEST_BYTES;
export type StorageEntryResult = {
  entryPoint: StorageEntryPoint;
  ok: boolean;
  reservationId?: string;
  bucketId?: string;
  objectPath?: string;
  code?: string;
};

type HoldReservation = () => Promise<void>;

export class ConcurrentReservationBarrier {
  private arrivals = 0;
  private release!: () => void;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(private readonly participants: number) {}

  async run<T>(operation: (hold: HoldReservation) => Promise<T>): Promise<T> {
    let held = false;
    const hold = async () => {
      if (held) return this.released;
      held = true;
      this.arrivals += 1;
      if (this.arrivals === this.participants) this.release();
      return this.released;
    };
    try {
      return await operation(hold);
    } finally {
      await hold();
    }
  }
}

function quotaCode(error: unknown): string {
  if (error instanceof StorageQuotaError && error.code === 'STORAGE_QUOTA_EXCEEDED') {
    return error.code;
  }
  if (error instanceof PixelLabMapError && error.code === 'pixellab_quota_exceeded') {
    return 'STORAGE_QUOTA_EXCEEDED';
  }
  return error instanceof Error ? error.message : 'UNKNOWN_STORAGE_ERROR';
}

async function pngFixture(): Promise<Uint8Array> {
  const bytes = await sharp(Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 0, 255, 255, 0, 255,
  ]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  return new Uint8Array(bytes);
}

function storageClient(
  base: SupabaseClient,
  input: {
    beforeUpload?: HoldReservation;
    failUpload?: boolean;
    onReservation?: (reservationId: string) => void;
    mapTransitions?: boolean;
  },
): SupabaseClient {
  return {
    storage: {
      from(bucketId: string) {
        const bucket = base.storage.from(bucketId);
        return {
          async upload(...args: Parameters<typeof bucket.upload>) {
            await input.beforeUpload?.();
            if (input.failUpload) return { data: null, error: { message: 'forced upload failure' } };
            return bucket.upload(...args);
          },
          download: bucket.download.bind(bucket),
          remove: bucket.remove.bind(bucket),
        };
      },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (input.mapTransitions && name === 'transition_map_asset') {
        return { data: [{ status: args.p_next_status }], error: null };
      }
      const result = await base.rpc(name, args);
      if (
        (name === 'service_reserve_project_storage_upload'
          || name === 'service_reserve_project_storage_upload_v2')
        && result.data
        && typeof result.data === 'object'
        && !Array.isArray(result.data)
        && typeof (result.data as Record<string, unknown>).reservationId === 'string'
      ) {
        input.onReservation?.(String((result.data as Record<string, unknown>).reservationId));
      }
      return result;
    },
  } as unknown as SupabaseClient;
}

export async function reserveBrowserUpload(input: {
  page: Page;
  projectId: string;
  runId: string;
  hold?: HoldReservation;
}): Promise<StorageEntryResult> {
  const result = await input.page.evaluate(async ({ projectId, runId, fileSize }) => {
    const response = await fetch(`/api/projects/${projectId}/game-assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'prepare',
        files: [{ fileName: `browser-${runId}.pdf`, fileType: 'application/pdf', fileSize }],
      }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }, { projectId: input.projectId, runId: input.runId, fileSize: STORAGE_REQUEST_BYTES.browser });
  await input.hold?.();
  if (result.status === 409) {
    return { entryPoint: 'browser', ok: false, code: 'STORAGE_QUOTA_EXCEEDED' };
  }
  const item = Array.isArray(result.body.items) ? result.body.items[0] as Record<string, unknown> : null;
  if (result.status !== 201 || !item || item.ok !== true) {
    return { entryPoint: 'browser', ok: false, code: `HTTP_${result.status}` };
  }
  return {
    entryPoint: 'browser',
    ok: true,
    reservationId: String(item.reservationId),
    bucketId: 'project-assets',
    objectPath: String(item.path),
  };
}

export async function reserveMcpUpload(input: {
  session: McpRpcSession;
  projectId: string;
  runId: string;
  hold?: HoldReservation;
}): Promise<StorageEntryResult> {
  const response = await mcpRpc(input.session, 'tools/call', {
    name: 'prepare_project_asset_uploads',
    arguments: {
      projectId: input.projectId,
      assetUploadAutoExecute: true,
      files: [{ fileName: `mcp-${input.runId}.pdf`, fileType: 'application/pdf', fileSize: STORAGE_REQUEST_BYTES.mcp }],
    },
  });
  await input.hold?.();
  const content = (response.result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent;
  const item = Array.isArray(content?.items) ? content.items[0] as Record<string, unknown> : null;
  if (!item || item.ok !== true) {
    const error = item?.error as Record<string, unknown> | undefined;
    return {
      entryPoint: 'mcp',
      ok: false,
      code: error?.code === 'PAYLOAD_TOO_LARGE' ? 'STORAGE_QUOTA_EXCEEDED' : String(error?.code ?? 'MCP_UPLOAD_FAILED'),
    };
  }
  const image = item.image as Record<string, unknown>;
  return {
    entryPoint: 'mcp',
    ok: true,
    reservationId: String(image.reservationId),
    bucketId: 'project-assets',
    objectPath: String(image.path),
  };
}

export async function persistMapAsset(input: {
  admin: SupabaseClient;
  actorUserId: string;
  projectId: string;
  runId: string;
  hold?: HoldReservation;
  failUpload?: boolean;
}): Promise<StorageEntryResult> {
  const bytes = await pngFixture();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const mapId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const assetKey = `quota-${input.runId}`;
  const objectPath = `${input.projectId}/${mapId}/${revisionId}/${assetKey}/${sha256}.png`;
  let reservationId: string | undefined;
  const client = storageClient(input.admin, {
    beforeUpload: input.hold,
    failUpload: input.failUpload,
    mapTransitions: true,
    onReservation: (id) => { reservationId = id; },
  });
  const context: AssetStorageContext = {
    serviceClient: client,
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    mapId,
    revisionId,
  };
  const png: MapValidatedPng = {
    bytes,
    width: 2,
    height: 2,
    hasTransparency: true,
    sha256,
    alphaBounds: { x: 0, y: 0, width: 2, height: 2 },
    opaquePixelCount: 3,
    visiblePixelCount: 3,
    opaqueFillRatio: 0.75,
  };
  try {
    const result = await persistValidatedAsset(context, { id: assetId, assetKey }, png);
    return {
      entryPoint: 'map', ok: true, reservationId,
      bucketId: 'map-assets', objectPath: result.storagePath,
    };
  } catch (error) {
    return {
      entryPoint: 'map', ok: false, reservationId,
      bucketId: 'map-assets', objectPath, code: quotaCode(error),
    };
  }
}

export async function persistCharacterAsset(input: {
  admin: SupabaseClient;
  actorUserId: string;
  projectId: string;
  hold?: HoldReservation;
}): Promise<StorageEntryResult> {
  const bytes = await pngFixture();
  const state = {
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    assetId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    planFingerprint: 'a'.repeat(64),
    attemptCount: 1,
    status: 'generating',
    lastErrorCode: null,
    providerJobId: null,
    metadata: {},
    plan: {
      schemaVersion: 1,
      kind: 'character',
      name: 'Storage quota fixture',
      description: 'A transparent two-color fixture.',
      perspective: 'topdown',
      facing: 'front',
      width: 2,
      height: 2,
      transparent: true,
    },
    sourceProviderCharacterId: null,
  } satisfies AuthorizedCharacterAttempt;
  const client = storageClient(input.admin, { beforeUpload: input.hold });
  let reservationId: string | undefined;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectPath = `${state.projectId}/${state.assetId}/${state.generationId}/${sha256}.png`;
  try {
    const persisted = await persistValidatedCharacterAsset(
      client,
      state,
      bytes,
      { width: 2, height: 2, alphaRequired: true },
    );
    reservationId = persisted.reservationId;
    await finalizePersistedCharacterAsset(client, state, persisted);
    return { entryPoint: 'character', ok: true, reservationId, bucketId: 'character-assets', objectPath };
  } catch (error) {
    return {
      entryPoint: 'character', ok: false, reservationId,
      bucketId: 'character-assets', objectPath, code: quotaCode(error),
    };
  }
}
