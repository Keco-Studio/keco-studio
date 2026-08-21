import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));

import { DELETE as deleteSystem, PATCH as updateMetadata } from '@/app/api/game-design-systems/[id]/route';
import { POST as copySystem } from '@/app/api/game-design-systems/[id]/copy/route';
import { POST as createVersion } from '@/app/api/game-design-systems/[id]/versions/route';
import { POST as startGeneration } from '@/app/api/game-design-systems/generation-jobs/route';
import { PUT as applyProject } from '@/app/api/projects/[projectId]/game-design-system/route';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import {
  RLS_DB_TESTS_ENABLED,
  TEST_PASSWORD,
  anonClient,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './database/helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

const retainedRule = {
  id: 'retained-rule',
  kind: 'principle',
  title: 'Retained rule',
  statement: 'Keep decisions readable.',
  appliesWhen: 'Presenting a decision.',
  severity: 'required',
};

const deletedRule = {
  ...retainedRule,
  id: 'deleted-rule',
  title: 'Deleted rule',
};

function ruleSet(ruleIds: Array<'retained' | 'deleted'> = ['retained']) {
  return {
    schemaVersion: 1,
    genres: ['Strategy'],
    philosophies: ['Readable Systems'],
    suitableFor: 'Tactical games',
    rules: ruleIds.map((id) => id === 'retained' ? retainedRule : deletedRule),
    tableGuidance: [],
  };
}

const designDocument = {
  designIntent: 'Make every tactical choice legible before commitment.',
  playerFantasy: 'Lead a compact squad through risky decisions.',
  coreLoop: 'Scout, commit, resolve consequences, and adapt.',
  decisionStructure: 'Trade immediate safety for positional advantage.',
  systemBoundaries: 'Uncertainty may hide outcomes but never action costs.',
  progressionEconomy: 'New tools widen options without invalidating old ones.',
  contentModel: 'Combine objectives, terrain pressure, and enemy roles.',
  difficultyBalance: 'Increase decision pressure instead of inflating stats.',
  experiencePresentation: 'Show intent, costs, and state changes at the point of action.',
};

const artStyleInput = {
  presetId: 'pixel-art' as const,
  presetVersion: 2 as const,
  customization: { referenceGames: [] },
};
const artStyle = compileGameArtStyle(artStyleInput);

function request(url: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(`https://keco.test${url}`, { ...init, headers });
}

function jsonRequest(url: string, token: string, method: string, body: unknown, extraHeaders?: HeadersInit) {
  return request(url, token, {
    method,
    headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(extraHeaders)) },
    body: JSON.stringify(body),
  });
}

function versionRequest(url: string, token: string, body: unknown, idempotencyKey = randomUUID()) {
  return jsonRequest(url, token, 'POST', body, { 'Idempotency-Key': idempotencyKey });
}

describeDb('Game Design System route authentication boundary (live Auth)', () => {
  it.each([
    ['metadata update', () => updateMetadata(request('/api/game-design-systems/system-1', undefined, { method: 'PATCH' }), { params: Promise.resolve({ id: 'system-1' }) })],
    ['version creation', () => createVersion(request('/api/game-design-systems/system-1/versions', undefined, { method: 'POST' }), { params: Promise.resolve({ id: 'system-1' }) })],
    ['generation enqueue', () => startGeneration(request('/api/game-design-systems/generation-jobs', undefined, { method: 'POST' }), {})],
    ['project binding', () => applyProject(request('/api/projects/project-1/game-design-system', undefined, { method: 'PUT' }), { params: Promise.resolve({ projectId: 'project-1' }) })],
  ])('rejects unauthenticated %s requests before protected state', async (_label, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Please sign in to continue' });
  });
});

type SeededVersion = {
  id: string;
  systemId: string;
  versionNumber: number;
};

type SeededSystem = {
  id: string;
  versions: SeededVersion[];
};

describeDb('Game Design System route contracts (live Auth, RLS, and database)', () => {
  let fixture: ProjectFixture;
  let ownerToken = '';
  let editorToken = '';
  let ownerSystem: SeededSystem;
  let foreignSystem: SeededSystem;
  let officialSystem: SeededSystem;
  const systemIds: string[] = [];

  async function tokenFor(user: RlsUser): Promise<string> {
    const auth = anonClient();
    const { data, error } = await auth.auth.signInWithPassword({ email: user.email, password: TEST_PASSWORD });
    if (error || !data.session) throw new Error(`route sign-in failed: ${error?.message ?? 'no session'}`);
    return data.session.access_token;
  }

  async function seedSystem(input: {
    ownerId: string | null;
    source?: 'official' | 'user';
    title: string;
    versions?: Array<{
      rules: ReturnType<typeof ruleSet>;
      document?: typeof designDocument;
      artStyle?: unknown;
      parentVersionId?: string | null;
      sourceSnapshots?: Array<Record<string, unknown>>;
    }>;
  }): Promise<SeededSystem> {
    const system = await fixture.svc.from('game_design_systems').insert({
      owner_id: input.ownerId,
      source: input.source ?? 'user',
      title: `${input.title}-${fixture.suffix}-${randomUUID().slice(0, 8)}`,
      summary: 'Route contract fixture',
      genres: ['Strategy'],
      philosophies: ['Readable Systems'],
      suitable_for: 'Tactical games',
      body: '# Route contract fixture',
      status: 'draft',
    }).select('id').single();
    if (system.error || !system.data) throw new Error(`seed system failed: ${system.error?.message}`);
    const systemId = String(system.data.id);
    systemIds.push(systemId);

    const versions: SeededVersion[] = [];
    for (const [index, spec] of (input.versions ?? [{ rules: ruleSet() }]).entries()) {
      const versionNumber = index + 1;
      const inserted = await fixture.svc.from('game_design_system_versions').insert({
        system_id: systemId,
        version_number: versionNumber,
        parent_version_id: spec.parentVersionId ?? versions.at(-1)?.id ?? null,
        document: spec.document ?? designDocument,
        rules: spec.rules,
        art_style: spec.artStyle ?? null,
        rendered_markdown: `# ${input.title} version ${versionNumber}`,
        source_snapshots: spec.sourceSnapshots ?? [],
        diff: { added: spec.rules.rules.map((rule) => rule.id), removed: [], changed: [], conflicts: [] },
        conflicts: [],
        content_hash: createHash('sha256').update(`${systemId}:${versionNumber}:${randomUUID()}`).digest('hex'),
        created_by: input.ownerId,
      }).select('id').single();
      if (inserted.error || !inserted.data) throw new Error(`seed version failed: ${inserted.error?.message}`);
      versions.push({ id: String(inserted.data.id), systemId, versionNumber });
    }

    const current = await fixture.svc.from('game_design_systems')
      .update({ current_version_id: versions.at(-1)!.id })
      .eq('id', systemId);
    if (current.error) throw new Error(`set current version failed: ${current.error.message}`);
    return { id: systemId, versions };
  }

  async function bind(system: SeededSystem, actorId = fixture.owner.id) {
    const result = await fixture.svc.from('project_game_design_systems').upsert({
      project_id: fixture.projectId,
      design_system_id: system.id,
      version_id: system.versions.at(-1)!.id,
      applied_by: actorId,
    }, { onConflict: 'project_id' });
    if (result.error) throw new Error(`seed binding failed: ${result.error.message}`);
  }

  beforeAll(async () => {
    fixture = await buildProjectFixture();
    [ownerToken, editorToken] = await Promise.all([
      tokenFor(fixture.owner),
      tokenFor(fixture.editor),
    ]);
    ownerSystem = await seedSystem({ ownerId: fixture.owner.id, title: 'owner-system' });
    foreignSystem = await seedSystem({ ownerId: fixture.outsider.id, title: 'foreign-system' });
    officialSystem = await seedSystem({ ownerId: null, source: 'official', title: 'official-system' });
  }, 120_000);

  beforeEach(async () => {
    const cleared = await fixture.svc.from('project_game_design_systems').delete().eq('project_id', fixture.projectId);
    if (cleared.error) throw new Error(`clear binding failed: ${cleared.error.message}`);
  });

  afterAll(async () => {
    if (!fixture) return;
    await fixture.svc.from('project_game_design_systems').delete().eq('project_id', fixture.projectId);
    await fixture.svc.from('game_design_system_generation_jobs').delete().in('owner_id', [fixture.owner.id, fixture.outsider.id]);
    if (systemIds.length > 0) await fixture.svc.from('game_design_systems').delete().in('id', systemIds);
    await teardownProjectFixture(fixture);
  }, 60_000);

  it('requires an idempotency key and maps a real stored payload conflict to 409', async () => {
    const payload = { title: 'Rules', genres: ['RPG'], references: [], referenceGames: [], artStyle: artStyleInput };
    const missing = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST', payload,
    ), {});
    expect(missing.status).toBe(400);

    const key = `route-conflict-${fixture.suffix}`;
    const seeded = await fixture.svc.from('game_design_system_generation_jobs').insert({
      owner_id: fixture.owner.id,
      input: { seeded: true },
      status: 'queued',
      phase: 'collecting',
      idempotency_key: key,
      input_hash: 'different-payload',
    });
    if (seeded.error) throw new Error(`seed conflict job failed: ${seeded.error.message}`);

    const conflict = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST', payload,
      { 'idempotency-key': key },
    ), {});
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: 'Idempotency key was already used with a different payload.',
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('accepts a reference-game-only request through a stored idempotent job', async () => {
    const key = `reference-game-${fixture.suffix}`;
    const referenceGames = [{
      name: 'Into the Breach',
      reference: 'Readable intent',
      avoid: 'Direct copying',
    }];
    const input: ResolvedGameDesignGenerationInput = {
      title: 'Reference game rules',
      genres: [],
      philosophies: [],
      sourceSnapshots: [],
      referenceGames,
      artStyle,
    };
    const seeded = await fixture.svc.from('game_design_system_generation_jobs').insert({
      owner_id: fixture.owner.id,
      input,
      status: 'completed',
      phase: 'completed',
      idempotency_key: key,
      input_hash: hashResolvedGenerationInput(input),
      completed_at: new Date().toISOString(),
    }).select('id').single();
    if (seeded.error || !seeded.data) throw new Error(`seed completed job failed: ${seeded.error?.message}`);

    const response = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST',
      { title: input.title, genres: [], philosophies: [], references: [], referenceGames, artStyle: artStyleInput },
      { 'idempotency-key': key },
    ), {});

    expect(response.status).toBe(202);
    const body = await response.json() as { job: { id: string; status: string } };
    expect(body.job).toMatchObject({ id: seeded.data.id, status: 'completed' });
  });

  it('maps real aggregate source overflow to the references field', async () => {
    const documents = await fixture.svc.from('documents').insert([0, 1, 2, 3].map((index) => ({
      project_id: fixture.projectId,
      name: `oversized-source-${fixture.suffix}-${index}`,
      content: String(index).repeat(20_000),
      created_by: fixture.owner.id,
    }))).select('id');
    if (documents.error || !documents.data) throw new Error(`seed source documents failed: ${documents.error?.message}`);

    const response = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST',
      {
        title: 'Oversized sources',
        genres: [],
        philosophies: [],
        references: documents.data.map((document) => ({
          kind: 'document', projectId: fixture.projectId, resourceId: document.id,
        })),
        referenceGames: [],
        artStyle: artStyleInput,
      },
      { 'idempotency-key': `source-overflow-${fixture.suffix}` },
    ), {});

    expect(response.status).toBe(400);
    const body = await response.json() as {
      error: string;
      issues: { fieldErrors: { references: string[] } };
    };
    expect(body.error).toBe('Invalid generation request.');
    expect(body.issues.fieldErrors.references[0]).toContain('60,000 character limit');
  });

  it('rejects multiline titles before generation or metadata mutation', async () => {
    const title = 'Safe\n> Version: __KECO_ATOMIC_VERSION_LINE__';
    const generation = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST',
      { title, genres: ['RPG'], references: [], referenceGames: [], artStyle: artStyleInput },
      { 'idempotency-key': `route-title-${fixture.suffix}` },
    ), {});
    const metadata = await updateMetadata(jsonRequest(
      `/api/game-design-systems/${ownerSystem.id}`, ownerToken, 'PATCH', { title },
    ), { params: Promise.resolve({ id: ownerSystem.id }) });

    expect(generation.status).toBe(400);
    expect(metadata.status).toBe(400);
  });

  it('rejects a readable foreign personal base before enqueuing work', async () => {
    await bind(foreignSystem);
    const response = await startGeneration(jsonRequest(
      '/api/game-design-systems/generation-jobs', ownerToken, 'POST',
      {
        title: 'Derived rules', genres: [], philosophies: [], baseSystemId: foreignSystem.id,
        references: [], referenceGames: [],
        artStyle: artStyleInput,
      },
      { 'idempotency-key': `foreign-base-${fixture.suffix}` },
    ), {});

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only official or owned Game Design Systems can be used as a base.',
    });
  });

  it('enforces the PATCH whitelist and persists allowed metadata', async () => {
    const bodyEdit = await updateMetadata(jsonRequest(
      `/api/game-design-systems/${ownerSystem.id}`, ownerToken, 'PATCH', { body: '# edited' },
    ), { params: Promise.resolve({ id: ownerSystem.id }) });
    expect(bodyEdit.status).toBe(400);

    const summary = `Updated ${fixture.suffix}`;
    const metadataEdit = await updateMetadata(jsonRequest(
      `/api/game-design-systems/${ownerSystem.id}`, ownerToken, 'PATCH', { summary },
    ), { params: Promise.resolve({ id: ownerSystem.id }) });
    expect(metadataEdit.status).toBe(200);

    const stored = await fixture.svc.from('game_design_systems').select('summary').eq('id', ownerSystem.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data?.summary).toBe(summary);
  });

  it('does not copy a personal system that is only readable through a project binding', async () => {
    await bind(foreignSystem);
    const response = await copySystem(request(
      `/api/game-design-systems/${foreignSystem.id}/copy`, ownerToken, { method: 'POST' },
    ), { params: Promise.resolve({ id: foreignSystem.id }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only the owner can copy this Game Design System.',
    });
  });

  it('creates an immutable structured version for the owning user', async () => {
    const system = await seedSystem({ ownerId: fixture.owner.id, title: 'version-create' });
    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: system.versions[0].id,
        expectedCurrentVersionId: system.versions[0].id,
        document: designDocument,
        rules: ruleSet(['retained', 'deleted']),
      },
    ), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(201);
    const body = await response.json() as { version: { system_id: string; version_number: number; document: unknown } };
    expect(body.version).toMatchObject({ system_id: system.id, version_number: 2, document: designDocument });
  });

  it('enforces owner and same-system parent checks inside the service-role write boundary', async () => {
    const foreign = await seedSystem({ ownerId: fixture.outsider.id, title: 'version-foreign-owner' });
    const owned = await seedSystem({ ownerId: fixture.owner.id, title: 'version-cross-parent' });
    const foreignResponse = await createVersion(versionRequest(
      `/api/game-design-systems/${foreign.id}/versions`, ownerToken, {
        parentVersionId: foreign.versions[0].id,
        expectedCurrentVersionId: foreign.versions[0].id,
        rules: { ...ruleSet(), genres: ['RPG'] },
      },
    ), { params: Promise.resolve({ id: foreign.id }) });
    expect(foreignResponse.status).toBe(403);
    await expect(foreignResponse.json()).resolves.toMatchObject({ code: 'VERSION_FORBIDDEN' });

    const crossParentResponse = await createVersion(versionRequest(
      `/api/game-design-systems/${owned.id}/versions`, ownerToken, {
        parentVersionId: foreign.versions[0].id,
        expectedCurrentVersionId: owned.versions[0].id,
        rules: { ...ruleSet(), genres: ['RPG'] },
      },
    ), { params: Promise.resolve({ id: owned.id }) });
    expect(crossParentResponse.status).toBe(400);
    await expect(crossParentResponse.json()).resolves.toMatchObject({ code: 'VERSION_PARENT_INVALID' });
  });

  it('inherits omitted fields, replaces all three domains together, and explicitly clears Art Style', async () => {
    const system = await seedSystem({
      ownerId: fixture.owner.id,
      title: 'version-partial-replacement',
      versions: [{ rules: ruleSet(), document: designDocument, artStyle }],
    });
    const inheritedDocument = { ...designDocument, gameBackground: 'A rain-soaked orbital port.' };
    const inheritedResponse = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: system.versions[0].id,
        expectedCurrentVersionId: system.versions[0].id,
        document: inheritedDocument,
      },
    ), { params: Promise.resolve({ id: system.id }) });
    expect(inheritedResponse.status).toBe(201);
    const inheritedBody = await inheritedResponse.json() as { version: { id: string; rules: unknown; artStyle: unknown } };
    expect(inheritedBody.version).toMatchObject({ rules: ruleSet(), artStyle });

    const replacedRules = { ...ruleSet(), genres: ['Strategy', 'RPG'] };
    const replacementArtStyle = {
      ...artStyleInput,
      customization: { direction: 'Crisp moonlit silhouettes.', referenceGames: [] },
    };
    const replacedDocument = { ...inheritedDocument, gameBackground: 'A bright desert arena.' };
    const replacedResponse = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: inheritedBody.version.id,
        expectedCurrentVersionId: inheritedBody.version.id,
        document: replacedDocument,
        rules: replacedRules,
        artStyle: replacementArtStyle,
      },
    ), { params: Promise.resolve({ id: system.id }) });
    expect(replacedResponse.status).toBe(201);
    const replacedBody = await replacedResponse.json() as {
      version: { id: string; document: unknown; rules: unknown; artStyle: unknown; diff: { artStyle: unknown } };
    };
    expect(replacedBody.version).toMatchObject({
      document: replacedDocument,
      rules: replacedRules,
      artStyle: compileGameArtStyle(replacementArtStyle),
    });

    const clearedResponse = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: replacedBody.version.id,
        expectedCurrentVersionId: replacedBody.version.id,
        artStyle: null,
      },
    ), { params: Promise.resolve({ id: system.id }) });
    expect(clearedResponse.status).toBe(201);
    await expect(clearedResponse.json()).resolves.toMatchObject({
      version: {
        artStyle: null,
        artStyleReadError: null,
        diff: { artStyle: { change: 'removed' } },
      },
    });
  });

  it('never exposes inherited unsupported Art Style JSON in the live route response', async () => {
    const rawArtStyle = {
      schemaVersion: 99,
      presetId: 'future-neon',
      payload: { secret: `live-route-raw-sentinel-${fixture.suffix}` },
    };
    const system = await seedSystem({
      ownerId: fixture.owner.id,
      title: 'version-raw-route-boundary',
      versions: [{ rules: ruleSet(), document: designDocument, artStyle: rawArtStyle }],
    });

    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: system.versions[0].id,
        expectedCurrentVersionId: system.versions[0].id,
        document: { ...designDocument, gameBackground: 'A glass city at dawn.' },
      },
    ), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(201);
    const payload = await response.json() as { version: { id: string } };
    expect(payload).toMatchObject({
      version: {
        artStyle: null,
        artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' },
      },
    });
    expect(JSON.stringify(payload)).not.toContain(String(rawArtStyle.payload.secret));
    expect(payload.version).not.toHaveProperty('art_style');
    expect(payload.version).not.toHaveProperty('idempotency_key');
    expect(payload.version).not.toHaveProperty('generation_job_id');
    const stored = await fixture.svc.from('game_design_system_versions')
      .select('art_style').eq('id', payload.version.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data?.art_style).toEqual(rawArtStyle);
  });

  it('rejects canonical no-op, maps stale/key conflict, and returns an idempotent replay', async () => {
    const system = await seedSystem({ ownerId: fixture.owner.id, title: 'version-cas-replay' });
    const parentVersionId = system.versions[0].id;
    const noOp = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId,
        expectedCurrentVersionId: parentVersionId,
        rules: {
          rules: ruleSet().rules,
          tableGuidance: [],
          suitableFor: 'Tactical games',
          philosophies: ['Readable Systems'],
          genres: ['Strategy'],
          schemaVersion: 1,
        },
      },
    ), { params: Promise.resolve({ id: system.id }) });
    expect(noOp.status).toBe(409);
    await expect(noOp.json()).resolves.toMatchObject({ code: 'VERSION_NO_CHANGES' });

    const key = randomUUID();
    const firstRequest = {
      parentVersionId,
      expectedCurrentVersionId: parentVersionId,
      rules: { ...ruleSet(), genres: ['Strategy', 'RPG'] },
    };
    const first = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, firstRequest, key,
    ), { params: Promise.resolve({ id: system.id }) });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { version: { id: string } };

    const replay = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, firstRequest, key,
    ), { params: Promise.resolve({ id: system.id }) });
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({ version: { id: firstBody.version.id } });

    const conflict = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        ...firstRequest,
        rules: { ...ruleSet(), genres: ['Strategy', 'Simulation'] },
      }, key,
    ), { params: Promise.resolve({ id: system.id }) });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const stale = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        ...firstRequest,
        rules: { ...ruleSet(), genres: ['Strategy', 'Stealth'] },
      },
    ), { params: Promise.resolve({ id: system.id }) });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'VERSION_STALE' });
  });

  it('redacts inaccessible source excerpts from a created-version response', async () => {
    const inaccessibleProjectId = randomUUID();
    const secretExcerpt = `revoked-source-${fixture.suffix}`;
    const sourceSnapshots = [{
      kind: 'document',
      projectId: inaccessibleProjectId,
      resourceId: randomUUID(),
      label: 'Revoked source',
      contentHash: createHash('sha256').update(secretExcerpt).digest('hex'),
      excerpt: secretExcerpt,
      byteCount: secretExcerpt.length,
      truncated: false,
    }];
    const system = await seedSystem({
      ownerId: fixture.owner.id,
      title: 'version-source-redaction',
      versions: [{ rules: ruleSet(), sourceSnapshots }],
    });

    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: system.versions[0].id,
        expectedCurrentVersionId: system.versions[0].id,
        document: designDocument,
        rules: { ...ruleSet(), genres: ['Strategy', 'Stealth'] },
      },
    ), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(201);
    const body = await response.json() as { version: { id: string; source_snapshots: Array<{ excerpt?: string; contentHash: string }> } };
    expect(body.version.source_snapshots).toEqual([
      expect.objectContaining({ contentHash: sourceSnapshots[0].contentHash }),
    ]);
    expect(body.version.source_snapshots[0].excerpt).toBeUndefined();

    const stored = await fixture.svc.from('game_design_system_versions')
      .select('source_snapshots')
      .eq('id', body.version.id)
      .single();
    expect(stored.error).toBeNull();
    expect((stored.data?.source_snapshots as Array<{ excerpt?: string }>)[0].excerpt).toBe(secretExcerpt);
  });

  it('rejects an invalid design document before creating a version', async () => {
    const system = await seedSystem({ ownerId: fixture.owner.id, title: 'invalid-document' });
    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken, {
        parentVersionId: system.versions[0].id,
        expectedCurrentVersionId: system.versions[0].id,
        document: { ...designDocument, coreLoop: '' },
        rules: ruleSet(),
      },
    ), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid version request.',
      code: 'VERSION_REQUEST_INVALID',
      issues: { fieldErrors: { document: expect.any(Array) } },
    });
  });

  it('rejects a rule ID reintroduced after deletion in the selected parent lineage', async () => {
    const system = await seedSystem({
      ownerId: fixture.owner.id,
      title: 'lineage',
      versions: [
        { rules: ruleSet(['retained', 'deleted']) },
        { rules: ruleSet(['retained']) },
      ],
    });
    const parentVersionId = system.versions.at(-1)!.id;
    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${system.id}/versions`, ownerToken,
      {
        parentVersionId,
        expectedCurrentVersionId: parentVersionId,
        rules: ruleSet(['retained', 'deleted']),
      },
    ), { params: Promise.resolve({ id: system.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Rule IDs cannot be reintroduced after deletion.',
      code: 'VERSION_RULE_REINTRODUCED',
      ruleIds: ['deleted-rule'],
    });
  });

  it('checks delete-then-readd ambiguity across an external parent lineage', async () => {
    const external = await seedSystem({
      ownerId: fixture.outsider.id,
      title: 'external-parent',
      versions: [{ rules: ruleSet(['retained', 'deleted']) }],
    });
    const child = await seedSystem({
      ownerId: fixture.owner.id,
      title: 'external-child',
      versions: [{ rules: ruleSet(['retained']), parentVersionId: external.versions[0].id }],
    });
    const response = await createVersion(versionRequest(
      `/api/game-design-systems/${child.id}/versions`, ownerToken,
      {
        parentVersionId: child.versions[0].id,
        expectedCurrentVersionId: child.versions[0].id,
        rules: ruleSet(['retained', 'deleted']),
      },
    ), { params: Promise.resolve({ id: child.id }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Rule IDs cannot be reintroduced after deletion.',
      code: 'VERSION_RULE_REINTRODUCED',
      ruleIds: ['deleted-rule'],
    });
  });

  it('denies editor binding and lets the owner bind the explicit version', async () => {
    const route = `/api/projects/${fixture.projectId}/game-design-system`;
    const payload = { designSystemId: ownerSystem.id, versionId: ownerSystem.versions[0].id };
    const editor = await applyProject(jsonRequest(route, editorToken, 'PUT', payload), {
      params: Promise.resolve({ projectId: fixture.projectId }),
    });
    expect(editor.status).toBe(403);
    await expect(editor.json()).resolves.toEqual({
      error: 'Only project owners and admins can change the Game Design System.',
    });

    const owner = await applyProject(jsonRequest(route, ownerToken, 'PUT', payload), {
      params: Promise.resolve({ projectId: fixture.projectId }),
    });
    expect(owner.status).toBe(200);
    const stored = await fixture.svc.from('project_game_design_systems')
      .select('design_system_id,version_id,applied_by')
      .eq('project_id', fixture.projectId)
      .single();
    expect(stored.data).toEqual({
      design_system_id: ownerSystem.id,
      version_id: ownerSystem.versions[0].id,
      applied_by: fixture.owner.id,
    });
  });

  it('maps real delete outcomes to 404, 403, 409, and 200', async () => {
    const missingId = randomUUID();
    const missing = await deleteSystem(request(
      `/api/game-design-systems/${missingId}`, ownerToken, { method: 'DELETE' },
    ), { params: Promise.resolve({ id: missingId }) });
    expect(missing.status).toBe(404);

    const foreign = await deleteSystem(request(
      `/api/game-design-systems/${foreignSystem.id}`, ownerToken, { method: 'DELETE' },
    ), { params: Promise.resolve({ id: foreignSystem.id }) });
    expect(foreign.status).toBe(403);

    const official = await deleteSystem(request(
      `/api/game-design-systems/${officialSystem.id}`, ownerToken, { method: 'DELETE' },
    ), { params: Promise.resolve({ id: officialSystem.id }) });
    expect(official.status).toBe(403);

    await bind(ownerSystem);
    const bound = await deleteSystem(request(
      `/api/game-design-systems/${ownerSystem.id}`, ownerToken, { method: 'DELETE' },
    ), { params: Promise.resolve({ id: ownerSystem.id }) });
    expect(bound.status).toBe(409);

    await fixture.svc.from('project_game_design_systems').delete().eq('project_id', fixture.projectId);
    const disposable = await seedSystem({ ownerId: fixture.owner.id, title: 'delete-success' });
    const deleted = await deleteSystem(request(
      `/api/game-design-systems/${disposable.id}`, ownerToken, { method: 'DELETE' },
    ), { params: Promise.resolve({ id: disposable.id }) });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ ok: true });
    const remaining = await fixture.svc.from('game_design_systems').select('id').eq('id', disposable.id);
    expect(remaining.data).toEqual([]);
  });
});
