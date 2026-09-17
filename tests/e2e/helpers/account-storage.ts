import type { Page, Route } from '@playwright/test';
import type {
  AccountStorageFile,
  AccountStorageFilePage,
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

function file(input: Partial<AccountStorageFile> & Pick<AccountStorageFile, 'id' | 'name'>): AccountStorageFile {
  return {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType ?? 'image/png',
    sizeBytes: input.sizeBytes ?? 1024,
    sourceKind: input.sourceKind ?? 'project_asset',
    sourceEntityId: input.sourceEntityId ?? null,
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

const ownedFiles = [
  file({ id: '60000000-0000-4000-8000-000000000006', name: 'Zebra large.png', sizeBytes: 3_000, createdAt: '2026-09-18T03:00:00.000Z' }),
  file({ id: '70000000-0000-4000-8000-000000000007', name: 'Alpha small.png', sizeBytes: 100, createdAt: '2026-09-17T03:00:00.000Z' }),
  file({ id: '80000000-0000-4000-8000-000000000008', name: 'Deleted source.png', sizeBytes: 200, sourceAvailable: false, createdAt: '2026-09-16T03:00:00.000Z' }),
];

const sharedFiles = [
  file({ id: '90000000-0000-4000-8000-000000000009', name: 'Shared fixture.png', sizeBytes: 500 }),
];

function compareFiles(sort: AccountStorageSort): (left: AccountStorageFile, right: AccountStorageFile) => number {
  switch (sort) {
    case 'name_asc': return (left, right) => left.name.localeCompare(right.name);
    case 'name_desc': return (left, right) => right.name.localeCompare(left.name);
    case 'size_asc': return (left, right) => left.sizeBytes - right.sizeBytes;
    case 'size_desc': return (left, right) => right.sizeBytes - left.sizeBytes;
    case 'created_asc': return (left, right) => left.createdAt.localeCompare(right.createdAt);
    case 'created_desc': return (left, right) => right.createdAt.localeCompare(left.createdAt);
  }
}

export class AccountStorageMockBackend {
  private usageBytes = ownedProject.usedBytes;
  private quotaState: 'below-quota' | 'full' = 'below-quota';
  readonly fileRequests: URL[] = [];

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
    await page.route('**/api/account/storage/projects/*/files**', (route) => this.handleFiles(route));
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
    this.usageBytes = Math.round(ONE_TB * percent / 100);
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
      reservedBytes: 0,
      remainingBytes: Math.max(0, ONE_TB - this.usageBytes),
      ownedProjects: [ownedProject],
      sharedProjects: [sharedProject],
      unassigned: { fileCount: 2, usedBytes: 2048 },
    };
  }

  private async handleFiles(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    this.fileRequests.push(url);
    const projectId = url.pathname.split('/').at(-2);
    if (projectId === FORBIDDEN_PROJECT_ID) return json(route, { error: 'Forbidden' }, 403);

    const files = projectId === SHARED_PROJECT_ID ? sharedFiles : ownedFiles;
    const query = (url.searchParams.get('query') ?? '').toLocaleLowerCase();
    const sort = (url.searchParams.get('sort') ?? 'size_desc') as AccountStorageSort;
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const items = files
      .filter((item) => item.name.toLocaleLowerCase().includes(query))
      .sort(compareFiles(sort));
    const page: AccountStorageFilePage = {
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
