import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ConcurrentReservationBarrier,
  STORAGE_TEST_QUOTA_BYTES,
  persistCharacterAsset,
  persistMapAsset,
  reserveBrowserUpload,
  reserveMcpUpload,
  type StorageEntryPoint,
  type StorageEntryResult,
} from '../helpers/storage-quota-live';
import { mcpRpc, type McpRpcSession } from '../helpers/mcp-jsonrpc';
import {
  authorizeMcpInBrowser,
  deleteMcpClient,
  exchangeAuthorizationCode,
  registerMcpClient,
} from '../helpers/mcp-oauth';
import { loginWithCredentials } from '../utils/auth-helpers';
import {
  addProjectCollaborator,
  createProjectFixture,
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  removeProjectFixture,
} from '../utils/supabase-admin';

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!configuredSupabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
const supabaseUrl = new URL(configuredSupabaseUrl).origin;
const mcpEndpoint = `${supabaseUrl}/functions/v1/mcp`;
const appOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;
const redirectUri = `${appOrigin}/payment/success`;

type QuotaRow = {
  quota_bytes: number;
  used_bytes: number;
  reserved_bytes: number;
};

async function quotaRow(admin: SupabaseClient, ownerId: string): Promise<QuotaRow> {
  const { data, error } = await admin
    .from('account_storage_quotas')
    .select('quota_bytes, used_bytes, reserved_bytes')
    .eq('owner_id', ownerId)
    .single();
  if (error || !data) throw error ?? new Error('Storage quota row is missing');
  return data as QuotaRow;
}

async function cleanupEntry(admin: SupabaseClient, actorUserId: string, entry: StorageEntryResult): Promise<void> {
  if (!entry.reservationId) return;
  const { data: reservation } = await admin
    .from('storage_upload_reservations')
    .select('status, bucket_id, object_path')
    .eq('id', entry.reservationId)
    .maybeSingle();
  if (!reservation) return;
  if (reservation.status === 'pending') {
    await admin.rpc('service_release_project_storage_upload', {
      p_actor_user_id: actorUserId,
      p_reservation_id: entry.reservationId,
    });
    return;
  }
  if (reservation.status === 'finalized') {
    const bucketId = String(reservation.bucket_id);
    const objectPath = String(reservation.object_path);
    await admin.storage.from(bucketId).remove([objectPath]);
    await admin.rpc('service_settle_project_storage_file_deletion', {
      p_bucket_id: bucketId,
      p_object_path: objectPath,
    });
  }
}

test.describe('Cross-entry owner storage quota', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('serializes browser, MCP, map, and character reservations and releases failures', async ({ page }) => {
    const admin = getE2EAdminClient();
    const runId = crypto.randomUUID();
    const owner = await createTemporaryUser(admin, 'quota-owner-e2e');
    const editor = await createTemporaryUser(admin, 'quota-editor-e2e');
    const projectIds: string[] = [];
    const entries: StorageEntryResult[] = [];
    let clientId = '';
    let originalQuota: QuotaRow | null = null;

    try {
      for (let index = 0; index < 4; index += 1) {
        const projectId = await createProjectFixture(admin, owner.id);
        projectIds.push(projectId);
        await addProjectCollaborator(admin, projectId, editor.id, 'editor', owner.id);
      }
      const { data: existingQuota } = await admin
        .from('account_storage_quotas')
        .select('quota_bytes, used_bytes, reserved_bytes')
        .eq('owner_id', owner.id)
        .maybeSingle();
      originalQuota = existingQuota as QuotaRow | null;
      const { error: quotaError } = await admin.from('account_storage_quotas').upsert({
        owner_id: owner.id,
        quota_bytes: STORAGE_TEST_QUOTA_BYTES,
        used_bytes: 0,
        reserved_bytes: 0,
      });
      expect(quotaError).toBeNull();

      await page.goto(`${appOrigin}/`);
      await loginWithCredentials(page, editor.email, editor.password);
      await expect(page).toHaveURL(/\/projects(?:\?|$)/, { timeout: 30_000 });
      ({ clientId } = await registerMcpClient({
        supabaseUrl,
        redirectUri,
        clientName: `Keco quota Playwright ${runId}`,
      }));
      const authorization = await authorizeMcpInBrowser({
        page,
        supabaseUrl,
        clientId,
        redirectUri,
        resource: mcpEndpoint,
      });
      const accessToken = await exchangeAuthorizationCode({
        supabaseUrl,
        clientId,
        redirectUri,
        code: authorization.code,
        codeVerifier: authorization.codeVerifier,
      });
      const session: McpRpcSession = { endpoint: mcpEndpoint, accessToken, nextId: 1 };
      const initialized = await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'keco-quota-playwright', version: '1.0.0' },
      });
      expect(initialized.error).toBeUndefined();

      const barrier = new ConcurrentReservationBarrier(4);
      const operations: Record<StorageEntryPoint, () => Promise<StorageEntryResult>> = {
        browser: () => barrier.run((hold) => reserveBrowserUpload({
          page, projectId: projectIds[0], runId, hold,
        })),
        mcp: () => barrier.run((hold) => reserveMcpUpload({
          session, projectId: projectIds[1], runId, hold,
        })),
        map: () => barrier.run((hold) => persistMapAsset({
          admin, actorUserId: editor.id, projectId: projectIds[2], runId, hold,
        })),
        character: () => barrier.run((hold) => persistCharacterAsset({
          admin, actorUserId: editor.id, projectId: projectIds[3], hold,
        })),
      };
      const concurrent = await Promise.allSettled(Object.values(operations).map((operation) => operation()));
      expect(concurrent.every((result) => result.status === 'fulfilled')).toBe(true);
      const results = concurrent.map((result) => (result as PromiseFulfilledResult<StorageEntryResult>).value);
      entries.push(...results);
      expect(results.filter((result) => result.ok)).toHaveLength(3);
      const rejected = results.filter((result) => !result.ok);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].code).toBe('STORAGE_QUOTA_EXCEEDED');

      const during = await quotaRow(admin, owner.id);
      expect(during.used_bytes + during.reserved_bytes).toBeLessThanOrEqual(during.quota_bytes);

      for (const entry of results) await cleanupEntry(admin, editor.id, entry);
      await expect.poll(async () => {
        const row = await quotaRow(admin, owner.id);
        return row.used_bytes + row.reserved_bytes;
      }).toBe(0);

      const failedMap = await persistMapAsset({
        admin,
        actorUserId: editor.id,
        projectId: projectIds[2],
        runId: `${runId}-forced-failure`,
        failUpload: true,
      });
      entries.push(failedMap);
      expect(failedMap).toMatchObject({ entryPoint: 'map', ok: false });
      expect(failedMap.reservationId).toEqual(expect.any(String));
      await expect.poll(async () => {
        const { data } = await admin
          .from('storage_upload_reservations')
          .select('status')
          .eq('id', failedMap.reservationId!)
          .single();
        return data?.status;
      }).toBe('released');
      expect((await quotaRow(admin, owner.id)).reserved_bytes).toBe(0);

      const retry = await (() => {
        switch (rejected[0].entryPoint) {
          case 'browser': return reserveBrowserUpload({ page, projectId: projectIds[0], runId: `${runId}-retry` });
          case 'mcp': return reserveMcpUpload({ session, projectId: projectIds[1], runId: `${runId}-retry` });
          case 'map': return persistMapAsset({ admin, actorUserId: editor.id, projectId: projectIds[2], runId: `${runId}-retry` });
          case 'character': return persistCharacterAsset({ admin, actorUserId: editor.id, projectId: projectIds[3] });
        }
      })();
      entries.push(retry);
      expect(retry.ok).toBe(true);
      const afterRetry = await quotaRow(admin, owner.id);
      expect(afterRetry.used_bytes + afterRetry.reserved_bytes).toBeLessThanOrEqual(afterRetry.quota_bytes);
      await cleanupEntry(admin, editor.id, retry);
    } finally {
      for (const entry of entries) await cleanupEntry(admin, editor.id, entry).catch(() => undefined);
      for (const entry of entries) {
        if (!entry.bucketId || !entry.objectPath) continue;
        const { data } = await admin.storage.from(entry.bucketId).info(entry.objectPath);
        expect(data).toBeNull();
      }
      const { data: pending } = await admin
        .from('storage_upload_reservations')
        .select('id')
        .eq('owner_id', owner.id)
        .eq('status', 'pending');
      expect(pending ?? []).toHaveLength(0);
      if (originalQuota) {
        await admin.from('account_storage_quotas').update(originalQuota).eq('owner_id', owner.id);
      }
      if (clientId) await deleteMcpClient(admin, clientId).catch(() => undefined);
      for (const projectId of projectIds) await removeProjectFixture(admin, projectId).catch(() => undefined);
      await deleteTemporaryUser(admin, editor).catch(() => undefined);
      await deleteTemporaryUser(admin, owner).catch(() => undefined);
      const [{ count: quotaCount }, { count: reservationCount }, { count: projectCount }] = await Promise.all([
        admin.from('account_storage_quotas').select('owner_id', { count: 'exact', head: true }).eq('owner_id', owner.id),
        admin.from('storage_upload_reservations').select('id', { count: 'exact', head: true }).eq('owner_id', owner.id),
        admin.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', owner.id),
      ]);
      expect({ quotaCount, reservationCount, projectCount }).toEqual({
        quotaCount: 0,
        reservationCount: 0,
        projectCount: 0,
      });
    }
  });
});
