import type { Page, Route } from '@playwright/test';
import type {
  AccountStorageEntity,
  AccountStorageEntityDetail,
  AccountStorageEntityPage,
  AccountStorageProject,
  AccountStorageSort,
  AccountStorageSummary,
} from '@/lib/types/accountStorage';

export const ACCOUNT_STORAGE_OWNER_ID = '10000000-0000-4000-8000-000000000001';
export const ACCOUNT_STORAGE_COLLABORATOR_ID = '20000000-0000-4000-8000-000000000002';
export const OWNED_PROJECT_ID = '30000000-0000-4000-8000-000000000003';
export const SHARED_PROJECT_ID = '40000000-0000-4000-8000-000000000004';
export const FORBIDDEN_PROJECT_ID = '50000000-0000-4000-8000-000000000005';

const ONE_TB = 1_099_511_627_776;
const SUPABASE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321').origin;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function fakeJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: ACCOUNT_STORAGE_OWNER_ID,
    role: 'authenticated',
    email: 'account-storage-e2e@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

function entity(input: Partial<AccountStorageEntity> & Pick<AccountStorageEntity, 'id' | 'name' | 'kind'>): AccountStorageEntity {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    mimeType: input.mimeType ?? `application/x-keco-${input.kind}`,
    logicalBytes: input.logicalBytes ?? 0,
    physicalBytes: input.physicalBytes ?? 1024,
    sizeBytes: input.sizeBytes ?? 1024,
    folderId: input.folderId ?? null,
    createdAt: input.createdAt ?? '2026-09-18T00:00:00.000Z',
    sourceAvailable: input.sourceAvailable ?? true,
  };
}

const ownedProject: AccountStorageProject = {
  id: OWNED_PROJECT_ID,
  name: 'Owned Storage Fixture',
  ownerName: 'Storage Owner',
  fileCount: 3,
  usedBytes: 512 * 1024 * 1024 * 1024,
  ownedByCurrentUser: true,
};

const sharedProject: AccountStorageProject = {
  id: SHARED_PROJECT_ID,
  name: 'Shared Storage Fixture',
  ownerName: 'Another Owner',
  fileCount: 1,
  usedBytes: 768 * 1024 * 1024 * 1024,
  ownedByCurrentUser: false,
};

const ownedEntities = [
  entity({
    id: '82000000-0000-4000-8000-000000000008',
    name: 'Story outline',
    kind: 'document',
    logicalBytes: 2_048,
    physicalBytes: 1024,
    sizeBytes: 3_072,
  }),
  entity({
    id: '84000000-0000-4000-8000-000000000008',
    name: 'Characters',
    kind: 'table',
    logicalBytes: 4_096,
    physicalBytes: 12_000,
    sizeBytes: 16_096,
  }),
  entity({ id: OWNED_PROJECT_ID, name: 'Assets', kind: 'assets', physicalBytes: 3_300, sizeBytes: 3_300 }),
];

const sharedEntities = [
  entity({ id: SHARED_PROJECT_ID, name: 'Assets', kind: 'assets', sizeBytes: 500, physicalBytes: 500 }),
];

function compareEntities(sort: AccountStorageSort): (left: AccountStorageEntity, right: AccountStorageEntity) => number {
  switch (sort) {
    case 'name_asc': return (left, right) => left.name.localeCompare(right.name);
    case 'name_desc': return (left, right) => right.name.localeCompare(left.name);
    case 'size_asc': return (left, right) => left.sizeBytes - right.sizeBytes;
    case 'size_desc': return (left, right) => right.sizeBytes - left.sizeBytes;
    case 'created_asc': return (left, right) => left.createdAt.localeCompare(right.createdAt);
    case 'created_desc': return (left, right) => right.createdAt.localeCompare(left.createdAt);
  }
}

function entityDetail(item: AccountStorageEntity): AccountStorageEntityDetail {
  const logicalId = item.kind === 'assets' ? null : '91000000-0000-4000-8000-000000000009';
  const detailItems: AccountStorageEntityDetail['items'] = [];
  if (logicalId && item.logicalBytes > 0) detailItems.push({
    id: logicalId,
    name: item.kind === 'table' ? 'Table data' : 'Document body',
    mimeType: item.kind === 'table' ? 'application/x-keco-library+json' : 'text/markdown',
    sizeBytes: item.logicalBytes,
    itemKind: 'logical',
    groupId: null,
    groupName: null,
    createdAt: item.createdAt,
  });
  if (item.physicalBytes > 0) detailItems.push({
    id: '92000000-0000-4000-8000-000000000009',
    name: item.kind === 'table' ? 'alice.png' : item.kind === 'document' ? 'cover.png' : 'project-assets.zip',
    mimeType: item.kind === 'assets' ? 'application/zip' : 'image/png',
    sizeBytes: item.physicalBytes,
    itemKind: 'media',
    groupId: item.kind === 'table' ? '93000000-0000-4000-8000-000000000009' : null,
    groupName: item.kind === 'table' ? 'Alice' : item.kind === 'document' ? 'Document media' : 'Project assets',
    createdAt: item.createdAt,
  });
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    logicalBytes: item.logicalBytes,
    physicalBytes: item.physicalBytes,
    sizeBytes: item.sizeBytes,
    sourceAvailable: item.sourceAvailable,
    items: detailItems,
  };
}

export class AccountStorageMockBackend {
  private usageBytes = ownedProject.usedBytes;
  private physicalUsageBytes = 500 * 1024 * 1024 * 1024;
  private quotaState: 'below-quota' | 'full' = 'below-quota';
  readonly entityRequests: URL[] = [];

  async install(page: Page): Promise<void> {
    await page.route(`${SUPABASE_ORIGIN}/**`, (route) => this.handleSupabase(route));
    await page.route('**/api/account/credits', (route) => json(route, {
      allocated: 0,
      used: 0,
      remaining: 0,
      overage: 0,
      deepseekTokens: 0,
      incompleteCount: 0,
      trackedFrom: '2026-09-01T00:00:00.000Z',
    }));
    await page.route('**/api/account/storage/projects/*/entities**', (route) => this.handleEntities(route));
    await page.route('**/api/account/storage', (route) => json(route, this.summary()));
    await page.route('**/api/projects/*/game-assets', (route) => this.handleProjectAssetUpload(route));
    await page.route('**/api/projects', (route) => json(route, [{
      id: OWNED_PROJECT_ID,
      owner_id: ACCOUNT_STORAGE_OWNER_ID,
      name: ownedProject.name,
      description: null,
    }]));
  }

  setUsagePercent(percent: number): void {
    this.usageBytes = Math.ceil(ONE_TB * percent / 100);
    this.physicalUsageBytes = this.usageBytes;
  }

  setLogicalOverage(overageBytes: number): void {
    this.physicalUsageBytes = 500 * 1024 * 1024 * 1024;
    this.usageBytes = ONE_TB + overageBytes;
  }

  setQuotaFull(): void {
    this.quotaState = 'full';
  }

  setQuotaAvailable(): void {
    this.quotaState = 'below-quota';
  }

  private summary(): AccountStorageSummary {
    return {
      quotaBytes: ONE_TB,
      usedBytes: this.usageBytes,
      physicalUsedBytes: this.physicalUsageBytes,
      logicalUsedBytes: this.usageBytes - this.physicalUsageBytes,
      reservedBytes: 0,
      remainingBytes: Math.max(0, ONE_TB - this.usageBytes),
      overageBytes: Math.max(0, this.usageBytes - ONE_TB),
      ownedProjects: [ownedProject],
      sharedProjects: [sharedProject],
      unassigned: { fileCount: 2, usedBytes: 2048 },
    };
  }

  private async handleEntities(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    this.entityRequests.push(url);
    const segments = url.pathname.split('/').filter(Boolean);
    const projectIndex = segments.indexOf('projects');
    const projectId = segments[projectIndex + 1];
    if (projectId === FORBIDDEN_PROJECT_ID) return json(route, { error: 'Forbidden' }, 403);

    const entityIndex = segments.indexOf('entities');
    if (segments.length > entityIndex + 1) {
      const kind = segments[entityIndex + 1];
      const entityId = segments[entityIndex + 2];
      const match = [...ownedEntities, ...sharedEntities].find(item => item.kind === kind && item.id === entityId);
      return match ? json(route, entityDetail(match)) : json(route, { error: 'Storage entity not found' }, 404);
    }

    const entities = projectId === SHARED_PROJECT_ID ? sharedEntities : ownedEntities;
    const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase();
    const sort = (url.searchParams.get('sort') ?? 'size_desc') as AccountStorageSort;
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const items = entities
      .filter((item) => item.name.toLocaleLowerCase().includes(query))
      .sort(compareEntities(sort));
    const page: AccountStorageEntityPage = {
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
    return json(route, page);
  }

  private async handleProjectAssetUpload(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') return json(route, { error: 'Method not allowed' }, 405);
    if (this.quotaState === 'full') {
      return json(route, { error: 'Storage quota exceeded', code: 'STORAGE_QUOTA_EXCEEDED' }, 409);
    }
    return json(route, { assetId: 'a0000000-0000-4000-8000-000000000010', status: 'ready' }, 201);
  }

  private async handleSupabase(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const user = {
      id: ACCOUNT_STORAGE_OWNER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'account-storage-e2e@example.com',
    };
    if (path === '/auth/v1/token') return json(route, {
      access_token: fakeJwt(),
      refresh_token: 'account-storage-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user,
    });
    if (path === '/auth/v1/user') return json(route, user);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (path === '/rest/v1/profiles') {
      const profile = { id: ACCOUNT_STORAGE_OWNER_ID, email: user.email, username: 'Storage Owner' };
      return json(route, request.headers().accept?.includes('application/vnd.pgrst.object') ? profile : [profile]);
    }
    if (path === '/rest/v1/projects') return json(route, [{
      id: OWNED_PROJECT_ID,
      owner_id: ACCOUNT_STORAGE_OWNER_ID,
      name: ownedProject.name,
      description: null,
    }]);
    if (path === '/rest/v1/project_collaborators') return json(route, []);
    return json(route, []);
  }
}

export async function loginToAccount(page: Page, backend: AccountStorageMockBackend): Promise<void> {
  await backend.install(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('account-storage-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await Promise.all([
    page.waitForURL(/\/projects$/, { timeout: 15_000 }),
    page.getByRole('button', { name: 'Login', exact: true }).click(),
  ]);
  await page.goto('/account');
}

export async function attemptProjectAssetUpload(
  page: Page,
  projectId: string,
  actorId: string,
): Promise<{ status: number; body: { code?: string; error?: string } }> {
  return page.evaluate(async ({ projectId: requestedProjectId, actorId: requestedActorId }) => {
    const response = await fetch(`/api/projects/${requestedProjectId}/game-assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-account-storage-actor': requestedActorId },
      body: JSON.stringify({ name: 'one-byte.txt', sizeBytes: 1 }),
    });
    return { status: response.status, body: await response.json() as { code?: string; error?: string } };
  }, { projectId, actorId });
}
