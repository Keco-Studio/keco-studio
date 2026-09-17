import { reconcileAccountStorage, parseReconciliationArguments } from '../../../scripts/reconcile-account-storage';

function clientFixture() {
  const calls = { expire: 0, rebuild: 0 };
  return {
    calls,
    async listPhysicalStorageObjects() {
      return [
        { bucketId: 'project-assets', objectPath: 'present.png', sizeBytes: 100 },
        { bucketId: 'project-assets', objectPath: 'size-mismatch.png', sizeBytes: 30 },
        { bucketId: 'map-assets', objectPath: 'unexpected.png', sizeBytes: 40 },
      ];
    },
    async listRegisteredStorageFiles() {
      return [
        { id: 'one', bucketId: 'project-assets', objectPath: 'present.png', ownerId: 'owner-a', sizeBytes: 100, lifecycleStatus: 'active' as const },
        { id: 'two', bucketId: 'project-assets', objectPath: 'missing.png', ownerId: 'owner-a', sizeBytes: 10, lifecycleStatus: 'pending_cleanup' as const },
        { id: 'three', bucketId: 'project-assets', objectPath: 'size-mismatch.png', ownerId: 'owner-a', sizeBytes: 20, lifecycleStatus: 'active' as const },
      ];
    },
    async listStorageReservations() {
      return [
        { id: 'expired', ownerId: 'owner-a', expectedBytes: 30, status: 'pending', expiresAt: '2020-01-01T00:00:00.000Z' },
        { id: 'current', ownerId: 'owner-b', expectedBytes: 10, status: 'pending', expiresAt: '2999-01-01T00:00:00.000Z' },
      ];
    },
    async listStorageQuotas() {
      return [
        { ownerId: 'owner-a', usedBytes: 0, reservedBytes: 30 },
        { ownerId: 'owner-b', usedBytes: 0, reservedBytes: 10 },
      ];
    },
    async listAmbiguousStorageObjects() { return [{ bucketId: 'project-assets', objectPath: 'ambiguous.png' }]; },
    async expireReservations() { calls.expire += 1; return 1; },
    async rebuildStorageQuotaTotals() { calls.rebuild += 1; return 1; },
  };
}

describe('account storage reconciliation', () => {
  it('reports physical registry drift and never repairs in report mode', async () => {
    const client = clientFixture();
    await expect(reconcileAccountStorage(client, { applySafeRepairs: false })).resolves.toEqual({
      registeredObjects: 3,
      physicalObjects: 3,
      missingObjects: 1,
      unexpectedObjects: 1,
      sizeMismatches: 1,
      ambiguousObjects: 1,
      expiredReservations: 1,
      quotaMismatches: 1,
      repairedReservations: 0,
      repairedQuotas: 0,
    });
    expect(client.calls).toEqual({ expire: 0, rebuild: 0 });
  });

  it('fails closed without any mutation when inventory parity is not clean', async () => {
    const client = clientFixture();
    await expect(reconcileAccountStorage(client, { applySafeRepairs: true }))
      .rejects.toThrow('Storage reconciliation aborted: inventory parity must be clean before repairs');
    expect(client.calls).toEqual({ expire: 0, rebuild: 0 });
  });

  it('repairs only a clean inventory and accepts the JSON quota result', async () => {
    const client = clientFixture();
    client.listPhysicalStorageObjects = async () => [{ bucketId: 'project-assets', objectPath: 'present.png', sizeBytes: 100 }];
    client.listRegisteredStorageFiles = async () => [{ id: 'one', bucketId: 'project-assets', objectPath: 'present.png', ownerId: 'owner-a', sizeBytes: 100, lifecycleStatus: 'active' as const }];
    client.listStorageReservations = async () => [];
    client.listStorageQuotas = async () => [{ ownerId: 'owner-a', usedBytes: 0, reservedBytes: 0 }];
    client.listAmbiguousStorageObjects = async () => [];
    delete (client as { rebuildStorageQuotaTotals?: () => Promise<number> }).rebuildStorageQuotaTotals;
    const rpc = jest.fn(async (name: string) => name === 'service_rebuild_account_storage_quota_totals'
      ? { data: { rebuiltAccounts: 3 }, error: null }
      : { data: 1, error: null });

    await expect(reconcileAccountStorage({ ...client, rpc }, { applySafeRepairs: true }))
      .resolves.toMatchObject({ repairedReservations: 0, repairedQuotas: 3 });
  });

  it('fails closed when registry state cannot be queried', async () => {
    const client = {
      async listPhysicalStorageObjects() { return []; },
      from(table: string) {
        return {
          async select() {
            return table === 'project_storage_files'
              ? { data: null, error: { message: 'offline' } }
              : { data: [], error: null };
          },
        };
      },
    };

    await expect(reconcileAccountStorage(client, { applySafeRepairs: true }))
      .rejects.toThrow('Storage reconciliation query failed for project_storage_files');
  });

  it('parses help, report, and apply modes without allowing extra flags', () => {
    expect(parseReconciliationArguments([])).toEqual({ help: false, applySafeRepairs: false });
    expect(parseReconciliationArguments(['--apply'])).toEqual({ help: false, applySafeRepairs: true });
    expect(parseReconciliationArguments(['--help'])).toEqual({ help: true, applySafeRepairs: false });
    expect(() => parseReconciliationArguments(['--apply', '--else'])).toThrow('Usage:');
  });
});
