import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'node:path';

const ACCOUNTED_BUCKETS = ['library-media-files', 'project-assets', 'map-assets', 'character-assets', 'tiptap-images'] as const;
const HELP = `Usage:\n  npm run storage:reconcile -- [--apply]\n\nReport mode is the default. --apply expires abandoned reservations and repairs cached totals only.\n\nRequired environment variables:\n  NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY`;

export type RegisteredStorageFile = { id: string; bucketId: string; objectPath: string; ownerId: string; sizeBytes: number; lifecycleStatus: 'active' | 'pending_cleanup' };
export type StorageReservation = { id: string; ownerId: string; expectedBytes: number; status: string; expiresAt: string };
export type StorageQuota = { ownerId: string; usedBytes: number; reservedBytes: number };
export type ReconciliationReport = {
  registeredObjects: number;
  physicalObjects: number;
  missingObjects: number;
  unexpectedObjects: number;
  sizeMismatches: number;
  ambiguousObjects: number;
  expiredReservations: number;
  quotaMismatches: number;
  repairedReservations: number;
  repairedQuotas: number;
};
export type ReconciliationClient = {
  listPhysicalStorageObjects?: () => Promise<Array<{ bucketId: string; objectPath: string; sizeBytes: number }>>;
  listRegisteredStorageFiles?: () => Promise<RegisteredStorageFile[]>;
  listStorageReservations?: () => Promise<StorageReservation[]>;
  listStorageQuotas?: () => Promise<StorageQuota[]>;
  listAmbiguousStorageObjects?: () => Promise<Array<{ bucketId: string; objectPath: string }>>;
  expireReservations?: () => Promise<number>;
  rebuildStorageQuotaTotals?: () => Promise<number>;
  storage?: { from(bucketId: string): { list(prefix?: string, options?: { limit?: number; offset?: number }): Promise<{ data: unknown[] | null; error: unknown }> } };
  from?: (table: string) => { select(columns: string): Promise<{ data: unknown[] | null; error: unknown }> };
  rpc?: (name: string, parameters?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function key(bucketId: string, objectPath: string): string { return `${bucketId}\u0000${objectPath}`; }
async function rows(client: ReconciliationClient, table: string, columns: string): Promise<Record<string, unknown>[]> {
  if (!client.from) throw new Error(`Storage reconciliation query is unavailable for ${table}`);
  const result = await client.from(table).select(columns);
  if (result.error || !Array.isArray(result.data)) {
    throw new Error(`Storage reconciliation query failed for ${table}`);
  }
  return result.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}
async function physicalObjects(client: ReconciliationClient): Promise<Array<{ bucketId: string; objectPath: string; sizeBytes: number }>> {
  if (client.listPhysicalStorageObjects) return client.listPhysicalStorageObjects();
  if (!client.storage) throw new Error('Storage inventory is unavailable');
  const output: Array<{ bucketId: string; objectPath: string; sizeBytes: number }> = [];
  for (const bucketId of ACCOUNTED_BUCKETS) {
    const bucket = client.storage.from(bucketId);
    const visited = new Set<string>();
    const walk = async (prefix: string): Promise<void> => {
      if (visited.has(prefix)) return;
      visited.add(prefix);
      for (let offset = 0;; offset += 100) {
        const result = await bucket.list(prefix, { limit: 100, offset });
        if (result.error || !Array.isArray(result.data)) throw new Error('Storage inventory failed');
        for (const raw of result.data) {
          const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
          const name = typeof row.name === 'string' ? row.name : '';
          const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
          const sizeBytes = numberValue(row.size ?? metadata.size);
          if (name && sizeBytes !== null && sizeBytes > 0) output.push({ bucketId, objectPath: `${prefix}${name}`, sizeBytes });
          else if (name && !name.includes('..')) await walk(`${prefix}${name}/`);
        }
        if (result.data.length < 100) return;
      }
    };
    await walk('');
  }
  return output;
}
async function registeredFiles(client: ReconciliationClient): Promise<RegisteredStorageFile[]> {
  if (client.listRegisteredStorageFiles) return client.listRegisteredStorageFiles();
  return (await rows(client, 'project_storage_files', 'id,bucket_id,object_path,owner_id,size_bytes,lifecycle_status')).flatMap(row => {
    const sizeBytes = numberValue(row.size_bytes);
    return typeof row.id === 'string' && typeof row.bucket_id === 'string' && typeof row.object_path === 'string' && typeof row.owner_id === 'string' && sizeBytes !== null && (row.lifecycle_status === 'active' || row.lifecycle_status === 'pending_cleanup')
      ? [{ id: row.id, bucketId: row.bucket_id, objectPath: row.object_path, ownerId: row.owner_id, sizeBytes, lifecycleStatus: row.lifecycle_status }]
      : [];
  });
}
async function reservations(client: ReconciliationClient): Promise<StorageReservation[]> {
  if (client.listStorageReservations) return client.listStorageReservations();
  return (await rows(client, 'storage_upload_reservations', 'id,owner_id,expected_bytes,status,expires_at')).flatMap(row => {
    const expectedBytes = numberValue(row.expected_bytes);
    return typeof row.id === 'string' && typeof row.owner_id === 'string' && typeof row.status === 'string' && typeof row.expires_at === 'string' && expectedBytes !== null
      ? [{ id: row.id, ownerId: row.owner_id, expectedBytes, status: row.status, expiresAt: row.expires_at }]
      : [];
  });
}
async function quotas(client: ReconciliationClient): Promise<StorageQuota[]> {
  if (client.listStorageQuotas) return client.listStorageQuotas();
  return (await rows(client, 'account_storage_quotas', 'owner_id,used_bytes,reserved_bytes')).flatMap(row => {
    const usedBytes = numberValue(row.used_bytes); const reservedBytes = numberValue(row.reserved_bytes);
    return typeof row.owner_id === 'string' && usedBytes !== null && reservedBytes !== null ? [{ ownerId: row.owner_id, usedBytes, reservedBytes }] : [];
  });
}
async function applyExpiredReservations(client: ReconciliationClient): Promise<number> {
  if (client.expireReservations) return client.expireReservations();
  if (!client.rpc) throw new Error('Storage reconciliation RPC is unavailable');
  const result = await client.rpc('reconcile_expired_project_storage_reservations');
  if (result.error || !Number.isSafeInteger(result.data)) throw new Error('Storage reconciliation RPC failed');
  return Number(result.data);
}
async function applyQuotaRebuild(client: ReconciliationClient): Promise<number> {
  if (client.rebuildStorageQuotaTotals) return client.rebuildStorageQuotaTotals();
  if (!client.rpc) throw new Error('Storage quota repair RPC is unavailable');
  const result = await client.rpc('service_rebuild_account_storage_quota_totals');
  const data = result.data && typeof result.data === 'object'
    ? result.data as Record<string, unknown>
    : null;
  if (result.error || !data || !Number.isSafeInteger(data.rebuiltAccounts)) {
    throw new Error('Storage quota repair RPC failed');
  }
  return Number(data.rebuiltAccounts);
}

export async function reconcileAccountStorage(client: ReconciliationClient, { applySafeRepairs }: { applySafeRepairs: boolean }): Promise<ReconciliationReport> {
  const [physical, registered, pendingReservations, cachedQuotas, ambiguous] = await Promise.all([
    physicalObjects(client), registeredFiles(client), reservations(client), quotas(client), client.listAmbiguousStorageObjects ? client.listAmbiguousStorageObjects() : Promise.resolve([]),
  ]);
  const physicalByKey = new Map(physical.map(item => [key(item.bucketId, item.objectPath), item]));
  const registeredByKey = new Map(registered.map(item => [key(item.bucketId, item.objectPath), item]));
  let missingObjects = 0; let sizeMismatches = 0;
  for (const file of registered) {
    const object = physicalByKey.get(key(file.bucketId, file.objectPath));
    if (!object) missingObjects += 1;
    else if (object.sizeBytes !== file.sizeBytes) sizeMismatches += 1;
  }
  let unexpectedObjects = 0;
  for (const object of physical) if (!registeredByKey.has(key(object.bucketId, object.objectPath))) unexpectedObjects += 1;
  const now = Date.now();
  const activePending = pendingReservations.filter(reservation => reservation.status === 'pending');
  const expiredReservations = activePending.filter(reservation => Number.isFinite(Date.parse(reservation.expiresAt)) && Date.parse(reservation.expiresAt) <= now);
  const expected = new Map<string, { usedBytes: number; reservedBytes: number }>();
  for (const file of registered) {
    const value = expected.get(file.ownerId) ?? { usedBytes: 0, reservedBytes: 0 };
    value.usedBytes += file.sizeBytes; expected.set(file.ownerId, value);
  }
  for (const reservation of activePending.filter(reservation => !expiredReservations.includes(reservation))) {
    const value = expected.get(reservation.ownerId) ?? { usedBytes: 0, reservedBytes: 0 };
    value.reservedBytes += reservation.expectedBytes; expected.set(reservation.ownerId, value);
  }
  const cached = new Map(cachedQuotas.map(quota => [quota.ownerId, quota]));
  const owners = new Set([...expected.keys(), ...cached.keys()]);
  const quotaMismatches = [...owners].filter(ownerId => {
    const actual = cached.get(ownerId); const wanted = expected.get(ownerId) ?? { usedBytes: 0, reservedBytes: 0 };
    return !actual || actual.usedBytes !== wanted.usedBytes || actual.reservedBytes !== wanted.reservedBytes;
  }).length;
  let repairedReservations = 0; let repairedQuotas = 0;
  const parityFailure = missingObjects > 0 || unexpectedObjects > 0 || sizeMismatches > 0 || ambiguous.length > 0;
  if (applySafeRepairs && parityFailure) {
    throw new Error('Storage reconciliation aborted: inventory parity must be clean before repairs');
  }
  if (applySafeRepairs) {
    if (expiredReservations.length > 0) repairedReservations = await applyExpiredReservations(client);
    if (quotaMismatches > 0) repairedQuotas = await applyQuotaRebuild(client);
  }
  return { registeredObjects: registered.length, physicalObjects: physical.length, missingObjects, unexpectedObjects, sizeMismatches, ambiguousObjects: ambiguous.length, expiredReservations: expiredReservations.length, quotaMismatches, repairedReservations, repairedQuotas };
}

export function parseReconciliationArguments(arguments_: readonly string[]): { help: boolean; applySafeRepairs: boolean } {
  if (arguments_.includes('--help')) return { help: true, applySafeRepairs: false };
  if (arguments_.length === 0) return { help: false, applySafeRepairs: false };
  if (arguments_.length === 1 && arguments_[0] === '--apply') return { help: false, applySafeRepairs: true };
  throw new Error(HELP);
}
function requiredEnvironment(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
export async function runReconcileAccountStorageCommand(arguments_: readonly string[]): Promise<void> {
  const parsed = parseReconciliationArguments(arguments_);
  if (parsed.help) { console.info(HELP); return; }
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false, quiet: true });
  const client = createClient(requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'), requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as ReconciliationClient;
  const report = await reconcileAccountStorage(client, parsed);
  console.info(`Storage reconciliation: mode=${parsed.applySafeRepairs ? 'apply' : 'report'} registered=${report.registeredObjects} physical=${report.physicalObjects} missing=${report.missingObjects} unexpected=${report.unexpectedObjects} size_mismatches=${report.sizeMismatches} ambiguous=${report.ambiguousObjects} expired=${report.expiredReservations} quota_mismatches=${report.quotaMismatches} repaired_reservations=${report.repairedReservations} repaired_quotas=${report.repairedQuotas}`);
}
if (path.basename(process.argv[1] ?? '') === 'reconcile-account-storage.ts') {
  runReconcileAccountStorageCommand(process.argv.slice(2)).catch(() => { console.error('Storage reconciliation failed'); process.exitCode = 1; });
}
