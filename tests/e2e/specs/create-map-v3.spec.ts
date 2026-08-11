import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { MapPlanV3, MapSceneV3 } from '../../../src/features/create-map/model/directMapSchema';
import type { MapPlanV2 } from '../../../src/features/create-map/model/mapPlanSchema';
import type { MapSceneV2 } from '../../../src/features/create-map/model/mapSceneSchema';
import { makeEmptyMapSceneV2, makeValidMapPlanV2 } from '../../unit/create-map/fixtures';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const DOCUMENT_ID = '30000000-0000-4000-8000-000000000003';
const MAP_ID = '40000000-0000-4000-8000-000000000004';
const DRAFT_REVISION_ID = '50000000-0000-4000-8000-000000000005';
const SLOW_MAP_ID = '80000000-0000-4000-8000-000000000008';
const FAST_MAP_ID = '90000000-0000-4000-8000-000000000010';
const LEGACY_MAP_ID = 'a0000000-0000-4000-8000-000000000012';
const SUPABASE_ORIGIN = 'http://127.0.0.1:54321';
const APP_ORIGIN = process.env.KECO_CREATE_MAP_E2E_ORIGIN ?? 'http://localhost:3000';

type AssetStatus = 'planned' | 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';

type AssetRecord = {
  id: string;
  map_revision_id: string;
  generation_id: string;
  plan_fingerprint: string;
  asset_key: 'map-image';
  kind: 'map_image';
  status: AssetStatus;
  requested_capability: 'direct_map_image';
  provider_operation: string | null;
  provider_job_id: string | null;
  prompt: string;
  generation_params: Record<string, unknown>;
  reference_asset_ids: string[];
  reference_hashes: string[];
  metadata: Record<string, unknown>;
  storage_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  has_transparency: boolean | null;
  last_error_code: string | null;
  attempt_count: number;
};

type RevisionV3 = {
  id: string;
  revision_number: number;
  save_version: number;
  source_document_id: string | null;
  schema_version: 3;
  plan: MapPlanV3;
  scene: MapSceneV3;
};

type RevisionV2 = {
  id: string;
  revision_number: number;
  save_version: number;
  source_document_id: string | null;
  schema_version: 2;
  plan: MapPlanV2;
  scene: MapSceneV2;
};

type Revision = RevisionV2 | RevisionV3;

type MockMap = {
  id: string;
  name: string;
  currentRevisionId: string;
  updatedAt: string;
  revisions: Map<string, Revision>;
  delayMs?: number;
};

type ReferenceRecord = {
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

type BrowserFailures = {
  pageErrors: string[];
  requestFailures: string[];
  responseFailures: string[];
};

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(plan: MapPlanV3): string {
  return createHash('sha256').update(canonical(plan)).digest('hex');
}

function planFixture(overrides: Partial<MapPlanV3> = {}): MapPlanV3 {
  return {
    schemaVersion: 3,
    name: 'Mosslight Crossing',
    summary: 'A complete opaque map of a mossy river crossing.',
    map: { width: 512, height: 512 },
    description: 'An opaque top-down pixel art river crossing with readable roads, buildings, trees, clear lighting, a natural palette, and no interface text.',
    references: [],
    styleReference: null,
    generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
    ...overrides,
  };
}

function emptyScene(plan: MapPlanV3): MapSceneV3 {
  return {
    schemaVersion: 3,
    size: { ...plan.map },
    mapImage: null,
    canvas: { zoom: 1, panX: 24, panY: 24 },
  };
}

function readyScene(plan: MapPlanV3, revisionId: string): MapSceneV3 {
  return {
    ...emptyScene(plan),
    mapImage: {
      assetKey: 'map-image',
      sourceRevisionId: revisionId,
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
  };
}

function fakeJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: USER_ID,
    role: 'authenticated',
    email: 'map-v3-e2e@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function queryValue(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  return value?.startsWith('eq.') ? value.slice(3) : value;
}

class CreateMapV3MockBackend {
  readonly maps = new Map<string, MockMap>();
  readonly assets = new Map<string, AssetRecord>();
  readonly references: ReferenceRecord[] = [];
  readonly edgeBodies: Array<Record<string, unknown>> = [];
  lastPlanRequest: Record<string, unknown> | null = null;
  createAssetRpc: { name: string; args: Record<string, unknown> } | null = null;
  failNextValidation = false;
  private sequence = 100;
  private uploadSequence = 0;
  readonly mapPng: Promise<Buffer>;

  constructor() {
    this.mapPng = sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 72, g: 116, b: 78, alpha: 1 } },
    }).composite([
      { input: Buffer.from('<svg width="512" height="512"><rect x="48" y="208" width="416" height="96" fill="#b79b67"/><rect x="220" y="48" width="72" height="416" fill="#7893a0"/><circle cx="256" cy="256" r="54" fill="#d8c88c"/></svg>'), top: 0, left: 0 },
    ]).png().toBuffer();
  }

  async install(page: Page): Promise<void> {
    await page.route(`${SUPABASE_ORIGIN}/**`, (route) => this.handleSupabase(route));
    await page.route('**/__create-map-v3-e2e/map.png', async (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: await this.mapPng,
      headers: { 'access-control-allow-origin': '*' },
    }));
    await page.route('**/api/create-map/references**', (route) => this.handleReferences(route));
    await page.route('**/api/create-map/plan', (route) => this.handlePlan(route));
  }

  seedReadyV3Map(id: string, name: string, delayMs = 0): void {
    const plan = planFixture({ name });
    const assetRevisionId = uuid(++this.sequence);
    const draftRevisionId = uuid(++this.sequence);
    const generationId = uuid(++this.sequence);
    const sha256 = createHash('sha256').update(`${id}:${name}`).digest('hex');
    const asset = this.assetRecord(id, assetRevisionId, generationId, fingerprint(plan));
    Object.assign(asset, {
      status: 'ready',
      provider_operation: 'create_image_pro',
      provider_job_id: `job-${this.sequence}`,
      storage_path: `${PROJECT_ID}/${id}/${assetRevisionId}/map-image/${sha256}.png`,
      sha256,
      width: plan.map.width,
      height: plan.map.height,
      has_transparency: false,
      attempt_count: 1,
    });
    this.assets.set(asset.id, asset);
    this.maps.set(id, {
      id,
      name,
      currentRevisionId: draftRevisionId,
      updatedAt: new Date(Date.now() + this.sequence * 1000).toISOString(),
      delayMs,
      revisions: new Map([[draftRevisionId, {
        id: draftRevisionId,
        revision_number: 2,
        save_version: 1,
        source_document_id: null,
        schema_version: 3,
        plan,
        scene: readyScene(plan, assetRevisionId),
      }]]),
    });
  }

  seedLegacyMap(): void {
    const plan = makeValidMapPlanV2();
    const revisionId = uuid(++this.sequence);
    this.maps.set(LEGACY_MAP_ID, {
      id: LEGACY_MAP_ID,
      name: 'Legacy Riverside V2',
      currentRevisionId: revisionId,
      updatedAt: '2026-08-11T01:00:00.000Z',
      revisions: new Map([[revisionId, {
        id: revisionId,
        revision_number: 1,
        save_version: 0,
        source_document_id: null,
        schema_version: 2,
        plan,
        scene: makeEmptyMapSceneV2(),
      }]]),
    });
  }

  readyAssets(): AssetRecord[] {
    return [...this.assets.values()].filter((asset) => asset.status === 'ready');
  }

  private assetRecord(mapId: string, revisionId: string, generationId: string, planFingerprint: string): AssetRecord {
    const map = this.maps.get(mapId);
    const revision = map?.revisions.get(revisionId);
    const plan = revision?.schema_version === 3 ? revision.plan : planFixture();
    return {
      id: uuid(++this.sequence),
      map_revision_id: revisionId,
      generation_id: generationId,
      plan_fingerprint: planFingerprint,
      asset_key: 'map-image',
      kind: 'map_image',
      status: 'planned',
      requested_capability: 'direct_map_image',
      provider_operation: null,
      provider_job_id: null,
      prompt: plan.description,
      generation_params: {
        width: plan.map.width,
        height: plan.map.height,
        noBackground: false,
        seed: plan.generation.seed,
        references: plan.references,
        styleReference: plan.styleReference,
      },
      reference_asset_ids: [
        ...plan.references.map((reference) => reference.assetId),
        ...(plan.styleReference ? [plan.styleReference.assetId] : []),
      ],
      reference_hashes: [
        ...plan.references.map((reference) => reference.sha256),
        ...(plan.styleReference ? [plan.styleReference.sha256] : []),
      ],
      metadata: {},
      storage_path: null,
      sha256: null,
      width: null,
      height: null,
      has_transparency: null,
      last_error_code: null,
      attempt_count: 0,
    };
  }

  private async handleReferences(route: Route): Promise<void> {
    if (route.request().method() === 'GET') return json(route, { references: this.references });
    this.uploadSequence += 1;
    const id = uuid(900 + this.uploadSequence);
    const sha256 = `${this.uploadSequence}`.repeat(64);
    const reference: ReferenceRecord = {
      id,
      projectId: PROJECT_ID,
      name: this.uploadSequence === 1 ? 'layout.png' : 'style.png',
      storagePath: `references/${PROJECT_ID}/${id}/${sha256}.png`,
      sha256,
      width: 128,
      height: 128,
      contentType: 'image/png',
      byteSize: 256,
      previewUrl: `${APP_ORIGIN}/__create-map-v3-e2e/map.png`,
    };
    this.references.unshift(reference);
    return json(route, { reference }, 201);
  }

  private async handlePlan(route: Route): Promise<void> {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    this.lastPlanRequest = request;
    const referenceIds = Array.isArray(request.referenceIds) ? request.referenceIds.map(String) : [];
    const roles = request.referenceRoles as Record<string, 'content' | 'layout'> | undefined;
    const usage = request.referenceUsage as Record<string, string> | undefined;
    const styleReferenceId = typeof request.styleReferenceId === 'string' ? request.styleReferenceId : null;
    const references = referenceIds.map((id) => {
      const record = this.references.find((candidate) => candidate.id === id);
      if (!record) throw new Error(`Unknown reference ${id}`);
      return { assetId: id, sha256: record.sha256, role: roles?.[id] ?? 'content', usage: usage?.[id] ?? record.name };
    });
    const styleRecord = styleReferenceId
      ? this.references.find((candidate) => candidate.id === styleReferenceId)
      : null;
    const plan = planFixture({
      references,
      styleReference: styleRecord ? {
        assetId: styleRecord.id,
        sha256: styleRecord.sha256,
        copy: Array.isArray(request.styleCopy) && request.styleCopy.length > 0
          ? request.styleCopy as Array<'color_palette' | 'outline' | 'detail' | 'shading'>
          : ['color_palette'],
      } : null,
    });
    return json(route, {
      plan,
      sourceToken: request.documentId ? {
        documentId: DOCUMENT_ID,
        documentUpdatedAt: '2026-08-11T01:00:00.000Z',
        epoch: 2,
        revision: 3,
      } : null,
    });
  }

  private async handleSupabase(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/auth/v1/token') {
      return json(route, {
        access_token: fakeJwt(),
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'map-v3-e2e@example.com' },
      });
    }
    if (path === '/auth/v1/user') {
      return json(route, { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'map-v3-e2e@example.com' });
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (path.startsWith('/storage/v1/object/sign/map-assets/')) {
      return json(route, { signedURL: `${APP_ORIGIN}/__create-map-v3-e2e/map.png` });
    }
    if (path === '/functions/v1/pixellab-map') return this.handlePixelLab(route);
    if (path.startsWith('/rest/v1/rpc/')) return this.handleRpc(route, path.split('/').at(-1) as string);
    if (path.startsWith('/rest/v1/')) return this.handleTable(route, path.slice('/rest/v1/'.length), url);
    return json(route, {});
  }

  private async handleTable(route: Route, table: string, url: URL): Promise<void> {
    const acceptsObject = route.request().headers().accept?.includes('application/vnd.pgrst.object') ?? false;
    const respond = (rows: unknown[]) => json(route, acceptsObject ? (rows[0] ?? null) : rows);
    if (table === 'profiles') {
      return respond([{ id: USER_ID, email: 'map-v3-e2e@example.com', username: 'Map V3 E2E' }]);
    }
    if (table === 'project_collaborators') {
      const select = url.searchParams.get('select') ?? '';
      return respond(select === 'project_id'
        ? [{ project_id: PROJECT_ID }]
        : [{ id: uuid(40), role: 'admin', accepted_at: '2026-08-11T00:00:00.000Z' }]);
    }
    if (table === 'projects') {
      return respond([{
        id: PROJECT_ID,
        owner_id: USER_ID,
        name: 'V3 E2E Project',
        description: null,
        created_at: '2026-08-11T00:00:00.000Z',
        updated_at: '2026-08-11T00:00:00.000Z',
      }]);
    }
    if (table === 'documents') {
      return respond([{
        id: DOCUMENT_ID,
        project_id: PROJECT_ID,
        folder_id: null,
        parent_document_id: null,
        name: 'Direct map notes',
        description: 'Map context',
        created_at: '2026-08-11T00:00:00.000Z',
        updated_at: '2026-08-11T01:00:00.000Z',
      }]);
    }
    if (table === 'map_projects') {
      const mapId = queryValue(url, 'id');
      if (mapId) {
        const map = this.maps.get(mapId);
        if (map?.delayMs) await new Promise((resolve) => setTimeout(resolve, map.delayMs));
        return respond(map ? [{ project_id: PROJECT_ID, current_revision_id: map.currentRevisionId }] : []);
      }
      return respond([...this.maps.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((map) => {
          const revision = map.revisions.get(map.currentRevisionId);
          return {
            id: map.id,
            project_id: PROJECT_ID,
            name: map.name,
            current_revision_id: map.currentRevisionId,
            updated_at: map.updatedAt,
            current_revision: { schema_version: revision?.schema_version ?? 3 },
            projects: { name: 'V3 E2E Project' },
          };
        }));
    }
    if (table === 'map_revisions') {
      const revisionId = queryValue(url, 'id');
      for (const map of this.maps.values()) {
        const revision = revisionId ? map.revisions.get(revisionId) : undefined;
        if (revision) return respond([revision]);
      }
      return respond([]);
    }
    if (table === 'map_assets') {
      const assetId = queryValue(url, 'id');
      const revisionId = queryValue(url, 'map_revision_id');
      const rows = [...this.assets.values()].filter((asset) =>
        assetId ? asset.id === assetId : revisionId ? asset.map_revision_id === revisionId : true
      );
      return respond(rows);
    }
    return respond([]);
  }

  private async handleRpc(route: Route, rpc: string): Promise<void> {
    const body = route.request().postDataJSON() as Record<string, any>;
    if (rpc === 'create_map_project_v3') {
      const revision: RevisionV3 = {
        id: DRAFT_REVISION_ID,
        revision_number: 1,
        save_version: 0,
        source_document_id: body.p_source_document_id,
        schema_version: 3,
        plan: body.p_plan,
        scene: body.p_scene,
      };
      this.maps.set(MAP_ID, {
        id: MAP_ID,
        name: body.p_name,
        currentRevisionId: DRAFT_REVISION_ID,
        updatedAt: new Date().toISOString(),
        revisions: new Map([[DRAFT_REVISION_ID, revision]]),
      });
      return json(route, [{ map_id: MAP_ID, draft_revision_id: DRAFT_REVISION_ID, revision_number: 1, save_version: 0 }]);
    }
    if (rpc === 'save_map_draft_v3') {
      const map = this.maps.get(body.p_map_id);
      const revision = map?.revisions.get(body.p_revision_id);
      if (!map || revision?.schema_version !== 3) return json(route, [], 409);
      revision.plan = body.p_plan;
      revision.scene = body.p_scene;
      revision.save_version += 1;
      map.name = revision.plan.name;
      map.updatedAt = new Date().toISOString();
      return json(route, [{ status: 'saved', save_version: revision.save_version }]);
    }
    if (rpc === 'publish_map_revision_v3') {
      const map = this.maps.get(body.p_map_id);
      const draft = map?.revisions.get(body.p_draft_revision_id);
      if (!map || draft?.schema_version !== 3) return json(route, [], 409);
      const publishedId = uuid(++this.sequence);
      const nextDraftId = uuid(++this.sequence);
      map.revisions.set(publishedId, {
        ...structuredClone(draft),
        id: publishedId,
        revision_number: draft.revision_number,
      });
      map.revisions.set(nextDraftId, {
        ...structuredClone(draft),
        id: nextDraftId,
        revision_number: draft.revision_number + 1,
        save_version: 0,
      });
      map.currentRevisionId = nextDraftId;
      return json(route, [{
        status: 'published',
        published_revision_id: publishedId,
        next_draft_revision_id: nextDraftId,
      }]);
    }
    if (rpc === 'create_map_asset_plan_v3') {
      this.createAssetRpc = { name: rpc, args: body };
      const map = [...this.maps.values()].find((candidate) => candidate.revisions.has(body.p_revision_id));
      if (!map) return json(route, [], 404);
      const existing = [...this.assets.values()].find((asset) => asset.map_revision_id === body.p_revision_id);
      if (existing) return json(route, [{ asset_id: existing.id, status: existing.status }]);
      const record = this.assetRecord(map.id, body.p_revision_id, body.p_generation_id, body.p_plan_fingerprint);
      this.assets.set(record.id, record);
      return json(route, [{ asset_id: record.id, status: record.status }]);
    }
    return json(route, []);
  }

  private async handlePixelLab(route: Route): Promise<void> {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.edgeBodies.push(body);
    const asset = this.assets.get(String(body.assetId));
    if (!asset) return json(route, { code: 'asset_not_found', error: 'Asset not found' }, 404);
    if (body.operation === 'submit' || body.operation === 'retry') {
      asset.status = 'generating';
      asset.provider_operation = 'create_image_pro';
      asset.provider_job_id = `job-${asset.id}`;
      asset.last_error_code = null;
      asset.attempt_count += 1;
      return json(route, { assetId: asset.id, status: 'generating' });
    }
    if (body.operation === 'poll') {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return json(route, { assetId: asset.id, status: 'completed' });
    }
    if (body.operation === 'validate') {
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (this.failNextValidation) {
        this.failNextValidation = false;
        asset.status = 'failed';
        asset.last_error_code = 'image_not_opaque';
        return json(route, { assetId: asset.id, status: 'failed', code: asset.last_error_code });
      }
      const map = [...this.maps.values()].find((candidate) => candidate.revisions.has(asset.map_revision_id));
      if (!map) return json(route, { code: 'map_not_found', error: 'Map not found' }, 404);
      const sha256 = createHash('sha256').update(`${asset.id}:${asset.attempt_count}`).digest('hex');
      Object.assign(asset, {
        status: 'ready',
        storage_path: `${PROJECT_ID}/${map.id}/${asset.map_revision_id}/map-image/${sha256}.png`,
        sha256,
        width: 512,
        height: 512,
        has_transparency: false,
        last_error_code: null,
        metadata: {
          schemaFingerprint: 'a'.repeat(64),
          pollOperation: 'get_image',
          pollSchemaFingerprint: 'b'.repeat(64),
          candidateIndex: 0,
        },
      });
      return json(route, { assetId: asset.id, status: 'ready' });
    }
    return json(route, { code: 'unsupported_operation', error: 'Unsupported operation' }, 400);
  }
}

function observeBrowserFailures(page: Page): BrowserFailures {
  const failures: BrowserFailures = { pageErrors: [], requestFailures: [], responseFailures: [] };
  page.on('pageerror', (error) => failures.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const resourceType = request.resourceType();
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText === 'net::ERR_ABORTED') return;
    if (resourceType === 'document' || resourceType === 'script' || resourceType === 'fetch') {
      failures.requestFailures.push(`${resourceType}:${errorText}:${request.url()}`);
    }
  });
  page.on('response', (response) => {
    const resourceType = response.request().resourceType();
    if (
      response.status() >= 400
      && (resourceType === 'document' || resourceType === 'script' || resourceType === 'fetch')
    ) {
      failures.responseFailures.push(`${resourceType}:${response.status()}:${response.url()}`);
    }
  });
  return failures;
}

async function loginAndOpen(page: Page, backend: CreateMapV3MockBackend): Promise<BrowserFailures> {
  const failures = observeBrowserFailures(page);
  await backend.install(page);
  await page.goto(APP_ORIGIN);
  await page.getByLabel('Email').fill('map-v3-e2e@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Password123!');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 15_000 });
  await page.goto(`${APP_ORIGIN}/create-map`);
  await expect(page.getByTestId('create-map-workbench')).toHaveAttribute('data-schema-version', '3');
  return failures;
}

async function createSavedMap(page: Page): Promise<void> {
  await page.getByLabel('Project Optional').selectOption(PROJECT_ID);
  await page.getByRole('button', { name: 'Create map plan' }).click();
  await expect(page.getByRole('heading', { name: 'Mosslight Crossing' })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
}

async function generateReadyMap(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Generate map' }).click();
  await expect(page.getByText('Awaiting confirmation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and generate map' }).click();
  await expect(page.getByText('Generating map', { exact: true })).toBeVisible();
  await expect(page.getByText('Validating image', { exact: true })).toBeVisible();
  await expect(page.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function expectWithin(locator: Locator, container: Locator): Promise<void> {
  const [box, containerBox] = await Promise.all([locator.boundingBox(), container.boundingBox()]);
  if (!box || !containerBox) throw new Error('Expected visible layout boxes');
  expect(box.x).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(box.y).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(containerBox.y + containerBox.height + 1);
}

test.describe('Create Map V3 mocked workflow', () => {
  test.describe.configure({ mode: 'serial', timeout: 45_000 });

  test('creates a description-only V3 Plan without Project or Document context', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    await loginAndOpen(page, backend);
    const description = 'A quiet top-down village market with open paths.';
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
    await page.getByRole('button', { name: 'Create map plan' }).click();
    await expect(page.getByRole('heading', { name: 'Mosslight Crossing' })).toBeVisible();
    expect(backend.lastPlanRequest).toMatchObject({ schemaVersion: 3, description });
    expect(backend.lastPlanRequest).not.toHaveProperty('projectId');
    expect(backend.lastPlanRequest).not.toHaveProperty('documentId');
  });

  test('uses optional Document and uploaded content/style references', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    await loginAndOpen(page, backend);
    await page.getByLabel('Project Optional').selectOption(PROJECT_ID);
    await page.getByLabel('Document Optional').selectOption(DOCUMENT_ID);
    const upload = page.locator('input[type="file"]');
    await upload.setInputFiles({ name: 'layout.png', mimeType: 'image/png', buffer: await backend.mapPng });
    await expect(page.getByText('layout.png', { exact: true })).toBeVisible();
    await upload.setInputFiles({ name: 'style.png', mimeType: 'image/png', buffer: await backend.mapPng });
    const layoutRow = page.getByRole('listitem').filter({ hasText: 'layout.png' });
    const styleRow = page.getByRole('listitem').filter({ hasText: 'style.png' });
    await layoutRow.getByLabel('Content').check();
    await layoutRow.getByLabel('layout.png reference role').selectOption('layout');
    await layoutRow.getByLabel('layout.png usage').fill('Match the river crossing layout');
    await styleRow.getByLabel('Style').check();
    await page.getByRole('button', { name: 'Create map plan' }).click();

    expect(backend.lastPlanRequest).toMatchObject({
      schemaVersion: 3,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      referenceIds: [backend.references.find((reference) => reference.name === 'layout.png')?.id],
      styleReferenceId: backend.references.find((reference) => reference.name === 'style.png')?.id,
      styleCopy: ['color_palette'],
    });
    await expect(page.getByText('1 / 4', { exact: true })).toBeVisible();
  });

  test('edits the exact prompt, saves, confirms, polls, validates, and renders one map image', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    const browserFailures = await loginAndOpen(page, backend);
    await page.getByLabel('Project Optional').selectOption(PROJECT_ID);
    await page.getByRole('button', { name: 'Create map plan' }).click();
    const exactDescription = 'Exact final opaque top-down pixel art map.  Keep this spacing and punctuation.';
    await page.getByLabel('PixelLab description').fill(exactDescription);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await generateReadyMap(page);

    const createAssetRpc = backend.createAssetRpc;
    expect(createAssetRpc).toEqual({
      name: 'create_map_asset_plan_v3',
      args: expect.objectContaining({
        p_revision_id: expect.any(String),
        p_generation_id: expect.any(String),
      }),
    });
    expect(backend.edgeBodies.map((body) => body.operation)).toEqual(['submit', 'poll', 'validate']);
    expect(backend.assets.size).toBe(1);
    expect([...backend.assets.values()][0]).toMatchObject({
      kind: 'map_image',
      prompt: exactDescription,
      status: 'ready',
      provider_operation: 'create_image_pro',
      width: 512,
      height: 512,
      has_transparency: false,
    });
    const image = page.getByRole('img', { name: 'Mosslight Crossing' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight]))
      .toEqual([512, 512]);
    expect(browserFailures).toEqual({ pageErrors: [], requestFailures: [], responseFailures: [] });
  });

  test('surfaces technical validation failure and retries the same immutable asset', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    backend.failNextValidation = true;
    await loginAndOpen(page, backend);
    await createSavedMap(page);
    await page.getByRole('button', { name: 'Generate map' }).click();
    await page.getByRole('button', { name: 'Confirm and generate map' }).click();
    await expect(page.getByText('Generation failed', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('image_not_opaque', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry generation' }).click();
    await expect(page.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(backend.edgeBodies.map((body) => body.operation)).toEqual([
      'submit', 'poll', 'validate', 'retry', 'poll', 'validate',
    ]);
    expect(backend.assets.size).toBe(1);
  });

  test('regenerates into a new revision while preserving the prior ready result', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    await loginAndOpen(page, backend);
    await createSavedMap(page);
    await generateReadyMap(page);
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible({ timeout: 5_000 });
    const prior = backend.readyAssets()[0];
    await page.getByRole('button', { name: 'Regenerate map' }).click();
    await expect(page.getByText('Awaiting confirmation', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and generate map' }).click();
    await expect(page.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 10_000 });
    const ready = backend.readyAssets();
    expect(ready).toHaveLength(2);
    expect(ready.map((asset) => asset.map_revision_id)).toContain(prior.map_revision_id);
    expect(new Set(ready.map((asset) => asset.map_revision_id)).size).toBe(2);
  });

  test('restores after refresh and discards a stale saved-map open', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    await loginAndOpen(page, backend);
    await createSavedMap(page);
    await generateReadyMap(page);
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible({ timeout: 5_000 });
    await page.reload();
    await page.getByRole('button', { name: /Mosslight Crossing/ }).click();
    await expect(page.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('img', { name: 'Mosslight Crossing' })).toBeVisible();

    backend.seedReadyV3Map(SLOW_MAP_ID, 'Slow Marsh', 600);
    backend.seedReadyV3Map(FAST_MAP_ID, 'Fast Harbor');
    await page.reload();
    await page.getByRole('button', { name: /Slow Marsh/ }).click();
    await page.getByRole('button', { name: /Fast Harbor/ }).click();
    await expect(page.getByRole('heading', { name: 'Fast Harbor' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByRole('heading', { name: 'Fast Harbor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slow Marsh' })).not.toBeVisible();
  });

  test('opens a V2 saved map in explicit read-only compatibility mode', async ({ page }) => {
    const backend = new CreateMapV3MockBackend();
    backend.seedLegacyMap();
    await loginAndOpen(page, backend);
    await page.getByRole('button', { name: /Legacy Riverside V2/ }).click();
    const workbench = page.getByTestId('create-map-workbench');
    await expect(workbench).toHaveAttribute('data-schema-version', '2');
    await expect(workbench).toHaveAttribute('data-read-only', 'true');
    await expect(page.getByRole('button', { name: 'Generate map' })).toBeDisabled();
  });

  test('captures nonblank, error-free desktop and mobile layouts', async ({ page }, testInfo) => {
    const backend = new CreateMapV3MockBackend();
    const browserFailures = await loginAndOpen(page, backend);
    await createSavedMap(page);
    await generateReadyMap(page);
    await expect(page.getByRole('img', { name: 'Mosslight Crossing' })).toBeVisible();
    const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const workbench = page.getByTestId('create-map-workbench');
      const canvas = page.getByLabel('Map canvas');
      await expect(workbench).toBeVisible();
      await expectWithin(page.locator('[data-status="saved"]'), workbench);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      if (viewport.width === 390) {
        const inspector = page.getByLabel('Map plan and generation');
        const [workbenchBox, canvasBox] = await Promise.all([
          workbench.boundingBox(),
          canvas.boundingBox(),
        ]);
        expect(workbenchBox).not.toBeNull();
        expect(canvasBox).not.toBeNull();
        expect(canvasBox?.width).toBeGreaterThanOrEqual((workbenchBox?.width ?? 0) - 1);
        await expect.poll(async () => (await inspector.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(
          (workbenchBox?.x ?? 0) + (workbenchBox?.width ?? 0) - 1,
        );
        await page.getByRole('button', { name: 'Open source panel' }).click();
        const sourcePanel = page.getByLabel('Map source and references');
        await expect(sourcePanel).toBeVisible();
        expect((await sourcePanel.boundingBox())?.width).toBeGreaterThanOrEqual(280);
        await expect.poll(async () => (await inspector.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(
          (workbenchBox?.x ?? 0) + (workbenchBox?.width ?? 0) - 1,
        );
        await page.getByRole('button', { name: 'Close source panel' }).click();
        await expect.poll(async () => (await inspector.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(
          (workbenchBox?.x ?? 0) + (workbenchBox?.width ?? 0) - 1,
        );
        await expect.poll(async () => {
          const sourceBox = await sourcePanel.boundingBox();
          return sourceBox ? sourceBox.x + sourceBox.width : Number.POSITIVE_INFINITY;
        }).toBeLessThanOrEqual((workbenchBox?.x ?? 0) + 1);
        expect(await workbench.evaluate((element) => element.scrollLeft)).toBe(0);
      }
      const path = testInfo.outputPath(`create-map-v3-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path, fullPage: true });
      const stats = await sharp(path).stats();
      expect(stats.channels.slice(0, 3).some((channel) => channel.stdev >= 5)).toBe(true);
    }
    expect(browserFailures).toEqual({ pageErrors: [], requestFailures: [], responseFailures: [] });
  });
});
