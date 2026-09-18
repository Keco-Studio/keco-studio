import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'node:path';

const ACCOUNTED_BUCKETS = [
  'library-media-files',
  'project-assets',
  'map-assets',
  'character-assets',
  'tiptap-images',
] as const;
const PAGE_SIZE = 100;

export type AccountedStorageBucket = typeof ACCOUNTED_BUCKETS[number];
export type StorageObject = {
  bucketId: AccountedStorageBucket;
  objectPath: string;
  sizeBytes: number;
  createdAt?: string | null;
  mimeType?: string | null;
  uploaderId?: string | null;
};
export type StorageAttribution = {
  projectId: string | null;
  ownerId: string;
  sourceKind?: string;
  sourceEntityId?: string | null;
  displayName?: string;
  mimeType?: string;
};
export type BackfillReport = {
  scannedObjects: number;
  attributableObjects: number;
  unassignedObjects: number;
  conflicts: number;
  insertedFiles: number;
  physicalBytes: number;
};

export type BackfillClient = {
  listAccountedStorageObjects?: (bucketId: AccountedStorageBucket, page: { offset: number; limit: number }) => Promise<StorageObject[]>;
  findStorageAttributions?: (object: StorageObject) => Promise<StorageAttribution[]>;
  importStorageFile?: (input: StorageObject & StorageAttribution) => Promise<{ inserted: boolean }>;
  rebuildAccountStorageTotals?: () => Promise<void>;
  storage?: { from(bucketId: string): { list(prefix?: string, options?: { limit?: number; offset?: number }): Promise<{ data: unknown[] | null; error: unknown }> } };
  from?: (table: string) => { select(columns: string): Promise<{ data: unknown[] | null; error: unknown }> };
  rpc?: (name: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const HELP = `Usage:\n  npm run storage:backfill -- [--apply]\n\nReport mode is the default. --apply imports attributable objects through the service-only RPC.\n\nRequired environment variables:\n  NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY`;

function safeSize(value: unknown): number | null {
  const size = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

function objectName(objectPath: string): string {
  return objectPath.split('/').filter(Boolean).at(-1) ?? objectPath;
}

function isBucket(value: string): value is AccountedStorageBucket {
  return (ACCOUNTED_BUCKETS as readonly string[]).includes(value);
}

function pathProjectId(bucketId: AccountedStorageBucket, objectPath: string, projects: Map<string, string>): string | null {
  const segments = objectPath.split('/').filter(Boolean);
  const candidate = bucketId === 'map-assets' && segments[0] === 'references'
    ? segments[1]
    : bucketId === 'library-media-files' || bucketId === 'project-assets' || bucketId === 'tiptap-images'
      ? segments[1]
      : bucketId === 'map-assets' || bucketId === 'character-assets'
        ? segments[0]
        : null;
  return candidate && projects.has(candidate) ? candidate : null;
}

async function selectRows(client: BackfillClient, table: string, columns: string): Promise<Record<string, unknown>[]> {
  if (!client.from) throw new Error(`Storage attribution query is unavailable for ${table}`);
  const result = await client.from(table).select(columns);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(`Storage attribution query failed for ${table}`);
  }
  return result.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

async function knownProjects(client: BackfillClient): Promise<Map<string, string>> {
  const rows = await selectRows(client, 'projects', 'id,owner_id');
  const projects = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.id === 'string' && typeof row.owner_id === 'string') projects.set(row.id, row.owner_id);
  }
  return projects;
}

async function nativeAttributions(client: BackfillClient, projects: Map<string, string>): Promise<Map<string, StorageAttribution[]>> {
  const [registered, assets, references] = await Promise.all([
    selectRows(client, 'project_storage_files', 'bucket_id,object_path,project_id,owner_id,source_kind,source_entity_id,display_name,mime_type'),
    selectRows(client, 'project_game_assets', 'id,project_id,created_by,name,mime_type,storage_bucket,storage_path'),
    selectRows(client, 'map_reference_images', 'id,project_id,created_by,name,content_type,storage_path'),
  ]);
  const byObject = new Map<string, StorageAttribution[]>();
  const add = (bucketId: string, objectPath: unknown, value: StorageAttribution) => {
    if (typeof objectPath !== 'string' || !objectPath || !value.ownerId) return;
    const key = `${bucketId}\u0000${objectPath}`;
    byObject.set(key, [...(byObject.get(key) ?? []), value]);
  };
  for (const row of registered) {
    if (typeof row.bucket_id !== 'string' || typeof row.owner_id !== 'string') continue;
    add(row.bucket_id, row.object_path, {
      projectId: typeof row.project_id === 'string' ? row.project_id : null,
      ownerId: row.owner_id,
      sourceKind: typeof row.source_kind === 'string' ? row.source_kind : undefined,
      sourceEntityId: typeof row.source_entity_id === 'string' ? row.source_entity_id : null,
      displayName: typeof row.display_name === 'string' ? row.display_name : undefined,
      mimeType: typeof row.mime_type === 'string' ? row.mime_type : undefined,
    });
  }
  for (const row of assets) {
    if (typeof row.project_id !== 'string') continue;
    const ownerId = projects.get(row.project_id) ?? (typeof row.created_by === 'string' ? row.created_by : '');
    add(typeof row.storage_bucket === 'string' ? row.storage_bucket : 'project-assets', row.storage_path, {
      projectId: row.project_id, ownerId, sourceKind: 'project_asset', sourceEntityId: typeof row.id === 'string' ? row.id : null,
      displayName: typeof row.name === 'string' ? row.name : undefined, mimeType: typeof row.mime_type === 'string' ? row.mime_type : undefined,
    });
  }
  for (const row of references) {
    if (typeof row.project_id !== 'string') continue;
    const ownerId = projects.get(row.project_id) ?? (typeof row.created_by === 'string' ? row.created_by : '');
    add('map-assets', row.storage_path, {
      projectId: row.project_id, ownerId, sourceKind: 'map_reference', sourceEntityId: typeof row.id === 'string' ? row.id : null,
      displayName: typeof row.name === 'string' ? row.name : undefined, mimeType: typeof row.content_type === 'string' ? row.content_type : undefined,
    });
  }
  return byObject;
}

async function listNativeObjects(client: BackfillClient, bucketId: AccountedStorageBucket): Promise<StorageObject[]> {
  if (!client.storage) throw new Error('Storage inventory is unavailable');
  const bucket = client.storage.from(bucketId);
  const objects: StorageObject[] = [];
  const visited = new Set<string>();
  async function walk(prefix: string): Promise<void> {
    if (visited.has(prefix)) return;
    visited.add(prefix);
    for (let offset = 0;; offset += PAGE_SIZE) {
      const result = await bucket.list(prefix, { limit: PAGE_SIZE, offset });
      if (result.error || !Array.isArray(result.data)) throw new Error('Storage inventory failed');
      for (const raw of result.data) {
        const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const name = typeof row.name === 'string' ? row.name : '';
        if (!name || name.includes('..')) continue;
        const objectPath = `${prefix}${name}`;
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
        const sizeBytes = safeSize(row.size ?? metadata.size);
        if (sizeBytes !== null) {
          objects.push({
            bucketId,
            objectPath,
            sizeBytes,
            createdAt: typeof row.created_at === 'string' ? row.created_at : null,
            mimeType: typeof metadata.mimetype === 'string' ? metadata.mimetype : null,
            uploaderId: typeof row.owner === 'string' ? row.owner : null,
          });
        } else if (!name.includes('/')) {
          await walk(`${objectPath}/`);
        }
      }
      if (result.data.length < PAGE_SIZE) return;
    }
  }
  await walk('');
  return objects;
}

async function listObjects(client: BackfillClient, bucketId: AccountedStorageBucket): Promise<StorageObject[]> {
  if (!client.listAccountedStorageObjects) return listNativeObjects(client, bucketId);
  const objects: StorageObject[] = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const page = await client.listAccountedStorageObjects(bucketId, { offset, limit: PAGE_SIZE });
    objects.push(...page);
    if (page.length < PAGE_SIZE) return objects;
  }
}

function sourceFromObject(object: StorageObject, projectId: string | null): StorageAttribution {
  return {
    projectId,
    ownerId: object.uploaderId ?? '',
    sourceKind: projectId
      ? object.bucketId === 'library-media-files' ? 'library_media'
        : object.bucketId === 'tiptap-images' ? 'document_image'
          : object.bucketId === 'map-assets' ? (object.objectPath.startsWith('references/') ? 'map_reference' : 'map_asset')
            : object.bucketId === 'character-assets' ? 'character_asset'
              : 'project_asset'
      : 'legacy_unassigned',
    sourceEntityId: null,
    displayName: objectName(object.objectPath),
    mimeType: object.mimeType ?? 'application/octet-stream',
  };
}

function resolveAttribution(
  object: StorageObject,
  candidates: StorageAttribution[],
  projects: Map<string, string>,
): { status: 'attributable' | 'unassigned' | 'conflict'; attribution?: StorageAttribution } {
  const byPath = pathProjectId(object.bucketId, object.objectPath, projects);
  if (byPath) return { status: 'attributable', attribution: { ...sourceFromObject(object, byPath), ownerId: projects.get(byPath)! } };

  const valid = candidates.filter(candidate => typeof candidate.ownerId === 'string' && candidate.ownerId.length > 0);
  const projectsById = new Map<string, StorageAttribution>();
  for (const candidate of valid) if (candidate.projectId) projectsById.set(candidate.projectId, candidate);
  if (projectsById.size === 1) return { status: 'attributable', attribution: [...projectsById.values()][0] };
  if (projectsById.size > 1) {
    const owners = new Set([...projectsById.values()].map(candidate => candidate.ownerId));
    if (owners.size === 1) {
      const canonical = [...projectsById.values()].sort((left, right) => String(left.projectId).localeCompare(String(right.projectId)))[0];
      return { status: 'attributable', attribution: canonical };
    }
    return { status: 'conflict' };
  }
  if (object.uploaderId) return { status: 'unassigned', attribution: sourceFromObject(object, null) };
  return { status: 'conflict' };
}

async function importFile(client: BackfillClient, input: StorageObject & StorageAttribution): Promise<boolean> {
  if (client.importStorageFile) return (await client.importStorageFile(input)).inserted;
  if (!client.rpc) throw new Error('Storage import RPC is unavailable');
  const result = await client.rpc('service_import_project_storage_file', {
    p_bucket_id: input.bucketId,
    p_object_path: input.objectPath,
    p_project_id: input.projectId,
    p_owner_id: input.ownerId,
    p_display_name: input.displayName ?? objectName(input.objectPath),
    p_mime_type: input.mimeType ?? 'application/octet-stream',
    p_size_bytes: input.sizeBytes,
    p_source_kind: input.sourceKind ?? (input.projectId ? 'project_asset' : 'legacy_unassigned'),
    p_source_entity_id: input.sourceEntityId ?? null,
    p_object_created_at: input.createdAt ?? null,
  });
  if (result.error) throw new Error('Storage import RPC failed');
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
  return data.inserted === true;
}

async function rebuildAccountStorageTotals(client: BackfillClient): Promise<void> {
  if (client.rebuildAccountStorageTotals) {
    await client.rebuildAccountStorageTotals();
    return;
  }
  if (!client.rpc) throw new Error('Storage quota rebuild RPC is unavailable');
  const result = await client.rpc('service_rebuild_account_storage_quota_totals');
  const data = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : null;
  if (result.error || !data || !Number.isSafeInteger(data.rebuiltAccounts)) {
    throw new Error('Storage quota rebuild RPC failed');
  }
}

export async function backfillAccountStorage(client: BackfillClient, { apply }: { apply: boolean }): Promise<BackfillReport> {
  const projects = await knownProjects(client);
  const nativeReferences = client.findStorageAttributions ? null : await nativeAttributions(client, projects);
  const report: BackfillReport = { scannedObjects: 0, attributableObjects: 0, unassignedObjects: 0, conflicts: 0, insertedFiles: 0, physicalBytes: 0 };
  const plannedImports: Array<StorageObject & StorageAttribution> = [];
  for (const bucketId of ACCOUNTED_BUCKETS) {
    for (const object of await listObjects(client, bucketId)) {
      if (!isBucket(object.bucketId) || !object.objectPath || safeSize(object.sizeBytes) === null) {
        report.scannedObjects += 1;
        report.conflicts += 1;
        continue;
      }
      report.scannedObjects += 1;
      const candidates = client.findStorageAttributions
        ? await client.findStorageAttributions(object)
        : nativeReferences?.get(`${object.bucketId}\u0000${object.objectPath}`) ?? [];
      const resolution = resolveAttribution(object, candidates, projects);
      if (resolution.status === 'conflict' || !resolution.attribution) {
        report.conflicts += 1;
        continue;
      }
      if (resolution.status === 'unassigned') report.unassignedObjects += 1;
      else report.attributableObjects += 1;
      report.physicalBytes += object.sizeBytes;
      plannedImports.push({ ...object, ...resolution.attribution });
    }
  }
  if (apply && report.conflicts > 0) {
    throw new Error(`Storage backfill aborted: ${report.conflicts} ambiguous object(s) require attribution`);
  }
  if (apply) {
    for (const input of plannedImports) report.insertedFiles += (await importFile(client, input)) ? 1 : 0;
    await rebuildAccountStorageTotals(client);
  }
  return report;
}

export function parseBackfillArguments(arguments_: readonly string[]): { help: boolean; apply: boolean } {
  if (arguments_.includes('--help')) return { help: true, apply: false };
  if (arguments_.length === 0) return { help: false, apply: false };
  if (arguments_.length === 1 && arguments_[0] === '--apply') return { help: false, apply: true };
  throw new Error(HELP);
}

function requiredEnvironment(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function runBackfillAccountStorageCommand(arguments_: readonly string[]): Promise<void> {
  const parsed = parseBackfillArguments(arguments_);
  if (parsed.help) { console.info(HELP); return; }
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false, quiet: true });
  const url = requiredEnvironment(process.env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requiredEnvironment(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as BackfillClient;
  const report = await backfillAccountStorage(client, { apply: parsed.apply });
  console.info(`Storage backfill: mode=${parsed.apply ? 'apply' : 'report'} scanned=${report.scannedObjects} attributable=${report.attributableObjects} unassigned=${report.unassignedObjects} conflicts=${report.conflicts} inserted=${report.insertedFiles} physical_bytes=${report.physicalBytes}`);
}

if (path.basename(process.argv[1] ?? '') === 'backfill-account-storage.ts') {
  runBackfillAccountStorageCommand(process.argv.slice(2)).catch(() => {
    console.error('Storage backfill failed');
    process.exitCode = 1;
  });
}
