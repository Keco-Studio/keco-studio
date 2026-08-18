import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));

import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import {
  createPublicGameDesignSystemVersion,
  PublicGameDesignSystemVersionError,
} from './gameDesignSystemWriteService.server';

const systemId = 'd2abed76-d085-4756-90ee-4facb696870b';
const parentId = 'f97722db-62b7-46f1-b409-a04f6e87d943';
const currentId = parentId;
const actorId = '095f196c-7141-469a-839e-1795ca8decca';
const idempotencyKey = 'de18138d-5a6c-4bd8-b399-46ab3da19911';

const document = {
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

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle' as const,
    title: 'Readable state',
    statement: 'Expose decision inputs.',
    appliesWhen: 'Presenting choices.',
    severity: 'required' as const,
  }],
  tableGuidance: [],
};

const supportedArtStyleInput = {
  presetId: 'pixel-art' as const,
  presetVersion: 2 as const,
  customization: { referenceGames: [] },
};

type VersionRow = Record<string, unknown> & {
  id: string;
  system_id: string;
  parent_version_id: string | null;
};

function versionRow(input: Partial<VersionRow> = {}): VersionRow {
  return {
    id: parentId,
    system_id: systemId,
    version_number: 1,
    parent_version_id: null,
    document,
    rules,
    art_style: null,
    rendered_markdown: '# Tactical rules',
    source_snapshots: [],
    diff: { added: [], removed: [], changed: [], conflicts: [] },
    conflicts: [],
    content_hash: 'a'.repeat(64),
    created_by: actorId,
    created_at: '2026-08-18T00:00:00.000Z',
    ...input,
  };
}

function mockServiceClient(input: {
  system?: Record<string, unknown> | null;
  versions?: VersionRow[];
  rpcError?: Record<string, unknown> | null;
  rpcResult?: (args: Record<string, unknown>) => Record<string, unknown>;
} = {}) {
  const versions = input.versions ?? [versionRow()];
  const system = input.system === undefined ? {
    id: systemId,
    owner_id: actorId,
    source: 'user',
    title: 'Tactical rules',
    summary: 'Readable tactics',
    current_version_id: currentId,
  } : input.system;
  const from = jest.fn((table: string) => ({
    select: jest.fn(() => ({
      eq: jest.fn((_column: string, value: unknown) => ({
        maybeSingle: jest.fn(async () => ({
          data: table === 'game_design_systems'
            ? system
            : versions.find((version) => version.id === value) ?? null,
          error: null,
        })),
      })),
    })),
  }));
  const rpc = jest.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: input.rpcError ? null : (input.rpcResult?.(args) ?? versionRow({
      id: '846d685a-fdfa-47de-a385-967fa9574e67',
      parent_version_id: parentId,
      version_number: 2,
      document: args.p_document,
      rules: args.p_rules,
      art_style: args.p_inherit_art_style
        ? versions.find((version) => version.id === args.p_parent_version_id)?.art_style ?? null
        : args.p_art_style,
      rendered_markdown: String(args.p_rendered_markdown).replace(
        '__KECO_ATOMIC_VERSION_LINE__',
        '2',
      ),
      source_snapshots: args.p_source_snapshots,
      diff: args.p_diff,
      conflicts: args.p_conflicts,
      content_hash: args.p_content_hash,
      idempotency_key: args.p_idempotency_key,
      generation_job_id: 'private-generation-job-id',
      future_private_column: 'private-future-value',
    })),
    error: input.rpcError ?? null,
  }));
  return { client: { from, rpc } as never, from, rpc };
}

function createInput(request: Record<string, unknown>) {
  return {
    systemId,
    actorId,
    idempotencyKey,
    request: {
      parentVersionId: parentId,
      expectedCurrentVersionId: currentId,
      ...request,
    },
  } as never;
}

describe('createPublicGameDesignSystemVersion', () => {
  it.each([
    ['structurally unknown', { schemaVersion: 99, presetId: 'future-neon', secret: 'raw-unknown-sentinel' }],
    ['schema-malformed', { schemaVersion: 1, presetId: 'pixel-art', presetVersion: 1, secret: 'raw-malformed-sentinel' }],
  ])('inherits %s Art Style JSON exactly for a Document-only version without exposing it', async (_label, rawArtStyle) => {
    const { client, rpc } = mockServiceClient({ versions: [versionRow({ art_style: rawArtStyle })] });

    const result = await createPublicGameDesignSystemVersion(client, createInput({
      document: { ...document, gameBackground: 'A rain-soaked orbital port.' },
    }));

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_art_style: null,
      p_inherit_art_style: true,
      p_document: { ...document, gameBackground: 'A rain-soaked orbital port.' },
      p_rules: rules,
      p_parent_version_id: parentId,
      p_expected_current_version_id: currentId,
      p_idempotency_key: idempotencyKey,
    }));
    expect(result.artStyle).toBeNull();
    expect(result.artStyleReadError).toEqual({ code: 'UNSUPPORTED_SNAPSHOT' });
    expect(JSON.stringify(result)).not.toContain(String(rawArtStyle.secret));
    expect(result).not.toHaveProperty('art_style');
    expect(result).not.toHaveProperty('idempotency_key');
    expect(result).not.toHaveProperty('generation_job_id');
    expect(result).not.toHaveProperty('future_private_column');
  });

  it('inherits malformed Art Style JSON exactly for a Rules-only version', async () => {
    const rawArtStyle = { schemaVersion: 1, presetId: 'pixel-art', secret: 'rules-only-raw-sentinel' };
    const changedRules = { ...rules, genres: ['Strategy', 'RPG'] };
    const { client, rpc } = mockServiceClient({ versions: [versionRow({ art_style: rawArtStyle })] });

    const result = await createPublicGameDesignSystemVersion(client, createInput({ rules: changedRules }));

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_art_style: null,
      p_inherit_art_style: true,
      p_document: document,
      p_rules: changedRules,
      p_diff: expect.objectContaining({ artStyle: { change: 'unchanged' } }),
    }));
    expect(JSON.stringify(result)).not.toContain(rawArtStyle.secret);
  });

  it('resolves simultaneous replacements and compiles only offered Art Style input', async () => {
    const rawArtStyle = { schemaVersion: 99, presetId: 'future-neon', secret: 'replace-me' };
    const changedDocument = { ...document, gameBackground: 'A clear desert arena.' };
    const changedRules = { ...rules, philosophies: ['Fast feedback'] };
    const { client, rpc } = mockServiceClient({ versions: [versionRow({ art_style: rawArtStyle })] });

    const result = await createPublicGameDesignSystemVersion(client, createInput({
      document: changedDocument,
      rules: changedRules,
      artStyle: supportedArtStyleInput,
    }));

    const compiled = compileGameArtStyle(supportedArtStyleInput);
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_document: changedDocument,
      p_rules: changedRules,
      p_art_style: compiled,
      p_inherit_art_style: false,
      p_diff: expect.objectContaining({
        schemaVersion: 2,
        document: { changedSections: ['gameBackground'] },
        artStyle: { change: 'preset_changed' },
        ruleSetSettingsChanged: true,
      }),
    }));
    expect(result.artStyle).toEqual(compiled);
    expect(result.artStyleReadError).toBeNull();
  });

  it('treats explicit null as an Art Style removal', async () => {
    const rawArtStyle = { schemaVersion: 99, presetId: 'future-neon', secret: 'clear-me' };
    const { client, rpc } = mockServiceClient({ versions: [versionRow({ art_style: rawArtStyle })] });

    const result = await createPublicGameDesignSystemVersion(client, createInput({ artStyle: null }));

    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_art_style: null,
      p_inherit_art_style: false,
      p_diff: expect.objectContaining({ artStyle: { change: 'removed' } }),
    }));
    expect(result.artStyle).toBeNull();
    expect(result.artStyleReadError).toBeNull();
  });

  it('defers a canonical no-op to the RPC after idempotency handling', async () => {
    const reorderedRules = {
      rules: rules.rules.map((rule) => ({
        severity: rule.severity,
        appliesWhen: rule.appliesWhen,
        statement: rule.statement,
        title: rule.title,
        kind: rule.kind,
        id: rule.id,
      })),
      tableGuidance: [],
      suitableFor: rules.suitableFor,
      philosophies: rules.philosophies,
      genres: rules.genres,
      schemaVersion: 1,
    };
    const { client, rpc } = mockServiceClient({
      versions: [versionRow({ rules: reorderedRules })],
      rpcError: { code: 'P0001', message: 'VERSION_NO_CHANGES' },
    });

    await expect(createPublicGameDesignSystemVersion(client, createInput({ rules }))).rejects.toMatchObject({
      code: 'VERSION_NO_CHANGES',
    });
    expect(rpc).toHaveBeenCalledWith('create_game_design_system_version', expect.objectContaining({
      p_parent_version_id: parentId,
      p_idempotency_key: idempotencyKey,
    }));
  });

  it.each([
    ['missing system', null, 'VERSION_SYSTEM_NOT_FOUND'],
    ['official system', { id: systemId, owner_id: null, source: 'official', title: 'Official', current_version_id: currentId }, 'VERSION_FORBIDDEN'],
    ['another owner', { id: systemId, owner_id: '65c1f64f-8851-4e68-94d0-1309c2b3f7d3', source: 'user', title: 'Foreign', current_version_id: currentId }, 'VERSION_FORBIDDEN'],
  ])('rejects %s before loading raw version data', async (_label, system, code) => {
    const { client, rpc } = mockServiceClient({ system });

    await expect(createPublicGameDesignSystemVersion(client, createInput({ rules: { ...rules, genres: ['RPG'] } })))
      .rejects.toMatchObject({ code });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires the public parent to belong to the destination system', async () => {
    const { client, rpc } = mockServiceClient({
      versions: [versionRow({ system_id: 'c831eb84-c058-45e2-adcf-27a613266833' })],
    });

    await expect(createPublicGameDesignSystemVersion(client, createInput({
      rules: { ...rules, genres: ['RPG'] },
    }))).rejects.toMatchObject({ code: 'VERSION_PARENT_INVALID' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects rule IDs reintroduced from any ancestor in the selected lineage', async () => {
    const ancestorId = '8afde008-e362-4fea-b538-2a37e243f896';
    const deletedRule = { ...rules.rules[0], id: 'deleted-rule', title: 'Deleted rule' };
    const parent = versionRow({ parent_version_id: ancestorId });
    const ancestor = versionRow({
      id: ancestorId,
      rules: { ...rules, rules: [...rules.rules, deletedRule] },
    });
    const { client, rpc } = mockServiceClient({ versions: [parent, ancestor] });

    await expect(createPublicGameDesignSystemVersion(client, createInput({
      rules: { ...rules, rules: [...rules.rules, deletedRule] },
    }))).rejects.toMatchObject({
      code: 'VERSION_RULE_REINTRODUCED',
      ruleIds: ['deleted-rule'],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'P0001', message: 'VERSION_STALE' }, 'VERSION_STALE'],
    [{ code: '23505', message: 'duplicate key: IDEMPOTENCY_CONFLICT' }, 'IDEMPOTENCY_CONFLICT'],
  ])('maps persistence conflict without retaining database details', async (rpcError, code) => {
    const { client } = mockServiceClient({ rpcError: { ...rpcError, details: 'private-database-detail' } });

    const caught = await createPublicGameDesignSystemVersion(client, createInput({
      rules: { ...rules, genres: ['RPG'] },
    })).catch((error) => error);

    expect(caught).toBeInstanceOf(PublicGameDesignSystemVersionError);
    expect(caught).toMatchObject({ code });
    expect(JSON.stringify(caught)).not.toContain('private-database-detail');
  });

  it('hydrates an idempotency replay through the same sanitized boundary', async () => {
    const rawArtStyle = { schemaVersion: 99, presetId: 'future-neon', secret: 'replay-raw-sentinel' };
    const { client } = mockServiceClient({
      versions: [versionRow({ art_style: rawArtStyle })],
      rpcResult: (args) => versionRow({
        id: '94c9ea38-eed4-4b7f-a35b-d6098d2a61c1',
        art_style: rawArtStyle,
        document: args.p_document,
        rules: args.p_rules,
        diff: args.p_diff,
        idempotency_key: idempotencyKey,
        generation_job_id: 'private-replay-job',
        future_private_column: 'private-replay-future',
      }),
    });

    const result = await createPublicGameDesignSystemVersion(client, createInput({
      rules: { ...rules, genres: ['RPG'] },
    }));

    expect(result.artStyleReadError).toEqual({ code: 'UNSUPPORTED_SNAPSHOT' });
    expect(JSON.stringify(result)).not.toContain(rawArtStyle.secret);
    expect(result).not.toHaveProperty('idempotency_key');
    expect(result).not.toHaveProperty('generation_job_id');
    expect(result).not.toHaveProperty('future_private_column');
  });
});
